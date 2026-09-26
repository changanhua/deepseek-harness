import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { FinishReason, GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { describe as describeDeclaration } from '../src/declaration.ts'
import { apply, type Config } from '../src/index.ts'

const CONFIG = { provider: 'mock', model: 'flash', maxInputBytes: 4096, maxCandidates: 4, maxOutputTokens: 32, timeoutMs: 1_000 } satisfies Config
const ARGS = { goal: 'open readme', facts: 'repo home', candidates: [{ id: 'readme', description: 'Readme' }, { id: 'disabled', description: 'Disabled', disabled: true }] } as const

function text(text: string, finish: FinishReason = { kind: 'stop' }): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 7, outputTokens: 3 } },
    { type: 'finish', reason: finish },
  ]
}

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  readonly started = Promise.withResolvers<undefined>()
  constructor(private readonly script: Array<readonly StreamChunk[] | 'hang'>) { super() }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, reasoning: {
      efforts: [{ id: ReasoningEffortId('off'), name: 'Off' }], defaultEffort: ReasoningEffortId('off'),
    } })
  }
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    this.started.resolve(undefined)
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('model script exhausted')
    if (entry === 'hang') {
      await new Promise<never>((_resolve, reject) => {
        const rejectAbort = (): void => {
          const cause: unknown = options.signal?.reason
          reject(cause instanceof Error ? cause : new Error('missing abort reason'))
        }
        if (options.signal?.aborted) rejectAbort()
        else options.signal?.addEventListener('abort', () => { rejectAbort() }, { once: true })
      })
      return
    }
    yield * entry
  }
}

interface Harness { readonly ctx: Context; readonly adapter: ScriptedAdapter; readonly agent: Agent }
const harnesses: Harness[] = []
let nextSession = 0
let nextCall = 0

afterEach(async () => {
  for (const harness of harnesses.splice(0).reverse()) await harness.ctx.fiber.dispose()
})

async function harness(script: Array<readonly StreamChunk[] | 'hang'>, config = CONFIG): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new ScriptedAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  apply(ctx, config)
  const agent = await ctx.agentLoop.create(SessionId(`choice-tool-${++nextSession}`), { provider: 'mock', model: 'conversation' })
  const result = { ctx, adapter, agent }
  harnesses.push(result)
  return result
}

function invoke(subject: Harness, arguments_: unknown = ARGS, signal = new AbortController().signal) {
  return subject.ctx.tools.execute({ signal, callId: ToolCallId(`choice-${++nextCall}`), name: 'choose_candidate', arguments: arguments_, agent: subject.agent })
}

function choiceEvents(subject: Harness) {
  return subject.agent.session.snapshotEvents().filter(event => event.type === 'choice/llm-request' || event.type === 'choice/llm-result')
}

function errorMessage(result: unknown): string {
  if (result === null || typeof result !== 'object' || !('error' in result)) throw new Error('expected tool error')
  const error = result.error
  if (error === null || typeof error !== 'object' || !('message' in error) || typeof error.message !== 'string') throw new Error('expected tool error message')
  return error.message
}

