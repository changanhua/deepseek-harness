import { Context } from '@deepseek-ai/cordis'
import type { Browser, BrowserOperation, BrowserPreparedTicket } from '@changanhua/dsh-browser'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { expect, it, vi } from 'vitest'
import { ExperimentBudget } from './page-model-experiment.ts'
import { meterPageModelSubject } from './page-model-controller.ts'

it('meters provider streams and direct/prepared browser calls at the shared service boundary', async () => {
  const ctx = new Context()
  const ticket = {} as BrowserPreparedTicket
  const browser = { execute: vi.fn(async () => ({ outcome: 'observed' })),
    prepare: vi.fn(async () => ({ ticket })), executePrepared: vi.fn(async () => ({ outcome: 'observed' })) } as unknown as Browser
  const original = browser.execute
  const budget = new ExperimentBudget(5)
  const meter = meterPageModelSubject(ctx, browser, { sessionId: 's', runId: 'sample', budget, maxRunRmb: 5,
    cost: { provider: 'fixture', model: 'model', maxRequestRmb: 1, inputRmbPerMillion: 1, outputRmbPerMillion: 2 } })
  const operation: BrowserOperation = { sessionId: SessionId('s'), installationId: 'i', action: { kind: 'tabs' } }
  const signal = new AbortController().signal
  const options: GenerateOptions = { sessionId: SessionId('s'), provider: 'fixture', model: 'model', messages: [] }
  const stream = async function* (): AsyncIterable<StreamChunk> {
    yield { type: 'usage', usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 1000 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  try {
    for await (const _chunk of ctx.waterfall({} as never, 'llm/stream', options, stream)) { /* Consume actual middleware output. */ }
    await browser.execute(operation, signal)
    await browser.prepare(operation, signal)
    await browser.executePrepared(ticket, signal)
    expect(meter.snapshot()).toMatchObject({ modelRequests: 1, browserOperations: 3,
      costs: { chargedRmb: 0.003, reservedRmb: 0 } })
    meter.startCleanup()
    await browser.execute(operation, signal)
    expect(meter.snapshot().cleanupOperations).toBe(1)
    await expect(async () => {
      for await (const _chunk of ctx.waterfall({} as never, 'llm/stream', options, stream)) { /* Must fail before provider. */ }
    }).rejects.toThrow('experiment_is_cleaning_up')
  } finally { meter.dispose(); await ctx.fiber.dispose() }
  expect(browser.execute).toBe(original)
})
