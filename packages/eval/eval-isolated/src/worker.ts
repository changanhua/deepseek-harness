/** Host-pinned core driver. Authenticated registry observations are distinct from the Agent's untrusted output. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { TurnEndReason } from '@deepseek-ai/dsh-session'
import { evalContractDigest, evalPlanSchema } from '@changanhua/dsh-eval'
import type { EvalPlan } from '@changanhua/dsh-eval'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-cmdline'
import { RoleChannel } from './channel.ts'
import { createRoleReporter } from './observer.ts'
import type { IsolatedTaskResult } from './task.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Private pinned-core task bridge; implementations must await task-tree quiescence. */
    'eval-isolated/task'(request: { sessionId: string; source: string }): Promise<IsolatedTaskResult>
  }
}

/** Private plugin name used only by the isolated dsh Profile. */
export const name = 'eval-isolated-worker'
/** Every role uses the existing Agent and Session owners. */
export const inject = ['agents', 'sessions', 'llm', 'agentPresets', 'tools', 'skills']

/** Host-authored configuration, stored in the sealed Profile before process launch. */
export interface Config {
  readonly channelDirectory: string
  readonly maxFrameBytes: number
  readonly timeoutMs: number
  readonly cleanupTimeoutMs: number
  readonly sessionId: string
  readonly prompt: string
  readonly route: EvalPlan['routes'][number]
}

/**
 * Drive one real Agent using the Host broker as its only model adapter.
 * @param ctx Profile-composed services; this plugin creates no Agent loop or persistence provider.
 * @param config Host-selected role input. Neither credentials nor a model network endpoint enters this process.
 */
