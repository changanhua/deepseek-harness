import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryRecordSchema } from '@changanhua/dsh-memory'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import { MemoryStore } from '../src/store.ts'

const roots: string[] = []
const cleanups: Array<() => Promise<void>> = []
const at = '2026-09-08T00:00:00.000Z'
const later = '2026-09-09T00:00:00.000Z'
const source = { kind: 'file' as const, path: 'README.md', sha256: 'a'.repeat(64) }
const input = () => ({ topicKey: 'validation.command', kind: 'method' as const, title: '验证', statement: '运行 pnpm test', tags: [], conditions: '', sources: [{ kind: 'file' as const, path: 'README.md' }], idempotencyKey: 'save' })

afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !root.includes('dsh-project-memory-test-')) throw new Error('refusing unrelated cleanup')
    await rm(root, { recursive: true, force: true })
  }
})

async function open(root?: string, failure?: { write: boolean }, sqlite = false) {
  if (root === undefined) {
    root = await mkdtemp(join(tmpdir(), 'dsh-project-memory-test-'))
    roots.push(root)
  }
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = sqlite
    ? new SqliteStorageBackend({ path: join(root, 'memory.db'), journalMode: 'wal' })
    : new JsonStorageBackend(root)
  ctx.storage.backend.register('json', failure === undefined ? backend : {
    kv: { open: async (descriptor) => {
      const unit = await backend.kv.open(descriptor)
      return {
        loadAll: () => unit.loadAll(),
        deleteRecord: (table, key) => unit.deleteRecord(table, key),
        setGlobal: value => unit.setGlobal(value),
        close: () => unit.close(),
        putRecord: async (table, key, value) => {
          if (failure.write) throw new Error('injected durable write failure')
          await unit.putRecord(table, key, value)
        },
      }
    } },
    close: () => backend.close(),
  })
  const facility = new DomainFacility(ctx, { backend: 'json' })
  ctx.storage.mount('domain', facility)
  const openDomain = facility.open.bind(facility)
  let observedDomain: Awaited<ReturnType<typeof facility.open>> | undefined
  vi.spyOn(facility, 'open').mockImplementation(async (spec) => {
    const domain = await openDomain(spec)
    observedDomain = domain
    return domain
  })
  const store = await MemoryStore.open(facility)
  if (observedDomain === undefined) throw new Error('memory store did not open its domain')
  const table = observedDomain.table('memories')
  const close = async () => { await store.close(); await backend.close(); await ctx.fiber.dispose() }
  cleanups.push(close)
  return { store, root, close, backend, facility, table }
}

