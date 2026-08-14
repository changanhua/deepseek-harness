/**
 * @deepseek-ai/dsh-headless — one-shot direct Agent driver. The bundle patch
 * rides over dsh-base without Host, HTTP, or browser plugins; this runner
 * creates (or resumes) one Agent through the core registry, drives the task to
 * quiescence, flushes its Session, prints the final assistant text, and exits.
 * `--list` short-circuits to the session-query corpus and prints its records.
 *
 * @module @deepseek-ai/dsh-headless
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Empty type imports carry the loader Context merge for the settlement await
// and the cmdline Context merge for the appExit host value.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'headless-runner'

/** Core services required before the one-shot turn can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config: the task resolved from this app's injected provider service. */
export interface Config {
  /** The prompt text for the single run (positional or piped stdin). */
  task?: string
  /** Model name override; the default provider is kept. */
  model?: string
  /** Persisted session id to resume instead of creating a new session. */
  resume?: string
  /** List sessions and exit instead of running a task. */
  list?: boolean
}

export const Config: z<Config> = z.object({
  // Schemastery fields default to optional; only `task` was required before.
  task: z.string(),
  model: z.string(),
  resume: z.string(),
  list: z.boolean(),
})

/** Outcome of one owned run interval. */
interface RunOutcome {
  text: string
  reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
}

/** Process-facing effects of one run: output streams plus the launcher's bounded exit request. */
interface HeadlessIo {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

/**
 * Minimal structural surface of `ctx.sessionQuery` for `--list`. Kept local so
 * this bundle needs no dependency on the session-query service definition.
 */
interface SessionQuerySurface {
  listSessions(signal?: AbortSignal): Promise<readonly { header: { id: string } }[]>
  readTitleSnapshots(ids: readonly string[]): Promise<readonly ({
    status: 'fulfilled'
    value: { session: { id: string }; title?: { title: string } }
  } | {
    status: 'rejected'
    reason: unknown
  })[]>
}

/** The process streams the runner writes to; tests substitute captures. */
export const internals: { stdout: HeadlessIo['stdout']; stderr: HeadlessIo['stderr'] } = {
  stdout: process.stdout,
  stderr: process.stderr,
}

/** Aggregate the last assistant text and turn outcome in one owned interval. */
function summarize(events: readonly SessionEvent[], firstSeq: number): RunOutcome {
  let started = false
  let text = ''
  let reason: SessionEvent<'turn/end'>['data']['reason'] | undefined
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'turn/start') {
      started = true
      continue
    }
    if (!started) continue
    if (event.type === 'assistant/message') {
      const joined = event.data.message.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
      if (joined !== '') text = joined
    }
    if (event.type === 'turn/end') reason = event.data.reason
  }
  return { text, reason }
}

/** Report an unexpected direct-driver failure and request a failing exit. */
function fail(io: HeadlessIo, error: unknown): void {
  io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
  io.exit(1)
}

/** Print one `id<TAB>title` line per listed session and request a clean exit. */
async function listSessions(ctx: Context, io: HeadlessIo): Promise<void> {
  const sessionQuery = ctx.get('sessionQuery') as SessionQuerySurface | undefined
  if (sessionQuery === undefined) {
    fail(io, new Error('headless-runner: --list requires the session-query service, which this composition does not provide'))
    return
  }
  try {
    const records = await sessionQuery.listSessions()
    const observations = await sessionQuery.readTitleSnapshots(records.map(record => record.header.id))
    for (const observation of observations) {
      if (observation.status !== 'fulfilled') continue
      const { session, title } = observation.value
      io.stdout.write(`${session.id}\t${title === undefined ? '' : title.title}\n`)
    }
    io.exit(0)
  } catch (error) {
    fail(io, error)
  }
}

/**
 * Run one task through a freshly created (or resumed) Agent and request
 * process exit.
 * @param ctx - plugin context carrying the Agent, default model, Session, and launcher IO services.
 * @param config - validated run config: task plus optional model/resume/list.
 * @param io - process-facing effects.
 */
async function run(ctx: Context, config: Config, io: HeadlessIo): Promise<void> {
  // Loader siblings mount concurrently. Await the complete application before
  // creating an Agent so its scoped tools and adapters are not half-composed.
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  // Early process shutdown can dispose the tree while settlement is pending.
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return

  if (config.list === true) {
    await listSessions(ctx, io)
    return
  }

  const task = config.task?.trim() ?? ''
  if (task === '') {
    fail(io, new Error('headless-runner: a non-empty task is required'))
    return
  }

  const selection = defaultModel.currentSelection()
  const model = config.model ?? selection.model
  // This bundle composes no preset roster, so the model-facing rows sit in the
  // host plane and the agent reads them from the global layer. A deployment
  // that DOES configure one has to join it here first
  // (@deepseek-ai/dsh-agent-presets README, "Composing a child agent").
  const selected: ModelSelectionRef = {
    current: { provider: selection.provider, model },
    assembled: undefined,
  }
  const setup = (agentCtx: Context): void => {
    installModelSelection(agentCtx, selected)
  }
  const agentOptions = { provider: selection.provider, model }
  const handle = config.resume === undefined
    ? await agents.create({
      sessionId: SessionId(`session-${randomUUID()}`),
      meta: { cwd: process.cwd() },
      agentOptions,
      setup,
    })
    : await agents.resume({
      resumeSessionId: SessionId(config.resume),
      agentOptions,
      setup,
    })
  const agent = handle.agent
  await agent.whenIdle()
  const firstSeq = agent.session.seq
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: task }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
  await sessions.flush(agent.session)
  const outcome = summarize(agent.session.events, firstSeq)
  io.stdout.write(outcome.text + '\n')
  if (outcome.reason?.kind === 'error') {
    io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`)
  }
  io.exit(outcome.reason?.kind === 'completed' ? 0 : 1)
}

/**
 * Mount the one-shot direct driver.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated task config.
 */
export function apply(ctx: Context, config: Config): void {
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('headless-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: HeadlessIo = { stdout: internals.stdout, stderr: internals.stderr, exit }
  void run(ctx, config, io).catch((error: unknown) => { fail(io, error) })
}
