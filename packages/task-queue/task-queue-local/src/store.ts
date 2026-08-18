/**
 * Durable single-writer segment-log store for the task queue (§4.1).
 *
 * The active segment (`active.jsonl`) is append-only and fsynced line-by-line;
 * when it crosses the row/byte thresholds it is fsynced, sealed into
 * `segments/<first>-<last>.jsonl`, and replaced (with each parent directory
 * fsynced after the cross-directory rename). A `snapshot.json` cache carries a
 * sha256 state digest plus a per-line digest of the lastSeq line so boot can
 * skip a replay; any validation failure discards the cache and folds from the
 * earliest segment. Corrupt complete lines or sealed half-lines fail closed
 * with a `FaultedError`; only the active segment's torn tail is repaired by
 * truncation.
 * @module @deepseek-ai/dsh-task-queue-local/store
 */

import { createHash } from 'node:crypto'
import { open, readFile, rename, stat, mkdir, readdir } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  foldChanges,
  isTerminalStatus,
  canonicalQueueState,
  materializeTask,
} from '@deepseek-ai/dsh-task-queue'
import type { ChangeRecord, FoldedQueue, Task, NotificationRecord } from '@deepseek-ai/dsh-task-queue'
import { DIR_MODE, FILE_MODE, segmentPath } from './paths.ts'
import type { QueuePaths } from './paths.ts'

/** Rotation trigger: number of rows in the active segment. */
export const MAX_ACTIVE_ROWS = 10_000
/** Rotation trigger: byte size of the active segment. */
export const MAX_ACTIVE_BYTES = 8 * 1024 * 1024

/** Snapshots version tag (bumped only if the shape changes incompatibly). */
const SNAPSHOT_VERSION = 1

/** A corrupt log that must fail closed (operator quarantine + restart). */
export class FaultedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FaultedError'
  }
}

/** Change ops allowed on the wire, in exact-match form for strict parsing. */
const CHANGE_OPS = new Set([
  'created', 'starting', 'running', 'stopping',
  'succeeded', 'failed', 'requeued', 'canceled', 'dismissed', 'notification-acknowledged',
])

function fault(message: string): FaultedError {
  return new FaultedError(`task-queue store corrupt: ${message}`)
}

function isNotificationSnapshot(value: unknown): value is NotificationRecord {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.notificationId === 'string'
    && typeof v.taskId === 'string'
    && typeof v.ownerSessionId === 'string'
    && typeof v.messageId === 'string'
    && (v.status === 'pending' || v.status === 'acknowledged')
}

function isTaskSnapshot(value: unknown): value is Task {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string') return false
  if (typeof v.status !== 'string') return false
  if (typeof v.executor !== 'string') return false
  if (typeof v.attempt !== 'number') return false
  if (typeof v.maxAttempts !== 'number') return false
  if (typeof v.prompt !== 'string') return false
  if (typeof v.title !== 'string') return false
  if (!Array.isArray(v.runs)) return false
  if (!Array.isArray(v.tags)) return false
  return true
}

/**
 * Strict validation of one parsed change line (§3.1/§4.1); throws FaultedError.
 * @param parsed - the JSON-parsed change record to validate.
 * @returns the validated change record.
 */
