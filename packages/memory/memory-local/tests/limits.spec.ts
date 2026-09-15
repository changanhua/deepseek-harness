import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MemoryMutation } from '@changanhua/dsh-memory'
import { createMemoryHarness } from './harness.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0).reverse()) await close()
})

async function harness(config: Parameters<typeof createMemoryHarness>[0] = {}) {
  const memory = await createMemoryHarness(config)
  cleanups.push(memory.dispose)
  const caller = memory.agent()
  const propose = (key: string, previous?: MemoryMutation) => memory.ctx.projectMemory.propose(caller, {
    topicKey: `validation.${previous === undefined ? key : 'first'}`, kind: 'method',
    title: `Validation ${key}`, statement: `Validate the project with pnpm test (${key}).`,
    tags: [], conditions: '', sources: [{ kind: 'file', path: 'README.md' }], idempotencyKey: key,
    ...previous === undefined ? {} : { memoryId: previous.id, expectedVersion: previous.recordVersion },
  })
  const accept = (mutation: MemoryMutation) => memory.ctx.projectMemory.decide(caller, {
    id: mutation.id, revision: mutation.revision, expectedVersion: mutation.recordVersion,
    action: 'accept', commandId: memory.human(caller, `accept ${mutation.id}@${mutation.revision}`),
  })
  return { ...memory, caller, propose, accept }
}

describe('project memory capacity preserves existing state', () => {
  it('refuses a new candidate when an accepted record has no remaining receipt capacity', async () => {
    const memory = await harness({ maxReceipts: 2 })
    const accepted = await memory.accept(await memory.propose('first'))
    await expect(memory.propose('second', accepted)).rejects.toMatchObject({ code: 'capacity-exceeded' })
    expect((await memory.records(memory.caller))[0]).toMatchObject({ activeRevision: 1, candidateRevision: null, recordVersion: 2 })
  })
  it('rejects a full project without eviction and still returns the first idempotent receipt', async () => {
    const memory = await harness({ maxRecordsPerWorkspace: 2 })
    const first = await memory.propose('first')
    await memory.propose('second')
    const before = await memory.records(memory.caller)
    await expect(memory.propose('third')).rejects.toMatchObject({ code: 'capacity-exceeded' })
    expect(await memory.propose('first')).toEqual(first)
    expect(await memory.records(memory.caller)).toEqual(before)
  })

  it('keeps the last active version and all immutable history at the revision cap', async () => {
    const memory = await harness({ maxRevisions: 2 })
    const first = await memory.accept(await memory.propose('first'))
    const second = await memory.accept(await memory.propose('second', first))
    const before = await memory.records(memory.caller)
    await expect(memory.propose('third', second)).rejects.toMatchObject({ code: 'capacity-exceeded' })
    expect(await memory.records(memory.caller)).toEqual(before)
    expect(await memory.ctx.projectMemory.read(memory.caller, first.id)).toMatchObject({ revision: 2, eligibility: 'usable' })
  })

  it('does not activate an unreceipted decision when the receipt cap is reached', async () => {
    const memory = await harness({ maxReceipts: 3 })
    const first = await memory.accept(await memory.propose('first'))
    const pending = await memory.propose('second', first)
    const before = await memory.records(memory.caller)
    await expect(memory.accept(pending)).rejects.toMatchObject({ code: 'capacity-exceeded' })
    const after = await memory.records(memory.caller)
    expect(after).toEqual(before)
    expect(after[0]).toMatchObject({ activeRevision: 1, candidateRevision: 2, recordVersion: 3 })
    expect(after[0]?.decisions).toHaveLength(1)
  })

  it('rejects a source that grows beyond its byte cap without losing the earlier record', async () => {
    const memory = await harness({ maxSourceBytes: 64 })
    const original = await readFile(join(memory.cwd, 'README.md'), 'utf8')
    const first = await memory.accept(await memory.propose('first'))
    const before = await memory.records(memory.caller)
    await writeFile(join(memory.cwd, 'README.md'), 'x'.repeat(65))
    await expect(memory.propose('second')).rejects.toMatchObject({ code: 'source-unavailable' })
    expect(await memory.ctx.projectMemory.read(memory.caller, first.id)).toMatchObject({ eligibility: 'source-unavailable' })
    expect(await memory.records(memory.caller)).toEqual(before)
    await writeFile(join(memory.cwd, 'README.md'), original)
    expect(await memory.ctx.projectMemory.read(memory.caller, first.id)).toMatchObject({ eligibility: 'usable' })
  })

  it('returns an explicit output-cap error without truncating a stored claim or changing it', async () => {
    const memory = await harness({ maxOutputBytes: 200 })
    const first = await memory.accept(await memory.propose('first'))
    const before = await memory.records(memory.caller)
    await expect(memory.ctx.projectMemory.read(memory.caller, first.id)).rejects.toMatchObject({ code: 'capacity-exceeded' })
    await expect(memory.ctx.projectMemory.search(memory.caller, { query: 'validation' })).rejects.toMatchObject({ code: 'capacity-exceeded' })
    expect(await memory.records(memory.caller)).toEqual(before)
  })

  it('honors the configured recall count even when the caller requests more', async () => {
    const memory = await harness({ maxSearchResults: 1 })
    for (const key of ['first', 'second', 'third']) await memory.accept(await memory.propose(key))
    const result = await memory.ctx.projectMemory.search(memory.caller, { query: 'validation', limit: 100 })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ eligibility: 'usable', revision: 1 })
    expect(await memory.records(memory.caller)).toHaveLength(3)
  })

  it('returns only complete hits when another hit would exceed the response byte budget', async () => {
    const memory = await harness({ maxOutputBytes: 1000 })
    await memory.accept(await memory.propose('first'))
    await memory.accept(await memory.propose('second'))
    const result = await memory.ctx.projectMemory.search(memory.caller, { query: 'validation' })
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.memory?.statement).toMatch(/^Validate the project with pnpm test \((first|second)\)\.$/u)
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(1000)
    expect(await memory.records(memory.caller)).toHaveLength(2)
  })

  it('withholds the accepted body exactly at the review deadline', async () => {
    const memory = await harness()
    const first = await memory.accept(await memory.propose('first'))
    const before = await memory.records(memory.caller)
    const deadline = before[0]?.decisions[0]?.reviewAfter
    if (deadline === undefined) throw new Error('acceptance did not persist its review deadline')
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(deadline))
    const result = await memory.ctx.projectMemory.read(memory.caller, first.id)
    expect(result).toMatchObject({ eligibility: 'review-due', revision: 1 })
    expect(result).not.toHaveProperty('memory')
    expect(await memory.ctx.projectMemory.search(memory.caller, { query: 'validation' })).toMatchObject({ items: [], excluded: { 'review-due': 1 } })
    expect(await memory.records(memory.caller)).toEqual(before)
  })
})
