import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { expect, test } from 'vitest'
import LocalBudget from '../src/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

async function boot(pool = new MemoryMediaPool(), maxLedgerBytes = 128 * 1024) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new MemoryStorageBackend(pool)
  ctx.storage.backend.register('memory', { guarantees: ['single-writer', 'commit-sync', 'private-root'], kv: backend.kv, close: () => backend.close() })
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
  await ctx.plugin(LocalBudget, { maxScopes: 16, maxReservations: 32, maxLedgerBytes })
  return { ctx, pool, close: async () => { await ctx.fiber.dispose(); await backend.close() } }
}

type Chunk = { kind: 'usage'; input: number; output: number } | { kind: 'done' }
const observe = (chunk: Chunk) => ({ terminal: chunk.kind === 'done',
  ...(chunk.kind === 'usage' ? { usage: { inputTokens: chunk.input, outputTokens: chunk.output } } : {}) })
const request = (id: string) => ({ requestId: id, attemptId: '1', inputDigest: 'a'.repeat(64), inputTokens: 20, outputTokens: 10 })
const limits = { requests: 1, inputTokens: 100, outputTokens: 100, totalTokens: 150, wallTimeMs: 60000 }
async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> { const output: T[] = []
  for await (const chunk of stream) output.push(chunk); return output }

test('serializes competing requests before dispatch and commits usage before terminal output', async () => {
  const h = await boot()
  try {
    const scope = await h.ctx.budget.createScope({ id: 'root', kind: 'workflow', subjectId: 'run', parentId: null, limits, onExhausted: 'deny' }, () => {})
    let dispatched = 0
    const run = (id: string) => h.ctx.budget.withScope(scope.reference, async () => {
      for await (const chunk of h.ctx.budget.streamModel<Chunk>(request(id), async function* () {
        dispatched++
        yield { kind: 'usage', input: 4, output: 3 }
        yield { kind: 'done' }
      }, observe)) {
        if (chunk.kind === 'done') expect(h.ctx.budget.reservation(id, '1')?.phase).toBe('settled')
      }
    })
    const results = await Promise.allSettled([run('a'), run('b')])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(dispatched).toBe(1)
    expect(h.ctx.budget.inspect('root').consumed).toEqual({ requests: 1, inputTokens: 4, outputTokens: 3, totalTokens: 7 })
  } finally { await h.close() }
})

test('holds missing usage across reopen and requires explicit reconciliation', async () => {
  const h = await boot()
  const scope = await h.ctx.budget.createScope({ id: 'root', kind: 'session', subjectId: 'session', parentId: null,
    limits: { ...limits, requests: 3 }, onExhausted: 'deny' }, () => {})
  await h.ctx.budget.withScope(scope.reference, () => collect(h.ctx.budget.streamModel<Chunk>(request('a'), async function* () {
    yield { kind: 'done' }
  }, observe)))
  expect(h.ctx.budget.reservation('a', '1')?.phase).toBe('unknown')
  await h.close()
  const reopened = await boot(h.pool)
  try {
    let dispatched = 0
    await expect(reopened.ctx.budget.withScope(scope.reference, () => collect(reopened.ctx.budget.streamModel<Chunk>(request('b'), async function* () {
      dispatched++
      yield { kind: 'done' }
    }, observe)))).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' })
    expect(dispatched).toBe(0)
    await reopened.ctx.budget.reconcile('a', '1', { inputTokens: 5, outputTokens: 2 }, () => {})
    expect(reopened.ctx.budget.inspect(scope.reference).unknownRequests).toBe(0)
  } finally { await reopened.close() }
})

test('does not accept missing scope, changed grant reference or cancelled calls as permission', async () => {
  const h = await boot()
  try {
    const scope = await h.ctx.budget.createScope({ id: 'root', kind: 'session', subjectId: 'session', parentId: null, limits, onExhausted: 'deny' }, () => {})
    let dispatched = 0
    const dispatch = async function* (): AsyncIterable<Chunk> { dispatched++; yield { kind: 'done' } }
    await expect(collect(h.ctx.budget.streamModel(request('a'), dispatch, observe))).rejects.toMatchObject({ code: 'BUDGET_SCOPE_MISSING' })
    await expect(h.ctx.budget.withScope({ ...scope.reference, digest: 'b'.repeat(64) }, async () => {}))
      .rejects.toMatchObject({ code: 'BUDGET_REFERENCE_CONFLICT' })
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(h.ctx.budget.withScope(scope.reference, () => collect(h.ctx.budget.streamModel(request('b'), dispatch, observe, controller.signal))))
      .rejects.toThrow('cancelled')
    expect(dispatched).toBe(0)
    expect(h.ctx.budget.reservation('b', '1')).toBeUndefined()
  } finally { await h.close() }
})

test('keeps the original settlement failure and refuses further dispatch after uncertain storage', async () => {
  const h = await boot()
  try {
    const scope = await h.ctx.budget.createScope({ id: 'root', kind: 'session', subjectId: 'session', parentId: null,
      limits: { ...limits, requests: 3 }, onExhausted: 'deny' }, () => {})
    let calls = 0
    await expect(h.ctx.budget.withScope(scope.reference, () => collect(h.ctx.budget.streamModel<Chunk>(request('a'), async function* () {
      calls++
      yield { kind: 'usage', input: 4, output: 3 }
      h.pool.failNextWrites = 1
      yield { kind: 'done' }
    }, observe)))).rejects.toMatchObject({ code: 'BUDGET_STORAGE_UNKNOWN' })
    await expect(h.ctx.budget.withScope(scope.reference, () => collect(h.ctx.budget.streamModel<Chunk>(request('b'), async function* () {
      calls++
      yield { kind: 'done' }
    }, observe)))).rejects.toMatchObject({ code: 'BUDGET_STORAGE_UNKNOWN' })
    expect(calls).toBe(1)
  } finally { await h.close() }
})

