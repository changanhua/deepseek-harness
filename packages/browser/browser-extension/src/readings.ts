import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { z } from 'zod'

const selectionSchema = z.object({ provider: z.string().min(1).max(256), model: z.string().min(1).max(256),
  reasoningEffort: z.string().min(1).max(128).optional() }).strict()
const inputSchema = z.object({ id: z.string().uuid(), text: z.string().min(1).max(52000),
  selection: selectionSchema.optional() }).strict()

/** One-shot reading calls use DSH adapters without an Agent, Session, tools, or history. */
export class BrowserReadings {
  private active: { id: string; controller: AbortController } | undefined
  constructor(private readonly ctx: Context, private readonly permit: () => boolean,
    private readonly send: (frame: unknown) => void) {}

  dispose(): void { this.active?.controller.abort() }

  async handle(method: string, params: unknown): Promise<unknown> {
    if (!this.permit()) throw new Error('forbidden')
    const llm = this.ctx.get('llm')
    if (!llm) throw new Error('model_unavailable')
    if (method === 'reading.models') {
      const providers = await Promise.all(llm.listProviders().map(async (provider) => {
        try {
          const models = await llm.listModels(provider.id)
          return { ...provider, models, error: null }
        } catch { return { ...provider, models: [], error: '无法读取此服务商的模型' } }
      }))
      return { providers, defaultSelection: this.ctx.get('agentDefaultModel')?.currentSelection() }
    }
    if (method === 'reading.model') {
      const selection = selectionSchema.parse(params)
      return llm.resolveModelInfo(selection.provider, selection.model)
    }
    if (method === 'reading.stop') {
      const { id } = z.object({ id: z.string().uuid() }).strict().parse(params)
      if (this.active?.id === id) this.active.controller.abort()
      return { stopped: true }
    }
    if (method !== 'reading.generate') throw new Error('unknown_method')
    const input = inputSchema.parse(params)
    if (this.active) throw new Error('reading_busy')
    const selection = input.selection ?? this.ctx.get('agentDefaultModel')?.currentSelection()
    if (!selection) throw new Error('model_unavailable')
    const operation = { id: input.id, controller: new AbortController() }
    this.active = operation
    const timer = setTimeout(() => operation.controller.abort(), 240000)
    timer.unref()
    let text = '', finished = false
    try {
      for await (const chunk of llm.stream({ provider: selection.provider, model: selection.model,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) }),
        messages: [createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: input.text }] })],
        signal: operation.controller.signal })) {
        if (!this.permit()) throw new Error('forbidden')
        if (chunk.type === 'text-delta') {
          if (text.length + chunk.text.length > 64000) throw new Error('reading_output_limit')
          text += chunk.text
          this.send({ type: 'reading', id: input.id, text: chunk.text })
        } else if (chunk.type === 'finish') {
          if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') throw new Error(chunk.reason.failure.message)
          if (chunk.reason.kind !== 'stop' && chunk.reason.kind !== 'max-tokens') throw new Error('unexpected_model_output')
          finished = true
        }
      }
      if (!finished || !text.trim()) throw new Error('empty_model_response')
      return { text, selection }
    } finally {
      clearTimeout(timer)
      operation.controller.abort()
      this.active = undefined
    }
  }
}
