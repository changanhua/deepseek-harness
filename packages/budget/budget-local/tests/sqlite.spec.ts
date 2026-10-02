import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { Config, SqliteStorageBackend } from '@deepseek-ai/dsh-storage-sqlite'
import LocalBudget from '../src/index.ts'

test('a private SQLite account retains unknown usage and exact scope authority across owner restart', async () => {
  const root = await mkdtemp(join(process.platform === 'win32' ? homedir() : tmpdir(), 'dsh-budget-restart-'))
  const boot = async () => {
    const ctx = new Context()
    const backend = new SqliteStorageBackend(Config({ path: join(root, 'private', 'account.sqlite'),
      ownership: 'exclusive', synchronous: 'full', journalMode: 'delete', privateDirectory: true }))
    await ctx.plugin(Storage)
    ctx.storage.backend.register('durable', backend)
    ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'durable' }))
    await ctx.plugin(LocalBudget, { maxScopes: 8, maxReservations: 16, maxLedgerBytes: 131072 })
    return { ctx, close: async () => { await ctx.fiber.dispose(); await backend.close() } }
  }
  let h: Awaited<ReturnType<typeof boot>> | undefined
  try {
    h = await boot()
    const scope = await h.ctx.budget.createScope({ id: 'root', kind: 'session', subjectId: 'session', parentId: null,
      limits: { requests: 2, inputTokens: 100, outputTokens: 100, totalTokens: 200, wallTimeMs: null }, onExhausted: 'deny' }, () => {})
    const request = { requestId: 'first', attemptId: '1', inputDigest: 'a'.repeat(64), inputTokens: 10, outputTokens: 10 }
    const owner = h.ctx.budget
    await owner.withScope(scope.reference, async () => {
      for await (const _chunk of owner.streamModel(request, async function* () { yield 'done' }, () => ({ terminal: true }))) { /* consume terminal */ }
    })
    await h.close()
    h = await boot()
    const reopened = h.ctx.budget
    expect(reopened.inspect(scope.reference).unknownRequests).toBe(1)
    let calls = 0
    await expect(reopened.withScope(scope.reference, async () => {
      for await (const _chunk of reopened.streamModel({ ...request, requestId: 'second' }, async function* () { calls++; yield 'done' }, () => ({ terminal: true }))) { /* consume terminal */ }
    })).rejects.toMatchObject({ code: 'BUDGET_EXHAUSTED' })
    expect(calls).toBe(0)
    await reopened.reconcile('first', '1', { inputTokens: 5, outputTokens: 3 }, () => {})
    expect(reopened.inspect(scope.reference)).toMatchObject({ unknownRequests: 0,
      consumed: { requests: 1, inputTokens: 5, outputTokens: 3, totalTokens: 8 } })
  } finally { await h?.close(); await rm(root, { recursive: true, force: true }) }
}, 30000)
