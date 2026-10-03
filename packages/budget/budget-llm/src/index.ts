import { createHash } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import { symbols } from '@deepseek-ai/cordis'
import { LlmError, contentHasImage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage, LlmRuntime, LlmDispatchIdentity } from '@deepseek-ai/dsh-llm'
import { BudgetError } from '@changanhua/dsh-budget'
import type { BudgetUsage, BudgetDecisionRecord, BudgetReservationView } from '@changanhua/dsh-budget'

/** Final LLM dispatch consumer; it installs even while the Budget owner is unavailable. */
export const name = 'budget-llm'
/** The guarded boundary must exist; absence of Budget itself remains a runtime refusal. */
export const inject = ['llm']

/** Host-observed dispatch and owner receipts; no messages, tools, keys or adapter configuration are retained. */
export interface BudgetDispatchEvidence {
  readonly identity: LlmDispatchIdentity
  readonly provider: string
  readonly model: string
  readonly parameters: Readonly<{ maxTokens?: number; temperature?: number; reasoningEffort?: string; stop?: readonly string[] }>
  readonly inputDigest: string
  readonly dispatched: boolean
  readonly decision: BudgetDecisionRecord | null
  readonly reservation: BudgetReservationView | null
}

const active = new WeakMap<LlmRuntime, object>()
/** Immutable final dispatch facts available before reservation or remote effects. */
export type BudgetDispatchFacts = Pick<BudgetDispatchEvidence, 'identity' | 'provider' | 'model' | 'parameters' | 'inputDigest'>
const observations = new AsyncLocalStorage<{ runtime: LlmRuntime
  records: BudgetDispatchEvidence[]
  maxAttempts: number
  attempts: number
  validate?: (facts: BudgetDispatchFacts) => void }>()

function runtimeIdentity(runtime: LlmRuntime): LlmRuntime {
  return (runtime as LlmRuntime & { [symbols.original]?: LlmRuntime })[symbols.original] ?? runtime
}

/**
 * Observe a Host operation through this bridge's actual final dispatch guard.
 * Refuses before invoking the operation when the bridge is absent. The operation
 * must await all stream consumption, including iterator cleanup, before returning.
 * @param ctx Host runtime whose bridge is mounted for the operation's lifetime.
 * @param maxAttempts Complete observation bound; overflow refuses dispatch before making a request.
 * @param operation Work under the caller's existing Budget scope; no scope is created here.
 * @param validate Optional synchronous Host policy check on copied final facts, before reservation and dispatch.
 * @returns Operation result and independent owner receipts for its dispatch attempts.
 */
export async function withBudgetDispatchEvidence<T>(ctx: Context, maxAttempts: number, operation: () => Promise<T>,
  validate?: (facts: BudgetDispatchFacts) => void): Promise<{
  readonly result: T
  readonly evidence: readonly BudgetDispatchEvidence[]
}> {
  const current = ctx.get('llm')
  const runtime = current && runtimeIdentity(current)
  if (!runtime || !active.has(runtime)) throw new LlmError('Budget dispatch bridge is unavailable', 'BUDGET_UNAVAILABLE')
  const generation = active.get(runtime)
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new LlmError('Invalid dispatch evidence bound', 'BUDGET_EVIDENCE_BOUND')
  const records: BudgetDispatchEvidence[] = []
  const result = await observations.run({ runtime, records, maxAttempts, attempts: 0, ...(validate ? { validate } : {}) }, operation)
  if (active.get(runtime) !== generation) throw new LlmError('Budget dispatch bridge changed during execution', 'BUDGET_UNAVAILABLE')
  return { result, evidence: structuredClone(records) }
}

function actualUsage(usage: TokenUsage): BudgetUsage | undefined {
  if (usage.totalTokens !== undefined && Number.isSafeInteger(usage.totalTokens) && usage.totalTokens >= usage.outputTokens) {
    return { inputTokens: usage.totalTokens - usage.outputTokens, outputTokens: usage.outputTokens }
  }
  if (usage.cacheReadTokens !== undefined && usage.cacheWriteTokens !== undefined) {
    return { inputTokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens, outputTokens: usage.outputTokens }
  }
  return undefined
}

/** Install one disposable budget guard at the Runtime's final dispatch boundary. */
export function apply(ctx: Context): void {
  const runtime = ctx.llm
  const identityOwner = runtimeIdentity(runtime)
  runtime.registerDispatchGuard(async function* ({ options, identity }, dispatch) {
    const observation = observations.getStore()
    if (observation?.runtime === identityOwner && ++observation.attempts > observation.maxAttempts) {
      throw new LlmError('Dispatch evidence capacity exceeded', 'BUDGET_EVIDENCE_BOUND')
    }
    const budget = ctx.get('budget')
    if (!budget) throw new LlmError('Budget owner is unavailable', 'BUDGET_UNAVAILABLE')
    if (!Number.isSafeInteger(options.maxTokens) || options.maxTokens === undefined || options.maxTokens <= 0) {
      throw new LlmError('Budget admission requires an explicit output Token limit', 'BUDGET_OUTPUT_LIMIT_REQUIRED')
    }
    if (options.messages.some(message => contentHasImage(message.content))) {
      throw new LlmError('Image input requires an owner-provided Token bound before budget admission', 'BUDGET_INPUT_UNMEASURED')
    }
    const input = JSON.stringify({ messages: options.messages, system: options.system, tools: options.tools })
    const inputDigest = createHash('sha256').update(JSON.stringify({
      input, provider: options.provider, model: options.model, maxTokens: options.maxTokens,
      temperature: options.temperature, reasoningEffort: options.reasoningEffort, stop: options.stop,
    })).digest('hex')
    let dispatched = false
    const facts: BudgetDispatchFacts = { identity: { ...identity }, provider: options.provider, model: options.model, inputDigest,
      parameters: { maxTokens: options.maxTokens,
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...(options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort }),
        ...(options.stop === undefined ? {} : { stop: [...options.stop] }) } }
    try {
      if (observation?.runtime === identityOwner) observation.validate?.(structuredClone(facts))
      yield* budget.streamModel({ ...identity, inputDigest, inputTokens: Buffer.byteLength(input), outputTokens: options.maxTokens },
        (signal) => { dispatched = true; return dispatch(signal) },
        chunk => ({ terminal: chunk.type === 'finish', ...(chunk.type === 'usage' ? { usage: actualUsage(chunk.usage) ?? null } : {}) }), options.signal)
    } catch (error) {
      if (error instanceof BudgetError) throw new LlmError(error.message, error.code, { cause: error })
      throw error
    } finally {
      if (observation?.runtime === identityOwner) observation.records.push({
        ...facts, dispatched,
        decision: budget.decision(identity.requestId, identity.attemptId) ?? null,
        reservation: budget.reservation(identity.requestId, identity.attemptId) ?? null,
      })
    }
  })
  ctx.effect(() => {
    active.set(identityOwner, {})
    return () => { active.delete(identityOwner) }
  }, 'budget-llm.dispatch-evidence()')
}
