/**
 * Runtime awareness snapshot: the model-visible `web.search-selected` fact is
 * a durable user-role snapshot on the session, not a live re-projection.
 *
 * The scenario proves the four obligations of the runtime-awareness seam:
 * 1. the first turn's request carries the baseline provider id (exa);
 * 2. a settings hot update to perplexity reaches the NEXT request;
 * 3. the runtime context is committed to the session log as a
 *    `@deepseek-ai/dsh-system-prompt` user/message (model-visible ⟺ logged);
 * 4. after live settings swing back to exa, `session.deriveMessages()` replay
 *    still reconstructs the HISTORICAL perplexity snapshot instead of
 *    re-deriving exa from the current settings.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import RuntimeFacts from '@deepseek-ai/dsh-runtime-facts'
import WebRuntime, { WEB_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchResult } from '@deepseek-ai/dsh-web'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { Message, UserMessage } from '@deepseek-ai/dsh-llm'

import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { MockAdapter, textResponse } from './mock-adapter.ts'

/** In-memory settings provider: updates land on a live document. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** A search provider that never touches the network. */
function mockSearchProvider(id: string): WebSearchProvider {
  return {
    id,
    available: () => true,
    search: async (): Promise<WebSearchResult> => ({ sources: [], truncated: false }),
  }
}

/** Wait for the agent's next transition to idle after a waking send. */
function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

function send(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}

/** All owned runtime-context snapshot messages committed to the session. */
function ownedRuntimeContexts(agent: Agent): UserMessage[] {
  return agent.session.events.flatMap((event) => {
    if (event.type !== 'user/message') return []
    const data = event.data
    if (data.source.kind !== 'plugin' || data.source.plugin !== '@deepseek-ai/dsh-system-prompt') return []
    return [data]
  })
}

/** The plain text of one owned runtime-context snapshot. */
function contextText(message: UserMessage): string | undefined {
  const [block] = message.content
  return block?.type === 'text' ? block.text : undefined
}

/** The selected provider id inside one rendered snapshot, or undefined. */
function selectedProviderOf(text: string | undefined): string | undefined {
  const match = /^- web\.search-selected: (\S+)$/m.exec(text ?? '')
  return match?.[1]
}

/** Every model-visible message (replay) that belongs to the runtime-context owner. */
function replayRuntimeContexts(messages: Message[]): Message[] {
  return messages.filter(message =>
    message.source.kind === 'plugin' && message.source.plugin === '@deepseek-ai/dsh-system-prompt')
}

async function harness(adapter: MockAdapter): Promise<{ ctx: Context; agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(RuntimeFacts, {})
  // Baseline preference starts at exa; hot updates flow through the settings
  // document and the fact re-projects on the next request.
  await ctx.plugin(WebRuntime, { searchProvider: 'exa' })
  await ctx.plugin(MemorySettings)
  ctx.llm.registerAdapter(['mock'], adapter)
  // The `web_search` tool must be visible so the runtime-facts relevance filter
  // admits the `web.search-selected` fact into the assembly scope.
  ctx.tools.register(defineContentToolFixture({
    name: 'web_search',
    description: 'search the web',
    parameters: {},
    async execute() {
      return [{ type: 'text', text: 'no results' }]
    },
  }))
  ctx.web.registerSearchProvider(mockSearchProvider('exa'))
  ctx.web.registerSearchProvider(mockSearchProvider('perplexity'))
  const agent = ctx.agentLoop.create(SessionId('runtime-awareness-snapshot'), {
    provider: 'mock',
    model: 'mock',
  })
  return { ctx, agent }
}

describe('runtime awareness snapshot', () => {
  it('materializes the baseline provider as a durable system-prompt user/message the model sees', async () => {
    const adapter = new MockAdapter([textResponse('first')])
    const { ctx, agent } = await harness(adapter)

    send(agent, 'use the web')
    await waitForIdle(ctx, agent)

    // The model saw the baseline fact in its request history.
    const requestMessages = adapter.requests[0]!.messages
    const requestText = JSON.stringify(requestMessages)
    expect(requestText).toContain('web.search-selected: exa')

    // The same fact is committed to the session as an owned snapshot.
    const snapshots = ownedRuntimeContexts(agent)
    expect(snapshots).toHaveLength(1)
    expect(selectedProviderOf(contextText(snapshots[0]!))).toBe('exa')

    await ctx.fiber.dispose()
  })

  it('propagates a settings hot update to the next request and logs the new snapshot', async () => {
    const adapter = new MockAdapter([textResponse('first'), textResponse('second')])
    const { ctx, agent } = await harness(adapter)

    send(agent, 'use the web')
    await waitForIdle(ctx, agent)

    await ctx.settings.update(WEB_SETTINGS_NAMESPACE, { searchProvider: 'perplexity' })
    send(agent, 'again')
    await waitForIdle(ctx, agent)

    // The second request saw perplexity; the first still recorded exa.
    expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('web.search-selected: perplexity')
    const snapshots = ownedRuntimeContexts(agent)
    expect(snapshots).toHaveLength(2)
    expect(selectedProviderOf(contextText(snapshots[0]!))).toBe('exa')
    expect(selectedProviderOf(contextText(snapshots[1]!))).toBe('perplexity')

    await ctx.fiber.dispose()
  })

  it('replays the historical perplexity snapshot after live settings swing back to exa', async () => {
    const adapter = new MockAdapter([textResponse('first'), textResponse('second'), textResponse('third')])
    const { ctx, agent } = await harness(adapter)

    send(agent, 'first')
    await waitForIdle(ctx, agent)
    await ctx.settings.update(WEB_SETTINGS_NAMESPACE, { searchProvider: 'perplexity' })
    send(agent, 'second')
    await waitForIdle(ctx, agent)
    await ctx.settings.update(WEB_SETTINGS_NAMESPACE, { searchProvider: 'exa' })
    send(agent, 'third')
    await waitForIdle(ctx, agent)

    // Live re-projection now yields exa on the next request...
    expect(JSON.stringify(adapter.requests[2]!.messages)).toContain('web.search-selected: exa')

    // ...but the durable history records all three snapshots, and replay
    // reconstructs the middle perplexity snapshot verbatim rather than
    // re-deriving it from the current settings.
    const snapshots = ownedRuntimeContexts(agent)
    expect(selectedProviderOf(contextText(snapshots[0]!))).toBe('exa')
    expect(selectedProviderOf(contextText(snapshots[1]!))).toBe('perplexity')
    expect(selectedProviderOf(contextText(snapshots[2]!))).toBe('exa')

    const replay = replayRuntimeContexts(agent.session.deriveMessages())
    expect(replay).toHaveLength(3)
    expect(selectedProviderOf(contextTextOf(replay[0]!))).toBe('exa')
    expect(selectedProviderOf(contextTextOf(replay[1]!))).toBe('perplexity')
    expect(selectedProviderOf(contextTextOf(replay[2]!))).toBe('exa')
    // The replay is byte-identical to the committed snapshots, not a
    // recomputation from the live settings document.
    expect(selectedProviderOf(contextTextOf(replay[1]!))).toBe('perplexity')

    await ctx.fiber.dispose()
  })
})

/** Extract the first text block from a replay message. */
function contextTextOf(message: Message): string | undefined {
  const [block] = message.content
  return block?.type === 'text' ? block.text : undefined
}
