/** Filesystem-backed immutable Delivery evidence provider. @module @changanhua/dsh-delivery-evidence-local */

import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  DELIVERY_SCHEMA_VERSION,
  EvidenceId,
  canonicalDigest,
  canonicalJson,
  evidenceBytesDigest,
  evidenceRefSchema,
} from '@changanhua/dsh-delivery-protocol'
import type {
  EvidenceId as EvidenceIdType,
  EvidenceRef,
} from '@changanhua/dsh-delivery-protocol'
import {
  DeliveryEvidence,
  DeliveryEvidenceError,
} from '@changanhua/dsh-delivery-evidence'
import { ensureDurableDirectoryWin32, publishNewPathWin32 } from './win32.ts'
import type {
  SaveDeliveryEvidence,
  StoredDeliveryEvidence,
} from '@changanhua/dsh-delivery-evidence'

const LOCAL_EVIDENCE_ID = /^evidence-sha256-([0-9a-f]{64})$/u
const MAX_LOCAL_EVIDENCE_BYTES = 64 * 1024 * 1024
const MAX_LOCAL_EVIDENCE_REFERENCE_BYTES = 64 * 1024

interface PhysicalDirectory {
  readonly path: string
  readonly realPath: string
  readonly dev: bigint
  readonly ino: bigint
}

/** Local evidence-store location. */
export interface Config {
  /** Private directory containing content-addressed evidence objects. */
  readonly root: string
  /** Complete-byte publication limit, capped by the P0 64 MiB ceiling. */
  readonly maxBytes?: number
}

/** Loader configuration schema. */
export const Config: z<Config> = z.object({
  root: z.string().required(),
  maxBytes: z.number().step(1).min(1).max(MAX_LOCAL_EVIDENCE_BYTES),
})

