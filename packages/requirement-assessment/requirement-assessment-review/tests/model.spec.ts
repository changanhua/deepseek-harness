import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Llm, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { runReviewModel } from '../src/model.ts'
const config = { provider: 'fixture', model: 'fixture', maxInputBytes: 30000, maxOutputBytes: 30000, maxOutputTokens: 1000, timeoutMs: 1000 }
it('uses the existing runtime with an empty capability surface and rejects unsafe or incomplete output', async () => {
  const ctx = new Context()
  let chunks: StreamChunk[] = []
  let calls = 0
  class Adapter extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      calls++; expect(options.tools).toEqual([])
      for (const chunk of chunks) yield chunk
    }
  }
  await ctx.plugin(Llm)
  ctx.llm.registerAdapter(['fixture'], new Adapter())
  const signal = new AbortController().signal
  try {
    chunks = [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: '{"ok":true}' }, { type: 'block-end', index: 0, block: { type: 'text', text: '{"ok":true}' } }, { type: 'finish', reason: { kind: 'stop' } }]
    expect((await runReviewModel(ctx, config, 'Review', { fact: 'unverified' }, signal)).output).toEqual({ ok: true })
    await expect(runReviewModel(ctx, { ...config, maxInputBytes: 1 }, 'Review', {}, signal)).rejects.toThrow('input exceeds')
    expect(calls).toBe(1)
    await expect(runReviewModel(ctx, { ...config, maxInputBytes: 1000000 }, 'Review', { text: 'x'.repeat(200001) }, signal)).rejects.toThrow()
    expect(calls).toBe(1)
    await expect(runReviewModel(ctx, { ...config, maxOutputBytes: 1 }, 'Review', {}, signal)).rejects.toThrow('output exceeds')
    chunks = [{ type: 'block-start', index: 0, blockType: 'tool-call' }]
    await expect(runReviewModel(ctx, config, 'Review', {}, signal)).rejects.toThrow('unsupported capability')
    chunks = [{ type: 'finish', reason: { kind: 'max-tokens' } }]
    await expect(runReviewModel(ctx, config, 'Review', {}, signal)).rejects.toThrow('complete normally')
    chunks = []
    await expect(runReviewModel(ctx, config, 'Review', {}, signal)).rejects.toThrow()
    const abort = new AbortController(); abort.abort()
    const before = calls
    await expect(runReviewModel(ctx, config, 'Review', {}, abort.signal)).rejects.toThrow()
    expect(calls).toBe(before)
  } finally { await ctx.fiber.dispose() }
})
it('propagates caller cancellation and the configured deadline to the runtime adapter', async () => {
  const ctx = new Context()
  class WaitingAdapter extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      await new Promise<void>((_resolve, reject) => {
        const abort = () => { reject(new Error('aborted', { cause: options.signal?.reason })) }
        if (options.signal?.aborted) abort()
        else options.signal?.addEventListener('abort', abort, { once: true })
      })
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  await ctx.plugin(Llm)
  ctx.llm.registerAdapter(['fixture'], new WaitingAdapter())
  try {
    const caller = new AbortController()
    const pending = runReviewModel(ctx, config, 'Review', {}, caller.signal)
    caller.abort(new Error('caller cancelled'))
    await expect(pending).rejects.toThrow()
    await expect(runReviewModel(ctx, { ...config, timeoutMs: 5 }, 'Review', {}, new AbortController().signal)).rejects.toThrow()
  } finally { await ctx.fiber.dispose() }
})
