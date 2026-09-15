import type { AcceptanceAgent } from './assertions.ts'

const READ_TOOLS = new Set([
  'read', 'read_image', 'glob', 'grep', 'memory_search', 'memory_read',
  'session_event_read', 'session_event_search', 'session_event_trace', 'session_search', 'session_trace',
])

export function taskMetrics(agent: AcceptanceAgent) {
  const calls = agent.session.events.filter(event => event.type === 'tool/call')
  const responses = agent.session.events.filter(event => event.type === 'assistant/message')
  const completeUsage = responses.length > 0 && responses.every(event => event.data.usage !== undefined)
  return {
    toolCalls: calls.map(event => event.data.name),
    readToolCalls: calls.filter(event => READ_TOOLS.has(event.data.name)).length,
    inputTokens: completeUsage ? responses.reduce((sum, event) => sum + event.data.usage!.inputTokens, 0) : null,
    outputTokens: completeUsage ? responses.reduce((sum, event) => sum + event.data.usage!.outputTokens, 0) : null,
    humanCorrections: 0,
  }
}

export function compareBenefit(
  enabled: Array<{ success: boolean } & ReturnType<typeof taskMetrics>>,
  disabled: Array<{ success: boolean } & ReturnType<typeof taskMetrics>>,
  guardsPassed: boolean,
) {
  const summarize = (items: typeof enabled) => ({
    tasks: items.length, successes: items.filter(item => item.success).length,
    readToolCalls: items.reduce((sum, item) => sum + item.readToolCalls, 0),
    inputTokens: items.every(item => item.inputTokens !== null) ? items.reduce((sum, item) => sum + item.inputTokens!, 0) : null,
  })
  const on = summarize(enabled)
  const off = summarize(disabled)
  const inputLower = on.inputTokens !== null && off.inputTokens !== null && on.inputTokens < off.inputTokens
  return {
    enabled: on, disabled: off, guardsPassed,
    observedReuseBenefit: on.tasks === 5 && off.tasks === 5 && guardsPassed
      && on.successes >= 4 && on.successes >= off.successes
      && (on.readToolCalls < off.readToolCalls || inputLower),
  }
}