export function apply(ctx: Context, config: Config): void {
  const route = evalPlanSchema.shape.routes.element.parse(config.route)
  if (!config.channelDirectory || !config.sessionId || typeof config.prompt !== 'string'
    || !Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1
    || !Number.isSafeInteger(config.cleanupTimeoutMs) || config.cleanupTimeoutMs < 1) throw new Error('eval-worker-invalid-config')
  const maxTokens = route.parameters.maxTokens
  if (typeof maxTokens !== 'number' || !Number.isSafeInteger(maxTokens) || maxTokens < 1) throw new Error('eval-worker-output-bound-required')
  const outputBound: number = maxTokens
  const ready = ctx.get('appReady'), exit = ctx.get('appExit')
  if (!ready || !exit) throw new Error('eval-worker-requires-profile-launch')
  const controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(config.timeoutMs)])
  let done: Promise<void> | undefined
  ctx.effect(() => async () => { controller.abort(); await done }, 'eval-worker.lifecycle()')
  ready.onReady(() => {
    done = drive().catch((error: unknown) => {
      process.stderr.write(`eval-worker: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
      exit(1)
    })
  })

  async function drive(): Promise<void> {
    const report = createRoleReporter(readFileSync(0, 'utf8'))
    const channel = await RoleChannel.connect(config.channelDirectory, config.maxFrameBytes)
    const stopWatch = new AbortController()
    const watching = channel.waitForCancellation(stopWatch.signal).then(() => { controller.abort() }, () => {
      if (!stopWatch.signal.aborted) controller.abort()
    })
    let sequence = 0
    let pending: Promise<unknown> = Promise.resolve()
    let observe: ((observationSignal?: AbortSignal) => Promise<unknown>) | undefined
    const exchange = (kind: string, value: unknown, exchangeSignal: AbortSignal = signal) => {
      const next = pending.then(async () => {
        exchangeSignal.throwIfAborted()
        const current = ++sequence
        await channel.send(report({ sequence: current, kind, value }))
        const response = report.acceptResponse(await channel.receive(current, exchangeSignal))
        if (response.kind !== `${kind}-result`) throw new Error('eval-worker-protocol-mismatch')
        return response.value
      })
      pending = next.catch(() => {})
      return next
    }
    class BrokerAdapter extends LlmAdapter {
      async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        const { signal: _signal, ...request } = options
        if (!observe) throw new Error('eval-worker-observer-unavailable')
        const result = await exchange('model', { request, observation: await observe() })
        if (!Array.isArray(result)) throw new Error('eval-worker-model-response-invalid')
        for (const chunk of result) yield chunk as StreamChunk
      }
    }
    const disposeAdapter = ctx.llm.registerAdapter([route.provider], new BrokerAdapter())
    const disposeTasks = ctx.on('eval-isolated/task', async (request) => {
      if (request.sessionId !== config.sessionId || typeof request.source !== 'string') throw new Error('eval-worker-task-scope-mismatch')
      return await exchange('task', request.source, AbortSignal.timeout(config.timeoutMs + config.cleanupTimeoutMs)) as IsolatedTaskResult
    })
    let handle: Awaited<ReturnType<Context['agents']['create']>> | undefined
    let removeEvents: (() => void) | undefined
    let removeCancel: (() => void) | undefined
    try {
      signal.throwIfAborted()
      handle = await ctx.agents.create({ sessionId: SessionId(config.sessionId),
        meta: { cwd: process.cwd(), agentPreset: route.preset.id }, signal,
        setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, route.preset.id) },
        agentOptions: { provider: route.provider, model: route.model, maxTokens: outputBound,
          ...(typeof route.parameters.reasoningEffort === 'string' ? { reasoningEffort: ReasoningEffortId(route.parameters.reasoningEffort) } : {}) } })
      const agent = handle.agent
      const cancel = () => { agent.cancel({ kind: 'parent' }) }
      signal.addEventListener('abort', cancel, { once: true })
      removeCancel = () => { signal.removeEventListener('abort', cancel) }
      signal.throwIfAborted()
      await agent.whenIdle()
      observe = async (observationSignal = signal) => {
        const preset = await ctx.agentPresets.readDocument(route.preset.id)
        const toolIds = ctx.tools.schemas(agent).map(tool => tool.name).sort()
        const tools = toolIds.map((id) => {
          const tool = ctx.tools.get(id, agent)
          if (!tool) throw new Error('eval-worker-tool-unavailable')
          return { id: tool.name, source: ctx.tools.get(id) === tool ? 'tool-contract:global' : 'tool-contract:agent',
            digest: evalContractDigest({ name: tool.name, description: tool.description, parameters: tool.parameters,
              outputSchema: tool.output.schema }) }
        })
        const skills = []
        const catalog = await ctx.skills.snapshot({ cwd: process.cwd(), signal: observationSignal, scope: agent })
        if (!catalog.complete) throw new Error('eval-worker-skill-catalog-incomplete')
        const skillIds = catalog.skills.map(skill => skill.name).sort()
        for (const id of skillIds) {
          const skill = await ctx.skills.get(id, { cwd: process.cwd(), signal: observationSignal, scope: agent })
          if (!skill) throw new Error('eval-worker-skill-unavailable')
          skills.push({ id: skill.name, source: `skill:${skill.provider}:${skill.source}`, digest: evalContractDigest({
            name: skill.name, description: skill.description, content: skill.content,
            invocation: skill.invocation, metadata: skill.metadata ?? null }) })
        }
        return { sessionId: agent.id,
          preset: { id: preset.agentPreset, source: `preset:${preset.trust}`, digest: createHash('sha256').update(preset.content.replace(/\r\n/gu, '\n')).digest('hex') },
          tools, skills }
      }
      const readyResult = await exchange('ready', await observe(), AbortSignal.timeout(config.cleanupTimeoutMs))
      if (readyResult && typeof readyResult === 'object' && 'canceled' in readyResult && readyResult.canceled === true) controller.abort()
      let text = '', reason: TurnEndReason | undefined, events = 0
      const trace: unknown[] = []
      let traceBytes = 2
      const traceState = { overflow: false }
      const eventDigest = createHash('sha256')
      removeEvents = ctx.on('session/event', (session, event) => {
        if (session !== agent.session) return
        const encoded = JSON.stringify(event)
        traceBytes += Buffer.byteLength(encoded) + 1
        if (traceBytes > config.maxFrameBytes) { traceState.overflow = true; controller.abort(); return }
        trace.push(event)
        eventDigest.update(encoded); events++
        if (event.type === 'assistant/message') text = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
        if (event.type === 'turn/end') reason = event.data.reason
      })
      if (!signal.aborted) agent.followup(createUserMessage({ content: [{ type: 'text', text: config.prompt }], source: { kind: 'user' } }))
      await agent.whenIdle()
      await ctx.sessions.flush(agent.session)
      if (traceState.overflow) throw new Error('eval-worker-evidence-capacity')
      const cleanupSignal = AbortSignal.timeout(config.cleanupTimeoutMs)
      await exchange('complete', { sessionId: agent.id, output: text, reason: reason ?? null, events,
        eventDigest: eventDigest.digest('hex'), trace, observation: await observe(cleanupSignal), flushed: true,
        canceled: signal.aborted, environment: { platform: process.platform, arch: process.arch, node: process.version } }, cleanupSignal)
    } finally {
      stopWatch.abort()
      await watching
      removeCancel?.()
      removeEvents?.()
      await handle?.dispose()
      disposeAdapter()
      disposeTasks()
      await channel.close()
    }
    exit?.(0)
  }
}
