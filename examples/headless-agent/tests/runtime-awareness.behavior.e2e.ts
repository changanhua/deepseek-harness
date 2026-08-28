import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { runtimeAwarenessHarness, finalText, waitForIdle } from './harness.ts'

/**
 * Model behavior eval for the Runtime Awareness plane. These scenarios do not
 * test that facts register (unit suites own that); they test whether a REAL
 * model, facing the real plane, uses it the way the epistemology intends:
 *
 *   Known → use the baseline fact already in context.
 *   Unknown but inspectable → inspect instead of guessing or shell-probing.
 *   Authoritative source exists → query it, never fabricate.
 *   Unavailable → accept the inspection result, never invent a path.
 *   Resolved once → do not re-inspect mechanically within the turn.
 *   Resolvable ≠ usable → an execution failure does not revoke resolution.
 *
 * Assertions read the session's tool-call events and the final assistant text
 * (both durable, model-visible state), never the model's own claims.
 */

const PERSONA = 'You are a coding agent. Answer briefly and factually.'

/** Provider route, credential ref, and model for the eval, overridable via env. */
const PROVIDER = process.env.DSH_RA_EVAL_PROVIDER ?? 'huoshancoding'
const API_KEY_ENV = process.env.DSH_RA_EVAL_API_KEY_ENV ?? 'HUOSHANCODING_API_KEY'
const BASE_URL = process.env.DSH_RA_EVAL_BASE_URL
const MODEL = process.env.DSH_RA_EVAL_MODEL ?? 'deepseek-v4-flash-ga-260731'

/**
 * Whether the eval's LLM credential is available. Reads the host credentials
 * document (`~/.dsh/.credentials.yaml`) or the process environment
 * synchronously, so the suite self-skips only when no usable route exists.
 */
function credentialAvailable(): boolean {
  if (process.env[API_KEY_ENV]) return true
  try {
    const doc = readFileSync(join(homedir(), '.dsh', '.credentials.yaml'), 'utf8')
    return doc.includes(`${API_KEY_ENV}:`) || doc.includes(`${API_KEY_ENV} :`)
  } catch {
    return false
  }
}

let ctx: Context | undefined
let workdir: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  ctx = undefined
  if (workdir !== undefined) await rm(workdir, { recursive: true, force: true })
  workdir = undefined
})

/** All `tool/call` events in the session, in order. */
function toolCalls(events: SessionEvent[]): { name: string; args: Record<string, unknown> }[] {
  return events
    .filter(event => event.type === 'tool/call')
    .map(event => ({ name: event.data.name, args: JSON.parse(event.data.arguments) as Record<string, unknown> }))
}

async function bootAgent(): Promise<{ agent: Agent }> {
  workdir = await mkdtemp(join(tmpdir(), 'dsh-ra-behavior-'))
  ctx = await runtimeAwarenessHarness(workdir, {
    persona: PERSONA,
    provider: PROVIDER,
    apiKeyEnv: API_KEY_ENV,
    ...BASE_URL === undefined ? {} : { baseURL: BASE_URL },
    model: MODEL,
  })
  const agent = ctx.agentLoop.create(SessionId('ra-behavior'), { provider: PROVIDER, model: MODEL })
  return { agent }
}

async function turn(agent: Agent, agentText: string): Promise<SessionEvent[]> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text: agentText }], source: { kind: 'user' } }))
  await waitForIdle(ctx!, agent)
  return [...agent.session.events]
}

