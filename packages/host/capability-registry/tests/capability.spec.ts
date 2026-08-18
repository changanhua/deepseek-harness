import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { ToolRuntime, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import CapabilityRegistryGateway from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

const activePlugin: Plugin.Function = () => {}

/** Test session id (branded at the test boundary). */
const SID = 's1' as SessionId

/** Minimal ToolDefinition for the test registry. */
function makeTool(name: string, description: string): ToolDefinition {
  return {
    name,
    description,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    output: {
      schema: { type: 'object', properties: { content: { type: 'array', items: {} } }, required: ['content'], additionalProperties: false },
      render: () => [{ type: 'text', text: 'ok' }],
    },
    execute: async () => ({}),
  }
}

/** One fake Loader entry for MCP server projection without importing the real module. */
interface FakeEntry {
  id: string
  options: { name: string; config?: Record<string, unknown>; group?: boolean; disabled?: boolean }
  disabled: boolean
  fiber: undefined
}

function mcpEntry(id: string, config: Record<string, unknown>, disabled = false): FakeEntry {
  return { id, options: { name: '@deepseek-ai/dsh-mcp-client', config }, disabled, fiber: undefined }
}

async function harness(fakeEntries: FakeEntry[] = []): Promise<{
  ctx: Context
  gateway: CapabilityRegistryGateway
  skills: SkillRegistry
  tools: ToolRuntime
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.active = activePlugin
  // Replace loader.entries() with a fixed fake set so MCP projection does not
  // require importing the real mcp-client module.
  ctx.loader.entries = (() => fakeEntries) as unknown as typeof ctx.loader.entries
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(ToolRuntime)
  // The gateway injects `agents` to resolve the viewing session's scope; a
  // stub that always returns the test context exercises the global-layer path.
  ctx.provide('agents', {
    get: () => ({ ctx }),
  } as never)
  await ctx.plugin(CapabilityRegistryGateway)
  const gateway = ctx.get('capabilityRegistry') as CapabilityRegistryGateway
  const skills = ctx.get('skills') as SkillRegistry
  const tools = ctx.get('tools') as ToolRuntime
  return { ctx, gateway, skills, tools }
}

describe('CapabilityRegistryGateway', () => {
  it('publishes one direct list method under the capabilityRegistry namespace', async () => {
    const { gateway } = await harness()
    expect(gateway.typertRemote).toMatchObject({
      serviceKey: 'capabilityRegistry',
      namespace: 'capabilityRegistry',
    })
    expect(remoteMethods(gateway)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
    ])
  })

  it('projects skills from the registry management snapshot', async () => {
    const { ctx, gateway, skills } = await harness()
    const dispose = skills.register({
      name: 'test-skill',
      description: 'A test skill',
      invocation: { modelInvocable: true, userInvocable: false },
      content: 'body',
      source: 'runtime',
      provider: 'runtime',
    })
    void ctx
    const snapshot = await gateway.list({ sessionId: SID })
    expect(snapshot.skills).toHaveLength(1)
    expect(snapshot.skills[0]!.name).toBe('test-skill')
    expect(snapshot.skills[0]!.invocation.userInvocable).toBe(false)
    dispose()
  })

  it('projects tools from the registry schemas', async () => {
    const { gateway, tools } = await harness()
    tools.register(makeTool('bash', 'Run bash'))
    tools.register(makeTool('mcp__github__create_issue', 'Create issue'))
    const snapshot = await gateway.list({ sessionId: SID })
    expect(snapshot.tools).toHaveLength(2)
    const mcpTool = snapshot.tools.find(t => t.name === 'mcp__github__create_issue')
    expect(mcpTool).toBeDefined()
  })

  it('projects MCP servers from Loader entries and counts registered tools', async () => {
    const { ctx, gateway, tools } = await harness([mcpEntry('e1', { serverName: 'github', transport: 'stdio', command: 'secret-cmd', env: { TOKEN: 'leak' }, args: ['--secret'] })])
    void ctx
    tools.register(makeTool('mcp__github__create_issue', 'Create issue'))
    tools.register(makeTool('mcp__github__list_repos', 'List repos'))
    tools.register(makeTool('bash', 'Run bash'))
    const snapshot = await gateway.list({ sessionId: SID })
    expect(snapshot.mcpServers).toHaveLength(1)
    const server = snapshot.mcpServers[0]!
    expect(server.serverName).toBe('github')
    expect(server.transport).toBe('stdio')
    expect(server.registeredTools).toBe(2)
  })

  it('never returns MCP env, headers, command, or args in the payload', async () => {
    const { gateway } = await harness([mcpEntry('e1', {
      serverName: 'leakcheck',
      transport: 'streamable-http',
      url: 'https://internal.example/mcp',
      headers: { Authorization: 'Bearer SECRET_TOKEN' },
      command: 'secret-binary',
      args: ['--password=hunter2'],
      env: { API_KEY: 'sk-leak', DB_PASSWORD: 'p@ss' },
    })])
    const snapshot = await gateway.list({ sessionId: SID })
    const payload = JSON.stringify(snapshot)
    expect(payload).not.toContain('SECRET_TOKEN')
    expect(payload).not.toContain('sk-leak')
    expect(payload).not.toContain('hunter2')
    expect(payload).not.toContain('p@ss')
    expect(payload).not.toContain('secret-binary')
    expect(payload).not.toContain('https://internal.example')
    expect(payload).not.toContain('Authorization')
    expect(payload).not.toContain('API_KEY')
  })

  it('skips disabled MCP client entries', async () => {
    const { gateway } = await harness([mcpEntry('e1', { serverName: 'disabled-server', transport: 'stdio' }, true)])
    const snapshot = await gateway.list({ sessionId: SID })
    expect(snapshot.mcpServers).toHaveLength(0)
  })

  it('skips group entries', async () => {
    const groupEntry: FakeEntry = { id: 'g1', options: { name: '@deepseek-ai/dsh-mcp-client', config: { serverName: 'grouped', transport: 'stdio' }, group: true }, disabled: false, fiber: undefined }
    const { gateway } = await harness([groupEntry])
    const snapshot = await gateway.list({ sessionId: SID })
    expect(snapshot.mcpServers).toHaveLength(0)
  })

  it('returns empty arrays when no skills, tools, or MCP servers exist', async () => {
    const { gateway } = await harness()
    const snapshot = await gateway.list({ sessionId: SID })
    expect(snapshot.skills).toEqual([])
    expect(snapshot.tools).toEqual([])
    expect(snapshot.mcpServers).toEqual([])
  })
})
