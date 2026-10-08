import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { expect, test } from 'vitest'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { RunLedger } from '../src/ledger.ts'

test('publishes only durable coordination facts and refuses further writes after ambiguous persistence', async () => {
  const pool = new MemoryMediaPool()
  const boot = async () => {
    const ctx = new Context(), backend = new MemoryStorageBackend(pool)
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', { guarantees: ['single-writer', 'commit-sync', 'private-root'], kv: backend.kv, close: () => backend.close() })
    ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
    const ledger = await RunLedger.open(ctx, { maxRuns: 2, maxLedgerBytes: 8192, maxBundles: 4, maxControls: 8 })
    return { ledger, close: async () => { await ledger.close(); await ctx.fiber.dispose(); await backend.close() } }
  }
  const first = await boot()
  try {
    await first.ledger.change((state) => { state.runs.push({ key: 'a'.repeat(64), workspaceId: 'workspace', requestId: 'request', actorId: 'operator',
      entrypoint: 'cli', policyId: 'policy', policyDigest: 'b'.repeat(64), plan: { id: 'plan', version: '1', digest: 'c'.repeat(64) },
      runId: null, phase: 'admitting', reason: null, batchId: null, cells: [], controls: [], createdAt: 1 }) })
    pool.failNextWrites = 1
    await expect(first.ledger.change((state) => { state.runs[0]!.phase = 'submitting' })).rejects.toThrow('unavailable')
    await expect(first.ledger.change(() => {})).rejects.toThrow('unavailable')
    await first.close()
    const second = await boot()
    try {
      expect(second.ledger.read().runs[0]?.phase).toBe('admitting')
      const copy = second.ledger.read()
      copy.runs.splice(0)
      expect(second.ledger.read().runs).toHaveLength(1)
      await expect(second.ledger.change((state) => { state.runs[0]!.requestId = 'x'.repeat(9000) })).rejects.toThrow()
      expect(second.ledger.read().runs[0]?.requestId).toBe('request')
    } finally { await second.close() }
  } finally { await first.close() }
})
