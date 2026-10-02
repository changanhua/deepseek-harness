import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { LlmError, contentHasImage } from '@deepseek-ai/dsh-llm'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { BudgetError } from '@changanhua/dsh-budget'
import type { BudgetUsage } from '@changanhua/dsh-budget'

/** Final LLM dispatch consumer; it installs even while the Budget owner is unavailable. */
export const name = 'budget-llm'
/** The guarded boundary must exist; absence of Budget itself remains a runtime refusal. */
export const inject = ['llm']

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
  ctx.llm.registerDispatchGuard(async function* ({ options, identity }, dispatch) {
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
    try {
      yield* budget.streamModel({ ...identity, inputDigest, inputTokens: Buffer.byteLength(input), outputTokens: options.maxTokens },
        dispatch, chunk => ({ terminal: chunk.type === 'finish', ...(chunk.type === 'usage' ? { usage: actualUsage(chunk.usage) ?? null } : {}) }), options.signal)
    } catch (error) {
      if (error instanceof BudgetError) throw new LlmError(error.message, error.code, { cause: error })
      throw error
    }
  })
}