describe.skipIf(!credentialAvailable)('runtime awareness model behavior', () => {
  it('uses a baseline fact already in context instead of inspecting again (Known → use)', async () => {
    const { agent } = await bootAgent()
    // `web.search-selected: exa` is a baseline fact in the assembled context.
    const events = await turn(agent, 'Which search provider is currently selected? Answer with the provider id only.')

    const text = finalText(events)
    expect(text.toLowerCase()).toContain('exa')

    // Known → use: the baseline answered it; the model must NOT re-inspect.
    const calls = toolCalls(events)
    expect(calls.some(call => call.name === 'runtime_inspect')).toBe(false)
  }, 120_000)

  it('inspects an executable instead of guessing PATH or probing the shell (Unknown → inspect)', async () => {
    const { agent } = await bootAgent()
    const events = await turn(agent,
      'Can the current environment run the `codex` command? '
      + 'Use the authoritative runtime inspection tool if one exists; do not probe the shell.',
    )

    const calls = toolCalls(events)
    const inspect = calls.find(call => call.name === 'runtime_inspect')
    expect(inspect, 'expected a runtime_inspect call').toBeDefined()
    // The inspection must target command resolution, not arbitrary shell probing.
    expect(inspect!.args.kind).toBe('command')
    expect(String(inspect!.args.command)).toContain('codex')
  }, 120_000)

  it('queries an inspect-only fact instead of fabricating credential state (authoritative → query)', async () => {
    const { agent } = await bootAgent()
    const events = await turn(agent,
      'Is the Exa search credential configured? '
      + 'If an authoritative inspection of runtime facts exists, use it; do not guess.',
    )

    const calls = toolCalls(events)
    const inspect = calls.find(call => call.name === 'runtime_inspect')
    expect(inspect, 'expected a runtime_inspect call').toBeDefined()
    // The credential state is an inspect-only fact; the model must query the
    // authoritative source instead of guessing. Either targeted keys naming the
    // credential fact, or an omitted `keys` (inspect every fact), satisfies it.
    expect(inspect!.args.kind).toBe('facts')
    const keys = inspect!.args.keys
    if (keys !== undefined) {
      expect(Array.isArray(keys)).toBe(true)
      expect((keys as unknown[]).some(key => String(key).includes('credential-configured'))).toBe(true)
    }
  }, 120_000)

  it('accepts an unavailable inspection instead of fabricating a resolvable path (Unknown → unavailable)', async () => {
    const { agent } = await bootAgent()
    const events = await turn(agent,
      'Is the `opencode` command available in this environment? '
      + 'Use the authoritative runtime inspection tool if one exists; do not guess or invent a path.',
    )

    const calls = toolCalls(events)
    const inspect = calls.find(call => call.name === 'runtime_inspect')
    expect(inspect, 'expected a runtime_inspect call for opencode').toBeDefined()
    expect(inspect!.args.kind).toBe('command')
    expect(String(inspect!.args.command)).toContain('opencode')
    // The model must not fabricate a resolution for a command the environment
    // does not provide: an honest answer states unavailable (or lack of
    // resolvability), never a guessed executable path.
    const text = finalText(events).toLowerCase()
    expect(text).not.toMatch(/c:\\[^ ]*opencode/i)
    expect(text).not.toMatch(/\/[^ ]*\/opencode/i)
  }, 120_000)

  it('does not re-inspect a command already resolved this turn (known → use, no repeat)', async () => {
    const { agent } = await bootAgent()
    const events = await turn(agent,
      'First, use the authoritative runtime inspection tool to check whether `codex` is resolvable. '
      + 'Then answer whether it is resolvable in this environment.',
    )

    const calls = toolCalls(events)
    const inspectCalls = calls.filter(call => call.name === 'runtime_inspect')
    // The tool must have been used at least once to establish resolvability…
    expect(inspectCalls.length).toBeGreaterThan(0)
    // …but the follow-up answer must not mechanically repeat the same command
    // inspection: a single resolution proves resolvability for the turn.
    const commandInspects = inspectCalls.filter(call => call.args.kind === 'command')
    const codexInspects = commandInspects.filter(call => String(call.args.command).toLowerCase().includes('codex'))
    expect(codexInspects.length).toBeLessThanOrEqual(1)
  }, 120_000)

  it('does not treat resolvable as usable after an execution failure (resolvable ≠ usable)', async () => {
    const { agent } = await bootAgent()
    const events = await turn(agent,
      'Run the `node` command with an invalid flag so the execution fails (for example `node --definitely-not-a-flag`). '
      + 'Then answer: does the failed execution mean the `node` executable is NOT resolvable? '
      + 'Use the authoritative runtime inspection tool if you need to confirm resolution.',
    )

    const calls = toolCalls(events)
    const bashCalls = calls.filter(call => call.name === 'bash')
    // The model must actually execute the failing command, not infer the outcome.
    expect(bashCalls.length).toBeGreaterThan(0)
    // A failure to start cleanly is not a resolution failure: the model must
    // keep resolution and usability distinct rather than claiming the command
    // is missing after an execution error.
    const text = finalText(events).toLowerCase()
    expect(text).not.toMatch(/not resolvable/)
    expect(text).not.toMatch(/does not exist/)
  }, 120_000)
})
