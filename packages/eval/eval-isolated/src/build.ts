/** Host-observed immutable runtime images, reused only within one run and one role. */
import { createHash } from 'node:crypto'
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Complete-tree bounds, including metadata rather than only selected entrypoints. */
export interface RuntimeImageBounds { readonly maxFiles: number
  readonly maxBytes: number }
/** Independent observation of the bytes available to one role's fixed runtime. */
export interface RuntimeImageFile { readonly path: string
  readonly bytes: number
  readonly digest: string }
/** Host-minted image proof. Plain JSON cannot be used with the owning cache's verify operation. */
export interface ObservedRuntimeImage {
  readonly role: 'subject' | 'grader'
  readonly verifiedCommit: string
  readonly buildDigest: string
  readonly files: readonly RuntimeImageFile[]
}

/**
 * Hash an entire contained runtime tree, rejecting links and shared writable file identities.
 * @param directory Fresh materialized runtime root owned by the Host.
 * @param bounds Complete-tree resource limits.
 * @param signal Caller cancellation.
 * @returns Actual sorted artifact inventory and its digest, never an expected build identity.
 */
export async function observeRuntimeTree(directory: string, bounds: RuntimeImageBounds, signal: AbortSignal): Promise<{
  readonly files: readonly RuntimeImageFile[]
  readonly digest: string
}> {
  for (const value of [bounds.maxFiles, bounds.maxBytes]) if (!Number.isSafeInteger(value) || value < 1) throw new Error('eval-build-invalid-bound')
  const root = resolve(directory)
  if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== root) throw new Error('eval-build-path-escaped')
  const files: RuntimeImageFile[] = []
  let totalBytes = 0
  const visit = async (path: string): Promise<void> => {
    signal.throwIfAborted()
    const before = await lstat(path)
    if (before.isSymbolicLink()) throw new Error('eval-build-link-refused')
    const physical = await realpath(path)
    const fromRoot = relative(root, physical)
    if (isAbsolute(fromRoot) || fromRoot === '..' || fromRoot.startsWith(`..${sep}`)) throw new Error('eval-build-path-escaped')
    if (before.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(join(path, name))
      return
    }
    if (!before.isFile() || before.nlink !== 1 || files.length >= bounds.maxFiles) throw new Error('eval-build-file-refused')
    totalBytes += before.size
    if (totalBytes > bounds.maxBytes) throw new Error('eval-build-capacity')
    const handle = await open(path, 'r')
    try {
      const held = await handle.stat()
      if (held.ino !== before.ino || held.dev !== before.dev || held.nlink !== 1 || held.size !== before.size) throw new Error('eval-build-identity-changed')
      const hash = createHash('sha256')
      const buffer = Buffer.alloc(Math.min(64 * 1024, before.size || 1))
      let offset = 0
      while (offset < before.size) {
        signal.throwIfAborted()
        const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, before.size - offset), offset)
        if (!bytesRead) throw new Error('eval-build-identity-changed')
        hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead
      }
      const after = await handle.stat()
      const named = await lstat(path)
      if (after.size !== held.size || after.mtimeMs !== held.mtimeMs || after.ctimeMs !== held.ctimeMs
        || named.ino !== held.ino || named.dev !== held.dev || named.isSymbolicLink()) throw new Error('eval-build-identity-changed')
      const record = Object.freeze({ path: fromRoot.split(sep).join('/'), bytes: offset, digest: hash.digest('hex') })
      totalBytes += Buffer.byteLength(JSON.stringify(record))
      if (totalBytes > bounds.maxBytes) throw new Error('eval-build-capacity')
      files.push(record)
    } finally { await handle.close() }
  }
  await visit(root)
  const digest = createHash('sha256').update(JSON.stringify(files)).digest('hex')
  return { files: Object.freeze(files), digest }
}

/** One run's build owner; failures remain cached so an uncertain build is never automatically rerun. */
export class RuntimeImageCache {
  private readonly entries = new Map<string, {
    readonly build: (destination: string, signal: AbortSignal) => Promise<void>
    readonly prepared: Promise<ObservedRuntimeImage>
  }>()
  private readonly images = new WeakMap<ObservedRuntimeImage, string>()
  constructor(private readonly root: string, private readonly bounds: RuntimeImageBounds) {}

  /**
   * Prepare a role image once. The trusted builder receives a new destination and must return only after its processes stop.
   * @param role Subject and Grader have separate images and permissions.
   * @param verifiedCommit Revision obtained from the real RepoWorkspace lease.
   * @param build Populate the complete runtime from the verified build inputs; no worker can supply this callback.
   * @param signal Run cancellation. Failure is retained instead of restarting an unknown build.
   * @returns Host-observed proof of actual files, shared only by cells of this role and revision.
   */
  prepare(role: ObservedRuntimeImage['role'], verifiedCommit: string,
    build: (destination: string, signal: AbortSignal) => Promise<void>, signal: AbortSignal): Promise<ObservedRuntimeImage> {
    if (!/^[a-f0-9]{40,64}$/u.test(verifiedCommit)) return Promise.reject(new Error('eval-build-unverified-revision'))
    const key = `${role}:${verifiedCommit}`
    const previous = this.entries.get(key)
    if (previous) return previous.build === build ? previous.prepared : Promise.reject(new Error('eval-build-input-conflict'))
    const prepared = (async () => {
      signal.throwIfAborted()
      const directory = resolve(this.root, role, verifiedCommit)
      await mkdir(join(this.root, role), { recursive: true })
      await mkdir(directory)
      await build(directory, signal)
      signal.throwIfAborted()
      const observed = await observeRuntimeTree(directory, this.bounds, signal)
      const proof = Object.freeze({ role, verifiedCommit, buildDigest: observed.digest, files: observed.files })
      this.images.set(proof, directory)
      return proof
    })()
    this.entries.set(key, { build, prepared })
    return prepared
  }

  /**
   * Recheck actual bytes before reuse and return the Host path only for this owner's original proof.
   * @param image Exact object minted by prepare; copied JSON rejects.
   * @param signal Cell cancellation.
   * @returns The unchanged image root. The role must receive read/execute grants only.
   */
  async verify(image: ObservedRuntimeImage, signal: AbortSignal): Promise<string> {
    const directory = this.images.get(image)
    if (!directory) throw new Error('eval-build-proof-refused')
    const current = await observeRuntimeTree(directory, this.bounds, signal)
    if (current.digest !== image.buildDigest) throw new Error('eval-build-identity-changed')
    return directory
  }
}
