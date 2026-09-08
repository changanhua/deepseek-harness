import { afterEach, describe, expect, it } from 'vitest'
import { access, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { KvUnit } from '@deepseek-ai/dsh-storage'
import LocalProjectMemory from '../src/index.ts'
import { createMemoryHarness } from './harness.ts'

const cleanups: Array<() => Promise<void>> = []
const releases: Array<() => void> = []
afterEach(async () => {
  for (const release of releases.splice(0)) release()
  for (const close of cleanups.splice(0).reverse()) await close()
})

async function harness() {
  const before = Promise.withResolvers<undefined>()
  const after = Promise.withResolvers<undefined>()
  releases.push(() => { before.resolve(undefined) }, () => { after.resolve(undefined) })
  const control = { pauseBefore: false, pauseAfter: false, entered: false, written: false, fail: false }
  const wrap = (unit: KvUnit): KvUnit => ({
    loadAll: () => unit.loadAll(), setGlobal: value => unit.setGlobal(value),
    deleteRecord: (table, key) => unit.deleteRecord(table, key), close: () => unit.close(),
    async putRecord(table, key, value) {
      control.entered = true
      if (control.pauseBefore) await before.promise
      if (control.fail) throw new Error('test memory medium unavailable')
      await unit.putRecord(table, key, value)
      control.written = true
      if (control.pauseAfter) await after.promise
    },
  })
  const memory = await createMemoryHarness({}, wrap)
  cleanups.push(memory.dispose)
  const caller = memory.agent()
  const draft = {
    topicKey: 'validation', kind: 'method' as const, title: 'Validation', statement: 'Run pnpm test',
    tags: [], conditions: '', sources: [{ kind: 'file' as const, path: 'README.md' }], idempotencyKey: 'first-proposal',
  }
  const disk = async () => JSON.parse(await readFile(join(memory.root, 'storage/project_memory.json'), 'utf8')) as {
    tables: { memories: Record<string, {
      activeRevision: number | null
      recordVersion: number
      revisions: unknown[]
      receipts: unknown[]
    }> }
  }
  return { ...memory, caller, draft, disk, control, before, after }
}

describe('project memory operation and ownership recovery', () => {
  it('preserves malformed persisted data and releases ownership after a failed reopen', async () => {
    const memory = await harness()
    const candidate = await memory.ctx.projectMemory.propose(memory.caller, memory.draft)
    const path = join(memory.root, 'storage/project_memory.json')
    const original = await readFile(path, 'utf8')
    await memory.memoryFiber.dispose()
    const corrupted = JSON.parse(original) as Awaited<ReturnType<typeof memory.disk>>
    corrupted.tables.memories[candidate.id]!.recordVersion = 99
    const damaged = JSON.stringify(corrupted)
    await writeFile(path, damaged)
    await expect(memory.ctx.plugin(LocalProjectMemory, { ownershipRoot: join(memory.root, 'owner') })).rejects.toThrow()
    expect(await readFile(path, 'utf8')).toBe(damaged)
    await expect(access(join(memory.root, 'owner/owner.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(path, original)
    await memory.ctx.plugin(LocalProjectMemory, { ownershipRoot: join(memory.root, 'owner') })
    expect(await memory.ctx.projectMemory.propose(memory.caller, memory.draft)).toEqual(candidate)
  })

  it('refuses a valid record stored under a different key and frees the failed domain handle', async () => {
    const memory = await harness()
    const candidate = await memory.ctx.projectMemory.propose(memory.caller, memory.draft)
    const path = join(memory.root, 'storage/project_memory.json')
    const original = await readFile(path, 'utf8')
    await memory.memoryFiber.dispose()
    const corrupted = JSON.parse(original) as Awaited<ReturnType<typeof memory.disk>>
    corrupted.tables.memories['different-key'] = corrupted.tables.memories[candidate.id]!
    Reflect.deleteProperty(corrupted.tables.memories, candidate.id)
    await writeFile(path, JSON.stringify(corrupted))
    await expect(memory.ctx.plugin(LocalProjectMemory, { ownershipRoot: join(memory.root, 'owner') })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(access(join(memory.root, 'owner/owner.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
    await writeFile(path, original)
    await memory.ctx.plugin(LocalProjectMemory, { ownershipRoot: join(memory.root, 'owner') })
    expect(await memory.ctx.projectMemory.propose(memory.caller, memory.draft)).toEqual(candidate)
  })

  it('retains a replaced owner lock and both errors when a failed domain open cannot release ownership', async () => {
    let root = ''
    let fail = false
    const memory = await createMemoryHarness({}, unit => ({
      setGlobal: value => unit.setGlobal(value),
      deleteRecord: (table, key) => unit.deleteRecord(table, key),
      putRecord: (table, key, value) => unit.putRecord(table, key, value),
      close: () => unit.close(),
      async loadAll() {
        if (fail) {
          await writeFile(join(root, 'owner/owner.lock'), 'replaced-owner-identity')
          throw new Error('test domain open failed')
        }
        return unit.loadAll()
      },
    }))
    cleanups.push(memory.dispose)
    root = memory.root
    await memory.memoryFiber.dispose()
    fail = true
    await expect(memory.ctx.plugin(LocalProjectMemory, { ownershipRoot: join(root, 'owner') })).rejects.toMatchObject({
      errors: [{ message: 'test domain open failed' }, { code: 'ownership-unavailable' }],
    })
    expect(await readFile(join(root, 'owner/owner.lock'), 'utf8')).toBe('replaced-owner-identity')
    fail = false
    await unlink(join(root, 'owner/owner.lock'))
    await memory.ctx.plugin(LocalProjectMemory, { ownershipRoot: join(root, 'owner') })
  })

  it('keeps the durable receipt when cancellation arrives after disk commit but before acknowledgment', async () => {
    const memory = await harness()
    memory.control.pauseAfter = true
    const controller = new AbortController()
    const admission = memory.ctx.projectMemory.propose(memory.caller, memory.draft, controller.signal)
    await expect.poll(() => memory.control.written, { timeout: 2000 }).toBe(true)
    const durable = await memory.disk()
    expect(Object.values(durable.tables.memories)).toHaveLength(1)
    controller.abort(new Error('caller stopped waiting after commit'))
    const retry = memory.ctx.projectMemory.propose(memory.caller, memory.draft)
    memory.after.resolve(undefined)
    const original = await admission
    expect(await retry).toEqual(original)
    expect(await memory.disk()).toEqual(durable)
    expect((await memory.records(memory.caller))[0]).toMatchObject({ recordVersion: 1, activeRevision: null })
  })

  it('drains a dispatched write before unloading and releasing its ownership lock', async () => {
    const memory = await harness()
    const provider = memory.ctx.projectMemory
    memory.control.pauseBefore = true
    const admission = provider.propose(memory.caller, memory.draft)
    await expect.poll(() => memory.control.entered, { timeout: 2000 }).toBe(true)
    let closed = false
    const closing = memory.memoryFiber.dispose().then(() => { closed = true })
    await expect.poll(() => memory.ctx.get('projectMemory'), { timeout: 2000 }).toBeUndefined()
    await expect(provider.propose(memory.caller, { ...memory.draft, idempotencyKey: 'too-late' })).rejects.toMatchObject({ code: 'closed' })
    await access(join(memory.root, 'owner/owner.lock'))
    expect(closed).toBe(false)
    memory.before.resolve(undefined)
    const accepted = await admission
    await closing
    expect((await memory.disk()).tables.memories[accepted.id]).toMatchObject({ recordVersion: 1, activeRevision: null })
    await expect(access(join(memory.root, 'owner/owner.lock'))).rejects.toMatchObject({ code: 'ENOENT' })
    await memory.ctx.plugin(LocalProjectMemory, { ownershipRoot: join(memory.root, 'owner') })
    expect(await memory.ctx.projectMemory.propose(memory.caller, memory.draft)).toEqual(accepted)
  })

  it('does not report a human decision as committed when the medium rejects its write', async () => {
    const memory = await harness()
    const candidate = await memory.ctx.projectMemory.propose(memory.caller, memory.draft)
    const commandId = memory.human(memory.caller, `accept ${candidate.id}@1`)
    const request = { id: candidate.id, revision: 1, expectedVersion: 1, action: 'accept' as const, commandId }
    const before = await memory.disk()
    memory.control.fail = true
    await expect(memory.ctx.projectMemory.decide(memory.caller, request)).rejects.toThrow('test memory medium unavailable')
    expect(await memory.disk()).toEqual(before)
    expect((await memory.records(memory.caller))[0]).toMatchObject({ activeRevision: null, candidateRevision: 1, decisions: [] })
    memory.control.fail = false
    expect(await memory.ctx.projectMemory.decide(memory.caller, request)).toMatchObject({ id: candidate.id, recordVersion: 2 })
  })
})
