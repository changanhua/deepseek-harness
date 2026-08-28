/**
 * Cross-process single-writer ownership for one queue root (§4.1).
 *
 * The segment store assumes exactly one writer per queue root; without an
 * ownership check a second host process would `recover()` the log and then
 * `reclaimCrashed()` the first host's live starting/running tasks as crash
 * leftovers. The lock is one `owner.lock` file acquired through an atomic
 * `link(2)` from a fully written temporary file, so the lock path never
 * exposes a half-written identity. A lock whose recorded pid is dead (the
 * previous host crashed) is archived into `quarantine/` and taken over; a
 * lock held by a live pid, or by a different host machine, refuses startup —
 * the queue then fails loud instead of silently corrupting shared state.
 * @module @deepseek-ai/dsh-task-queue-local/lock
 */

import { randomUUID } from 'node:crypto'
import { link, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { DIR_MODE, FILE_MODE } from './paths.ts'

/** Lock file name under the queue root. */
const LOCK_NAME = 'owner.lock'

/** The persisted identity of the one host process owning a queue root. */
export interface OwnerLockFile {
  version: 1
  /** Operating-system process id of the owning host. */
  pid: number
  /** Per-acquisition UUID; distinguishes successive owners with one pid. */
  bootId: string
  /** Host machine name at acquisition time. */
  hostname: string
  /** ISO timestamp of acquisition. */
  acquiredAt: string
}

/** Refusal to start: the queue root already has a live (or unverifiable) owner. */
export class QueueOwnershipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueueOwnershipError'
  }
}

/** A held queue-root ownership; `release` removes the lock file (best-effort). */
export interface QueueOwnership {
  release(): Promise<void>
}

/** Serialize one owner identity into the canonical lock file body. */
function renderLock(file: OwnerLockFile): string {
  return JSON.stringify(file)
}

/** Parse a lock body; `undefined` when it is not a well-formed owner identity. */
function parseLock(raw: string): OwnerLockFile | undefined {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const v = parsed as Record<string, unknown>
    if (v.version !== 1) return undefined
    if (typeof v.pid !== 'number' || !Number.isSafeInteger(v.pid) || v.pid <= 0) return undefined
    if (typeof v.bootId !== 'string' || v.bootId.length === 0) return undefined
    if (typeof v.hostname !== 'string' || v.hostname.length === 0) return undefined
    if (typeof v.acquiredAt !== 'string') return undefined
    return { version: 1, pid: v.pid, bootId: v.bootId, hostname: v.hostname, acquiredAt: v.acquiredAt }
  } catch {
    return undefined
  }
}

/**
 * Whether `pid` names a live process on this machine. `process.kill(pid, 0)`
 * signals nothing; ESRCH means dead, EPERM means alive but not signalable.
 */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Atomically create the lock from a fully written temporary file. Returns
 * `true` on acquisition; `false` when the lock path already exists (any
 * errno), re-checked with `stat` so a Windows EPERM cannot read as a
 * permission failure.
 */
async function tryLinkLock(root: string, body: string): Promise<boolean> {
  const tmp = join(root, `.owner.lock.${randomUUID()}.tmp`)
  const handle = await open(tmp, 'wx', FILE_MODE)
  try {
    await handle.writeFile(body, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await link(tmp, join(root, LOCK_NAME))
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'EPERM') throw error
    // EPERM can mean "target exists" on Windows or a real permission problem;
    // only treat it as "already locked" when the lock path is present.
    try {
      await stat(join(root, LOCK_NAME))
      return false
    } catch {
      throw error
    }
  } finally {
    await unlink(tmp).catch(() => {})
  }
}

/**
 * Acquire single-writer ownership of the queue root at `root`.
 * @param root - the queue root directory to own.
 * @returns the held ownership; call `release()` on teardown.
 * @throws QueueOwnershipError when a live or unverifiable owner already holds
 * the root, or the lock content is unreadable.
 */
export async function acquireQueueOwnership(root: string): Promise<QueueOwnership> {
  await mkdir(root, { recursive: true, mode: DIR_MODE })
  const file: OwnerLockFile = {
    version: 1,
    pid: process.pid,
    bootId: randomUUID(),
    hostname: hostname(),
    acquiredAt: new Date().toISOString(),
  }
  const lockPath = join(root, LOCK_NAME)

  if (await tryLinkLock(root, renderLock(file))) return makeOwnership(lockPath)

  const existing = parseLock(await readFile(lockPath, 'utf8'))
  if (existing === undefined) {
    throw new QueueOwnershipError(
      `task-queue queue root ${root}: owner lock ${LOCK_NAME} is unreadable; remove or archive it manually before restarting`,
    )
  }
  if (existing.hostname !== file.hostname) {
    throw new QueueOwnershipError(
      `task-queue queue root ${root}: owned by host "${existing.hostname}" (pid ${existing.pid}, acquired ${existing.acquiredAt}); a shared queue root across machines is not supported`,
    )
  }
  if (existing.pid === process.pid) {
    throw new QueueOwnershipError(
      `task-queue queue root ${root}: owner lock held by this process (pid ${process.pid}); only one task-queue backend per queue root per process`,
    )
  }
  if (isPidAlive(existing.pid)) {
    throw new QueueOwnershipError(
      `task-queue queue root ${root}: already owned by a live host process (pid ${existing.pid}, acquired ${existing.acquiredAt}); only one writer per queue root is allowed`,
    )
  }

  // Stale lock: the recorded owner is dead. Archive it out of the way and
  // retry once — `rename` fails with ENOENT when another process archived it
  // first, and the retried link then either wins or sees the new live owner.
  await mkdir(join(root, 'quarantine'), { recursive: true, mode: DIR_MODE })
  try {
    await rename(lockPath, join(root, 'quarantine', `owner-stale-${randomUUID()}.lock`))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw error
  }
  if (await tryLinkLock(root, renderLock(file))) return makeOwnership(lockPath)

  const replacer = parseLock(await readFile(lockPath, 'utf8'))
  if (replacer === undefined || replacer.hostname !== file.hostname || isPidAlive(replacer.pid)) {
    throw new QueueOwnershipError(
      `task-queue queue root ${root}: lost the stale-takeover race to another host process; retry startup`,
    )
  }
  // replacer is this process on a different call — same-pid already caught above.
  throw new QueueOwnershipError(
    `task-queue queue root ${root}: owner lock held by this process (pid ${replacer.pid}); only one task-queue backend per queue root per process`,
  )
}

/** Build the ownership handle for a lock file this call created. */
function makeOwnership(lockPath: string): QueueOwnership {
  return {
    async release(): Promise<void> {
      await unlink(lockPath).catch(() => {})
    },
  }
}
