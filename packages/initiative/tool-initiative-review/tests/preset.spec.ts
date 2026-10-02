import { expect, it } from 'vitest'
import { mkdir, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Llm from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import * as Persona from '@deepseek-ai/dsh-persona'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { boot } from '../../initiative-local/tests/harness.ts'
import * as Review from '../src/index.ts'
import * as Restriction from '../src/restrict.ts'

it('mounts the shipped preset through Loader and the real Agent factory before denying inherited capabilities', async () => {
  let dispatched = 0
  const h = await boot(undefined, undefined, undefined, [
    { name: 'review-consumer', plugin: Review },
    { name: '@deepseek-ai/dsh-llm', plugin: Llm },
    { name: '@deepseek-ai/dsh-session-projection', plugin: SessionProjection },
    { name: '@deepseek-ai/dsh-agent-loop', plugin: AgentLoop, config: { agents: [] } },
    { name: '@deepseek-ai/dsh-agent-presets', plugin: AgentPresets,
      config: { default: 'initiative-review', roots: [], includeShippedRoot: true, includeUserRoot: false } },
    { name: '@deepseek-ai/dsh-persona', plugin: Persona, importOnly: true },
    { name: '@changanhua/dsh-tool-initiative-review/restrict', plugin: Restriction, importOnly: true },
    { name: 'forbidden-tools', plugin: { inject: ['tools'], apply(ctx: Context) {
      for (const name of ['planning_update', 'subagent']) ctx.tools.register(defineTool({ name, description: 'Forbidden fixture',
        parameters: {}, output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
        execute: () => { dispatched++; return Promise.resolve('unexpected dispatch') } }))
    } } },
  ])
  try {
    // Resolve the shipped package names from this isolated installation without rewriting its preset YAML.
    for (const [name, source] of [
      ['@deepseek-ai/dsh-persona', 'packages/preset/persona'],
      ['@changanhua/dsh-tool-initiative-review', 'packages/initiative/tool-initiative-review'],
    ]) {
      const target = join(h.root, 'node_modules', name!)
      await mkdir(join(h.root, 'node_modules', name!.split('/')[0]!), { recursive: true })
      await symlink(resolve(source!), target, 'junction')
    }
    expect(h.ctx.tools.schemas(h.agent).map(tool => tool.name)).toContain('planning_update')
    const handle = await h.ctx.agents.create({ sessionId: SessionId('real-review-preset'), meta: { cwd: h.cwd },
      setup: async agentCtx => void await h.ctx.agentPresets.mount(agentCtx, 'initiative-review') })
    try {
      const agent = handle.agent
      expect(h.ctx.agentPresets.composedPreset(agent.ctx)).toBe('initiative-review')
      expect(h.ctx.tools.schemas(agent).map(tool => tool.name).sort()).toEqual(['initiative_review_decide', 'initiative_review_read'])
      for (const name of ['initiative_record', 'planning_update', 'subagent']) {
        expect(await h.ctx.tools.execute({ name, agent, arguments: {}, callId: ToolCallId(`deny-${name}`),
          signal: new AbortController().signal })).toMatchObject({ isError: true })
      }
      expect(dispatched).toBe(0)
    } finally { await handle.dispose() }
  } finally { await h.dispose() }
})
