import { afterEach, describe, expect, it, vi } from 'vitest'
import { rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { createMemoryHarness } from './harness.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0).reverse()) await close()
})
async function harness() {
  const memory = await createMemoryHarness()
  cleanups.push(memory.dispose)
  const caller = memory.agent()
  const draft = {
    topicKey: 'validation', kind: 'method' as const, title: 'Validation', statement: 'Run tests', tags: [], conditions: '',
    sources: [{ kind: 'file' as const, path: 'README.md' }], idempotencyKey: 'admission',
  }
  const candidate = await memory.ctx.projectMemory.propose(caller, draft)
  const decision = (id = candidate.id, revision = 1) => ({
    id, revision, expectedVersion: 1, action: 'accept' as const,
    commandId: memory.human(caller, `accept ${id}@${revision}`),
  })
  return { ...memory, caller, draft, candidate, decision }
}

describe('memory provider admission failures', () => {
  it('rejects an invalid candidate without admitting a record', async () => {
    const memory = await harness()
    await expect(memory.ctx.projectMemory.propose(memory.caller, { ...memory.draft, statement: '', idempotencyKey: 'bad' }))
      .rejects.toMatchObject({ code: 'invalid-input' })
    expect(await memory.records(memory.caller)).toHaveLength(1)
  })

  it('rejects absent memory and revision identities even with exact human command evidence', async () => {
    const memory = await harness()
    await expect(memory.ctx.projectMemory.decide(memory.caller, memory.decision('absent'))).rejects.toMatchObject({ code: 'not-found' })
    await expect(memory.ctx.projectMemory.decide(memory.caller, memory.decision(undefined, 99))).rejects.toMatchObject({ code: 'invalid-transition' })
    await expect(memory.ctx.projectMemory.inspect(memory.caller, {
      id: memory.candidate.id, revision: 99, commandId: memory.human(memory.caller, `show ${memory.candidate.id}@99`),
    })).rejects.toMatchObject({ code: 'not-found' })
  })

  it('refuses acceptance when a source vanishes or the command durability checkpoint refuses', async () => {
    const memory = await harness()
    vi.spyOn(memory.ctx.sessions, 'flush').mockResolvedValueOnce(false)
    await expect(memory.ctx.projectMemory.decide(memory.caller, memory.decision())).rejects.toMatchObject({ code: 'unauthorized' })
    await unlink(join(memory.cwd, 'README.md'))
    await expect(memory.ctx.projectMemory.decide(memory.caller, memory.decision())).rejects.toMatchObject({ code: 'source-unavailable' })
    expect((await memory.records(memory.caller))[0]).toMatchObject({ activeRevision: null, candidateRevision: 1, decisions: [] })
  })

  it('does not obtain a file capability from another context when the caller lacks one', async () => {
    const memory = await harness()
    const isolated = new Context()
    cleanups.push(() => isolated.fiber.dispose())
    await expect(memory.ctx.projectMemory.propose({ ...memory.caller, ctx: isolated }, { ...memory.draft, idempotencyKey: 'without-fs' }))
      .rejects.toMatchObject({ code: 'source-unavailable' })
  })

  it('does not fall back to global memory when the project directory no longer exists', async () => {
    const memory = await harness()
    await unlink(join(memory.cwd, 'README.md'))
    await rmdir(memory.cwd)
    await expect(memory.ctx.projectMemory.search(memory.caller, { query: 'validation' })).rejects.toMatchObject({ code: 'workspace-unavailable' })
  })

  it.each([
    { query: ' ' }, { query: 'x'.repeat(1001) }, { query: 'validation', limit: 0 },
    { query: 'validation', limit: 0.5 }, { query: 'validation', tags: Array.from({ length: 21 }, () => 'ci') },
  ])('rejects unbounded service-level search input: %j', async (request) => {
    const memory = await harness()
    await expect(memory.ctx.projectMemory.search(memory.caller, request)).rejects.toMatchObject({ code: 'invalid-input' })
  })
})
