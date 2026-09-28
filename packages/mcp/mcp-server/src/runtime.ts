/** Host-owned lazy composition and per-invocation real Agent execution. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { CatalogEntry } from './catalog.ts'
import { declarationDigest } from './catalog.ts'
import type { Config } from './types.ts'
import { failureResult, invocationResult } from './result.ts'

/** Failure owned by external admission, before a native result is available. */
export class InvocationError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

/** Waiter cancellation never cancels or releases a shared composition. */
export async function waitFor<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  const aborted = Promise.withResolvers<never>()
  const abort = () => { aborted.reject(signal.reason) }
  signal.addEventListener('abort', abort, { once: true })
  try { return await Promise.race([pending, aborted.promise]) } finally { signal.removeEventListener('abort', abort) }
}

interface Combination {
  loading?: Promise<void>
  state: 'unloaded' | 'loading' | 'ready' | 'failed'
  attempts: number
  error: string | null
  tail: Promise<void>
}

/** Canonical execution plus stable evidence linking it to a stored Session. */
export interface InvocationResult {
  readonly outcome: ToolExecutionResult | undefined
  readonly result: CallToolResult
  readonly sessionId: string
  readonly callId: string
  readonly preset: string
  readonly elapsedMs: number
}

/** One runtime per Host; capability instances outlive individual callers. */
export class InvocationRuntime {
  private readonly lifetime = new AbortController()
  private readonly groups = new Map<string, Combination>()
  private readonly calls = new Set<Promise<unknown>>()

  constructor(private readonly ctx: Context, private readonly config: Config, readonly catalog: readonly CatalogEntry[]) {
    for (const entry of catalog) this.groups.set(entry.preset, { state: 'unloaded', attempts: 0, error: null, tail: Promise.resolve() })
  }

  /** Metadata-only observations; querying this method activates no combination. */
  status(): JsonValue {
    return this.catalog.map((entry) => {
      const group = this.group(entry.preset)
      return { name: entry.name, description: entry.description, preset: entry.preset, declarationDigest: entry.digest,
        state: group.state, loadAttempts: group.attempts, error: group.error }
    })
  }

  private group(preset: string): Combination {
    const group = this.groups.get(preset)
    if (group === undefined) throw new InvocationError('UNKNOWN_PRESET', `No configured capability group: ${preset}`)
    return group
  }

  private ensureLoaded(preset: string, group: Combination): Promise<void> {
    if (group.loading !== undefined) return group.loading
    group.state = 'loading'
    group.attempts += 1
    group.error = null
    const pending = this.ctx.agentPresets.standingKeyFor(preset).then(() => {
      group.state = 'ready'
    }).catch((error: unknown) => {
      group.state = 'failed'
      group.error = error instanceof Error ? error.message : String(error)
      delete group.loading
      throw new InvocationError('CAPABILITY_LOAD_FAILED', group.error)
    })
    group.loading = pending
    // A cancelled last waiter leaves a host-owned load with an observed rejection.
    void pending.catch(() => undefined)
    return pending
  }

  /** Admit one configured tool and keep it owned until cleanup finishes. */
  invoke(name: string, args: Record<string, unknown>, callerSignal: AbortSignal): Promise<InvocationResult> {
    this.lifetime.signal.throwIfAborted()
    const entry = this.catalog.find(candidate => candidate.name === name)
    if (entry === undefined) return Promise.reject(new InvocationError('UNKNOWN_CAPABILITY', `Unknown capability: ${name}`))
    if (this.calls.size >= this.config.maxPendingCalls) return Promise.reject(new InvocationError('BUSY', 'The DSH call limit is reached'))
    const deadline = new AbortController()
    const timer = setTimeout(() => { deadline.abort(new InvocationError('TIMEOUT', 'The DSH call timed out')) }, this.config.callTimeoutMs)
    const signal = AbortSignal.any([callerSignal, this.lifetime.signal, deadline.signal])
    const call = this.execute(entry, args, signal).finally(() => { clearTimeout(timer); this.calls.delete(call) })
    this.calls.add(call)
    return call
  }