test('retains an unavailable question and never repeats it after reopen', async () => {
  const h = await boot()
  const scope = await h.ctx.budget.createScope({ id: 'root', kind: 'session', subjectId: 'session', parentId: null,
    limits: { ...limits, requests: 0 }, onExhausted: 'ask' }, () => {})
  let calls = 0
  const dispatch = async function* (): AsyncIterable<Chunk> { calls++; yield { kind: 'done' } }
  await expect(h.ctx.budget.withScope(scope.reference, () => collect(h.ctx.budget.streamModel(request('ask'), dispatch, observe))))
    .rejects.toMatchObject({ code: 'BUDGET_APPROVAL_UNAVAILABLE' })
  expect(h.ctx.budget.decision('ask', '1')?.approval).toBe('unavailable')
  await h.close()
  const reopened = await boot(h.pool)
  try {
    let questions = 0
    reopened.ctx.budget.registerApprover(async () => { questions++; return 'allowed-once' })
    await expect(reopened.ctx.budget.withScope(scope.reference, () => collect(reopened.ctx.budget.streamModel(request('ask'), dispatch, observe))))
      .rejects.toMatchObject({ code: 'BUDGET_ATTEMPT_REPLAY' })
    expect(questions).toBe(0)
    expect(calls).toBe(0)
  } finally { await reopened.close() }
})

test('an approval authorizes only the captured attempt and cannot bypass a denying ancestor', async () => {
  const h = await boot()
  try {
    const parent = await h.ctx.budget.createScope({ id: 'parent', kind: 'workflow', subjectId: 'run', parentId: null,
      limits: { ...limits, requests: 1 }, onExhausted: 'deny' }, () => {})
    const child = await h.ctx.budget.createScope({ id: 'child', kind: 'session', subjectId: 'session', parentId: parent.scope.id,
      limits: { ...limits, requests: 0 }, onExhausted: 'ask' }, () => {})
    let calls = 0
    let questions = 0
    h.ctx.budget.registerApprover(async (question) => {
      questions++
      expect(h.ctx.budget.decision(question.request.requestId, '1')?.approval).toBe('pending')
      expect(question.scopes.map(value => value.scope.id)).toEqual(['child'])
      return 'allowed-once'
    })
    const dispatch = async function* (): AsyncIterable<Chunk> { calls++; yield { kind: 'usage', input: 4, output: 3 }; yield { kind: 'done' } }
    await h.ctx.budget.withScope(child.reference, () => collect(h.ctx.budget.streamModel(request('first'), dispatch, observe)))
    expect(h.ctx.budget.decision('first', '1')?.approval).toBe('allowed-once')
    expect(h.ctx.budget.inspect('child').consumed.requests).toBe(1)
    await expect(h.ctx.budget.withScope(child.reference, () => collect(h.ctx.budget.streamModel(request('second'), dispatch, observe))))
      .rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' })
    expect(questions).toBe(1)
    expect(calls).toBe(1)
  } finally { await h.close() }
})

test('invalid latest usage cannot settle from an earlier usage chunk', async () => {
  const h = await boot()
  try {
    const scope = await h.ctx.budget.createScope({ id: 'root', kind: 'session', subjectId: 's', parentId: null, limits, onExhausted: 'deny' }, () => {})
    await expect(h.ctx.budget.withScope(scope.reference, () => collect(h.ctx.budget.streamModel<Chunk>(request('bad'), async function* () {
      yield { kind: 'usage', input: 3, output: 2 }
      yield { kind: 'usage', input: -1, output: 2 }
    }, observe)))).rejects.toThrow()
    expect(h.ctx.budget.reservation('bad', '1')).toMatchObject({ phase: 'unknown', usage: null })
  } finally { await h.close() }
})

test('reserves terminal receipt space before dispatch even when actual counters exceed the estimate', async () => {
  const h = await boot(undefined, 4096)
  try {
    const scope = await h.ctx.budget.createScope({ id: 'root', kind: 'session', subjectId: 's', parentId: null,
      limits: { requests: null, inputTokens: null, outputTokens: null, totalTokens: null, wallTimeMs: null }, onExhausted: 'deny' }, () => {})
    let calls = 0
    for (let index = 0; index < 16; index++) {
      const before = calls
      const id = `r${index}`
      try {
        await h.ctx.budget.withScope(scope.reference, () => collect(h.ctx.budget.streamModel<Chunk>(request(id), async function* () {
          calls++
          yield { kind: 'usage', input: 100000000000000, output: 100000000000000 }
          yield { kind: 'done' }
        }, observe)))
        expect(h.ctx.budget.reservation(id, '1')?.phase).toBe('settled')
      } catch (error) {
        expect(error).toMatchObject({ code: 'BUDGET_CAPACITY' })
        expect(calls).toBe(before)
        break
      }
    }
    expect(calls).toBeGreaterThan(0)
    expect(calls).toBeLessThan(16)
  } finally { await h.close() }
})
