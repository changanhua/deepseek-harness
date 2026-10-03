/** Live model requests leave the isolated role only through this Host-owned, Budget-guarded call path. */
import type { Context } from '@deepseek-ai/cordis'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { BudgetReference } from '@changanhua/dsh-budget'
import { withBudgetDispatchEvidence } from '@changanhua/dsh-budget-llm'
import type { BudgetDispatchEvidence } from '@changanhua/dsh-budget-llm'
import { evalContractDigest, evalPlanSchema } from '@changanhua/dsh-eval'
import type { EvalPlan } from '@changanhua/dsh-eval'

/** Actual Host response and accounting; unknown usage is never a completed execution. */
export interface GuardedModelResult {
  readonly status: 'settled' | 'denied' | 'uncertain'
  readonly reason: string | null
  readonly chunks: readonly StreamChunk[]
  readonly evidence: readonly BudgetDispatchEvidence[]
}

/** Host-only binding captured from approved Plan/run authority, never reconstructed from a worker request. */
export interface ModelBrokerBinding {
  readonly route: EvalPlan['routes'][number]
  readonly budget: BudgetReference
  readonly sessionId: string
  readonly maxResponseBytes: number
  readonly maxAttempts: number
}

function portableContent(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  const pending: unknown[] = [...content as unknown[]]
  const seen = new Set<object>()
  while (pending.length) {
    const value = pending.pop()
    if (!value || typeof value !== 'object' || Array.isArray(value) || seen.has(value)) return false
    seen.add(value)
    const block = value as Record<string, unknown>
    if (block.type === 'text' || block.type === 'reasoning') {
      if (typeof block.text !== 'string') return false
    } else if (block.type === 'tool-call') {
      if (typeof block.id !== 'string' || typeof block.name !== 'string' || typeof block.arguments !== 'string') return false
    } else if (block.type === 'tool-result') {
      if (typeof block.toolCallId !== 'string' || !Array.isArray(block.content)) return false
      pending.push(...block.content as unknown[])
    } else return false
  }
  return true
}

/**
 * Capture the approved route and exact Budget scope once for one isolated role.
 * @param ctx Trusted Host runtime composing credentials, Budget, and its final-dispatch bridge.
 * @param binding Plan-derived authority and explicit evidence/output bounds.
 * @returns A broker accepting only model content; it overrides no authority from worker JSON.
 */