/** Filesystem-backed evidence provider selected for the local MVP. */
export class LocalDeliveryEvidence extends DeliveryEvidence {
  static Config = Config
  private readonly root: string
  private readonly maxBytes: number
  private rootDirectory: PhysicalDirectory | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.root = resolve(config.root)
    this.maxBytes = config.maxBytes ?? MAX_LOCAL_EVIDENCE_BYTES
  }

  async save(input: SaveDeliveryEvidence, signal?: AbortSignal): Promise<EvidenceRef> {
    signal?.throwIfAborted()
    const data = input.data.slice()
    if (data.byteLength > this.maxBytes) {
      throw new DeliveryEvidenceError(
        'write-failed',
        `evidence payload is ${String(data.byteLength)} bytes; limit is ${String(this.maxBytes)}`,
      )
    }
    const provenance = structuredClone(input.provenance)
    const digest = evidenceBytesDigest(data)
    const envelope = {
      kind: input.kind,
      mediaType: input.mediaType,
      provenance,
      byteLength: data.byteLength,
      digest,
    }
    const envelopeDigest = canonicalDigest(envelope)
    const id = this.evidenceId(envelope)
    await this.ensureLayout()
    const prior = await this.resolve(id, signal)
    signal?.throwIfAborted()
    await this.publishImmutable(
      this.objectPath(digest),
      data,
      existing => existing.byteLength === data.byteLength && evidenceBytesDigest(existing) === digest,
      'evidence bytes',
    )
    signal?.throwIfAborted()
    if (prior !== undefined) {
      await this.syncPublishedPath(this.referencePath(id))
      return prior
    }

    const reference = evidenceRefSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id,
      kind: input.kind,
      mediaType: input.mediaType,
      uri: `dsh-evidence://sha256/${digest.slice('sha256:'.length)}`,
      byteLength: data.byteLength,
      digest,
      createdAt: new Date().toISOString(),
      provenance,
    })
    await this.publishImmutable(
      this.referencePath(id),
      Buffer.from(`${canonicalJson(reference)}\n`, 'utf8'),
      () => true,
      'evidence reference',
    )
    const published = await this.resolve(id, signal)
    /* v8 ignore next 9 -- requires cross-process replacement between atomic publication and immediate verification. */
    if (published === undefined || canonicalDigest({
      kind: published.kind,
      mediaType: published.mediaType,
      provenance: published.provenance,
      byteLength: published.byteLength,
      digest: published.digest,
    }) !== envelopeDigest) {
      throw new DeliveryEvidenceError('write-failed', `published evidence reference '${id}' does not match its envelope`)
    }
    return published
  }

  async resolve(id: EvidenceIdType, signal?: AbortSignal): Promise<EvidenceRef | undefined> {
    signal?.throwIfAborted()
    if (!LOCAL_EVIDENCE_ID.test(id)) return undefined
    if (!await this.hasSafeReferenceDirectory()) return undefined
    const path = this.referencePath(id)
    const status = await this.safeFileStatus(path, 'read-failed')
    if (status === undefined) return undefined
    try {
      const bytes = await this.readBoundedFile(
        path,
        status,
        MAX_LOCAL_EVIDENCE_REFERENCE_BYTES,
        'read-failed',
        signal,
      )
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      const reference = evidenceRefSchema.parse(value)
      if (reference.byteLength > this.maxBytes || reference.byteLength > MAX_LOCAL_EVIDENCE_BYTES) {
        throw new DeliveryEvidenceError(
          'read-failed',
          `evidence reference '${id}' exceeds the configured complete-byte limit`,
        )
      }
      if (
        reference.id !== id
        || reference.id !== this.evidenceId(reference)
        || reference.uri !== `dsh-evidence://sha256/${reference.digest.slice('sha256:'.length)}`
      ) {
        throw new DeliveryEvidenceError(
          'reference-mismatch',
          `evidence reference '${id}' does not match its content address`,
        )
      }
      return structuredClone(reference)
    } catch (error) {
      /* v8 ignore next -- only another process can remove the lstat-verified reference before readFile opens it. */
      if (isCode(error, 'ENOENT')) return undefined
      signal?.throwIfAborted()
      if (error instanceof DeliveryEvidenceError) throw error
      throw new DeliveryEvidenceError('read-failed', `cannot read evidence reference '${id}'`, { cause: error })
    }
  }

  async read(ref: EvidenceRef, signal?: AbortSignal): Promise<StoredDeliveryEvidence> {
    signal?.throwIfAborted()
    const published = await this.resolve(ref.id, signal)
    if (published === undefined) {
      throw new DeliveryEvidenceError('not-found', `evidence '${ref.id}' is absent`)
    }
    if (canonicalJson(published) !== canonicalJson(ref)) {
      throw new DeliveryEvidenceError('reference-mismatch', `evidence '${ref.id}' metadata does not match the published reference`)
    }
    const objectPath = this.objectPath(ref.digest)
    await this.assertSafeObjectDirectories(ref.id)
    const status = await this.safeFileStatus(objectPath, 'read-failed')
    if (status === undefined) {
      throw new DeliveryEvidenceError('not-found', `evidence '${ref.id}' bytes are absent`)
    }
    if (status.size > this.maxBytes || status.size > MAX_LOCAL_EVIDENCE_BYTES) {
      throw new DeliveryEvidenceError('length-mismatch', `evidence '${ref.id}' byte length exceeds the configured limit`)
    }
    if (status.size !== ref.byteLength) {
      throw new DeliveryEvidenceError('length-mismatch', `evidence '${ref.id}' byte length changed`)
    }
    const data = await this.readBoundedFile(objectPath, status, this.maxBytes, 'read-failed', signal)
    if (evidenceBytesDigest(data) !== ref.digest) {
      throw new DeliveryEvidenceError('digest-mismatch', `evidence '${ref.id}' digest changed`)
    }
    return { ref: structuredClone(published), data: data.slice() }
  }

  private async ensureLayout(): Promise<void> {
    try {
      if (this.rootDirectory === undefined) {
        await ensureDirectoryTreeWithoutLinks(this.root, 'write-failed')
        this.rootDirectory = await capturePhysicalDirectory(this.root, 'write-failed')
      } else {
        await assertSamePhysicalDirectory(this.rootDirectory, 'write-failed')
      }
      await ensureContainedDirectory(this.rootDirectory, join(this.root, 'objects'), 'write-failed')
      await ensureContainedDirectory(this.rootDirectory, join(this.root, 'objects', 'sha256'), 'write-failed')
      await ensureContainedDirectory(this.rootDirectory, join(this.root, 'references'), 'write-failed')
    } catch (error) {
      /* v8 ignore start -- only a host filesystem fault reaches this wrapper; classified provider failures pass through. */
      if (error instanceof DeliveryEvidenceError) throw error
      throw new DeliveryEvidenceError('write-failed', `cannot prepare evidence store path '${this.root}'`, { cause: error })
      /* v8 ignore stop */
    }
  }

  private async hasSafeReferenceDirectory(): Promise<boolean> {
    if (this.rootDirectory === undefined) {
      const root = await captureExistingDirectoryTreeWithoutLinks(this.root, 'read-failed')
      if (root === undefined) return false
      this.rootDirectory = root
    } else {
      await assertSamePhysicalDirectory(this.rootDirectory, 'read-failed')
    }
    return await captureContainedDirectory(
      this.rootDirectory,
      join(this.root, 'references'),
      'read-failed',
    ) !== undefined
  }

  private async assertSafeObjectDirectories(id: EvidenceIdType): Promise<void> {
    /* v8 ignore next 3 -- read() resolves the reference directory first and therefore establishes this root. */
    if (this.rootDirectory === undefined) {
      throw new DeliveryEvidenceError('not-found', `evidence '${id}' bytes are absent`)
    }
    await assertSamePhysicalDirectory(this.rootDirectory, 'read-failed')
    for (const path of [join(this.root, 'objects'), join(this.root, 'objects', 'sha256')]) {
      if (await captureContainedDirectory(this.rootDirectory, path, 'read-failed') === undefined) {
        throw new DeliveryEvidenceError('not-found', `evidence '${id}' bytes are absent`)
      }
    }
  }

  private async safeFileStatus(
    path: string,
    code: 'read-failed' | 'write-failed',
  ): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
    /* v8 ignore next 3 -- every caller establishes the root before deriving a store file path. */
    if (this.rootDirectory === undefined) {
      throw new DeliveryEvidenceError(code, `evidence store root '${this.root}' is not physically established`)
    }
    /* v8 ignore next -- layout/ref validation establishes each file's parent; only a concurrent removal can make it absent here. */
    if (await captureContainedDirectory(this.rootDirectory, dirname(path), code) === undefined) return undefined
    let status
    try {
      status = await lstat(path)
    } catch (error) {
      /* v8 ignore next 2 -- non-ENOENT lstat failures require a host filesystem or permission fault. */
      if (!isCode(error, 'ENOENT')) {
        throw new DeliveryEvidenceError(code, `cannot inspect evidence store file '${path}'`, { cause: error })
      }
      return undefined
    }
    if (!status.isFile() || status.isSymbolicLink()) {
      throw new DeliveryEvidenceError(code, `evidence store file '${path}' must be a real file`)
    }
    return status
  }

  private async readBoundedFile(
    path: string,
    expected: Awaited<ReturnType<typeof lstat>>,
    maxBytes: number,
    code: 'read-failed' | 'write-failed',
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    if (expected.size > maxBytes || expected.size > MAX_LOCAL_EVIDENCE_BYTES) {
      throw new DeliveryEvidenceError(code, `evidence store file '${path}' exceeds its complete-byte limit`)
    }
    signal?.throwIfAborted()
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(path, 'r')
      const opened = await handle.stat()
      /* v8 ignore next 8 -- requires replacement between the lstat and opening the no-write handle. */
      if (
        !opened.isFile()
        || opened.dev !== expected.dev
        || opened.ino !== expected.ino
        || opened.size !== expected.size
      ) {
        throw new DeliveryEvidenceError(code, `evidence store file '${path}' changed before bounded read`)
      }
      const data = Buffer.alloc(expected.size)
      let offset = 0
      while (offset < data.byteLength) {
        signal?.throwIfAborted()
        const { bytesRead } = await handle.read(data, offset, data.byteLength - offset, offset)
        /* v8 ignore next 3 -- requires concurrent truncation of the already size-checked open inode. */
        if (bytesRead === 0) {
          throw new DeliveryEvidenceError(code, `evidence store file '${path}' became shorter during bounded read`)
        }
        offset += bytesRead
      }
      const extra = Buffer.alloc(1)
      /* v8 ignore next 3 -- requires concurrent growth of the bounded open inode. */
      if ((await handle.read(extra, 0, 1, data.byteLength)).bytesRead !== 0) {
        throw new DeliveryEvidenceError(code, `evidence store file '${path}' grew during bounded read`)
      }
      const settled = await handle.stat()
      /* v8 ignore next 3 -- requires concurrent metadata mutation during the bounded handle read. */
      if (settled.dev !== opened.dev || settled.ino !== opened.ino || settled.size !== opened.size) {
        throw new DeliveryEvidenceError(code, `evidence store file '${path}' changed during bounded read`)
      }
      signal?.throwIfAborted()
      return data
    } catch (error) {
      /* v8 ignore start -- these branches require cancellation or an OS/open fault racing the prevalidated bounded read. */
      signal?.throwIfAborted()
      if (error instanceof DeliveryEvidenceError) throw error
      if (isCode(error, 'ENOENT')) {
        throw new DeliveryEvidenceError(code, `evidence store file '${path}' disappeared before bounded read`, { cause: error })
      }
      throw new DeliveryEvidenceError(code, `cannot bounded-read evidence store file '${path}'`, { cause: error })
      /* v8 ignore stop */
    } finally {
      /* v8 ignore next -- a close rejection requires a second host fault after read settlement. */
      await handle?.close().catch(() => undefined)
    }
  }

  private async publishImmutable(
    path: string,
    data: Uint8Array,
    acceptsExisting: (data: Uint8Array) => boolean,
    label: string,
  ): Promise<void> {
    const existing = await this.safeFileStatus(path, 'write-failed')
    if (existing !== undefined) {
      if (existing.size !== data.byteLength || !acceptsExisting(await this.readBoundedFile(
        path,
        existing,
        data.byteLength,
        'write-failed',
      ))) {
        throw new DeliveryEvidenceError('write-failed', `${label} path '${path}' contains different bytes`)
      }
      await this.syncPublishedPath(path)
      return
    }

    const temporary = join(dirname(path), `.${randomUUID()}.tmp`)
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(temporary, 'wx', 0o600)
      await handle.writeFile(data)
      await handle.sync()
      await handle.close()
      handle = undefined
      try {
        if (process.platform === 'win32') await publishNewPathWin32(temporary, path)
        else await link(temporary, path)
      } catch (error) {
        /* v8 ignore next 2 -- EEXIST is a cross-process publication race; other publication failures require a host filesystem fault. */
        if (!isCode(error, 'EEXIST')) throw error
      }
      const published = await this.safeFileStatus(path, 'write-failed')
      /* v8 ignore next 3 -- only external replacement between link and verification can violate this postcondition. */
      if (
        published === undefined
        || published.size !== data.byteLength
        || !acceptsExisting(await this.readBoundedFile(path, published, data.byteLength, 'write-failed'))
      ) {
        throw new DeliveryEvidenceError('write-failed', `${label} path '${path}' contains different bytes`)
      }
      await this.syncPublishedPath(path)
    } catch (error) {
      /* v8 ignore next 4 -- explicit collision errors are tested before this block; this path requires an OS write/link fault. */
      if (error instanceof DeliveryEvidenceError) throw error
      /* v8 ignore next -- reaching this wrapper requires an OS write, sync, or link fault. */
      throw new DeliveryEvidenceError('write-failed', `cannot publish ${label} '${path}'`, { cause: error })
    } finally {
      /* v8 ignore next -- an open handle remains only when a host write, sync, or close operation faults. */
      await handle?.close().catch(() => undefined)
      /* v8 ignore next 4 -- the private temporary name is either present or already absent; other unlink outcomes require an OS fault. */
      await unlink(temporary).catch((error: unknown) => {
        /* v8 ignore next 2 -- a non-ENOENT unlink failure requires a host filesystem or permission fault. */
        if (!isCode(error, 'ENOENT')) throw error
      })
    }
  }

  private async syncPublishedPath(path: string): Promise<void> {
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(path, 'r+')
      await handle.sync()
    } finally {
      await handle?.close()
    }
    if (process.platform !== 'win32') await syncDirectoryPosix(dirname(path))
  }

  private objectPath(digest: EvidenceRef['digest']): string {
    return join(this.root, 'objects', 'sha256', digest.slice('sha256:'.length))
  }

  private referencePath(id: EvidenceIdType): string {
    return join(this.root, 'references', `${id}.json`)
  }

  private evidenceId(reference: Pick<EvidenceRef, 'kind' | 'mediaType' | 'provenance' | 'byteLength' | 'digest'>): EvidenceIdType {
    const digest = canonicalDigest({
      kind: reference.kind,
      mediaType: reference.mediaType,
      provenance: reference.provenance,
      byteLength: reference.byteLength,
      digest: reference.digest,
    })
    return EvidenceId(`evidence-sha256-${digest.slice('sha256:'.length)}`)
  }
}

function isCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}

async function ensureDirectoryTreeWithoutLinks(
  path: string,
  code: 'write-failed',
): Promise<void> {
  const target = resolve(path)
  const filesystemRoot = parse(target).root
  let current = filesystemRoot
  for (const name of relative(filesystemRoot, target).split(sep).filter(Boolean)) {
    current = join(current, name)
    let status = await fileStatus(current, code)
    if (status === undefined) {
      if (process.platform === 'win32') await ensureDurableDirectoryWin32(current)
      else try {
        await mkdir(current, { mode: 0o700 })
      } catch (error) {
        /* v8 ignore next -- only a same-component POSIX creator race reaches EEXIST after the preceding lstat. */
        if (!isCode(error, 'EEXIST')) throw error
      }
      status = await fileStatus(current, code)
    }
    if (status === undefined || !status.isDirectory() || status.isSymbolicLink()) {
      throw new DeliveryEvidenceError(code, `evidence store path '${current}' must be a real directory`)
    }
    if (process.platform !== 'win32') await syncDirectoryPosix(dirname(current))
  }
}

async function captureExistingDirectoryTreeWithoutLinks(
  path: string,
  code: 'read-failed',
): Promise<PhysicalDirectory | undefined> {
  const target = resolve(path)
  const filesystemRoot = parse(target).root
  let current = filesystemRoot
  for (const name of relative(filesystemRoot, target).split(sep).filter(Boolean)) {
    current = join(current, name)
    const status = await fileStatus(current, code)
    if (status === undefined) return undefined
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new DeliveryEvidenceError(code, `evidence store path '${current}' must be a real directory`)
    }
  }
  return await capturePhysicalDirectory(target, code)
}