export function parseChangeLine(parsed: unknown): ChangeRecord {
  if (typeof parsed !== 'object' || parsed === null) throw fault('change line is not an object')
  const change = parsed as Record<string, unknown>
  if (change.version !== 1) throw fault(`unsupported change version ${JSON.stringify(change.version)}`)
  if (typeof change.seq !== 'number' || !Number.isSafeInteger(change.seq) || change.seq < 1) {
    throw fault(`invalid change seq ${JSON.stringify(change.seq)}`)
  }
  if (typeof change.op !== 'string' || !CHANGE_OPS.has(change.op)) {
    throw fault(`invalid change op ${JSON.stringify(change.op)}`)
  }
  if (typeof change.at !== 'string') throw fault('change line missing string "at"')

  if (change.op === 'notification-acknowledged') {
    if (typeof change.notificationId !== 'string') throw fault('ack line missing notificationId')
    if (change.expectedStatus !== 'pending') throw fault('ack line expectedStatus must be "pending"')
    if (typeof change.expectedMessageId !== 'string') throw fault('ack line missing expectedMessageId')
    if (change.state === undefined || !isNotificationSnapshot(change.state)) {
      throw fault('ack line missing acknowledged notification state')
    }
    return change as unknown as ChangeRecord
  }

  if (typeof change.taskId !== 'string') throw fault(`change op ${change.op} missing taskId`)
  if (change.state === undefined || !isTaskSnapshot(change.state)) {
    throw fault(`change op ${change.op} missing valid task state`)
  }
  const task = change.state
  if (task.id !== change.taskId) throw fault('change taskId does not match state.id')
  if (task.source !== 'tool' && task.source !== 'inbox') throw fault('invalid task source')
  if (typeof task.receiptId !== 'string' || task.receiptId.length === 0) throw fault('invalid task receiptId')
  if (change.notification !== undefined && !isNotificationSnapshot(change.notification)) {
    throw fault('change notification payload invalid')
  }
  // Only terminal ops may attach a notification; non-terminal ops may not.
  if (change.notification !== undefined && !isTerminalOp(change.op)) {
    throw fault(`op ${change.op} must not attach a notification`)
  }
  return change as unknown as ChangeRecord
}

function isTerminalOp(op: string): boolean {
  return op === 'succeeded' || op === 'failed' || op === 'canceled'
}

/**
 * Parse the raw bytes of one full change line into its canonical record.
 * @param rawLine - the complete newline-terminated JSONL line.
 * @returns the validated change record.
 */
export function decodeChangeLine(rawLine: string): ChangeRecord {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawLine)
  } catch {
    throw fault('change line is not valid JSON')
  }
  return parseChangeLine(parsed)
}

/**
 * Canonical one-line serialization of a change record (no embedded newlines).
 * @param change - the change record to serialize.
 * @returns the single-line JSON string.
 */
export function serializeChange(change: ChangeRecord): string {
  return JSON.stringify(change)
}

/** Output of {@link TaskQueueStore.recover}. */
export interface RecoveredStore {
  folded: FoldedQueue
  nextSeq: number
  /** Repaired: the active segment had a torn tail that was truncated. */
  repairedTornTail: boolean
}

/**
 * Compute a sha256 hex digest of `data` bytes.
 * @param data - the string or buffer to hash.
 * @returns the hex sha256 digest.
 */
export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

interface SnapshotFile {
  version: 1
  lastSeq: number
  lastChangeDigest: string
  stateDigest: string
  tasks: Task[]
  notifications: NotificationRecord[]
}

/** Parse and validate a snapshot file's header (version + digests + arrays). */
function validateSnapshot(parsed: unknown): parsed is SnapshotFile {
  if (typeof parsed !== 'object' || parsed === null) return false
  const v = parsed as Record<string, unknown>
  if (v.version !== 1) return false
  if (typeof v.lastSeq !== 'number' || !Number.isSafeInteger(v.lastSeq) || v.lastSeq < 0) return false
  if (typeof v.lastChangeDigest !== 'string') return false
  if (typeof v.stateDigest !== 'string') return false
  if (!Array.isArray(v.tasks) || !v.tasks.every(isTaskSnapshot)) return false
  if (!Array.isArray(v.notifications) || !v.notifications.every(isNotificationSnapshot)) return false
  return true
}

/** Fold `tasks`/`notifications` arrays into id-keyed maps (snapshot replay shape). */
function foldFromArrays(tasks: Task[], notifications: NotificationRecord[], lastSeq: number): FoldedQueue {
  const tasksById = new Map<Task['id'], Task>()
  for (const task of tasks) tasksById.set(task.id, materializeTask(task))
  const notificationsById = new Map<NotificationRecord['notificationId'], NotificationRecord>()
  for (const notification of notifications) notificationsById.set(notification.notificationId, notification)
  return { tasksById, notificationsById, lastSeq }
}

/**
 * Durable single-writer store over one queue root. All mutations are expected
 * to already be serialized by the service FIFO; this class owns only fsync and
 * rotation bookkeeping, not mutual exclusion across calls.
 */
