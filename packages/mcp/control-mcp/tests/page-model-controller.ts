/** Opt-in instrumentation for one isolated subject Host; never mount in a personal Profile. */
import type { Context } from '@deepseek-ai/cordis'
import type { Browser } from '@changanhua/dsh-browser'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { ExperimentBudget } from './page-model-experiment.ts'

interface ModelCostBound {
  readonly provider: string
  readonly model: string
  /** Conservative upper bound using the frozen provider context/output limits and current RMB prices. */
  readonly maxRequestRmb: number
  readonly inputRmbPerMillion: number
  readonly outputRmbPerMillion: number
}

/** Reserve cost before opening a provider stream; missing usage keeps the complete reservation. */
export function meterPageModelSubject(ctx: Context, browser: Browser, input: {
  readonly sessionId: string
  readonly runId: string
  readonly budget: ExperimentBudget
  readonly maxRunRmb: number
  readonly cost: ModelCostBound
}) {
  for (const price of [input.cost.inputRmbPerMillion, input.cost.outputRmbPerMillion]) {
    if (!Number.isFinite(price) || price < 0) throw new Error('invalid_model_price')
  }
  const run = input.budget.start(input.runId, input.maxRunRmb)
  const operations: Array<{ kind: string; phase: string; outcome?: string }> = []
  let cleanup = false
  const execute = browser.execute
  const prepare = browser.prepare
  const executePrepared = browser.executePrepared
  const tickets = new Set<Parameters<Browser['executePrepared']>[0]>()
  const charge = (usage: TokenUsage) => {
    const inputTokens = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
    if (![inputTokens, usage.outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('invalid_model_usage')
    return (inputTokens * input.cost.inputRmbPerMillion + usage.outputTokens * input.cost.outputRmbPerMillion) / 1_000_000
  }
  const off = ctx.on('llm/stream', async function* (options, next) {
    if (String(options.sessionId) !== input.sessionId) { yield* next(); return }
    if (cleanup) throw new Error('experiment_is_cleaning_up')
    if (options.provider !== input.cost.provider || options.model !== input.cost.model) throw new Error('experiment_model_changed')
    const reservation = run.request(input.cost.maxRequestRmb)
    let usage: TokenUsage | undefined
    let finished = false
    for await (const chunk of next()) {
      if (chunk.type === 'usage') usage = chunk.usage
      if (chunk.type === 'finish') finished = true
      yield chunk
    }
    if (finished && usage !== undefined) reservation.settle(charge(usage))
  })
  browser.execute = async function (operation, signal) {
    if (String(operation.sessionId) !== input.sessionId) return execute.call(this, operation, signal)
    run.browser('execute', cleanup)
    const record = { kind: operation.action.kind, phase: cleanup ? 'cleanup' : 'task', outcome: 'pending' }
    operations.push(record)
    try { const result = await execute.call(this, operation, signal); record.outcome = result.outcome; return result }
    catch (error) { record.outcome = 'threw'; throw error }
  }
  browser.prepare = async function (operation, signal) {
    if (String(operation.sessionId) !== input.sessionId) return prepare.call(this, operation, signal)
    run.browser('prepare', cleanup)
    operations.push({ kind: operation.action.kind, phase: 'prepare' })
    const prepared = await prepare.call(this, operation, signal)
    tickets.add(prepared.ticket)
    return prepared
  }
  browser.executePrepared = async function (ticket, signal) {
    if (tickets.has(ticket)) {
      run.browser('executePrepared', cleanup)
      operations.push({ kind: 'prepared', phase: 'commit' })
    }
    return executePrepared.call(this, ticket, signal)
  }
  let disposed = false
  return {
    snapshot: () => ({ ...run.snapshot(), operations: structuredClone(operations), costs: input.budget.snapshot() }),
    /** Only the controller may enter safety cleanup; no more subject requests are permitted. */
    startCleanup: () => { cleanup = true },
    dispose: () => {
      if (disposed) return
      disposed = true
      off()
      browser.execute = execute
      browser.prepare = prepare
      browser.executePrepared = executePrepared
    },
  }
}
