import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import { AssessmentStore } from '../src/store.ts'
import { input } from '../../requirement-assessment/tests/fixtures.ts'
const disposals: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose() })
async function open(root?: string, bytes?: number) {
  const dir = root ?? await mkdtemp(join(tmpdir(), 'dsh-assessment-'))
  if (!root) disposals.push(() => rm(dir, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('json', new JsonStorageBackend(dir))
  const facility = new DomainFacility(ctx, { backend: 'json', routes: {} })
  ctx.provide('storageDomain', facility)
  const store = await AssessmentStore.open(facility, bytes)
  disposals.push(async () => { await store.close(); await ctx.fiber.dispose() })
  return { store, root: dir, ctx }
}
const access = { workspaceId: 'workspace-a', actorId: 'human-a', kind: 'human' as const, authorize() {} }
describe('AssessmentStore', () => {
  it('persists immutable input, evidence and supersedes across reload without leaking workspaces', async () => {
    const first = await open()
    const original = await first.store.create(access, input)
    const revised = await first.store.create(access, { ...input, requestId: 'second', requestDigest: 'second', supersedes: original.id, actualInput: { ...input.actualInput, text: 'Changed' } })
    original.actualInput.text = 'Caller mutation'
    await first.store.close()
    await first.ctx.fiber.dispose()
    const reopened = await open(first.root)
    expect(reopened.store.get(access.workspaceId, original.id).actualInput.text).toBe('Original text')
    expect(reopened.store.get(access.workspaceId, revised.id).supersedes).toBe(original.id)
    expect(() => reopened.store.get('workspace-b', original.id)).toThrow('unavailable')
    await expect(reopened.store.create({ ...access, workspaceId: 'workspace-b' }, { ...input, supersedes: original.id })).rejects.toMatchObject({ code: 'conflict' })
  })
  it('serializes concurrent requests and durably prevents duplicate evaluator reservations', async () => {
    const { store } = await open()
    const reservation = { requestId: input.requestId, requestDigest: input.requestDigest }
    const results = await Promise.all([store.reserve(access, reservation), store.reserve(access, reservation)])
    expect(results.map(value => value.status)).toEqual(['acquired', 'pending'])
    await expect(store.reserve(access, { ...reservation, requestDigest: 'changed' })).rejects.toMatchObject({ code: 'idempotency-conflict' })
    const [first, second] = await Promise.all([store.create(access, input), store.create(access, input)])
    expect(second).toEqual(first)
    expect(store.snapshot(access.workspaceId).assessments).toHaveLength(1)
    await expect(store.create(access, { ...input, rawOutput: 'Changed despite same digest' })).rejects.toMatchObject({ code: 'idempotency-conflict' })
    await expect(store.reserve(access, reservation)).resolves.toEqual({ status: 'completed', assessment: first })
    await expect(store.create(access, { ...input, requestDigest: 'changed' })).rejects.toMatchObject({ code: 'idempotency-conflict' })
  })
  it('retains unresolved reservations after restart', async () => {
    const first = await open()
    await first.store.reserve(access, input)
    await first.store.close()
    await first.ctx.fiber.dispose()
    const second = await open(first.root)
    await expect(second.store.reserve(access, input)).resolves.toEqual({ status: 'pending' })
  })
  it('rejects revoked authority, cancelled writes and tiny complete byte budgets atomically', async () => {
    const tiny = await open(undefined, 1)
    await expect(tiny.store.create(access, input)).rejects.toMatchObject({ code: 'capacity-exceeded' })
    const { store } = await open()
    await expect(store.create({ ...access, authorize() { throw new Error('revoked') } }, input)).rejects.toThrow('revoked')
    await expect(store.create(access, input, AbortSignal.abort())).rejects.toThrow()
    expect(store.snapshot(access.workspaceId).assessments).toEqual([])
  })
  it('bounds the complete UTF-8 record at exact and one-byte-short capacities', async () => {
    const first = await open()
    await first.store.create(access, { ...input, actualInput: { ...input.actualInput, text: '中文😀' } })
    const snapshot = first.store.snapshot(access.workspaceId)
    const bytes = Buffer.byteLength(JSON.stringify({ ...snapshot, reservations: [] }), 'utf8')
    await first.store.close()
    await first.ctx.fiber.dispose()
    const exact = await open(first.root, bytes)
    expect(exact.store.snapshot(access.workspaceId)).toEqual(snapshot)
    await exact.store.close()
    await exact.ctx.fiber.dispose()
    const short = await open(first.root, bytes - 1)
    expect(() => short.store.snapshot(access.workspaceId)).toThrow('capacity')
  })
  it('captures queued caller input and fences same-subject history', async () => {
    const { store } = await open()
    const mutable = structuredClone(input)
    const pending = store.create(access, mutable)
    mutable.actualInput.text = 'Mutated after invocation'
    const saved = await pending
    expect(saved.actualInput.text).toBe('Original text')
    const subject = { ...input.subject, id: 'another-subject' }
    await expect(store.create(access, { ...input, subject, baseline: { ...input.baseline, subject }, requestId: 'other', requestDigest: 'other', supersedes: saved.id })).rejects.toMatchObject({ code: 'conflict' })
  })
})
