/** Durable ChangeSet store for the Queue v2 canary root. */
import { createHash } from 'node:crypto'
import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { applyChange, canonicalJson, foldChanges, hydrateFoldedQueue, snapshotFoldedQueue } from '@deepseek-ai/dsh-task-queue'
import type { ChangeSet, QueueFoldSnapshot } from '@deepseek-ai/dsh-task-queue'
import type { FoldedQueue } from '@deepseek-ai/dsh-task-queue'
import { acquireQueueOwnership } from './lock.ts'
import type { QueueOwnership } from './lock.ts'

const MANIFEST_VERSION = 3
interface Manifest { readonly schemaVersion: number }
interface SnapshotFile { readonly schemaVersion: number; readonly digest: string; readonly projection: QueueFoldSnapshot }

/** Append-only storage isolated from the legacy task-queue root. */
export class WorkQueueStore {
  /** Append-only ChangeSet log path. */
  readonly logPath: string
  /** Optional folded projection cache path. */
  readonly snapshotPath: string
  private projection: FoldedQueue = foldChanges([])
  private tail: Promise<void> = Promise.resolve()
  private ownership: QueueOwnership | undefined

  /** @param root - Dedicated Queue v2 root. */
  constructor(readonly root: string) {
    this.logPath = join(root, 'active.jsonl')
    this.snapshotPath = join(root, 'snapshot.json')
  }

  /**
   * Create or recover the isolated v2 root.
   * @returns Recovered folded Queue projection.
   */
  async open(): Promise<FoldedQueue> {
    await mkdir(this.root, { recursive: true })
    this.ownership = await acquireQueueOwnership(this.root)
    const manifestPath = join(this.root, 'manifest.json')
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest
      if (manifest.schemaVersion !== MANIFEST_VERSION) throw new Error(`task queue v2 refuses schemaVersion ${String(manifest.schemaVersion)} at ${this.root}`)
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      await writeFile(manifestPath, `${canonicalJson({ schemaVersion: MANIFEST_VERSION })}\n`, 'utf8')
    }
    try {
      this.projection = await this.recover()
      return this.projection
    } catch (error) {
      await this.close()
      throw error
    }
  }

  /** Release the exclusive root lock after active executions have drained. */
  async close(): Promise<void> {
    await this.drain()
    const ownership = this.ownership
    this.ownership = undefined
    await ownership?.release()
  }

  /**
   * Return the current folded projection.
   * @returns Current in-memory projection.
   */
  current(): FoldedQueue { return this.projection }

  /**
   * Serialize one durable mutation while callers prepare work outside the FIFO.
   * @param operation Mutation executed after earlier transactions settle.
   * @returns Operation result.
   */
  async transaction<T>(operation: () => Promise<T>): Promise<T> {
    const prior = this.tail
    const gate = Promise.withResolvers<void>()
    this.tail = gate.promise
    await prior
    try {
      return await operation()
    } finally {
      gate.resolve()
    }
  }

  /** Await every mutation admitted before this call. */
  async drain(): Promise<void> { await this.tail }

  /**
   * Append and fsync one next ChangeSet before exposing it.
   * @param change Next contiguous ChangeSet.
   * @returns Updated folded Queue projection.
   */
  async append(change: ChangeSet): Promise<FoldedQueue> {
    applyChange(this.projection, change)
    const handle = await open(this.logPath, 'a')
    try {
      await handle.writeFile(`${canonicalJson(change)}\n`, 'utf8')
      await handle.sync()
    } catch (error) {
      this.projection = await this.recover()
      throw error
    } finally {
      await handle.close()
    }
    return this.projection
  }

  /** Atomically cache the projection; JSONL remains authoritative. */
  async writeSnapshot(): Promise<void> {
    const projection = snapshotFoldedQueue(this.projection)
    const value: SnapshotFile = { schemaVersion: MANIFEST_VERSION, projection, digest: digest(projection) }
    const temporary = `${this.snapshotPath}.tmp`
    await writeFile(temporary, `${canonicalJson(value)}\n`, 'utf8')
    await rename(temporary, this.snapshotPath)
  }

  private async recover(): Promise<FoldedQueue> {
    const changes = await this.readLog()
    const snapshot = await this.readSnapshot()
    if (snapshot === null) return foldChanges(changes)
    const projection = hydrateFoldedQueue(snapshot)
    for (const change of changes) if (change.seq > projection.lastSeq) applyChange(projection, change)
    return projection
  }

  private async readLog(): Promise<readonly ChangeSet[]> {
    try {
      return (await readFile(this.logPath, 'utf8')).split('\n').filter(Boolean).map((line, index) => {
        try { return JSON.parse(line) as ChangeSet } catch { throw new Error(`task queue v2 corrupt JSONL at line ${index + 1}`) }
      })
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
      throw error
    }
  }

  private async readSnapshot(): Promise<QueueFoldSnapshot | null> {
    try {
      const value = JSON.parse(await readFile(this.snapshotPath, 'utf8')) as SnapshotFile
      return value.schemaVersion === MANIFEST_VERSION && digest(value.projection) === value.digest ? value.projection : null
    } catch { return null }
  }
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`
}