  private async execute(entry: CatalogEntry, args: Record<string, unknown>, signal: AbortSignal): Promise<InvocationResult> {
    signal.throwIfAborted()
    const group = this.group(entry.preset)
    await waitFor(this.ensureLoaded(entry.preset, group), signal)
    const previous = group.tail
    const settled = Promise.withResolvers<void>()
    group.tail = previous.then(() => settled.promise)
    try {
      await waitFor(previous, signal)
      signal.throwIfAborted()
      return await this.run(entry, args, signal)
    } finally { settled.resolve() }
  }

  private async run(entry: CatalogEntry, args: Record<string, unknown>, signal: AbortSignal): Promise<InvocationResult> {
    const callId = ToolCallId(randomUUID())
    const sessionId = SessionId(randomUUID())
    let handle: AgentHandle | undefined
    const started = performance.now()
    try {
      handle = await this.ctx.agents.create({
        sessionId,
        meta: { cwd: this.config.workspace, agentPreset: entry.preset },
        signal,
        setup: async (agentCtx) => { await this.ctx.agentPresets.mount(agentCtx, entry.preset) },
      })
      const agent = handle.agent
      if (this.ctx.tools.schemas(agent).some(schema => schema.name === 'run_code')) {
        throw new InvocationError('UNSUPPORTED_PRESENTATION_MODE', 'External capability calls require a native tool preset')
      }
      const actual = this.ctx.tools.get(entry.name, agent)
      if (actual === undefined || declarationDigest({
        name: actual.name, description: actual.description, parameters: actual.parameters, outputSchema: actual.output.schema,
      }) !== entry.digest) {
        throw new InvocationError('CAPABILITY_METADATA_STALE', `The declaration for ${entry.name} does not match the loaded tool`)
      }
      // Restriction is installed on the real invocation scope, never on its shared preset.
      agent.ctx.tools.guard(exec => exec.name === entry.name ? undefined : 'Only the admitted external capability may execute')
      agent.session.append('mcp/invocation-start', { callId, tool: entry.name, preset: entry.preset,
        declarationDigest: entry.digest, arguments: args as JsonValue })
      let outcome: ToolExecutionResult | undefined
      let result: CallToolResult
      let state: 'observed' | 'failed' | 'unknown'
      try {
        outcome = await this.ctx.tools.execute({ callId, name: entry.name, arguments: args, agent, signal })
        result = invocationResult(outcome, {
          sessionId, callId, preset: entry.preset, elapsedMs: performance.now() - started,
        }, this.config.resultMaxBytes)
        state = outcome.isError && outcome.error.info?.code === 'ABORTED' ? 'unknown' : result.isError === true ? 'failed' : 'observed'
      } catch (error: unknown) {
        state = 'unknown'
        result = failureResult('EXECUTION_FAILED', error instanceof Error ? error.message : 'Execution did not return a settled result', this.config.resultMaxBytes,
          { sessionId, callId, preset: entry.preset, elapsedMs: performance.now() - started })
      }
      const elapsedMs = performance.now() - started
      agent.session.append('mcp/invocation-end', { callId, isError: result.isError === true, state,
        code: result.isError === true ? typeof result._meta?.code === 'string' ? result._meta.code : 'TOOL_FAILED' : null,
        value: result.isError === true || outcome === undefined || outcome.isError ? null : outcome.value, elapsedMs })
      if (!await this.ctx.sessions.flush(agent.session)) throw new InvocationError('AUDIT_UNAVAILABLE', 'Session persistence is required for external calls')
      return { outcome, result, sessionId, callId, preset: entry.preset, elapsedMs }
    } finally {
      if (handle !== undefined) await handle.dispose()
    }
  }

  /** Stop admission, cancel calls, then drain calls and shared mounts before Host teardown. */
  async dispose(): Promise<void> {
    this.lifetime.abort(new InvocationError('HOST_STOPPING', 'The DSH capability server is stopping'))
    const loads = [...this.groups.values()].flatMap(group => group.loading === undefined ? [] : [group.loading])
    await Promise.allSettled([...this.calls, ...loads])
  }
}