describe('project memory durable mutations', () => {
  it('renews acceptance of the active revision without rewriting content', async () => {
    const { store } = await open()
    const { id } = await store.propose('a', 'session', input(), [source], at)
    await store.decide('a', 'session', {
      id, revision: 1, expectedVersion: 1, action: 'accept', commandId: 'first', reviewAfter: '2026-10-08T00:00:00.000Z',
    }, at)
    const before = store.get('a', id)!
    const renewed = await store.decide('a', 'session', {
      id, revision: 1, expectedVersion: 2, action: 'accept', commandId: 'renew', reviewAfter: '2026-11-08T00:00:00.000Z',
    }, later)
    const after = store.get('a', id)!
    expect(renewed).toMatchObject({ revision: 1, recordVersion: 3 })
    expect(after.revisions).toEqual(before.revisions)
    expect(after.decisions.at(-1)?.reviewAfter).toBe('2026-11-08T00:00:00.000Z')
    expect(after.candidateRevision).toBeNull()
  })

  it('rejects unknown runtime actions and access through a closed store handle', async () => {
    const { store, close } = await open()
    const { id } = await store.propose('a', 'session', input(), [source], at)
    await expect(store.decide('a', 'session', {
      id, revision: 1, expectedVersion: 1, action: 'approve' as 'accept', commandId: 'invalid-action',
    }, at)).rejects.toMatchObject({ code: 'invalid-input' })
    expect(store.get('a', id)?.recordVersion).toBe(1)
    await close()
    expect(() => store.get('a', id)).toThrow('project memory is closing')
  })
  it.each(['workspace', 'version'])('rejects an intervening %s change at the atomic KV update boundary', async (field) => {
    const { store, table } = await open()
    const { id } = await store.propose('a', 'session', input(), [source], at)
    const update = table.update.bind(table)
    vi.spyOn(table, 'update').mockImplementationOnce(async (key, updater) => {
      await update(key, (value) => {
        const record = memoryRecordSchema.parse(value)
        if (field === 'workspace') return { ...record, workspaceId: 'moved' }
        return memoryRecordSchema.parse({
          ...record, recordVersion: 2, candidateRevision: null,
          decisions: [{ action: 'reject', revision: 1, commandId: 'intervening', sessionId: 'session', at }],
          receipts: [...record.receipts, {
            key: 'command:intervening', operation: 'reject', digest: 'b'.repeat(64), at,
            result: { id, recordVersion: 2, revision: 1 },
          }],
        })
      })
      return update(key, updater)
    })
    await expect(store.decide('a', 'session', {
      id, revision: 1, expectedVersion: 1, action: 'accept', commandId: 'stale-update', reviewAfter: '2026-10-08T00:00:00.000Z',
    }, at)).rejects.toMatchObject({ code: 'version-conflict' })
    expect(store.get(field === 'workspace' ? 'moved' : 'a', id)?.activeRevision).toBeNull()
  })

  it('observes cancellation that arrives after dispatch but before the KV update callback', async () => {
    const { store, table } = await open()
    const { id } = await store.propose('a', 'session', input(), [source], at)
    const update = table.update.bind(table)
    const controller = new AbortController()
    vi.spyOn(table, 'update').mockImplementationOnce(async (key, updater) => {
      controller.abort(new Error('cancel before KV callback'))
      return update(key, updater)
    })
    await expect(store.decide('a', 'session', { id, revision: 1, expectedVersion: 1, action: 'reject', commandId: 'cancel' }, at, controller.signal))
      .rejects.toThrow('cancel before KV callback')
    expect(store.get('a', id)).toMatchObject({ recordVersion: 1, candidateRevision: 1 })
  })

  it('rejects source locators differing from the admitted proposal', async () => {
    const { store } = await open()
    await expect(store.propose('a', 'session', input(), [{ ...source, path: 'another.md' }], at)).rejects.toMatchObject({ code: 'invalid-input' })
    expect(store.list('a')).toEqual([])
  })

  it.each(['accept', 'reject', 'retire'] as const)('rejects %s against a non-current version', async (action) => {
    const { store } = await open()
    const { id } = await store.propose('a', 'session', input(), [source], at)
    await expect(store.decide('a', 'session', {
      id, revision: 2, expectedVersion: 1, action, commandId: 'invalid-target',
      ...action === 'accept' ? { reviewAfter: '2026-10-08T00:00:00.000Z' } : {},
    }, at)).rejects.toMatchObject({ code: 'invalid-transition' })
    expect(store.get('a', id)?.recordVersion).toBe(1)
  })

  it('rejects acceptance without a future review date', async () => {
    const { store } = await open()
    const { id } = await store.propose('a', 'session', input(), [source], at)
    for (const reviewAfter of [undefined, 'invalid', at]) {
      await expect(store.decide('a', 'session', {
        id, revision: 1, expectedVersion: 1, action: 'accept', commandId: 'bad-date',
        ...reviewAfter === undefined ? {} : { reviewAfter },
      }, at)).rejects.toMatchObject({ code: 'invalid-input' })
    }
  })
  it('rejects invalid store limits before opening another domain', async () => {
    const { store, facility } = await open()
    for (const maxReceipts of [0, 201, 1.5]) {
      await expect(MemoryStore.open(facility, { maxReceipts })).rejects.toMatchObject({ code: 'invalid-input' })
    }
    expect(await store.propose('a', 'session', input(), [source], at)).toMatchObject({ recordVersion: 1 })
  })

  it('keeps a human decision retry idempotent and rejects reuse by a different Session', async () => {
    const { store } = await open()
    const { id } = await store.propose('a', 'session', input(), [source], at)
    const request = { id, revision: 1, expectedVersion: 1, action: 'accept' as const, commandId: 'approve', reviewAfter: '2026-10-08T00:00:00.000Z' }
    const accepted = await store.decide('a', 'session', request, at)
    expect(await store.decide('a', 'session', request, later)).toEqual(accepted)
    await expect(store.decide('a', 'another-session', request, later)).rejects.toMatchObject({ code: 'idempotency-conflict' })
    expect(store.get('a', id)?.decisions).toHaveLength(1)
  })

  it('rejects pending replacement, topic changes, and foreign mutation targets without altering state', async () => {
    const { store } = await open()
    const { id } = await store.propose('a', 'session', input(), [source], at)
    const amend = { ...input(), memoryId: id, expectedVersion: 1, idempotencyKey: 'amend' }
    await expect(store.propose('a', 'session', amend, [source], later)).rejects.toMatchObject({ code: 'candidate-pending' })
    await expect(store.propose('a', 'session', { ...amend, topicKey: 'other' }, [source], later)).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(store.propose('other', 'session', amend, [source], later)).rejects.toMatchObject({ code: 'not-found' })
    await expect(store.decide('other', 'session', { id, revision: 1, expectedVersion: 1, action: 'reject', commandId: 'foreign' }, later))
      .rejects.toMatchObject({ code: 'not-found' })
    await expect(store.decide('a', 'session', { id, revision: 1, expectedVersion: 9, action: 'reject', commandId: 'stale' }, later))
      .rejects.toMatchObject({ code: 'version-conflict' })
    expect(store.get('a', id)).toMatchObject({ recordVersion: 1, candidateRevision: 1, activeRevision: null })
  })

  it('persists a candidate and its idempotency result across a storage reopen', async () => {
    const first = await open()
    const result = await first.store.propose('project-a', 'session-a', input(), [source], at)
    const original = first.store.get('project-a', result.id)
    expect(original).toMatchObject({ activeRevision: null, candidateRevision: 1, recordVersion: 1 })
    const persisted = JSON.parse(await readFile(join(first.root, 'project_memory.json'), 'utf8')) as {
      tables: { memories: Record<string, unknown> }
    }
    expect(persisted.tables.memories[result.id]).toEqual(original)
    await first.close()
    const second = await open(first.root)
    expect(second.store.get('project-a', result.id)).toEqual(original)
    expect(await second.store.propose('project-a', 'session-b', input(), [source], later)).toEqual(result)
    expect(second.store.list('project-a')).toHaveLength(1)
  })

  it('retains identical records when the domain is routed through SQLite', async () => {
    const first = await open(undefined, undefined, true)
    const result = await first.store.propose('project-a', 'session-a', input(), [source], at)
    const original = first.store.get('project-a', result.id)
    await first.close()
    const second = await open(first.root, undefined, true)
    expect(second.store.get('project-a', result.id)).toEqual(original)
    expect(await second.store.propose('project-a', 'session-b', input(), [source], later)).toEqual(result)
  })

  it('refuses changed intent under an existing idempotency key', async () => {
    const { store } = await open()
    await store.propose('a', 'session', input(), [source], at)
    await expect(store.propose('a', 'session', { ...input(), statement: '运行错误命令' }, [source], later)).rejects.toMatchObject({ code: 'idempotency-conflict' })
    expect(store.list('a')[0]?.revisions[0]?.statement).toBe('运行 pnpm test')
  })

  it('keeps records and mutation lookup scoped to the owning project', async () => {
    const { store } = await open()
    const a = await store.propose('a', 'session', input(), [source], at)
    const b = await store.propose('b', 'session', input(), [source], at)
    expect(a.id).not.toBe(b.id)
    expect(store.get('b', a.id)).toBeUndefined()
    await expect(store.propose('b', 'session', { ...input(), memoryId: a.id, expectedVersion: 1, idempotencyKey: 'amend' }, [source], later)).rejects.toMatchObject({ code: 'not-found' })
  })

  it('accepts, amends and replaces an active version without rewriting old claim content', async () => {
    const { store } = await open()
    const first = await store.propose('a', 'session', input(), [source], at)
    const firstRevision = store.get('a', first.id)!.revisions[0]
    const accepted = await store.decide('a', 'session', { id: first.id, expectedVersion: 1, revision: 1, action: 'accept', commandId: 'cmd-1', reviewAfter: '2026-10-08T00:00:00.000Z' }, at)
    expect(accepted.recordVersion).toBe(2)
    await store.propose('a', 'session', { ...input(), memoryId: first.id, expectedVersion: 2, statement: '运行 pnpm run test:focused', idempotencyKey: 'revise' }, [source], later)
    expect(store.get('a', first.id)).toMatchObject({ activeRevision: 1, candidateRevision: 2, recordVersion: 3 })
    await store.decide('a', 'session', { id: first.id, expectedVersion: 3, revision: 2, action: 'accept', commandId: 'cmd-2', reviewAfter: '2026-10-09T00:00:00.000Z' }, later)
    const final = store.get('a', first.id)!
    expect(final).toMatchObject({ activeRevision: 2, candidateRevision: null, recordVersion: 4 })
    expect(final.revisions[0]).toEqual(firstRevision)
    expect(final.decisions.map(item => item.commandId)).toEqual(['cmd-1', 'cmd-2'])
  })

  it('rejects a pending revision without retiring the accepted one', async () => {
    const { store } = await open()
    const { id } = await store.propose('a', 'session', input(), [source], at)
    await store.decide('a', 'session', { id, expectedVersion: 1, revision: 1, action: 'accept', commandId: 'accept', reviewAfter: '2026-10-08T00:00:00.000Z' }, at)
    await store.propose('a', 'session', { ...input(), memoryId: id, expectedVersion: 2, idempotencyKey: 'amend' }, [source], later)
    await store.decide('a', 'session', { id, expectedVersion: 3, revision: 2, action: 'reject', commandId: 'reject' }, later)
    expect(store.get('a', id)).toMatchObject({ activeRevision: 1, candidateRevision: null })
    await store.decide('a', 'session', { id, expectedVersion: 4, revision: 1, action: 'retire', commandId: 'retire' }, later)
    expect(store.get('a', id)).toMatchObject({ activeRevision: null, candidateRevision: null })
    expect(store.get('a', id)?.revisions).toHaveLength(2)
  })

  it('admits only one of two amendments with the same version fence', async () => {
    const { store } = await open()
    const { id } = await store.propose('a', 'session', input(), [source], at)
    await store.decide('a', 'session', { id, expectedVersion: 1, revision: 1, action: 'reject', commandId: 'reject' }, at)
    const results = await Promise.allSettled(['one', 'two'].map(key => store.propose('a', 'session', { ...input(), memoryId: id, expectedVersion: 2, idempotencyKey: key }, [source], later)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'version-conflict' } })
    expect(store.get('a', id)).toMatchObject({ recordVersion: 3, candidateRevision: 2 })
  })

  it('does not let a caller mutate the stored record through a returned object', async () => {
    const { store } = await open()
    const { id } = await store.propose('a', 'session', input(), [source], at)
    store.get('a', id)!.revisions[0]!.statement = '意外修改'
    expect(store.get('a', id)!.revisions[0]!.statement).toBe('运行 pnpm test')
  })

  it('keeps the accepted state and disk bytes unchanged when a decision write fails', async () => {
    const failure = { write: false }
    const { store, root } = await open(undefined, failure)
    const { id } = await store.propose('a', 'session', input(), [source], at)
    const before = await readFile(join(root, 'project_memory.json'), 'utf8')
    failure.write = true
    await expect(store.decide('a', 'session', { id, revision: 1, expectedVersion: 1, action: 'accept', commandId: 'approve', reviewAfter: '2026-10-08T00:00:00.000Z' }, at)).rejects.toThrow('injected durable write failure')
    expect(store.get('a', id)).toMatchObject({ recordVersion: 1, activeRevision: null, candidateRevision: 1 })
    expect(await readFile(join(root, 'project_memory.json'), 'utf8')).toBe(before)
    failure.write = false
    expect(await store.decide('a', 'session', { id, revision: 1, expectedVersion: 1, action: 'accept', commandId: 'approve', reviewAfter: '2026-10-08T00:00:00.000Z' }, at)).toMatchObject({ recordVersion: 2 })
  })

  it('rejects a canceled admission without creating a receipt or record', async () => {
    const { store } = await open()
    await expect(store.propose('a', 'session', input(), [source], at, AbortSignal.abort(new Error('canceled')))).rejects.toThrow('canceled')
    expect(store.list('a')).toEqual([])
    expect(store.replayProposal('a', input())).toBeUndefined()
  })
})
