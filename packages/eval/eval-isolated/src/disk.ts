/** Host-owned best-effort disk-growth observation for an isolated role world. */
import { lstat, opendir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Explicit finite Host limits. This is sampling, not a filesystem quota. */
export interface IsolatedDiskLimits {
  /** Total bytes in all monitored roots. */
  readonly maxBytes: number
  /** Reject pathological zero-byte entry growth before scanning becomes unbounded. */
  readonly maxEntries: number
  /** Maximum time between completed Host observations. */
  readonly sampleMs: number
}

export interface DiskUsage {
  readonly bytes: number
  readonly entries: number
}

export type DiskLimitFailure = 'eval-disk-limit-exceeded' | 'eval-disk-observation-uncertain'

/** A read-only admission/recovery inspection for pre-existing retained worlds. */
export type DiskUsageInspection = { readonly status: 'within-limit'; readonly usage: DiskUsage }
  | { readonly status: 'limit-exceeded'; readonly usage: null }
  | { readonly status: 'uncertain'; readonly usage: null }

/**
 * Classify a whole owned root before admitting more work. This neither creates,
 * deletes, nor follows anything in the observed tree.
 * @param roots Owned absolute roots whose aggregate usage is inspected without following links.
 * @param limits Explicit finite byte, entry and sampling limits.
 * @param signal Caller cancellation, which propagates instead of becoming an uncertainty result.
 * @returns Observed within-limit, exceeded, or uncertain status; never filesystem quota enforcement.
 */
export async function inspectDiskUsage(roots: readonly string[], limits: IsolatedDiskLimits,
  signal: AbortSignal): Promise<DiskUsageInspection> {
  try { return { status: 'within-limit', usage: await observeDiskUsage(roots, limits, signal) } }
  catch (error) {
    signal.throwIfAborted()
    return { status: error instanceof Error && ['eval-disk-capacity', 'eval-disk-entry-capacity'].includes(error.message)
      ? 'limit-exceeded' : 'uncertain', usage: null }
  }
}

/**
 * Observe only pre-validated Host roots. Links and path identity changes fail closed;
 * they are never traversed and this monitor never removes any filesystem entry.
 */
export async function observeDiskUsage(roots: readonly string[], limits: IsolatedDiskLimits,
  signal: AbortSignal): Promise<DiskUsage> {
  validateLimits(limits)
  if (!roots.length) throw new Error('eval-disk-root-refused')
  const captured = await captureDiskRoots(roots, limits, false)
  return observeCapturedDiskUsage(captured, limits, signal)
}

async function observeCapturedDiskUsage(captured: readonly CapturedRoot[], limits: IsolatedDiskLimits,
  signal: AbortSignal): Promise<DiskUsage> {
  let bytes = 0, entries = 0
  const visit = async (root: CapturedRoot, path: string): Promise<void> => {
    signal.throwIfAborted()
    const stat = await lstat(path)
    if (++entries > limits.maxEntries) throw new Error('eval-disk-entry-capacity')
    const rel = relative(root.path, path)
    const allowedLink = root.links.get(rel)
    if (stat.isSymbolicLink()) {
      if (!allowedLink || stat.dev !== allowedLink.dev || stat.ino !== allowedLink.ino) throw new Error('eval-disk-path-refused')
      return
    }
    if (await realpath(path) !== resolve(path)) throw new Error('eval-disk-path-refused')
    if (path === root.path && (stat.dev !== root.dev || stat.ino !== root.ino || !stat.isDirectory())) {
      throw new Error('eval-disk-root-changed')
    }
    if (stat.isDirectory()) {
      const directory = await opendir(path)
      try {
        for await (const entry of directory) await visit(root, join(path, entry.name))
      } finally { await directory.close().catch(() => {}) }
      return
    }
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('eval-disk-file-refused')
    bytes += stat.size
    if (bytes > limits.maxBytes) throw new Error('eval-disk-capacity')
  }
  for (const root of captured) await visit(root, root.path)
  return { bytes, entries }
}

/** Own one timer and expose its first failure to the Host lifecycle owner. */
export class DiskUsageMonitor {
  private timer: ReturnType<typeof setTimeout> | undefined
  private checking = false
  private readonly state = { stopped: false }
  private _failure: DiskLimitFailure | null = null
  private removeAbortListener: (() => void) | undefined

  private constructor(private readonly roots: readonly CapturedRoot[], private readonly limits: IsolatedDiskLimits,
    private readonly signal: AbortSignal, private readonly onFailure: (failure: DiskLimitFailure) => void) {}

  get failure(): DiskLimitFailure | null { return this._failure }

  static async start(roots: readonly string[], limits: IsolatedDiskLimits, signal: AbortSignal,
    onFailure: (failure: DiskLimitFailure) => void): Promise<DiskUsageMonitor> {
    validateLimits(limits)
    const monitor = new DiskUsageMonitor(await captureDiskRoots(roots, limits, true), structuredClone(limits), signal, onFailure)
    const stop = () => { monitor.stop() }
    signal.addEventListener('abort', stop, { once: true })
    monitor.removeAbortListener = () => { signal.removeEventListener('abort', stop) }
    if (signal.aborted) monitor.stop()
    await monitor.check()
    if (!monitor.failure && !signal.aborted) monitor.schedule()
    return monitor
  }

  stop(): void {
    this.state.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.removeAbortListener?.()
    this.removeAbortListener = undefined
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.check().then(() => {
        if (!this.state.stopped && !this.failure && !this.signal.aborted) this.schedule()
      }, () => {})
    }, this.limits.sampleMs)
  }

  private async check(): Promise<void> {
    if (this.state.stopped || this.checking || this.failure || this.signal.aborted) return
    this.checking = true
    try {
      await observeCapturedDiskUsage(this.roots, this.limits, this.signal)
    } catch (error) {
      if (error === this.signal.reason) throw error
      this.fail(error instanceof Error && ['eval-disk-capacity', 'eval-disk-entry-capacity'].includes(error.message)
        ? 'eval-disk-limit-exceeded' : 'eval-disk-observation-uncertain')
    } finally { this.checking = false }
  }

  private fail(failure: DiskLimitFailure): void {
    if (this.failure) return
    this._failure = failure
    this.stop()
    this.onFailure(failure)
  }
}

