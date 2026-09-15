import { expect, it } from 'vitest'
import { compareBenefit, taskMetrics } from './benefit-metrics.ts'
import type { AcceptanceAgent } from './assertions.ts'

const rows = (readToolCalls: number, successes = 5) => Array.from({ length: 5 }, (_, index) => ({
  success: index < successes, readToolCalls, inputTokens: null, outputTokens: null,
  humanCorrections: 0, toolCalls: [],
}))

it('requires five tasks, no success regression, and passing blindness guards before reporting benefit', () => {
  expect(compareBenefit(rows(1), rows(2), true).observedReuseBenefit).toBe(true)
  expect(compareBenefit(rows(1, 4), rows(2, 5), true).observedReuseBenefit).toBe(false)
  expect(compareBenefit(rows(1), rows(2), false).observedReuseBenefit).toBe(false)
  expect(compareBenefit(rows(1).slice(1), rows(2), true).observedReuseBenefit).toBe(false)
  expect(compareBenefit(rows(2), rows(2), true).observedReuseBenefit).toBe(false)
})

it('treats missing Provider accounting as unavailable instead of zero tokens', () => {
  const agent = { session: { events: [{ type: 'assistant/message', data: {} }] } } as unknown as AcceptanceAgent
  expect(taskMetrics(agent)).toMatchObject({ inputTokens: null, outputTokens: null, readToolCalls: 0 })
  const partial = { session: { events: [
    { type: 'assistant/message', data: { usage: { inputTokens: 10, outputTokens: 2 } } },
    { type: 'assistant/message', data: {} },
  ] } } as unknown as AcceptanceAgent
  expect(taskMetrics(partial).inputTokens).toBeNull()
  expect(taskMetrics({ session: { events: partial.session.events.slice(0, 1) } } as unknown as AcceptanceAgent))
    .toMatchObject({ inputTokens: 10, outputTokens: 2 })
})
