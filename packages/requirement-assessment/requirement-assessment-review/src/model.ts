import type { Context } from '@deepseek-ai/cordis'
import { assessmentActualInputSchema } from '@changanhua/dsh-requirement-assessment'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { deadline } from '@deepseek-ai/dsh-timeout'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'

/** Deployment-owned route and complete request/response resource bounds. */
export interface ReviewModelConfig {
  provider: string
  model: string
  maxInputBytes: number
  maxOutputBytes: number
  maxOutputTokens: number
  timeoutMs: number
}

/** Exact successful one-shot output and reproducible request settings. */
export interface ReviewModelResult {
  output: unknown
  rawOutput: string
  prompt: string
  system: string
  settings: LlmCallConfig
}

/**
 * One bounded request through the existing LLM runtime, with no executable tools.
 * @param ctx - Host context exposing the configured LLM runtime.
 * @param config - Deployment route and resource bounds.
 * @param system - Stable evaluator instruction.
 * @param input - Frozen evidence payload, framed as one JSON message.
 * @param signal - Caller lifetime fused with the deployment deadline.
 * @returns Raw output, parsed JSON and exact request facts; schema validation belongs to the caller.
 */
export async function runReviewModel(
  ctx: Context, config: ReviewModelConfig, system: string, input: unknown, signal: AbortSignal,
): Promise<ReviewModelResult> {
  using lifetime = deadline(signal, config.timeoutMs, 'REQUIREMENT_REVIEW_TIMEOUT')
  const active = lifetime.signal
  active.throwIfAborted()
  const prompt = JSON.stringify(input)
  // The exact request must remain persistable even if deployment byte limits are higher.
  assessmentActualInputSchema.shape.requestPrompt.parse(prompt)
  const prepared = await ctx.llm.prepareCall({ provider: config.provider, model: config.model, maxTokens: config.maxOutputTokens }, active)
  const messages = [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'plugin', plugin: 'dsh-requirement-assessment-review' } })]
  const request = deepFreeze({ ...prepared.config, system, messages, tools: [], signal: active })
  if (Buffer.byteLength(JSON.stringify({ ...prepared.config, system, messages, tools: [] }), 'utf8') > config.maxInputBytes) throw new Error('review input exceeds byte limit')
  const assembler = new BlockAssembler()
  let bytes = 0
  let finished = false
  for await (const chunk of prepared.stream(request)) {
    active.throwIfAborted()
    // Bound the entire stream (including reasoning and replay metadata), not just final text.
    bytes += Buffer.byteLength(JSON.stringify(chunk), 'utf8')
    if (bytes > config.maxOutputBytes) throw new Error('review output exceeds byte limit')
    if (finished) throw new Error('review emitted data after completion')
    if (chunk.type === 'tool-call-delta' || (chunk.type === 'block-start' && chunk.blockType !== 'text' && chunk.blockType !== 'reasoning')) throw new Error('review output requested an unsupported capability')
    if (chunk.type === 'block-end' && chunk.block.type !== 'text' && chunk.block.type !== 'reasoning') throw new Error('review output must be text')
    if (chunk.type === 'finish') {
      finished = true
      if (chunk.reason.kind !== 'stop') throw new Error('review did not complete normally')
    }
    assembler.push(chunk)
  }
  active.throwIfAborted()
  if (!finished) throw new Error('review stream ended without completion')
  const rawOutput = assembler.blocks().filter(block => block.type === 'text').map(block => block.text).join('')
  return { output: JSON.parse(rawOutput) as unknown, rawOutput, prompt, system, settings: prepared.config }
}