export class TaskQueueStore {
  private maxSeq = 0
  private activeRows = 0
  private activeBytes = 0
  private activeExpectedSeq = 1

  /** The fixed on-disk sub-path layout for this store's root. */
  readonly paths: QueuePaths

  constructor(root: string) {
    this.paths = {
      root,
      active: `${root}/active.jsonl`,
      segmentsDir: `${root}/segments`,
      snapshot: `${root}/snapshot.json`,
      inboxDir: `${root}/inbox`,
      quarantineDir: `${root}/quarantine`,
      runsDir: `${root}/runs`,
      outputDir: `${root}/output`,
    }
  }

  /** Ensure the whole on-disk layout exists with owner-only modes. */
  async ensureLayout(): Promise<void> {
    const { segmentsDir, inboxDir, quarantineDir, runsDir, outputDir, root } = this.paths
    await mkdir(segmentsDir, { recursive: true, mode: DIR_MODE })
    await mkdir(inboxDir, { recursive: true, mode: DIR_MODE })
    await mkdir(quarantineDir, { recursive: true, mode: DIR_MODE })
    await mkdir(runsDir, { recursive: true, mode: DIR_MODE })
    await mkdir(outputDir, { recursive: true, mode: DIR_MODE })
    await mkdir(root, { recursive: true, mode: DIR_MODE })
  }

  /** The store's in-memory high-water seq (0 when nothing has been appended yet). */
  get durableMaxSeq(): number {
    return this.maxSeq
  }

