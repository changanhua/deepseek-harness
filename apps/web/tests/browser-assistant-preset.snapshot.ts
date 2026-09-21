import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  assertFixtureInventory,
  fixtureUserPrompts,
  launchWebScaffold,
  recordFixture,
  selectedSessionFixture,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/browser-assistant-preset', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const MODE = webSnapshotMode()
const PROMPT = 'Reply exactly BROWSER_ASSISTANT_PRESET_READY and stop. Do not call any tools.'

/** The exact system prompt projected into model history for this Session. */
function systemPromptText(session: Session): string | undefined {
  const message = session.deriveMessages().find(candidate => candidate.role === 'system')
  return message?.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
}

describe('browser assistant preset model context', () => {
  let scaffold: WebScaffold
  let agentHandle: AgentHandle

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      compareReplaySession: true,
      paceMs: 10,
      ...MODE === 'record' ? {} : { replayFixture: FIXTURE },
    })
    agentHandle = await scaffold.ctx.agents.create({
      sessionId: SessionId('browser-assistant-preset-snapshot'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'browser-assistant' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'browser-assistant').then(() => undefined),
    })
    agentHandle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: PROMPT }],
      source: { kind: 'user' },
    }))
    await agentHandle.agent.whenIdle()
    if (MODE === 'record') await recordFixture(scaffold, agentHandle.agent.session.id, FIXTURE)
  }, 180_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await agentHandle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'browser assistant preset snapshot teardown failed')
  })

  it('persists the Loader-composed prompt and complete runtime tool catalog in the model request', async () => {
    if (MODE !== 'record') {
      const selected = await selectedSessionFixture(FIXTURE)
      expect(fixtureUserPrompts(await readFile(selected, 'utf8'))).toEqual([PROMPT])
    }

    const session = agentHandle.agent.session
    const requestHeader = session.requestHeader()
    if (requestHeader === undefined) throw new Error('the browser assistant issued no model request')
    const prompt = systemPromptText(session)
    if (prompt === undefined) throw new Error('the browser assistant issued no system prompt')

    const events = session.snapshotEvents()
    const persistedHeader = events.find(event => event.type === 'request/header')
    const persistedSystem = events.find(event => event.type === 'system/message')
    if (persistedHeader?.type !== 'request/header') throw new Error('the model request header was not persisted')
    if (persistedSystem?.type !== 'system/message') throw new Error('the system prompt was not persisted')

    expect(persistedHeader.data.header).toEqual(requestHeader)
    expect(persistedSystem.data.message.content
      .flatMap(block => block.type === 'text' ? [block.text] : []).join('')).toBe(prompt)
    expect(persistedSystem.data.message.source).toMatchObject({
      kind: 'plugin',
      plugin: '@deepseek-ai/dsh-system-prompt',
    })
    expect(requestHeader.tools?.toSorted((left, right) => left.name.localeCompare(right.name)))
      .toEqual(scaffold.ctx.tools.schemas(agentHandle.agent).toSorted((left, right) => left.name.localeCompare(right.name)))
    expect(scaffold.ctx.commands.find(agentHandle.agent, 'compact')).toBeDefined()
    expect(scaffold.ctx.agentPresets.serviceFor(agentHandle.agent, 'compaction')).toBeDefined()
    expect(scaffold.ctx.agentPresets.serviceFor(agentHandle.agent, 'toolResultPruner')).toBeDefined()

    const assistantText = session.deriveMessages()
      .filter(message => message.role === 'assistant')
      .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
      .join('')
    expect(assistantText).toBe('BROWSER_ASSISTANT_PRESET_READY')
  })

  // Refresh writes header pins while scaffold.close() drains in afterAll, so
  // inventory is meaningful only after that refresh has completed.
  it.skipIf(MODE !== 'replay')('keeps the recorded scenario inventory complete', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'session.v3.jsonl',
      'system-prompt.expected.md',
      'tool-schemas.expected.json',
    ])
  })
})
