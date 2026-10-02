import { Context } from '@deepseek-ai/cordis'
import { expect, test } from 'vitest'
import LlmRuntime, { LlmAdapter, LlmError, createUserMessage } from '../src/index.ts'
import type { GenerateOptions, StreamChunk } from '../src/index.ts'

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

test('enforces the final guard for direct and prepared calls before reaching an adapter', async () => {
  const ctx = new Context()
  let calls = 0
  class Adapter extends LlmAdapter {
    async * stream(): AsyncIterable<StreamChunk> { calls++; yield { type: 'finish', reason: { kind: 'stop' } } }
  }
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['test'], new Adapter())
  const seen: string[] = []
  const release = ctx.llm.registerDispatchGuard(async function* (request, next) {
    seen.push(request.identity.requestId)
    if (request.options.maxTokens === 1) throw new LlmError('Budget exhausted', 'BUDGET_EXHAUSTED')
    yield* next()
  })
  try {
    const direct = await collect(ctx.llm.stream({ provider: 'test', model: 'test', maxTokens: 1, messages: [] }))
    expect(direct).toMatchObject([{ type: 'finish', reason: { kind: 'error', failure: { code: 'BUDGET_EXHAUSTED' } } }])
    const prepared = await ctx.llm.prepareCall({ provider: 'test', model: 'test', maxTokens: 1 })
    expect(await collect(prepared.stream({ ...prepared.config, messages: [] })))
      .toMatchObject([{ type: 'finish', reason: { failure: { code: 'BUDGET_EXHAUSTED' } } }])
    expect(calls).toBe(0)
    expect(new Set(seen).size).toBe(2)
    release()
    expect(await collect(ctx.llm.stream({ provider: 'test', model: 'test', maxTokens: 2, messages: [] })))
      .toMatchObject([{ type: 'finish', reason: { failure: { code: 'DISPATCH_GUARD_UNAVAILABLE' } } }])
    expect(calls).toBe(0)
    const replacement = ctx.llm.registerDispatchGuard((_request, next) => next())
    try { await collect(ctx.llm.stream({ provider: 'test', model: 'test', maxTokens: 2, messages: [] })) }
    finally { replacement() }
    expect(calls).toBe(1)
  } finally { release(); await ctx.fiber.dispose() }
})

test('freezes the charged request and refuses a second dispatch from one guard invocation', async () => {
  const ctx = new Context()
  let actual: GenerateOptions | undefined
  class Adapter extends LlmAdapter {
    async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      actual = options
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  await ctx.plugin(LlmRuntime)
  ctx.llm.registerAdapter(['test'], new Adapter())
  const ready = Promise.withResolvers<undefined>()
  const proceed = Promise.withResolvers<undefined>()
  const input = { provider: 'test', model: 'test', maxTokens: 2, messages: [createUserMessage({ content: [{ type: 'text', text: 'original' }], source: { kind: 'user' } })] }
  const release = ctx.llm.registerDispatchGuard(async function* (request, next) {
    expect(Object.isFrozen(request.options.messages)).toBe(true)
    ready.resolve(undefined)
    await proceed.promise
    yield* next()
    expect(() => next()).toThrow(/already/u)
  })
  try {
    const output = collect(ctx.llm.stream(input))
    await ready.promise
    input.messages.push(createUserMessage({ content: [{ type: 'text', text: 'changed after reservation' }], source: { kind: 'user' } }))
    proceed.resolve(undefined)
    await output
    expect(actual?.messages).toHaveLength(1)
  } finally { proceed.resolve(undefined); release(); await ctx.fiber.dispose() }
})
