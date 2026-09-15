import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { MemoryMutation } from '@changanhua/dsh-memory'
import { createMemoryHarness } from './harness.ts'

const cleanups: Array<() => Promise<void>> = []
const releases: Array<() => void> = []
afterEach(async () => {
  for (const release of releases.splice(0)) release()
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0).reverse()) await close()
})

async function harness() {
  const memory = await createMemoryHarness()
  cleanups.push(memory.dispose)
  const reader = memory.agent()
  const writer = memory.agent()
  const propose = (key: string, previous?: MemoryMutation, statement = 'Run pnpm test', topic = 'validation') =>
    memory.ctx.projectMemory.propose(writer, {
      topicKey: topic, kind: 'method', title: `Validation ${key}`, statement, tags: [], conditions: '',
      sources: [{ kind: 'file', path: 'README.md' }], idempotencyKey: key,
      ...previous === undefined ? {} : { memoryId: previous.id, expectedVersion: previous.recordVersion },
    })
  const decide = (target: MemoryMutation, action: 'accept' | 'retire' | 'reject' = 'accept', caller = writer, signal?: AbortSignal) =>
    memory.ctx.projectMemory.decide(caller, {
      id: target.id, revision: target.revision, expectedVersion: target.recordVersion, action,
      commandId: memory.human(caller, `${action} ${target.id}@${target.revision}`),
    }, signal)
  const pauseReads = (ordinals: number[]) => {
    const fs = memory.ctx.fs
    const original = fs.readBytes.bind(fs)
    const gates = ordinals.map(ordinal => ({ ordinal, entered: false, resume: Promise.withResolvers<undefined>() }))
    releases.push(...gates.map(gate => () => { gate.resume.resolve(undefined) }))
    let calls = 0
    vi.spyOn(fs, 'readBytes').mockImplementation(async (...args) => {
      const ordinal = ++calls
      const bytes = await original(...args)
      const gate = gates.find(value => value.ordinal === ordinal)
      if (gate !== undefined) {
        gate.entered = true
        await gate.resume.promise
      }
      return bytes
    })
    return {
      async entered(index = 0) { await expect.poll(() => gates[index]?.entered, { timeout: 2000 }).toBe(true) },
      release(index = 0) { gates[index]?.resume.resolve(undefined) },
    }
  }
  return { ...memory, reader, writer, propose, decide, pauseReads }
}

