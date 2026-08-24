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
import { COMMAND_PROFILES_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-command-profile'
import { runtimeAwarenessHarness, finalText, waitForIdle } from './harness.ts'

/**
 * Model behavior eval for the Command Knowledge Plane (V2). These scenarios
 * test whether a REAL model, facing the knowledge plane, maps an ability to a
 * candidate executable name and then verifies presence with authoritative
 * runtime inspection instead of guessing:
 *
 *   Ability → candidate → inspect confirms (never treat candidate as installed).
 *   User-defined profile → retrievable → inspect confirms.
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

/** Whether the eval's LLM credential is available (same self-skip as the V1 eval). */
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

async function bootAgent(): Promise<{ agent: Agent; ctx: Context }> {
  workdir = await mkdtemp(join(tmpdir(), 'dsh-cp-behavior-'))
  ctx = await runtimeAwarenessHarness(workdir, {
    persona: PERSONA,
    provider: PROVIDER,
    apiKeyEnv: API_KEY_ENV,
    ...BASE_URL === undefined ? {} : { baseURL: BASE_URL },
    model: MODEL,
  })
  const agent = ctx.agentLoop.create(SessionId('cp-behavior'), { provider: PROVIDER, model: MODEL })
  return { agent, ctx }
}

async function turn(agent: Agent, agentText: string): Promise<SessionEvent[]> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text: agentText }], source: { kind: 'user' } }))
  await waitForIdle(ctx!, agent)
  return [...agent.session.events]
}

describe.skipIf(!credentialAvailable)('command profile model behavior', () => {
  it('maps an ability to a candidate, then inspects before treating it as installed', async () => {
    const { agent } = await bootAgent()
    const events = await turn(agent,
      'I want to use the GitHub CLI to inspect a pull request in this repository. '
      + 'Look up which executable the GitHub CLI capability maps to, then verify that executable '
      + 'with the authoritative runtime inspection tool before reporting whether you can use it.',
    )

    const calls = toolCalls(events)
    const lookup = calls.find(call => call.name === 'command_profile')
    expect(lookup, 'expected a command_profile lookup').toBeDefined()
    expect(String(lookup!.args.query).toLowerCase()).toMatch(/github|gh/)

    const inspect = calls.find(call => call.name === 'runtime_inspect')
    expect(inspect, 'expected a runtime_inspect call after the profile lookup').toBeDefined()
    expect(inspect!.args.kind).toBe('command')
    expect(String(inspect!.args.command).toLowerCase()).toContain('gh')
  }, 120_000)

  it('retrieves a user-defined profile and inspects its candidate', async () => {
    const { agent, ctx } = await bootAgent()
    // Assemble a user-defined profile through the settings plane, then ask the
    // model to use it; the profile is only retrievable through command_profile.
    await ctx.settings.update(COMMAND_PROFILES_SETTINGS_NAMESPACE, {
      profiles: [{
        id: 'my-feishu',
        displayName: 'My Feishu CLI',
        description: 'My Feishu automation CLI',
        aliases: ['feishu-sync'],
        tags: ['feishu', 'automation'],
        candidates: ['feishu-sync'],
      }],
    })
    const events = await turn(agent,
      'I defined a profile called my-feishu for my Feishu automation CLI. '
      + 'Look it up, report its candidate executable, and verify that executable '
      + 'with the authoritative runtime inspection tool.',
    )

    const calls = toolCalls(events)
    const lookup = calls.find(call => call.name === 'command_profile')
    expect(lookup, 'expected a command_profile lookup for the user profile').toBeDefined()
    expect(String(lookup!.args.query).toLowerCase()).toMatch(/feishu/)

    const inspect = calls.find(call => call.name === 'runtime_inspect')
    expect(inspect, 'expected a runtime_inspect call for the user profile candidate').toBeDefined()
    expect(inspect!.args.kind).toBe('command')
    expect(String(inspect!.args.command).toLowerCase()).toContain('feishu-sync')

    const text = finalText(events).toLowerCase()
    expect(text).toContain('feishu-sync')
  }, 120_000)
})