export function createGuardedModelBroker(ctx: Context, binding: ModelBrokerBinding):
(input: unknown, signal: AbortSignal) => Promise<GuardedModelResult> {
  const route = evalPlanSchema.shape.routes.element.parse(binding.route)
  const budget = Object.freeze({ ...binding.budget })
  const sessionId = SessionId(binding.sessionId)
  const { maxResponseBytes, maxAttempts } = binding
  for (const bound of [maxResponseBytes, maxAttempts]) if (!Number.isSafeInteger(bound) || bound < 1) throw new Error('eval-model-invalid-bound')
  const parameters = route.parameters
  if (Object.keys(parameters).some(key => !['maxTokens', 'temperature', 'reasoningEffort', 'stop'].includes(key))) throw new Error('eval-model-unsupported-parameter')
  if (typeof parameters.maxTokens !== 'number' || !Number.isSafeInteger(parameters.maxTokens) || parameters.maxTokens < 1) throw new Error('eval-model-output-bound-required')
  const maxTokens = parameters.maxTokens
  const temperature = parameters.temperature
  const reasoningEffort = parameters.reasoningEffort
  const stop = parameters.stop
  if (temperature !== undefined && (typeof temperature !== 'number' || !Number.isFinite(temperature))) throw new Error('eval-model-invalid-parameter')
  if (reasoningEffort !== undefined && (typeof reasoningEffort !== 'string' || !reasoningEffort)) throw new Error('eval-model-invalid-parameter')
  if (stop !== undefined && (!Array.isArray(stop) || stop.some(value => typeof value !== 'string'))) throw new Error('eval-model-invalid-parameter')
  let calls = 0
  let observedAttempts = 0
  let uncertain = false
  const dispatch = async (input: unknown, signal: AbortSignal): Promise<GuardedModelResult> => {
    signal.throwIfAborted()
    if (uncertain) throw new Error('eval-model-reconciliation-required')
    if (++calls > maxAttempts) throw new Error('eval-model-attempt-bound')
    if (observedAttempts >= maxAttempts) throw new Error('eval-model-attempt-bound')
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('eval-model-invalid-request')
    const request = input as Record<string, unknown>
    if (request.provider !== route.provider || request.model !== route.model || request.maxTokens !== maxTokens) throw new Error('eval-model-route-mismatch')
    if (!Array.isArray(request.messages)) throw new Error('eval-model-invalid-request')
    const messages = request.messages as unknown[]
    for (const message of messages) {
      if (!message || typeof message !== 'object' || !('role' in message) || typeof message.role !== 'string'
        || !['user', 'assistant', 'system'].includes(message.role) || !('id' in message) || typeof message.id !== 'string'
        || !('source' in message) || !message.source || typeof message.source !== 'object'
        || !('kind' in message.source) || typeof message.source.kind !== 'string') throw new Error('eval-model-invalid-request')
      if (!('content' in message) || !portableContent(message.content)) throw new Error('eval-model-content-unsupported')
    }
    // Attachment ids belong to a runtime owner. A child id must never resolve through the Host's private attachment store.
    if (request.system !== undefined && typeof request.system !== 'string') throw new Error('eval-model-invalid-request')
    if (request.tools !== undefined) {
      if (!Array.isArray(request.tools) || (request.tools as unknown[]).some(tool => !tool || typeof tool !== 'object'
        || !('name' in tool) || typeof tool.name !== 'string' || !('description' in tool) || typeof tool.description !== 'string'
        || !('parameters' in tool) || !tool.parameters || typeof tool.parameters !== 'object')) throw new Error('eval-model-invalid-request')
    }
    // Only content crosses this boundary. Route, limits, identity and cancellation come from the Host binding.
    const options: GenerateOptions = { provider: route.provider, model: route.model, maxTokens, signal, sessionId,
      messages: structuredClone(request.messages) as GenerateOptions['messages'],
      ...(request.system === undefined ? {} : { system: request.system }),
      ...(request.tools === undefined ? {} : { tools: structuredClone(request.tools) as NonNullable<GenerateOptions['tools']> }),
      ...(typeof temperature === 'number' ? { temperature } : {}),
      ...(typeof reasoningEffort === 'string' ? { reasoningEffort: ReasoningEffortId(reasoningEffort) } : {}),
      ...(Array.isArray(stop) ? { stop: [...stop] as string[] } : {}) }
    const validation = { identityMismatch: false }
    const result = await withBudgetDispatchEvidence(ctx, maxAttempts - observedAttempts, () => ctx.budget.withScope(budget, async () => {
      const chunks: StreamChunk[] = []
      let bytes = 2
      try {
        for await (const chunk of ctx.llm.stream(options)) {
          bytes += Buffer.byteLength(JSON.stringify(chunk)) + (chunks.length === 0 ? 0 : 1)
          if (bytes > maxResponseBytes) throw new Error('eval-model-output-capacity')
          chunks.push(chunk)
        }
        return { chunks, failed: false }
      } catch { return { chunks: [] as StreamChunk[], failed: true } }
    }), (facts) => {
      if (facts.provider !== route.provider || facts.model !== route.model
        || evalContractDigest(facts.parameters) !== evalContractDigest(parameters)) {
        validation.identityMismatch = true
        throw new Error('eval-model-identity-mismatch')
      }
    }).catch((error: unknown) => { uncertain = true; throw error })
    const records = result.evidence
    observedAttempts += records.length
    if (validation.identityMismatch && records.length > 0 && records.every(record => !record.dispatched)) {
      return { status: 'denied', reason: 'eval-model-identity-mismatch', chunks: [], evidence: records }
    }
    if (result.result.failed || records.length === 0 || records.some(record => record.dispatched && record.reservation?.phase !== 'settled')) {
      uncertain = true
      return { status: 'uncertain', reason: 'eval-model-accounting-uncertain', chunks: [], evidence: records }
    }
    if (records.some(record => !record.dispatched)) return { status: 'denied', reason: 'eval-model-budget-denied', chunks: result.result.chunks, evidence: records }
    return { status: 'settled', reason: null, chunks: result.result.chunks, evidence: records }
  }
  let pending = false
  return async (input, signal) => {
    if (pending) throw new Error('eval-model-request-in-progress')
    pending = true
    try { return await dispatch(input, signal) }
    finally { pending = false }
  }
}