describe('choose_candidate through the real DSH tool runtime', () => {
  it('publishes the declaration-equivalent schema, dispatches with reasoning off, and records a successful terminal pair', async () => {
    const subject = await harness([text('{"status":"selected","candidateId":"readme"}')])
    const actual = subject.ctx.tools.get('choose_candidate', subject.agent)
    const declaration = describeDeclaration({})
    expect(actual).toBeDefined()
    expect(actual).toMatchObject({
      name: declaration.name, description: declaration.description,
      parameters: declaration.parameters, output: { schema: declaration.outputSchema },
    })
    expect(subject.ctx.tools.schemas(subject.agent)).toEqual([{
      name: declaration.name, description: declaration.description, parameters: declaration.parameters,
    }])

    const result = await invoke(subject)
    expect(result).toMatchObject({ isError: false, value: { status: 'selected', candidateId: 'readme', provider: 'mock', model: 'flash', usage: { inputTokens: 7, outputTokens: 3 } } })
    expect(subject.adapter.requests).toHaveLength(1)
    expect(subject.adapter.requests[0]).toMatchObject({
      provider: 'mock', model: 'flash', maxTokens: 32,
      reasoningEffort: 'off', sessionId: subject.agent.id,
    })
    expect(JSON.stringify(subject.adapter.requests[0]?.messages)).not.toContain('disabled')
    expect(choiceEvents(subject).map(event => event.type)).toEqual(['choice/llm-request', 'choice/llm-result'])
    expect(choiceEvents(subject)[1]).toMatchObject({ data: { error: null, finishKind: 'stop', usage: { inputTokens: 7, outputTokens: 3 } } })
  })

  it('returns zero-eligible abstention without a model request or auxiliary session event', async () => {
    const subject = await harness([])
    const result = await invoke(subject, { ...ARGS, candidates: [{ id: 'disabled', description: 'Disabled', disabled: true }] })
    expect(result).toMatchObject({ isError: false, value: { status: 'abstain', reason: 'no_eligible_candidates', usage: null } })
    expect(subject.adapter.requests).toEqual([])
    expect(choiceEvents(subject)).toEqual([])
  })

  it('accepts abstention and rejects an unknown selected id or extra response fields through ToolRuntime', async () => {
    const accepted = await harness([text('{"status":"abstain","reason":"ambiguous"}')])
    expect(await invoke(accepted)).toMatchObject({ isError: false, value: { status: 'abstain', reason: 'ambiguous' } })
    const unknown = await harness([text('{"status":"selected","candidateId":"other"}')])
    const unknownResult = await invoke(unknown)
    expect(unknownResult).toMatchObject({ isError: true })
    expect(errorMessage(unknownResult)).toContain('unknown or disabled')
    expect(choiceEvents(unknown).map(event => event.type)).toEqual(['choice/llm-request', 'choice/llm-result'])
    const extra = await harness([text('{"status":"abstain","reason":"x","extra":true}')])
    const extraResult = await invoke(extra)
    expect(extraResult).toMatchObject({ isError: true })
    expect(errorMessage(extraResult)).toContain('unknown keys')
    expect(choiceEvents(extra).map(event => event.type)).toEqual(['choice/llm-request', 'choice/llm-result'])
  })

  it.each([
    [text('{"status":"selected","candidateId":"readme"}').slice(0, -1), 'without finish'],
    [text('{"status":"selected"}', { kind: 'max-tokens' }), 'finished with max-tokens'],
    [[{ type: 'block-start', index: 0, blockType: 'reasoning' }, { type: 'reasoning-delta', index: 0, text: 'thinking only' }, { type: 'finish', reason: { kind: 'stop' } }] satisfies StreamChunk[], 'output must contain text only'],
  ] as const)('records a terminal failure for %s', async (script, message) => {
    const subject = await harness([script])
    const result = await invoke(subject)
    expect(result).toMatchObject({ isError: true })
    expect(errorMessage(result)).toContain(message)
    const events = choiceEvents(subject)
    expect(events.map(event => event.type)).toEqual(['choice/llm-request', 'choice/llm-result'])
    const terminal = events[1]
    if (terminal?.type !== 'choice/llm-result') throw new Error('expected choice terminal')
    expect(terminal.data.result).toBeNull()
    expect(terminal.data.error).toContain(message)
  })

  it('propagates caller cancellation and the short tool deadline while keeping auxiliary records paired', async () => {
    const caller = await harness(['hang'])
    const controller = new AbortController()
    const pending = invoke(caller, ARGS, controller.signal)
    await caller.adapter.started.promise
    controller.abort(new Error('caller cancelled'))
    const callerResult = await pending
    expect(callerResult).toMatchObject({ isError: true })
    expect(errorMessage(callerResult)).toContain('caller cancelled')
    expect(choiceEvents(caller).map(event => event.type)).toEqual(['choice/llm-request', 'choice/llm-result'])

    vi.useFakeTimers()
    try {
      const timed = await harness(['hang'], { ...CONFIG, timeoutMs: 10 })
      const pendingTimeout = invoke(timed)
      await timed.adapter.started.promise
      await vi.advanceTimersByTimeAsync(10)
      const timeoutResult = await pendingTimeout
      expect(timeoutResult).toMatchObject({ isError: true })
      expect(errorMessage(timeoutResult)).toContain('CHOICE_TIMEOUT')
      expect(choiceEvents(timed).map(event => event.type)).toEqual(['choice/llm-request', 'choice/llm-result'])
    } finally { vi.useRealTimers() }
  })

  it('unregisters when the applying fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const plugin = Object.assign((inner: Context): void => { apply(inner, CONFIG) }, { inject: ['tools', 'llm'] })
    const fiber = await ctx.plugin(plugin)
    try {
      expect(ctx.tools.get('choose_candidate')).toBeDefined()
      await fiber.dispose()
      expect(ctx.tools.get('choose_candidate')).toBeUndefined()
    } finally { await ctx.fiber.dispose() }
  })
})
