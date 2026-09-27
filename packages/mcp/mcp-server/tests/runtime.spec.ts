import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets, { livePresetMounts } from '@deepseek-ai/dsh-agent-presets'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { loadCatalog } from '../src/catalog.ts'
import { InvocationRuntime } from '../src/runtime.ts'
import type { Config } from '../src/types.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const CATALOG: Config['catalog'] = [{
  preset: 'alpha', declaration: './declarations/capability.js',
  options: { name: 'alpha_lookup', description: 'Alpha lookup.' },
}]

interface Harness {
  readonly ctx: Context
  readonly runtime: InvocationRuntime
  readonly durable: Map<string, readonly SessionEvent[]>
}

const harnesses: Harness[] = []
afterEach(async () => {
  for (const harness of harnesses.splice(0).reverse()) await harness.ctx.fiber.dispose()
})

async function createHarness(catalog = CATALOG): Promise<Harness> {
  const ctx = new Context()
  ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, { personaPrefix: '' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(AgentPresets, {
    default: 'alpha', roots: [{ path: join(FIXTURES, 'presets'), trust: 'system' }],
    includeShippedRoot: false, includeUserRoot: false,
  })
  const durable = new Map<string, readonly SessionEvent[]>()
  // This is the test deployment's actual durability participant. InvocationRuntime
  // must call the public session flush barrier before it reports a receipt.
  ctx.on('session/flush', (session) => { durable.set(session.id, session.snapshotEvents()) })
  const config: Config = {
    path: '/mcp', tokenEnv: 'DSH_MCP_TEST_TOKEN', workspace: process.cwd(),
    catalog: [...catalog], requestMaxBytes: 64 * 1024, resultMaxBytes: 8 * 1024,
    callTimeoutMs: 5_000, maxPendingCalls: 8,
  }
  const runtime = new InvocationRuntime(ctx, config, await loadCatalog(ctx, config.catalog))
  const harness = { ctx, runtime, durable }
  harnesses.push(harness)
  return harness
}

const freshSignal = (): AbortSignal => new AbortController().signal
const mounts = (ctx: Context, preset: string) => livePresetMounts(ctx.root.fiber).filter(mount => mount.presetId === preset)

describe('lazy MCP capability execution', () => {
  it('discovers configured capabilities without activating either preset', async () => {
    const { ctx, runtime } = await createHarness([
      ...CATALOG,
      { preset: 'beta', declaration: './declarations/capability.js', options: { name: 'beta_lookup', description: 'Beta lookup.' } },
    ])

    expect(runtime.status()).toMatchObject([
      { name: 'alpha_lookup', preset: 'alpha', state: 'unloaded', loadAttempts: 0 },
      { name: 'beta_lookup', preset: 'beta', state: 'unloaded', loadAttempts: 0 },
    ])
    expect(mounts(ctx, 'alpha')).toEqual([])
    expect(mounts(ctx, 'beta')).toEqual([])
    expect(ctx.agents.list()).toEqual([])
  })

  it('single-flights a concurrent first load and reuses the standing preset', async () => {
    const { ctx, runtime } = await createHarness()

    const [left, right] = await Promise.all([
      runtime.invoke('alpha_lookup', { text: 'left' }, freshSignal()),
      runtime.invoke('alpha_lookup', { text: 'right' }, freshSignal()),
    ])
    const later = await runtime.invoke('alpha_lookup', { text: 'later' }, freshSignal())

    expect(left.result.structuredContent).toEqual({ value: 'alpha_lookup:left' })
    expect(right.result.structuredContent).toEqual({ value: 'alpha_lookup:right' })
    expect(later.result.structuredContent).toEqual({ value: 'alpha_lookup:later' })
    expect(new Set([left.sessionId, right.sessionId, later.sessionId]).size).toBe(3)
    expect(mounts(ctx, 'alpha')).toHaveLength(1)
    expect(runtime.status()).toMatchObject([{ preset: 'alpha', state: 'ready', loadAttempts: 1 }])
  })

  it('loads only the preset that owns the called capability', async () => {
    const { ctx, runtime } = await createHarness([
      ...CATALOG,
      { preset: 'beta', declaration: './declarations/capability.js', options: { name: 'beta_lookup', description: 'Beta lookup.' } },
    ])

    await runtime.invoke('beta_lookup', { text: 'only beta' }, freshSignal())

    expect(mounts(ctx, 'alpha')).toEqual([])
    expect(mounts(ctx, 'beta')).toHaveLength(1)
    expect(runtime.status()).toMatchObject([
      { preset: 'alpha', state: 'unloaded', loadAttempts: 0 },
      { preset: 'beta', state: 'ready', loadAttempts: 1 },
    ])
  })

  it('lets a later call retry a failed first composition without retaining a partial mount', async () => {
    const { ctx, runtime } = await createHarness([{
      preset: 'broken', declaration: './declarations/capability.js',
      options: { name: 'alpha_lookup', description: 'Alpha lookup.' },
    }])

    await expect(runtime.invoke('alpha_lookup', { text: 'first' }, freshSignal()))
      .rejects.toMatchObject({ code: 'CAPABILITY_LOAD_FAILED' })
    expect(mounts(ctx, 'broken')).toEqual([])
    expect(runtime.status()).toMatchObject([{ preset: 'broken', state: 'failed', loadAttempts: 1 }])

    // The public roster is dynamic. Repair the exact preset file, then a new
    // invocation must receive a clean new standing generation.
    const file = join(FIXTURES, 'presets', 'broken', 'agent.cordis.yml')
    const original = await import('node:fs/promises').then(({ readFile }) => readFile(file, 'utf8'))
    try {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(file, '- id: repaired\n  name: ../../plugins/capability.js\n  config:\n    name: alpha_lookup\n    description: Alpha lookup.\n')
      const result = await runtime.invoke('alpha_lookup', { text: 'repaired' }, freshSignal())
      expect(result.result.structuredContent).toEqual({ value: 'alpha_lookup:repaired' })
      expect(mounts(ctx, 'broken')).toHaveLength(1)
      expect(runtime.status()).toMatchObject([{ preset: 'broken', state: 'ready', loadAttempts: 2 }])
    } finally {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(file, original)
    }
  })

  it('does not cancel a shared preset load when one first waiter aborts', async () => {
    const { ctx, runtime } = await createHarness()
    const controller = new AbortController()
    const first = runtime.invoke('alpha_lookup', { text: 'cancelled' }, controller.signal)
    const second = runtime.invoke('alpha_lookup', { text: 'survives' }, freshSignal())
    controller.abort(new Error('first caller left'))

    await expect(first).rejects.toThrow('first caller left')
    await expect(second).resolves.toMatchObject({ result: { structuredContent: { value: 'alpha_lookup:survives' } } })
    expect(mounts(ctx, 'alpha')).toHaveLength(1)
  })

  it('uses the real ToolRuntime policy and records only terminal invocation evidence', async () => {
    const { durable, runtime } = await createHarness([{
      preset: 'approval', declaration: './declarations/capability.js',
      options: { name: 'approval_lookup', description: 'Approval lookup.' },
    }])

    const result = await runtime.invoke('approval_lookup', { text: 'requires approval' }, freshSignal())
    const events = durable.get(result.sessionId) ?? []

    expect(result.outcome?.isError).toBe(true)
    expect(result.result.isError).toBe(true)
    expect(JSON.stringify(result.result)).toContain('fixture approval required')
    expect(events.map(event => event.type)).toEqual(['mcp/invocation-start', 'mcp/invocation-end'])
    expect(events[1]).toMatchObject({ data: { state: 'failed', code: 'TOOL_FAILED' } })
  })

  it.each([
    ['additional contexts', 'contexts', 'context_lookup', 'Context lookup.', false],
    ['turn completion', 'conclusion', 'conclusion_lookup', 'Conclusion lookup.', true],
  ])('rejects ToolRuntime %s without retaining its value in the terminal audit', async (_label, preset, name, description, concludesTurn) => {
    const { durable, runtime } = await createHarness([{
      preset, declaration: './declarations/capability.js', options: { name, description },
    }])

    const result = await runtime.invoke(name, { text: 'must stay external' }, freshSignal())
    const events = durable.get(result.sessionId) ?? []

    expect(result.outcome).toMatchObject({ isError: false, value: `${name}:must stay external` })
    expect(result.outcome?.concludesTurn ?? false).toBe(concludesTurn)
    expect(result.result).toMatchObject({ isError: true, _meta: { code: 'UNSUPPORTED_EXECUTION_SEMANTICS' } })
    expect(events).toMatchObject([
      { type: 'mcp/invocation-start' },
      { type: 'mcp/invocation-end', data: { state: 'failed', code: 'UNSUPPORTED_EXECUTION_SEMANTICS', value: null } },
    ])
  })

  it('rejects PTC-shaped presets before dispatching the admitted tool', async () => {
    const { runtime } = await createHarness([{
      preset: 'ptc', declaration: './declarations/capability.js',
      options: { name: 'ptc_lookup', description: 'PTC lookup.' },
    }])

    await expect(runtime.invoke('ptc_lookup', { text: 'no direct PTC' }, freshSignal()))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_PRESENTATION_MODE' })
  })

  it('refuses execution when the loaded tool metadata differs from its frozen declaration', async () => {
    const { runtime } = await createHarness([{
      preset: 'alpha', declaration: './declarations/capability.js',
      options: { name: 'alpha_lookup', description: 'A stale declaration.' },
    }])

    await expect(runtime.invoke('alpha_lookup', { text: 'stale' }, freshSignal()))
      .rejects.toMatchObject({ code: 'CAPABILITY_METADATA_STALE' })
  })
})