async function ensureContainedDirectory(
  root: PhysicalDirectory,
  path: string,
  code: 'write-failed',
): Promise<PhysicalDirectory> {
  await assertSamePhysicalDirectory(root, code)
  const absolute = resolve(path)
  /* v8 ignore next 3 -- all callers join provider-owned literal descendants onto the captured root. */
  if (!isContainedPath(root.path, absolute)) {
    throw new DeliveryEvidenceError(code, `evidence store path '${absolute}' escapes '${root.path}'`)
  }
  let current = root.path
  for (const name of relative(root.path, absolute).split(sep).filter(Boolean)) {
    current = join(current, name)
    let status = await fileStatus(current, code)
    if (status === undefined) {
      if (process.platform === 'win32') await ensureDurableDirectoryWin32(current)
      else try {
        await mkdir(current, { mode: 0o700 })
      } catch (error) {
        /* v8 ignore next -- only a same-component POSIX creator race reaches EEXIST after the preceding lstat. */
        if (!isCode(error, 'EEXIST')) throw error
      }
      status = await fileStatus(current, code)
    }
    if (status === undefined || !status.isDirectory() || status.isSymbolicLink()) {
      throw new DeliveryEvidenceError(code, `evidence store path '${current}' must be a real directory`)
    }
    const directory = await capturePhysicalDirectory(current, code)
    /* v8 ignore next 3 -- non-link directories can escape only through a host mount-point change during this walk. */
    if (!isContainedPath(root.realPath, directory.realPath)) {
      throw new DeliveryEvidenceError(code, `evidence store path '${current}' escapes physical root '${root.realPath}'`)
    }
    if (process.platform !== 'win32') await syncDirectoryPosix(dirname(current))
  }
  return await capturePhysicalDirectory(absolute, code)
}

