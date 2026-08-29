/** Filesystem-backed immutable Delivery evidence provider. @module @deepseek-ai/dsh-delivery-evidence-local */

import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readFile, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  DELIVERY_SCHEMA_VERSION,
  EvidenceId,
  canonicalDigest,
  canonicalJson,
  evidenceBytesDigest,
  evidenceRefSchema,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  EvidenceId as EvidenceIdType,
  EvidenceRef,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  DeliveryEvidence,
  DeliveryEvidenceError,
} from '@deepseek-ai/dsh-delivery-evidence'
import type {
  SaveDeliveryEvidence,
  StoredDeliveryEvidence,
} from '@deepseek-ai/dsh-delivery-evidence'

const LOCAL_EVIDENCE_ID = /^evidence-sha256-([0-9a-f]{64})$/u
const MAX_LOCAL_EVIDENCE_BYTES = 64 * 1024 * 1024

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
    if (prior !== undefined) return prior

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
      const value: unknown = JSON.parse(await readFile(path, { encoding: 'utf8', signal }))
      const reference = evidenceRefSchema.parse(value)
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
    if (status.size !== ref.byteLength) {
      throw new DeliveryEvidenceError('length-mismatch', `evidence '${ref.id}' byte length changed`)
    }
    let data: Uint8Array
    try {
      data = await readFile(objectPath, { signal })
    } catch (error) {
      /* v8 ignore next 3 -- only another process can remove the lstat-verified object before readFile opens it. */
      if (isCode(error, 'ENOENT')) {
        throw new DeliveryEvidenceError('not-found', `evidence '${ref.id}' bytes are absent`, { cause: error })
      }
      /* v8 ignore next -- this branch requires cancellation to land inside the host filesystem read. */
      signal?.throwIfAborted()
      /* v8 ignore next -- remaining readFile failures require a host filesystem or permission fault. */
      throw new DeliveryEvidenceError('read-failed', `cannot read evidence '${ref.id}' bytes`, { cause: error })
    }
    /* v8 ignore next 3 -- only concurrent external replacement between lstat and readFile can change the already-checked length. */
    if (data.byteLength !== ref.byteLength) {
      throw new DeliveryEvidenceError('length-mismatch', `evidence '${ref.id}' byte length changed`)
    }
    if (evidenceBytesDigest(data) !== ref.digest) {
      throw new DeliveryEvidenceError('digest-mismatch', `evidence '${ref.id}' digest changed`)
    }
    return { ref: structuredClone(published), data: data.slice() }
  }

  private async ensureLayout(): Promise<void> {
    await this.ensureRealDirectory(this.root)
    await this.ensureRealDirectory(join(this.root, 'objects'))
    await this.ensureRealDirectory(join(this.root, 'objects', 'sha256'))
    await this.ensureRealDirectory(join(this.root, 'references'))
  }

  private async ensureRealDirectory(path: string): Promise<void> {
    try {
      await mkdir(path, { recursive: true, mode: 0o700 })
      const status = await lstat(path)
      if (!status.isDirectory() || status.isSymbolicLink()) {
        throw new DeliveryEvidenceError('write-failed', `evidence store path '${path}' must be a real directory`)
      }
    } catch (error) {
      if (error instanceof DeliveryEvidenceError) throw error
      throw new DeliveryEvidenceError('write-failed', `cannot prepare evidence store path '${path}'`, { cause: error })
    }
  }

  private async hasSafeReferenceDirectory(): Promise<boolean> {
    for (const path of [this.root, join(this.root, 'references')]) {
      let status
      try {
        status = await lstat(path)
      } catch (error) {
        /* v8 ignore next 2 -- non-ENOENT lstat failures require a host filesystem or permission fault. */
        if (!isCode(error, 'ENOENT')) {
          throw new DeliveryEvidenceError('read-failed', `cannot inspect evidence store path '${path}'`, { cause: error })
        }
        return false
      }
      if (!status.isDirectory() || status.isSymbolicLink()) {
        throw new DeliveryEvidenceError('read-failed', `evidence store path '${path}' must be a real directory`)
      }
    }
    return true
  }

  private async assertSafeObjectDirectories(id: EvidenceIdType): Promise<void> {
    for (const path of [join(this.root, 'objects'), join(this.root, 'objects', 'sha256')]) {
      let status
      try {
        status = await lstat(path)
      } catch (error) {
        /* v8 ignore next 3 -- non-ENOENT lstat failures require a host filesystem or permission fault. */
        if (!isCode(error, 'ENOENT')) {
          throw new DeliveryEvidenceError('read-failed', `cannot inspect evidence store path '${path}'`, { cause: error })
        }
        throw new DeliveryEvidenceError('not-found', `evidence '${id}' bytes are absent`, { cause: error })
      }
      if (!status.isDirectory() || status.isSymbolicLink()) {
        throw new DeliveryEvidenceError('read-failed', `evidence store path '${path}' must be a real directory`)
      }
    }
  }

  private async safeFileStatus(
    path: string,
    code: 'read-failed' | 'write-failed',
  ): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
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

  private async publishImmutable(
    path: string,
    data: Uint8Array,
    acceptsExisting: (data: Uint8Array) => boolean,
    label: string,
  ): Promise<void> {
    const existing = await this.safeFileStatus(path, 'write-failed')
    if (existing !== undefined) {
      if (!acceptsExisting(await readFile(path))) {
        throw new DeliveryEvidenceError('write-failed', `${label} path '${path}' contains different bytes`)
      }
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
        await link(temporary, path)
      } catch (error) {
        /* v8 ignore next 2 -- EEXIST is a cross-process publication race; other link failures require a host filesystem fault. */
        if (!isCode(error, 'EEXIST')) throw error
      }
      const published = await this.safeFileStatus(path, 'write-failed')
      /* v8 ignore next 3 -- only external replacement between link and verification can violate this postcondition. */
      if (published === undefined || !acceptsExisting(await readFile(path))) {
        throw new DeliveryEvidenceError('write-failed', `${label} path '${path}' contains different bytes`)
      }
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

export default LocalDeliveryEvidence