interface CapturedRoot {
  readonly path: string
  readonly dev: number
  readonly ino: number
  readonly links: ReadonlyMap<string, FileIdentity>
}
interface FileIdentity {
  readonly dev: number
  readonly ino: number
}

async function captureDiskRoots(roots: readonly string[], limits: IsolatedDiskLimits,
  allowExistingLinks: boolean): Promise<readonly CapturedRoot[]> {
  if (!roots.length) throw new Error('eval-disk-root-refused')
  const captured = await Promise.all(roots.map(root => captureRoot(root, limits, allowExistingLinks)))
  for (let index = 0; index < captured.length; index++) {
    for (let other = index + 1; other < captured.length; other++) {
      const first = captured[index], second = captured[other]
      if (!first || !second) throw new Error('eval-disk-root-refused')
      if (contains(first.path, second.path) || contains(second.path, first.path)) throw new Error('eval-disk-root-overlap')
    }
  }
  return captured
}

async function captureRoot(directory: string, limits: IsolatedDiskLimits, allowExistingLinks: boolean): Promise<CapturedRoot> {
  if (!isAbsolute(directory)) throw new Error('eval-disk-root-refused')
  const path = resolve(directory), stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) throw new Error('eval-disk-root-refused')
  const links = new Map<string, FileIdentity>()
  let entries = 0
  const visit = async (current: string): Promise<void> => {
    const currentStat = await lstat(current)
    const rel = relative(path, current)
    if (++entries > limits.maxEntries) throw new Error('eval-disk-entry-capacity')
    if (currentStat.isSymbolicLink()) {
      if (!allowExistingLinks) throw new Error('eval-disk-path-refused')
      links.set(rel, { dev: currentStat.dev, ino: currentStat.ino })
      return
    }
    if (await realpath(current) !== resolve(current)) throw new Error('eval-disk-path-refused')
    if (!currentStat.isDirectory()) return
    const opened = await opendir(current)
    try { for await (const entry of opened) await visit(join(current, entry.name)) }
    finally { await opened.close().catch(() => {}) }
  }
  await visit(path)
  return { path, dev: stat.dev, ino: stat.ino, links }
}

function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return !rel || !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

function validateLimits(limits: IsolatedDiskLimits): void {
  for (const value of [limits.maxBytes, limits.maxEntries, limits.sampleMs]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('eval-disk-invalid-bound')
  }
}
