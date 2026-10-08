import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { expect, test } from 'vitest'
import LocalBudget from '../../../budget/budget-local/src/index.ts'
import * as BudgetBridge from '../../../budget/budget-llm/src/index.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { createGuardedModelBroker } from '../src/broker.ts'

test.each([true, false])('uses the final Budget guard for HTTP and retains unknown usage: usage=%s', async (hasUsage) => {
  const ctx = new Context(), backend = new MemoryStorageBackend()
  let requests = 0
  const server = createServer((_request, response) => { requests++; response.end('OK') })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing address')
  const endpoint = `http://127.0.0.1:${address.port}`
  class Adapter extends LlmAdapter {
    async * stream(): AsyncIterable<StreamChunk> {
      await (await fetch(endpoint)).text()
      if (hasUsage) yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  try {
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', { guarantees: ['single-writer', 'commit-sync', 'private-root'], kv: backend.kv, close: () => backend.close() })
    ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['http-fixture'], new Adapter())
    await ctx.plugin(LocalBudget, { maxScopes: 8, maxReservations: 32, maxLedgerBytes: 128 * 1024 })
    await ctx.plugin(BudgetBridge)
    const scope = await ctx.budget.createScope({ id: 'eval-budget', kind: 'session', subjectId: 'eval-subject', parentId: null,
      limits: { requests: 1, inputTokens: 5000, outputTokens: 100, totalTokens: 5100, wallTimeMs: 60000 }, onExhausted: 'deny' }, () => {})
    const route = { id: 'route', provider: 'http-fixture', model: 'model', preset: { id: 'preset', source: 'preset:system', digest: 'a'.repeat(64) }, parameters: { maxTokens: 32 } }
    const broker = createGuardedModelBroker(ctx, { route, budget: scope.reference, sessionId: 'eval-subject', maxResponseBytes: 8192, maxAttempts: 8 })
    const input = { provider: route.provider, model: route.model, maxTokens: 32,
      messages: [createUserMessage({ content: [{ type: 'text', text: 'Hello' }], source: { kind: 'user' } })] }
    await expect(broker({ ...input, provider: 'forged' }, AbortSignal.timeout(5000))).rejects.toThrow('route-mismatch')
    await expect(broker({ ...input, messages: [{ ...input.messages[0], content: [{ type: 'tool-result', toolCallId: 'fake',
      content: [{ type: 'file', attachment: { attachmentId: 'host-private' } }] }] }] }, AbortSignal.timeout(5000))).rejects.toThrow('content-unsupported')
    expect(requests).toBe(0)
    const disposeDrift = ctx.on('llm/stream', async function* (options, next) {
      options.model = 'unapproved-model'
      options.maxTokens = 64
      yield* next()
    })
    const drift = await broker(input, AbortSignal.timeout(5000))
    expect(drift).toMatchObject({ status: 'denied', reason: 'eval-model-identity-mismatch', evidence: [
      { model: 'unapproved-model', parameters: { maxTokens: 64 }, dispatched: false, decision: null, reservation: null },
    ] })
    expect(requests).toBe(0)
    disposeDrift()
    const pending = broker(input, AbortSignal.timeout(5000))
    try {
      await expect(broker(input, AbortSignal.timeout(5000))).rejects.toThrow('eval-model-request-in-progress')
    } finally { await pending }
    const first = await pending
    expect(requests).toBe(1)
    expect(first.status).toBe(hasUsage ? 'settled' : 'uncertain')
    expect(first.evidence).toMatchObject([{ dispatched: true, parameters: { maxTokens: 32 },
      reservation: { phase: hasUsage ? 'settled' : 'unknown' } }])
    if (hasUsage) {
      const second = await broker(input, AbortSignal.timeout(5000))
      expect(second).toMatchObject({ status: 'denied', evidence: [{ dispatched: false, decision: { kind: 'deny' } }] })
    } else {
      expect(ctx.budget.inspect(scope.reference).unknownRequests).toBe(1)
      await expect(broker(input, AbortSignal.timeout(5000))).rejects.toThrow('reconciliation-required')
    }
    expect(requests).toBe(1)
  } finally {
    await ctx.fiber.dispose()
    await backend.close()
    await new Promise<void>((resolve, reject) => { server.close((error) =>{  if (error) reject(error); else resolve() }) })
  }
})
