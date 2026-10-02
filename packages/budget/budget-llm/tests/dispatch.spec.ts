import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { expect, test } from 'vitest'
import LocalBudget from '../../budget-local/src/index.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import * as Bridge from '../src/index.ts'

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const output: StreamChunk[] = []
  for await (const chunk of stream) output.push(chunk)
  return output
}

test('composes budget accounting into both final dispatch paths and denies a third call', async () => {
  const ctx = new Context()
  const backend = new MemoryStorageBackend()
  let calls = 0
  class Adapter extends LlmAdapter {
    async * stream(): AsyncIterable<StreamChunk> {
      calls++
      yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', { guarantees: ['single-writer', 'commit-sync', 'private-root'], kv: backend.kv, close: () => backend.close() })
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['fixture'], new Adapter())
  await ctx.plugin(Bridge)
  try {
    const options = { provider: 'fixture', model: 'fixture', maxTokens: 10, messages: [createUserMessage({ content: [{ type: 'text', text: 'Hello' }], source: { kind: 'user' } })] }
    expect(await collect(ctx.llm.stream(options))).toMatchObject([{ type: 'finish', reason: { failure: { code: 'BUDGET_UNAVAILABLE' } } }])
    expect(calls).toBe(0)
    await ctx.plugin(LocalBudget, { maxScopes: 8, maxReservations: 32, maxLedgerBytes: 128 * 1024 })
    const scope = await ctx.budget.createScope({ id: 'root', kind: 'session', subjectId: 'session', parentId: null,
      limits: { requests: 2, inputTokens: 5000, outputTokens: 100, totalTokens: 5100, wallTimeMs: 60000 }, onExhausted: 'deny' }, () => {})
    await ctx.budget.withScope(scope.reference, () => collect(ctx.llm.stream(options)))
    const prepared = await ctx.llm.prepareCall({ provider: options.provider, model: options.model, maxTokens: 10 })
    await ctx.budget.withScope(scope.reference, () => collect(prepared.stream({ ...prepared.config, messages: options.messages })))
    expect(calls).toBe(2)
    const denied = await ctx.budget.withScope(scope.reference, () => collect(ctx.llm.stream(options)))
    expect(denied).toMatchObject([{ type: 'finish', reason: { failure: { code: 'BUDGET_EXHAUSTED' } } }])
    expect(calls).toBe(2)
    expect(ctx.budget.inspect(scope.reference).consumed).toEqual({ requests: 2, inputTokens: 8, outputTokens: 6, totalTokens: 14 })
  } finally { await ctx.fiber.dispose(); await backend.close() }
})
