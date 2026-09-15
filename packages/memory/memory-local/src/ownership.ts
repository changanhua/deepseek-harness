/** Single-process ownership of one local memory storage root. @module @changanhua/dsh-memory-local/ownership */
import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises'
import { hostname } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** A held lock must be released only after its domain has drained and closed. */
export interface MemoryOwnership {
  release(): Promise<void>
}

/** Startup or cleanup could not prove sole ownership; the lock is retained for inspection. */
export class MemoryOwnershipError extends Error {
  /** Stable refusal code for callers inspecting ownership failures. */
  readonly code = 'ownership-unavailable'
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MemoryOwnershipError'
  }
}

/**
 * Publish a complete owner identity atomically; existing locks are never stolen.
 * @param root - Absolute local directory shared by every host targeting the same memory storage.
 * @returns an idempotent release handle whose token is checked before unlinking.
 */
export async function acquireMemoryOwnership(root: string): Promise<MemoryOwnership> {
  if (!isAbsolute(root) || root.startsWith('\\\\') || root.startsWith('//')) {
    throw new MemoryOwnershipError('memory ownership requires an absolute local directory')
  }
  await mkdir(root, { recursive: true, mode: 0o700 })
  const directory = await realpath(root)
  const token = randomUUID()
  const file = join(directory, 'owner.lock')
  const temporary = join(directory, `.owner-${token}.tmp`)
  const owner = { version: 1, hostname: hostname(), pid: process.pid, token, acquiredAt: new Date().toISOString() }
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify(owner), 'utf8')
    await handle.sync()
    await handle.close()
  } catch (error) {
    const failures = [error]
    try { await handle.close() }
    catch (cleanupError) { failures.push(cleanupError) }
    try { await unlink(temporary) }
    catch (cleanupError) { failures.push(cleanupError) }
    if (failures.length > 1) throw new AggregateError(failures, 'memory owner creation and cleanup failed')
    throw error
  }
  try {
    await link(temporary, file)
  } catch (error) {
    const failure = new MemoryOwnershipError(
      `cannot acquire memory ownership at ${file}; verify the prior Host has stopped before removing that exact lock`, { cause: error },
    )
    try { await unlink(temporary) }
    catch (cleanupError) { throw new AggregateError([failure, cleanupError], 'memory owner publication and cleanup failed') }
    throw failure
  }
  let releasePromise: Promise<void> | undefined
  const ownership: MemoryOwnership = {
    release() {
      return releasePromise ??= (async () => {
        try {
          const info = await lstat(file)
          // lstat does not follow links; isFile excludes links and directories.
          if (!info.isFile() || info.size > 16 * 1024) throw new Error('owner lock is not a bounded regular file')
          const current = JSON.parse(await readFile(file, 'utf8')) as { token?: unknown; pid?: unknown; hostname?: unknown }
          if (current.token !== token || current.pid !== owner.pid || current.hostname !== owner.hostname) throw new Error('owner identity changed')
          await unlink(file)
        } catch (error) {
          throw new MemoryOwnershipError(`cannot release memory ownership at ${file}; preserve the lock for inspection`, { cause: error })
        }
      })()
    },
  }
  try {
    await unlink(temporary)
  } catch (error) {
    try { await ownership.release() }
    catch (releaseError) { throw new AggregateError([error, releaseError], 'memory ownership initialization cleanup failed') }
    throw error
  }
  return ownership
}