async function captureContainedDirectory(
  root: PhysicalDirectory,
  path: string,
  code: 'read-failed' | 'write-failed',
): Promise<PhysicalDirectory | undefined> {
  await assertSamePhysicalDirectory(root, code)
  const absolute = resolve(path)
  /* v8 ignore next 3 -- all callers join provider-owned literal descendants onto the captured root. */
  if (!isContainedPath(root.path, absolute)) {
    throw new DeliveryEvidenceError(code, `evidence store path '${absolute}' escapes '${root.path}'`)
  }
  let current = root.path
  let directory = root
  for (const name of relative(root.path, absolute).split(sep).filter(Boolean)) {
    current = join(current, name)
    const status = await fileStatus(current, code)
    if (status === undefined) return undefined
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new DeliveryEvidenceError(code, `evidence store path '${current}' must be a real directory`)
    }
    directory = await capturePhysicalDirectory(current, code)
    /* v8 ignore next 3 -- non-link directories can escape only through a host mount-point change during this walk. */
    if (!isContainedPath(root.realPath, directory.realPath)) {
      throw new DeliveryEvidenceError(code, `evidence store path '${current}' escapes physical root '${root.realPath}'`)
    }
  }
  return directory
}

async function capturePhysicalDirectory(
  path: string,
  code: 'read-failed' | 'write-failed',
): Promise<PhysicalDirectory> {
  const absolute = resolve(path)
  try {
    const status = await lstat(absolute, { bigint: true })
    const realPath = await realpath(absolute)
    /* v8 ignore next 3 -- callers lstat each component first; only a replacement race can reach this duplicate guard. */
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new DeliveryEvidenceError(code, `evidence store path '${absolute}' must be a real directory`)
    }
    return { path: absolute, realPath, dev: status.dev, ino: status.ino }
  } catch (error) {
    /* v8 ignore start -- requires a link/IO race between the component lstat and physical capture. */
    if (error instanceof DeliveryEvidenceError) throw error
    throw new DeliveryEvidenceError(code, `cannot inspect evidence store path '${absolute}'`, { cause: error })
    /* v8 ignore stop */
  }
}

async function assertSamePhysicalDirectory(
  expected: PhysicalDirectory,
  code: 'read-failed' | 'write-failed',
): Promise<void> {
  const observed = await capturePhysicalDirectory(expected.path, code)
  if (
    !samePath(observed.realPath, expected.realPath)
    || observed.dev !== expected.dev
    || observed.ino !== expected.ino
  ) {
    throw new DeliveryEvidenceError(code, `evidence store path '${expected.path}' changed physical identity`)
  }
}

async function fileStatus(
  path: string,
  code: 'read-failed' | 'write-failed',
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    /* v8 ignore start -- the non-ENOENT branch requires a host permission or filesystem fault. */
    if (isCode(error, 'ENOENT')) return undefined
    throw new DeliveryEvidenceError(code, `cannot inspect evidence store path '${path}'`, { cause: error })
    /* v8 ignore stop */
  }
}

function isContainedPath(root: string, target: string): boolean {
  const child = relative(root, target)
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`))
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left)
  const normalizedRight = resolve(right)
  /* v8 ignore next 3 -- path case semantics are selected by the native host; each platform executes its own branch. */
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

async function syncDirectoryPosix(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export default LocalDeliveryEvidence