describe('project memory observations across concurrent changes', () => {
  it('withholds a result when the initiating Session loses its live registration during IO', async () => {
    const memory = await harness()
    const accepted = await memory.decide(await memory.propose('first'))
    let reader = memory.reader
    const owner = await memory.ctx.plugin(Object.assign((ctx: Context) => {
      const session = ctx.sessions.create(SessionId('temporary-reader'), { meta: { cwd: memory.cwd } })
      reader = { ...reader, id: session.id, session }
    }, { inject: ['sessions'] }))
    const gate = memory.pauseReads([1])
    const reading = memory.ctx.projectMemory.read(reader, accepted.id)
    const rejected = expect(reading).rejects.toMatchObject({ code: 'workspace-unavailable' })
    await gate.entered()
    await owner.dispose()
    expect(memory.ctx.sessions.get(reader.session.id)).toBeUndefined()
    gate.release()
    await rejected
  })

  it('rechecks the record after a concurrent human retirement while reading its source', async () => {
    const memory = await harness()
    const accepted = await memory.decide(await memory.propose('first'))
    const gate = memory.pauseReads([1])
    const reading = memory.ctx.projectMemory.read(memory.reader, accepted.id)
    await gate.entered()
    await memory.decide(accepted, 'retire')
    gate.release()
    expect(await reading).toMatchObject({ eligibility: 'withdrawn', revision: null, recordVersion: 3 })
  })

  it('refuses a human inspection whose record changed while source previews were being read', async () => {
    const memory = await harness()
    const accepted = await memory.decide(await memory.propose('first'))
    const gate = memory.pauseReads([1])
    const inspecting = memory.ctx.projectMemory.inspect(memory.reader, {
      id: accepted.id, commandId: memory.human(memory.reader, `show ${accepted.id}`),
    })
    const rejected = expect(inspecting).rejects.toMatchObject({ code: 'version-conflict' })
    await gate.entered()
    await memory.decide(accepted, 'retire')
    gate.release()
    await rejected
  })

  it('rechecks the registered Workspace identity after source IO', async () => {
    const memory = await harness()
    const accepted = await memory.decide(await memory.propose('first'))
    const before = memory.ctx.workspaceRegistry.list()
    const gate = memory.pauseReads([1])
    const reading = memory.ctx.projectMemory.read(memory.reader, accepted.id)
    const rejected = expect(reading).rejects.toMatchObject({ code: 'workspace-unavailable' })
    await gate.entered()
    vi.spyOn(memory.ctx.workspaceRegistry, 'list').mockReturnValue(before.map(value => ({
      ...value, id: 'replacement' as typeof value.id, path: value.path,
    })))
    gate.release()
    await rejected
  })

  it('stops after one retry when the same record changes in both source observations', async () => {
    const memory = await harness()
    const accepted = await memory.decide(await memory.propose('first'))
    // Read 1 pauses the caller; read 2 belongs to the concurrent proposal;
    // read 3 is the caller's one permitted retry.
    const gate = memory.pauseReads([1, 3])
    const reading = memory.ctx.projectMemory.read(memory.reader, accepted.id)
    const rejected = expect(reading).rejects.toMatchObject({ code: 'concurrent-change' })
    await gate.entered()
    const next = await memory.propose('second', accepted, 'Run the revised validation')
    gate.release()
    await gate.entered(1)
    await memory.decide(next, 'reject')
    gate.release(1)
    await rejected
  })

  it('does not return an earlier hit retired while a later search hit was being checked', async () => {
    const memory = await harness()
    await memory.decide(await memory.propose('one', undefined, 'First validation method', 'one'))
    await memory.decide(await memory.propose('two', undefined, 'Second validation method', 'two'))
    const baseline = await memory.ctx.projectMemory.search(memory.reader, { query: 'validation' })
    const first = baseline.items[0]
    if (first === undefined || first.revision === null) throw new Error('missing baseline search hit')
    const gate = memory.pauseReads([2])
    const searching = memory.ctx.projectMemory.search(memory.reader, { query: 'validation' })
    await gate.entered()
    await memory.decide({ id: first.id, revision: first.revision, recordVersion: first.recordVersion }, 'retire')
    gate.release()
    const result = await searching
    expect(result.items).toHaveLength(1)
    expect(result.items.some(value => value.id === first.id)).toBe(false)
  })

  it('bounds whole-search retries when different records change after individual checks', async () => {
    const memory = await harness()
    await memory.decide(await memory.propose('one', undefined, 'First method', 'one'))
    await memory.decide(await memory.propose('two', undefined, 'Second method', 'two'))
    const first = (await memory.ctx.projectMemory.search(memory.reader, { query: 'validation' })).items[0]
    if (first === undefined || first.revision === null) throw new Error('missing baseline search hit')
    const gate = memory.pauseReads([2, 3])
    const searching = memory.ctx.projectMemory.search(memory.reader, { query: 'validation' })
    const rejected = expect(searching).rejects.toMatchObject({ code: 'concurrent-change' })
    await gate.entered()
    await memory.decide({ id: first.id, revision: first.revision, recordVersion: first.recordVersion }, 'retire')
    gate.release()
    await gate.entered(1)
    await memory.propose('third', undefined, 'Another pending method', 'third')
    gate.release(1)
    await rejected
  })

  it('does not return a hit whose review deadline passes during later search checks', async () => {
    const memory = await harness()
    await memory.decide(await memory.propose('one', undefined, 'First method', 'one'))
    await memory.decide(await memory.propose('two', undefined, 'Second method', 'two'))
    const first = (await memory.ctx.projectMemory.search(memory.reader, { query: 'validation' })).items[0]
    if (first?.reviewAfter === undefined) throw new Error('missing review deadline')
    const gate = memory.pauseReads([2])
    const searching = memory.ctx.projectMemory.search(memory.reader, { query: 'validation' })
    await gate.entered()
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(first.reviewAfter))
    gate.release()
    const result = await searching
    expect(result.items.some(item => item.id === first.id)).toBe(false)
    expect(result.items.every(item => Date.parse(item.reviewAfter ?? '') > Date.now())).toBe(true)
    expect(result.excluded['review-due']).toBeGreaterThanOrEqual(1)
  })

  it('withholds the body if the review deadline arrives during the source read', async () => {
    const memory = await harness()
    const accepted = await memory.decide(await memory.propose('first'))
    const deadline = (await memory.records(memory.writer))[0]?.decisions[0]?.reviewAfter
    if (deadline === undefined) throw new Error('acceptance has no deadline')
    const gate = memory.pauseReads([1])
    const reading = memory.ctx.projectMemory.read(memory.reader, accepted.id)
    await gate.entered()
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(deadline))
    gate.release()
    const result = await reading
    expect(result.eligibility).toBe('review-due')
    expect(result).not.toHaveProperty('memory')
    expect(result.sources.every(value => value.preview === undefined)).toBe(true)
  })

  it('does not disclose source previews when a conflicting claim becomes active during observation', async () => {
    const memory = await harness()
    const source = await readFile(join(memory.cwd, 'README.md'), 'utf8')
    const first = await memory.decide(await memory.propose('first', undefined, source))
    const conflicting = await memory.propose('conflict', undefined, 'Use another command')
    const gate = memory.pauseReads([1])
    const reading = memory.ctx.projectMemory.read(memory.reader, first.id)
    await gate.entered()
    await memory.decide(conflicting)
    gate.release()
    const result = await reading
    expect(result.eligibility).toBe('conflicted')
    expect(JSON.stringify(result)).not.toContain('pnpm test')
  })

  it.each(['proposal', 'decision'] as const)('cancels a %s during source observation without a durable mutation', async (operation) => {
    const memory = await harness()
    const pending = await memory.propose('first')
    const before = await memory.records(memory.writer)
    const gate = memory.pauseReads([1])
    const controller = new AbortController()
    const request = operation === 'decision'
      ? memory.decide(pending, 'accept', memory.writer, controller.signal)
      : memory.ctx.projectMemory.propose(memory.writer, {
        topicKey: 'other', kind: 'fact', title: 'Canceled claim', statement: 'Canceled claim', tags: [], conditions: '',
        sources: [{ kind: 'file', path: 'README.md' }], idempotencyKey: 'canceled',
      }, controller.signal)
    const rejected = expect(request).rejects.toThrow('cancel during source check')
    await gate.entered()
    controller.abort(new Error('cancel during source check'))
    gate.release()
    await rejected
    expect(await memory.records(memory.writer)).toEqual(before)
  })

  it('rejects a changed source even if the caller supplied an earlier valid candidate revision', async () => {
    const memory = await harness()
    const pending = await memory.propose('first')
    await writeFile(join(memory.cwd, 'README.md'), 'Changed validation rule')
    await expect(memory.decide(pending)).rejects.toMatchObject({ code: 'source-changed' })
    expect((await memory.records(memory.writer))[0]).toMatchObject({ activeRevision: null, candidateRevision: 1, recordVersion: 1 })
  })
})
