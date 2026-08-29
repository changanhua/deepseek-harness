import { mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  EvidenceId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  VerificationCheckId,
  WorkPacketId,
  evidenceBytesDigest,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  Config,
  LocalDeliveryEvidence,
} from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function evidenceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-delivery-evidence-local-'))
  roots.push(root)
  return root
}

describe('local Delivery evidence store', () => {
  it('requires a non-empty storage root', () => {
    expect(Config({ root: 'evidence' })).toEqual({ root: 'evidence' })
    expect(() => Config({} as never)).toThrow()
  })

  it('constructs the provider without touching the configured root', () => {
    const ctx = new Context()
    expect(new LocalDeliveryEvidence(ctx, { root: 'evidence' }))
      .toBeInstanceOf(LocalDeliveryEvidence)
  })

  it('registers and disposes the concrete service with its package invariant', async () => {
    const root = await evidenceRoot()
    const ctx = new Context()
    const fiber = ctx.plugin(LocalDeliveryEvidence, { root })
    await fiber
    expect(ctx.deliveryEvidence).toBeInstanceOf(LocalDeliveryEvidence)
    await fiber.dispose()
    expect(ctx.get('deliveryEvidence')).toBeUndefined()
    await ctx.fiber.dispose()
  })

  it('publishes one immutable envelope that survives provider reconstruction', async () => {
    const root = await evidenceRoot()
    const input = new Uint8Array([1, 2, 3])
    const save = {
      kind: 'log' as const,
      mediaType: 'application/octet-stream',
      data: input,
      provenance: {
        kind: 'change-attempt' as const,
        packetId: WorkPacketId('packet-evidence-local'),
        queueWorkId: QueueWorkIdRef('work-evidence-local'),
        queueAttemptId: QueueAttemptIdRef('attempt-evidence-local'),
      },
    }
    const firstProvider = new LocalDeliveryEvidence(new Context(), { root })
    const reference = await firstProvider.save(save)
    input[0] = 9

    expect(reference).toMatchObject({
      kind: save.kind,
      mediaType: save.mediaType,
      byteLength: 3,
      digest: evidenceBytesDigest(new Uint8Array([1, 2, 3])),
      provenance: save.provenance,
    })
    expect(reference.id).toMatch(/^evidence-sha256-[0-9a-f]{64}$/u)
    expect(reference.uri).toBe(`dsh-evidence://sha256/${reference.digest.slice('sha256:'.length)}`)

    const reconstructed = new LocalDeliveryEvidence(new Context(), { root })
    const resolved = await reconstructed.resolve(reference.id)
    expect(resolved).toEqual(reference)
    expect(resolved).not.toBe(reference)
    expect(await reconstructed.save({ ...save, data: new Uint8Array([1, 2, 3]) })).toEqual(reference)

    const firstRead = await reconstructed.read(reference)
    expect([...firstRead.data]).toEqual([1, 2, 3])
    firstRead.data[1] = 9
    expect([...(await reconstructed.read(reference)).data]).toEqual([1, 2, 3])
  })

  it('re-publishes missing bytes before returning an existing envelope reference', async () => {
    const root = await evidenceRoot()
    const evidence = new LocalDeliveryEvidence(new Context(), { root })
    const save = {
      kind: 'log' as const,
      mediaType: 'text/plain',
      data: new TextEncoder().encode('restart-stable evidence'),
      provenance: {
        kind: 'change-attempt' as const,
        packetId: WorkPacketId('packet-evidence-republish'),
        queueWorkId: QueueWorkIdRef('work-evidence-republish'),
        queueAttemptId: QueueAttemptIdRef('attempt-evidence-republish'),
      },
    }
    const reference = await evidence.save(save)
    await unlink(join(root, 'objects', 'sha256', reference.digest.slice('sha256:'.length)))

    await expect(evidence.save(save)).resolves.toEqual(reference)
    expect([...(await evidence.read(reference)).data]).toEqual([...save.data])
  })

  it('rejects corrupted bytes before returning an existing envelope reference', async () => {
    const root = await evidenceRoot()
    const evidence = new LocalDeliveryEvidence(new Context(), { root })
    const save = {
      kind: 'patch' as const,
      mediaType: 'application/octet-stream',
      data: new Uint8Array([1, 2, 3]),
      provenance: {
        kind: 'change-attempt' as const,
        packetId: WorkPacketId('packet-evidence-reject-corruption'),
        queueWorkId: QueueWorkIdRef('work-evidence-reject-corruption'),
        queueAttemptId: QueueAttemptIdRef('attempt-evidence-reject-corruption'),
      },
    }
    const reference = await evidence.save(save)
    await writeFile(
      join(root, 'objects', 'sha256', reference.digest.slice('sha256:'.length)),
      new Uint8Array([9, 9, 9]),
    )

    await expect(evidence.save(save)).rejects.toMatchObject({
      code: 'write-failed',
      name: 'DeliveryEvidenceError',
    })
  })

  it('rejects a complete byte payload above the configured publication limit', async () => {
    const root = await evidenceRoot()
    const evidence = new LocalDeliveryEvidence(new Context(), { root, maxBytes: 3 })
    const save = {
      kind: 'patch' as const,
      mediaType: 'application/octet-stream',
      provenance: {
        kind: 'change-attempt' as const,
        packetId: WorkPacketId('packet-evidence-bound'),
        queueWorkId: QueueWorkIdRef('work-evidence-bound'),
        queueAttemptId: QueueAttemptIdRef('attempt-evidence-bound'),
      },
    }

    await expect(evidence.save({ ...save, data: new Uint8Array([1, 2, 3]) })).resolves.toMatchObject({
      byteLength: 3,
    })
    await expect(evidence.save({ ...save, data: new Uint8Array([1, 2, 3, 4]) })).rejects.toMatchObject({
      code: 'write-failed',
      name: 'DeliveryEvidenceError',
    })
  })

  it('refuses a link-shaped reference directory without writing through it', async () => {
    const root = await evidenceRoot()
    const outside = await evidenceRoot()
    await symlink(outside, join(root, 'references'), 'junction')
    const evidence = new LocalDeliveryEvidence(new Context(), { root })

    await expect(evidence.save({
      kind: 'log',
      mediaType: 'text/plain',
      data: new TextEncoder().encode('must stay inside the store'),
      provenance: {
        kind: 'change-attempt',
        packetId: WorkPacketId('packet-evidence-link'),
        queueWorkId: QueueWorkIdRef('work-evidence-link'),
        queueAttemptId: QueueAttemptIdRef('attempt-evidence-link'),
      },
    })).rejects.toMatchObject({
      code: 'write-failed',
      name: 'DeliveryEvidenceError',
    })
    expect(await readdir(outside)).toEqual([])
  })

  it('never overwrites bytes occupying a content-addressed object path', async () => {
    const root = await evidenceRoot()
    const data = new Uint8Array([1, 2, 3])
    const digest = evidenceBytesDigest(data)
    const objects = join(root, 'objects', 'sha256')
    const objectPath = join(objects, digest.slice('sha256:'.length))
    await mkdir(objects, { recursive: true })
    await writeFile(objectPath, new Uint8Array([9, 9, 9]))
    const evidence = new LocalDeliveryEvidence(new Context(), { root })

    await expect(evidence.save({
      kind: 'checkpoint-metadata',
      mediaType: 'application/octet-stream',
      data,
      provenance: {
        kind: 'change-attempt',
        packetId: WorkPacketId('packet-evidence-immutable'),
        queueWorkId: QueueWorkIdRef('work-evidence-immutable'),
        queueAttemptId: QueueAttemptIdRef('attempt-evidence-immutable'),
      },
    })).rejects.toMatchObject({
      code: 'write-failed',
      name: 'DeliveryEvidenceError',
    })
    expect([...await readFile(objectPath)]).toEqual([9, 9, 9])
  })

  it('rejects schema-valid reference metadata that no longer matches its content address', async () => {
    const root = await evidenceRoot()
    const evidence = new LocalDeliveryEvidence(new Context(), { root })
    const reference = await evidence.save({
      kind: 'verification-output',
      mediaType: 'text/plain',
      data: new TextEncoder().encode('verified output'),
      provenance: {
        kind: 'verification-check',
        packetId: WorkPacketId('packet-evidence-reference'),
        queueWorkId: QueueWorkIdRef('work-evidence-reference'),
        queueAttemptId: QueueAttemptIdRef('attempt-evidence-reference'),
        checkId: VerificationCheckId('check-evidence-reference'),
      },
    })
    await writeFile(
      join(root, 'references', `${reference.id}.json`),
      JSON.stringify({ ...reference, uri: 'dsh-evidence://sha256/ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' }),
    )

    await expect(evidence.resolve(reference.id)).rejects.toMatchObject({
      code: 'reference-mismatch',
      name: 'DeliveryEvidenceError',
    })
  })

  it('rejects link-shaped evidence bytes even when the target has the expected digest', async () => {
    const root = await evidenceRoot()
    const outside = await evidenceRoot()
    const evidence = new LocalDeliveryEvidence(new Context(), { root })
    const data = new TextEncoder().encode('matching external bytes')
    const reference = await evidence.save({
      kind: 'screenshot',
      mediaType: 'application/octet-stream',
      data,
      provenance: {
        kind: 'change-attempt',
        packetId: WorkPacketId('packet-evidence-object-link'),
        queueWorkId: QueueWorkIdRef('work-evidence-object-link'),
        queueAttemptId: QueueAttemptIdRef('attempt-evidence-object-link'),
      },
    })
    const objectPath = join(root, 'objects', 'sha256', reference.digest.slice('sha256:'.length))
    const outsidePath = join(outside, 'external-bytes')
    await writeFile(outsidePath, data)
    await unlink(objectPath)
    await symlink(outsidePath, objectPath, 'file')

    await expect(evidence.read(reference)).rejects.toMatchObject({
      code: 'read-failed',
      name: 'DeliveryEvidenceError',
    })
  })

  it('classifies missing and corrupted files through stable evidence errors', async () => {
    const root = await evidenceRoot()
    const evidence = new LocalDeliveryEvidence(new Context(), { root })
    const provenance = {
      kind: 'verification-check' as const,
      packetId: WorkPacketId('packet-evidence-corruption'),
      queueWorkId: QueueWorkIdRef('work-evidence-corruption'),
      queueAttemptId: QueueAttemptIdRef('attempt-evidence-corruption'),
      checkId: VerificationCheckId('check-evidence-corruption'),
    }
    const save = (label: string) => evidence.save({
      kind: 'verification-output',
      mediaType: 'text/plain',
      data: new TextEncoder().encode(label),
      provenance,
    })

    const invalidMetadata = await save('invalid metadata')
    await writeFile(join(root, 'references', `${invalidMetadata.id}.json`), '{')
    await expect(evidence.resolve(invalidMetadata.id)).rejects.toMatchObject({ code: 'read-failed' })

    const missing = await save('missing bytes')
    await unlink(join(root, 'objects', 'sha256', missing.digest.slice('sha256:'.length)))
    await expect(evidence.read(missing)).rejects.toMatchObject({ code: 'not-found' })

    const shortened = await save('length changes')
    await writeFile(
      join(root, 'objects', 'sha256', shortened.digest.slice('sha256:'.length)),
      new TextEncoder().encode('short'),
    )
    await expect(evidence.read(shortened)).rejects.toMatchObject({ code: 'length-mismatch' })

    const changed = await save('same size bytes')
    await writeFile(
      join(root, 'objects', 'sha256', changed.digest.slice('sha256:'.length)),
      new TextEncoder().encode('XXXXXXXXXXXXXXX'),
    )
    await expect(evidence.read(changed)).rejects.toMatchObject({ code: 'digest-mismatch' })
  })

  it('rejects caller reference drift and propagates cancellation without filesystem work', async () => {
    const root = await evidenceRoot()
    const evidence = new LocalDeliveryEvidence(new Context(), { root })
    const save = {
      kind: 'log' as const,
      mediaType: 'text/plain',
      data: new TextEncoder().encode('cancellation fixture'),
      provenance: {
        kind: 'change-attempt' as const,
        packetId: WorkPacketId('packet-evidence-cancel'),
        queueWorkId: QueueWorkIdRef('work-evidence-cancel'),
        queueAttemptId: QueueAttemptIdRef('attempt-evidence-cancel'),
      },
    }
    const reference = await evidence.save(save)
    await expect(evidence.read({ ...reference, mediaType: 'application/json' }))
      .rejects.toMatchObject({ code: 'reference-mismatch' })
    await expect(evidence.resolve(EvidenceId('foreign-evidence-id'))).resolves.toBeUndefined()
    await expect(evidence.read({
      ...reference,
      id: EvidenceId(`evidence-sha256-${'0'.repeat(64)}`),
    })).rejects.toMatchObject({ code: 'not-found' })

    const reason = new Error('stop evidence operation')
    const signal = AbortSignal.abort(reason)
    await expect(evidence.save(save, signal)).rejects.toBe(reason)
    await expect(evidence.resolve(reference.id, signal)).rejects.toBe(reason)
    await expect(evidence.read(reference, signal)).rejects.toBe(reason)
  })

  it('fails closed for missing or linked storage directories', async () => {
    const parent = await evidenceRoot()
    const outside = await evidenceRoot()
    const id = EvidenceId(`evidence-sha256-${'1'.repeat(64)}`)
    await expect(new LocalDeliveryEvidence(new Context(), { root: join(parent, 'missing') }).resolve(id))
      .resolves.toBeUndefined()
    await expect(new LocalDeliveryEvidence(new Context(), { root: parent }).resolve(id))
      .resolves.toBeUndefined()

    const linkedRoot = join(parent, 'linked-root')
    await symlink(outside, linkedRoot, 'junction')
    await expect(new LocalDeliveryEvidence(new Context(), { root: linkedRoot }).resolve(id))
      .rejects.toMatchObject({ code: 'read-failed' })

    const blockingFile = join(parent, 'blocking-file')
    await writeFile(blockingFile, 'not a directory')
    await expect(new LocalDeliveryEvidence(new Context(), { root: join(blockingFile, 'store') }).save({
      kind: 'log',
      mediaType: 'text/plain',
      data: new Uint8Array(),
      provenance: {
        kind: 'change-attempt',
        packetId: WorkPacketId('packet-evidence-blocked-root'),
        queueWorkId: QueueWorkIdRef('work-evidence-blocked-root'),
        queueAttemptId: QueueAttemptIdRef('attempt-evidence-blocked-root'),
      },
    })).rejects.toMatchObject({ code: 'write-failed' })

    const root = await evidenceRoot()
    const evidence = new LocalDeliveryEvidence(new Context(), { root })
    const reference = await evidence.save({
      kind: 'log',
      mediaType: 'text/plain',
      data: new TextEncoder().encode('object directory fixture'),
      provenance: {
        kind: 'change-attempt',
        packetId: WorkPacketId('packet-evidence-directory'),
        queueWorkId: QueueWorkIdRef('work-evidence-directory'),
        queueAttemptId: QueueAttemptIdRef('attempt-evidence-directory'),
      },
    })
    await rm(join(root, 'objects'), { recursive: true, force: true })
    await expect(evidence.read(reference)).rejects.toMatchObject({ code: 'not-found' })
    await mkdir(join(root, 'objects'))
    await symlink(outside, join(root, 'objects', 'sha256'), 'junction')
    await expect(evidence.read(reference)).rejects.toMatchObject({ code: 'read-failed' })
  })

  it('reuses an intact orphan object and converges concurrent publications', async () => {
    const root = await evidenceRoot()
    const data = new TextEncoder().encode('shared immutable bytes')
    const digest = evidenceBytesDigest(data)
    const objects = join(root, 'objects', 'sha256')
    await mkdir(objects, { recursive: true })
    await writeFile(join(objects, digest.slice('sha256:'.length)), data)
    const save = {
      kind: 'patch' as const,
      mediaType: 'application/octet-stream',
      data,
      provenance: {
        kind: 'change-attempt' as const,
        packetId: WorkPacketId('packet-evidence-concurrent'),
        queueWorkId: QueueWorkIdRef('work-evidence-concurrent'),
        queueAttemptId: QueueAttemptIdRef('attempt-evidence-concurrent'),
      },
    }
    const providers = Array.from({ length: 12 }, () => new LocalDeliveryEvidence(new Context(), { root }))
    const references = await Promise.all(providers.map(async provider => await provider.save(save)))
    expect(references.every(reference => JSON.stringify(reference) === JSON.stringify(references[0]))).toBe(true)
  })
})
