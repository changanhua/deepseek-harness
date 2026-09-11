import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { afterEach, describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as ToolSubagent from '../src/index.ts'
import { mountScriptedProvider } from './scripted-provider.ts'

const contexts: Context[] = []
const roots: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** Load the production tool through Cordis; only model and child responses are scripted. */
async function boot(mode: 'current' | 'changed' | 'cancelled') {
  const root = await mkdtemp(join(tmpdir(), 'dsh-foreground-relay-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions') })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await mountScriptedProvider(ctx, {
    name: 'external-fixture',
    reply: 'external-result-v1',
    onStart: ({ parent }) => {
      if (mode === 'changed') parent.steer(createUserMessage({ content: [{ type: 'text', text: 'new-input-v2' }], source: { kind: 'user' } }))
      if (mode === 'cancelled') parent.cancel({ kind: 'user' })
    },
  })
  const adapter = new MockAdapter([
    toolCallResponse('external-call-1', 'external_delegate', { description: 'get an external view', prompt: 'input-v1' }),
    textResponse('parent-continued'),
  ])
  ctx.llm.registerAdapter(['fixture'], adapter)
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-tool-subagent'",
    '  config:',
    '    provider: external-fixture',
    '    toolName: external_delegate',
    '    enableRunInBackground: false',
    '',
  ].join('\n'))
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (specifier === '@deepseek-ai/dsh-tool-subagent') return ToolSubagent
      throw new Error(`unexpected fixture import: ${specifier}`)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const handle = await ctx.agents.create({ sessionId: SessionId(`parent-${mode}`), agentOptions: { provider: 'fixture', model: 'fixture' } })
  return { ctx, adapter, agent: handle.agent }
}

describe('foreground relay through the real Loader and parent loop', () => {
  it.each(['current', 'changed', 'cancelled'] as const)('records and resumes the correct parent: %s', async (mode) => {
    const { ctx, adapter, agent } = await boot(mode)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'start-input-v1' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    await ctx.sessions.flush(agent.session)
    const stored = await ctx.sessionPersistence.load(agent.session.id)
    const calls = stored.events.filter(event => event.type === 'tool/call')
    const results = stored.events.filter(event => event.type === 'tool/result')
    expect(calls).toHaveLength(1)
    expect(results).toHaveLength(1)
    expect(results[0]?.data.message.source.callId).toBe('external-call-1')
    expect(stored.events.some(event => event.type === 'subagent/foreground-input')).toBe(true)
    const resultText = JSON.stringify(results[0]?.data.message.content)
    if (mode === 'current') {
      expect(adapter.requests).toHaveLength(2)
      expect(results[0]?.data.message.content[0].isError).toBe(false)
      expect(resultText).toContain('external-result-v1')
      expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('external-result-v1')
    } else if (mode === 'changed') {
      expect(adapter.requests).toHaveLength(2)
      expect(results[0]?.data.message.content[0].isError).toBe(true)
      expect(resultText).not.toContain('external-result-v1')
      expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('new-input-v2')
      expect(JSON.stringify(adapter.requests[1]?.messages)).not.toContain('external-result-v1')
      expect(stored.events.some(event => event.type === 'subagent/foreground-stale')).toBe(true)
    } else {
      expect(adapter.requests).toHaveLength(1)
      expect(results[0]?.data.message.content[0].isError).toBe(true)
      expect(stored.events.some(event => event.type === 'assistant/message'
        && JSON.stringify(event.data).includes('parent-continued'))).toBe(false)
    }
  })
})
