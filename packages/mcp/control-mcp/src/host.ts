/** Opt-in Host adapter exposing a narrow run-bound control route. */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { DshControlPlane, type ControlRequest } from './control-plane.ts'
import { ControlAttentions } from './attention.ts'
import { captureRuntimeIdentity } from './runtime.ts'

export const name = 'dsh-control-mcp-host'
export const inject = ['connection', 'sessionController', 'agents']

export interface Config {
  /** Exact validation-run identity accepted by this Host adapter. */
  readonly runId: string
  /** Maximum idempotent write receipts retained for this process run. */
  readonly maxWriteReceipts?: number
}

export const Config: Schema<Config> = Schema.object({
  runId: Schema.string().required(),
  maxWriteReceipts: Schema.natural().min(2).max(4096).default(256),
})

interface OptionalBrowser {
  instances(): Promise<readonly Readonly<Record<string, unknown>>[]>
  execute(
    operation: {
      readonly sessionId: string
      readonly installationId: string
      readonly action: Readonly<{ readonly kind: string; readonly [key: string]: unknown }>
    },
    signal: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>>
}

interface OptionalCordisRunner {
  inventory(): readonly Readonly<Record<string, unknown>>[]
}

/** Register the exact POST route behind the existing Connection authentication fence. */
export function apply(ctx: Context, config: Config): void {
  if (typeof config.runId !== 'string' || config.runId.length === 0) {
    throw new Error('dsh-control-mcp-host: runId must be a non-empty string')
  }
  const browser = ctx.get('browser') as OptionalBrowser | undefined
  const cordis = ctx.get('dynamicCordisRunner') as OptionalCordisRunner | undefined
  const attention = new ControlAttentions()
  const runtime = captureRuntimeIdentity()
  void runtime.catch(() => {})
  const plane = new DshControlPlane({
    runId: config.runId,
    runtime: () => runtime,
    maxWriteReceipts: config.maxWriteReceipts ?? 256,
    sessions: {
      create: request => ctx.sessionController.create(request as never),
      prompt: (request, signal) => ctx.sessionController.prompt(request as never, signal),
      cancel: request => ctx.sessionController.cancel(request as never),
      inspect: (sessionId, signal) => ctx.sessionController.inspect(sessionId as never, signal) as never,
      getAgent: sessionId => ctx.agents.get(sessionId as never),
      subscribe: (sessionId, notify) => {
        const offEvent = ctx.on('session/event', (session) => { if (String(session.id) === sessionId) notify() })
        const offStatus = ctx.on('agent/status', ({ agent }) => { if (String(agent.id) === sessionId) notify() })
        return () => { offEvent(); offStatus() }
      },
    },
    ...(browser === undefined ? {} : { browser }),
    attention,
    ...(cordis === undefined ? {} : { cordis }),
  })
  ctx.on('user-questions/request', (request, next) => {
    const sessionId = plane.boundSessionId()
    const agent = request.agent
    if (sessionId === undefined || agent === undefined || String(agent.id) !== sessionId
      || ctx.agents.get(agent.id) !== agent) return next()
    return attention.ask(sessionId, request)
  }, { prepend: true })
  ctx.effect(() => () => {
    attention.dispose()
  }, 'dsh-control-mcp.attention')
  const connection = ctx.get('connection') as HostConnectionHandle
  connection.rpc.handle('/dsh-control', (endpoint, payload, signal) =>
    handleRequest(plane, endpoint, payload, signal))
}

async function handleRequest(
  plane: DshControlPlane,
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
) {
  if (endpoint !== 'invoke') {
    return { ok: false as const, error: { code: 'not-found', message: 'unknown control endpoint', details: {} } }
  }
  let parsed: ControlRequest
  try {
    parsed = parseRequest(payload)
  } catch (error: unknown) {
    return {
      ok: false as const,
      error: { code: 'bad-request', message: error instanceof Error ? error.message : String(error), details: {} },
    }
  }
  try {
    return { ok: true as const, value: await plane.handle(parsed, signal) }
  } catch (error: unknown) {
    const cancelled = signal.aborted
    return {
      ok: false as const,
      error: {
        code: cancelled ? 'cancelled' : 'rejected',
        message: error instanceof Error ? error.message : String(error),
        details: {},
      },
    }
  }
}

const METHODS = new Set<ControlRequest['method']>([
  'runtime_status', 'request_receipt',
  'session_open', 'session_prompt', 'session_wait', 'session_events', 'session_observe', 'session_attention_answer', 'session_cancel', 'cordis_inspect',
  'browser_instances', 'browser_tabs', 'browser_snapshot', 'evidence_export',
  'browser_entry_inspect',
])

function parseRequest(value: unknown): ControlRequest {
  if (!isRecord(value)
    || typeof value.runId !== 'string' || value.runId.length === 0
    || typeof value.requestId !== 'string' || value.requestId.length === 0
    || typeof value.method !== 'string' || !METHODS.has(value.method as ControlRequest['method'])
    || !isRecord(value.params)) {
    throw new Error('control request must contain runId, requestId, a supported method, and object params')
  }
  return value as unknown as ControlRequest
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