  /**
   * Append one change line with the full durability protocol: open('a') →
   * write one line (JSON, no embedded newlines) → fsync(file); on first
   * creation the parent directory is also fsynced. Rotates the active segment
   * when it crosses the row/byte thresholds.
   * @param change - the change record to append and fsync.
   * @returns the number of bytes appended (excluding the newline).
   */
  async appendActive(change: ChangeRecord): Promise<number> {
    await this.ensureLayout()
    const line = serializeChange(change) + '\n'
    const bytes = Buffer.byteLength(line, 'utf8')

    let isNew = false
    try {
      await stat(this.paths.active)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') isNew = true
      else throw error
    }
    const handle = await open(this.paths.active, 'a', FILE_MODE)
    try {
      await handle.writeFile(line, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (isNew) await this.fsyncDir(this.paths.root)

    this.activeBytes += bytes
    this.activeRows += 1
    this.maxSeq = change.seq
    if (this.activeRows > MAX_ACTIVE_ROWS || this.activeBytes > MAX_ACTIVE_BYTES) {
      await this.rotate()
    }
    return bytes
  }

  /** fsync a directory; tolerated on platforms where dir fsync is unsupported. */
  private async fsyncDir(dir: string): Promise<void> {
    try {
      const handle = await open(dir, 'r')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOTSUP' || code === 'EINVAL' || code === 'EISDIR' || code === 'EPERM') return
      throw error
    }
  }

  /** Seal the active segment into `segments/<first>-<last>.jsonl` and recreate it. */
  private async rotate(): Promise<void> {
    const { active, segmentsDir, root } = this.paths
    const handle = await open(active, 'r')
    await handle.sync()
    await handle.close()

    const first = this.activeExpectedSeq
    const last = this.maxSeq
    const target = segmentPath(root, first, last)

    await rename(active, target)
    await this.fsyncDir(segmentsDir)
    await this.fsyncDir(root)

    const fresh = await open(active, 'wx', FILE_MODE)
    await fresh.sync()
    await fresh.close()
    await this.fsyncDir(root)

    this.activeExpectedSeq = last + 1
    this.activeRows = 0
    this.activeBytes = 0
  }

  /**
   * Compute and write the snapshot cache over a folded state at `lastSeq`.
   * @param folded - the folded state to materialize into the cache.
   * @param lastChangeDigest - the digest of the lastSeq line, stored for boot validation.
   */
  async cacheSnapshot(folded: FoldedQueue, lastChangeDigest: string): Promise<void> {
    const { snapshot, root } = this.paths
    const stateDigest = sha256(canonicalQueueState(folded))
    const tasks = [...folded.tasksById.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    const notifications = [...folded.notificationsById.values()]
      .sort((a, b) => a.notificationId < b.notificationId ? -1 : a.notificationId > b.notificationId ? 1 : 0)
    const payload = JSON.stringify({
      version: SNAPSHOT_VERSION,
      lastSeq: folded.lastSeq,
      lastChangeDigest,
      stateDigest,
      tasks,
      notifications,
    })
    await writeFileAtomic(snapshot, payload, { mode: FILE_MODE, dirMode: DIR_MODE })
    // fsync the replacement file. Windows refuses to fsync a read-only handle
    // (EPERM), so open writable; the EPERM/EINVAL tolerance below matches
    // fsyncDir's platform behavior.
    try {
      const handle = await open(snapshot, 'r+')
      try {
        await handle.sync()
      } finally {
        await handle.close()
      }
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EINVAL' || code === 'EISDIR') return
      throw error
    }
    await this.fsyncDir(root)
  }

  /**
   * The raw bytes (including the trailing newline) of the change at `seq`.
   * @param seq - the seq number whose raw line bytes to return.
   * @returns the raw line bytes, or an empty buffer when the seq is not the durable tail.
   */
  async rawLineBytes(seq: number): Promise<Buffer> {
    // Read from active or a sealed segment; used to compute the lastChangeDigest.
    const activeRaw = await readFile(this.paths.active, 'utf8')
    const split = splitCompleteLines(activeRaw)
    const all = split.lines
    // We only need the lastSeq line from the active tail for the common case.
    const line = all[all.length - 1]
    if (line !== undefined) {
      const parsed = decodeChangeLine(line)
      if (parsed.seq === seq) return Buffer.from(line + '\n', 'utf8')
    }
    // Fall back to sealed segments (full scan).
    const fallback = await this.recover()
    const last = fallback.nextSeq - 1
    if (last === seq) {
      const tail = split.lines
      const lastLine = tail[tail.length - 1]
      if (lastLine !== undefined) return Buffer.from(lastLine + '\n', 'utf8')
    }
    return Buffer.alloc(0)
  }

  /**
   * Fold the full durable log from the earliest sealed segment plus the active
   * tail, enforcing filename/seq continuity. Throws `FaultedError` on any
   * sealed half-line, seq gap/duplicate, or invalid change line; repairs only
   * the active segment's torn final line by truncation + fsync (§4.1).
   * @returns the folded state plus the next seq to allocate, and whether a torn tail was repaired.
   */
  async recover(): Promise<RecoveredStore> {
    await this.ensureLayout()
    const { segmentsDir, active, root } = this.paths

    const entries = (await readdir(segmentsDir)).filter(name => name.endsWith('.jsonl'))
    const sealed: Array<{ first: number; last: number; name: string }> = []
    for (const name of entries) {
      const match = /^(\d+)-(\d+)\.jsonl$/.exec(name)
      if (match === null) throw fault(`invalid sealed segment filename ${JSON.stringify(name)}`)
      const first = Number(match[1])
      const last = Number(match[2])
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first) {
        throw fault(`invalid sealed segment range ${JSON.stringify(name)}`)
      }
      sealed.push({ first, last, name })
    }
    sealed.sort((a, b) => a.first - b.first)

    const changes: ChangeRecord[] = []
    const lastChangeBytesBySeq = new Map<number, string>()
    let expectedSeq = 1
    for (const seg of sealed) {
      if (seg.first !== expectedSeq) {
        throw fault(`sealed segment gap: expected seq ${expectedSeq}, ${seg.name} starts at ${seg.first}`)
      }
      const raw = await readFile(segmentPath(root, seg.first, seg.last), 'utf8')
      const split = splitCompleteLines(raw)
      if (split.trailing !== '') throw fault(`sealed segment ${seg.name} has a torn final line`)
      let index = 0
      for (const line of split.lines) {
        const change = decodeChangeLine(line)
        if (change.seq !== seg.first + index) {
          throw fault(`sealed segment ${seg.name} seq gap at line ${index + 1}: expected ${seg.first + index}, got ${change.seq}`)
        }
        changes.push(change)
        lastChangeBytesBySeq.set(change.seq, line)
        index += 1
      }
      const declaredLast = seg.first + split.lines.length - 1
      if (declaredLast !== seg.last) {
        throw fault(`sealed segment ${seg.name} declares last ${seg.last} but contains ${declaredLast}`)
      }
      expectedSeq = seg.last + 1
    }

    // Active segment: may be absent, may carry a torn tail, must be contiguous.
    let activeRaw = ''
    try {
      activeRaw = await readFile(active, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const split = splitCompleteLines(activeRaw)
    const tornTail = split.trailing !== ''
    for (const line of split.lines) {
      const change = decodeChangeLine(line)
      if (change.seq !== expectedSeq) {
        throw fault(`active segment seq gap: expected ${expectedSeq}, got ${change.seq}`)
      }
      changes.push(change)
      lastChangeBytesBySeq.set(change.seq, line)
      expectedSeq += 1
    }

    // Repair the active torn tail by truncation + fsync (the only recoverable corruption).
    if (tornTail) {
      const keep = split.lines.map(line => line + '\n').join('')
      const handle = await open(active, 'r+', FILE_MODE)
      try {
        await handle.truncate(Buffer.byteLength(keep, 'utf8'))
        await handle.sync()
      } finally {
        await handle.close()
      }
    }

    const maxSeq = expectedSeq - 1
    this.maxSeq = maxSeq
    this.activeExpectedSeq = sealed.length > 0 ? (sealed[sealed.length - 1]?.last ?? 0) + 1 : 1
    this.activeRows = split.lines.length
    this.activeBytes = Buffer.byteLength(split.lines.map(l => l + '\n').join(''), 'utf8')

    // 4. snapshot-based replay, else full fold.
    const folded = await this.trySnapshot(changes, maxSeq, lastChangeBytesBySeq)

    return { folded, nextSeq: maxSeq + 1, repairedTornTail: tornTail }
  }

  /** Snapshot-based replay with digest gates; falls back to a full fold. */
  private async trySnapshot(
    changes: ChangeRecord[],
    maxSeq: number,
    bytesBySeq: Map<number, string>,
  ): Promise<FoldedQueue> {
    try {
      const raw = await readFile(this.paths.snapshot, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!validateSnapshot(parsed)) return foldChanges(changes)
      if (parsed.lastSeq > maxSeq) return foldChanges(changes)
      // stateDigest gate: the snapshot's materialized state must match itself.
      const snapshotFolded = foldFromArrays(parsed.tasks, parsed.notifications, parsed.lastSeq)
      if (sha256(canonicalQueueState(snapshotFolded)) !== parsed.stateDigest) return foldChanges(changes)
      // lastChangeDigest gate: the raw lastSeq line in the durable log must match.
      const rawLine = parsed.lastSeq === 0 ? '' : bytesBySeq.get(parsed.lastSeq)
      if (sha256(rawLine ?? '') !== parsed.lastChangeDigest) return foldChanges(changes)
      // Replay only the tail after the snapshot baseline, folded over the maps.
      const tail = foldChanges(changes.filter(change => change.seq > parsed.lastSeq))
      const tasksById = new Map(snapshotFolded.tasksById)
      const notificationsById = new Map(snapshotFolded.notificationsById)
      for (const [id, task] of tail.tasksById) tasksById.set(id, task)
      for (const [id, notification] of tail.notificationsById) notificationsById.set(id, notification)
      return { tasksById, notificationsById, lastSeq: maxSeq }
    } catch {
      return foldChanges(changes)
    }
  }
}

/** Split a JSONL body into complete lines plus any trailing non-newline fragment. */
function splitCompleteLines(raw: string): { lines: string[]; trailing: string } {
  if (raw === '') return { lines: [], trailing: '' }
  const endsWithNewline = raw.endsWith('\n')
  const trimmed = endsWithNewline ? raw.slice(0, -1) : raw
  const parts = trimmed.split('\n')
  if (endsWithNewline) return { lines: parts, trailing: '' }
  const last = parts.pop() ?? ''
  return { lines: parts, trailing: last }
}

export { isTerminalStatus }
export type { ChangeRecord, FoldedQueue, Task, NotificationRecord }
