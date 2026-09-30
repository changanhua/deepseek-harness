import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuery from '@deepseek-ai/dsh-session-query'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import LocalPlanning from '@changanhua/dsh-planning-local'
import { afterEach, describe, expect, it } from 'vitest'
import * as Gateway from '../src/index.ts'
import { registerPlanningTools } from '../src/connector.ts'

const TOKEN_ENV = 'DSH_PLANNING_GATEWAY_COMPOSITION_TEST_TOKEN'
const TOKEN = 'planning-gateway-test-token'
const originalToken = process.env[TOKEN_ENV]
const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.()
  if (originalToken === undefined) Reflect.deleteProperty(process.env, TOKEN_ENV)
  else process.env[TOKEN_ENV] = originalToken
})

function valueOf(input: unknown): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || !('content' in input) || !Array.isArray(input.content))
    throw new Error('MCP result has no content')
  const result = input as { structuredContent?: unknown; content: readonly { type: string; text?: string }[] }
  if (typeof result.structuredContent === 'object' && result.structuredContent !== null) return result.structuredContent as Record<string, unknown>
  const text = result.content.find(part => part.type === 'text')?.text
  if (text === undefined) throw new Error('MCP result has no structured content or text payload')
  return JSON.parse(text) as Record<string, unknown>
}

async function boot(options: {
  readonly workspacePaths?: readonly string[]
  readonly allowProject?: boolean
  readonly resultMaxBytes?: number
  readonly fileCredential?: boolean
} = {}) {
  process.env[TOKEN_ENV] = TOKEN
  const root = await mkdtemp(join(tmpdir(), 'dsh-gateway-planning-'))
  cleanup.push(async () => {
    const child = relative(resolve(tmpdir()), resolve(root))
    if (!child.startsWith('dsh-gateway-planning-') || child.includes('/') || child.includes('\\')) throw new Error('unsafe fixture cleanup')
    await rm(root, { recursive: true, force: true })
  })
  const project = join(root, 'project'), foreignPath = join(root, 'foreign')
  await Promise.all([mkdir(project), mkdir(foreignPath)])
  const baseConfig = join(root, 'base.yml')
  await writeFile(baseConfig, [
    "- id: web-server\n  name: '@deepseek-ai/dsh-host-webserver'\n  config: { host: '127.0.0.1', port: 0 }",
    "- { id: storage, name: '@deepseek-ai/dsh-storage' }",
    `- id: storage-json\n  name: '@deepseek-ai/dsh-storage-json'\n  config:\n    root: ${JSON.stringify(join(root, 'storage'))}`,
    "- id: storage-domain\n  name: '@deepseek-ai/dsh-storage-domain'\n  isolate:\n    storageDomain: web-host\n  config: { backend: json }",
    "- { id: sessions, name: '@deepseek-ai/dsh-session' }",
    `- id: session-persistence\n  name: '@deepseek-ai/dsh-session-persistence-jsonl'\n  config:\n    root: ${JSON.stringify(join(root, 'sessions'))}\n    compression: none`,
    "- { id: session-query, name: '@deepseek-ai/dsh-session-query' }",
    "- id: workspace-registry\n  name: '@deepseek-ai/dsh-workspace'\n  isolate:\n    storageDomain: web-host\n    workspaceRegistry: web-host",
    `- id: planning-local\n  name: '@changanhua/dsh-planning-local'\n  isolate:\n    storageDomain: web-host\n    workspaceRegistry: web-host\n  config:\n    ownershipRoot: ${JSON.stringify(join(root, 'ownership'))}`,
  ].join('\n'))
  const ctx = new Context(); cleanup.push(() => ctx.fiber.dispose()); ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader); ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', WebServer], ['@deepseek-ai/dsh-storage', Storage], ['@deepseek-ai/dsh-storage-json', StorageJson], ['@deepseek-ai/dsh-storage-domain', StorageDomain],
    ['@deepseek-ai/dsh-session', SessionStore], ['@deepseek-ai/dsh-session-persistence-jsonl', JsonlPersistence], ['@deepseek-ai/dsh-session-query', SessionQuery], ['@deepseek-ai/dsh-workspace', WorkspaceRegistry],
    ['@changanhua/dsh-planning-local', LocalPlanning], ['@deepseek-ai/dsh-mcp-gateway', Gateway],
  ])
  ctx.loader.internal = { version: 'v2', async import(name: string) { const value = modules.get(name); if (value === undefined) throw new Error(`unexpected module ${name}`); return value } } as never
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(baseConfig).href } }); await ctx.loader.await()
  const registry = [...ctx.loader.entries()].find(entry => entry.options.id === 'workspace-registry')?.ctx?.get('workspaceRegistry')
  if (registry === undefined) throw new Error('Workspace Registry did not activate')
  const workspace = await registry.create(project), foreign = await registry.create(foreignPath)
  const gatewayConfig = join(root, 'gateway.yml')
  const tokenFile = join(root, 'credential')
  if (options.fileCredential) await writeFile(tokenFile, TOKEN)
  await writeFile(gatewayConfig, [
    "- id: gateway\n  name: '@deepseek-ai/dsh-mcp-gateway'\n  isolate:\n    workspaceRegistry: web-host",
    `  config: ${JSON.stringify({ ...(options.fileCredential ? { tokenFile } : { tokenEnv: TOKEN_ENV }), resultMaxBytes: options.resultMaxBytes ?? 256 * 1024, ...(options.workspacePaths === undefined && !options.allowProject ? {} : { workspacePaths: options.workspacePaths ?? [String(workspace.path)] }) })}`,
  ].join('\n'))
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(gatewayConfig).href } }); await ctx.loader.await()
  const planning = [...ctx.loader.entries()].find(entry => entry.options.id === 'planning-local')?.ctx?.get('planning')
  const gateway = [...ctx.loader.entries()].find(entry => entry.options.id === 'gateway')
  if (planning === undefined || gateway?.fiber === undefined) throw new Error('Planning gateway entries did not activate')
  const url = new URL(`http://127.0.0.1:${ctx.webServer.port}/mcp/planning`)
  const client = new Client({ name: 'planning-gateway-composition-test', version: '1' })
  const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } })
  return {
    client, ctx, foreignWorkspaceId: String(foreign.id), planning,
    disposeGateway: () => gateway.fiber!.dispose(), foreignPath: foreign.path,
    project: workspace.path, transport, url, workspaceId: String(workspace.id),
  }
}

describe('Planning MCP gateway Loader composition', () => {
  it('rejects absent, conflicting, and relative credential sources before activating', () => {
    expect(() =>{  Gateway.apply({} as never, {}) }).toThrow('exactly one')
    expect(() =>{  Gateway.apply({} as never, { tokenEnv: TOKEN_ENV, tokenFile: 'relative' }) }).toThrow('exactly one')
    expect(() =>{  Gateway.apply({} as never, { tokenFile: 'relative' }) }).toThrow('absolute')
  })
  it('uses connection context, permits explicit project switching, and rejects a disallowed default', async () => {
    const setup = await boot({ fileCredential: true })
    const server = new McpServer({ name: 'existing-connector', version: '1' })
    const client = new Client({ name: 'context-test', version: '1' })
    const [local, remote] = InMemoryTransport.createLinkedPair()
    let current: string | undefined = setup.project
    const unregister = registerPlanningTools(server, {
      url: setup.url.href, token: async () => TOKEN, currentWorkspace: () => current,
    })
    cleanup.push(async () => { unregister(); await client.close(); await server.close() })
    await server.connect(remote); await client.connect(local)
    expect(valueOf(await client.callTool({ name: 'dsh_planning_list', arguments: {} }))).toMatchObject({ workspaceId: setup.workspaceId })
    expect(valueOf(await client.callTool({ name: 'dsh_planning_list', arguments: { workspace: setup.foreignWorkspaceId } }))).toMatchObject({ workspaceId: setup.foreignWorkspaceId })
    current = setup.foreignPath
    expect(valueOf(await client.callTool({ name: 'dsh_planning_list', arguments: {} }))).toMatchObject({ workspaceId: setup.foreignWorkspaceId })
    current = undefined
    expect(await client.callTool({ name: 'dsh_planning_list', arguments: {} })).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('WORKSPACE_REQUIRED') }] })
    current = 'unregistered-project'
    expect(await client.callTool({ name: 'dsh_planning_list', arguments: {} })).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('WORKSPACE_UNAVAILABLE') }] })
  })

  it('treats one path as the default project and an empty allowlist as deny-all', async () => {
    const allowed = await boot({ workspacePaths: [] })
    await allowed.client.connect(allowed.transport as Transport)
    try {
      expect(valueOf(await allowed.client.callTool({ name: 'dsh_planning_workspaces', arguments: {} }))).toMatchObject({ total: 0, workspaces: [] })
    } finally { await allowed.client.close() }
    const onePath = await boot({ allowProject: true })
    await onePath.client.connect(onePath.transport as Transport)
    try {
      expect(valueOf(await onePath.client.callTool({ name: 'dsh_planning_workspaces', arguments: {} }))).toMatchObject({ total: 1 })
      expect(await onePath.client.callTool({ name: 'dsh_planning_list', arguments: { workspace: onePath.foreignWorkspaceId } })).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('WORKSPACE_UNAVAILABLE') }] })
      expect(await onePath.client.callTool({ name: 'dsh_planning_propose', arguments: { workspace: onePath.foreignWorkspaceId, requestId: 'forbidden', expectedBoardVersion: 0, idea: 'must not write' } })).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('WORKSPACE_UNAVAILABLE') }] })
    } finally { await onePath.client.close() }
  })

  it('uses real projects, strict inputs, pagination, chunked reads, and idempotent pending proposals', async () => {
    const setup = await boot()
    const { client, foreignWorkspaceId, planning, transport } = setup
    await client.connect(transport as Transport)
    try {
      const tools = await client.listTools()
      expect(tools.tools.map(tool => tool.name).sort()).toEqual(['dsh_planning_list', 'dsh_planning_propose', 'dsh_planning_read', 'dsh_planning_workspaces'])
      const projects = valueOf(await client.callTool({ name: 'dsh_planning_workspaces', arguments: {} }))
      expect(projects).toMatchObject({ total: 2 })
      const workspace = String((projects.workspaces as { id: string; title: string }[]).find(value => value.title === 'project')?.id)
      expect(workspace).not.toBe('undefined')
      const ambiguous = await client.callTool({ name: 'dsh_planning_propose', arguments: { requestId: 'ambiguous', expectedBoardVersion: 0, idea: '需要明确项目' } })
      expect(ambiguous).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('WORKSPACE_REQUIRED') }] })
      const input = { workspace, requestId: 'same-raw-idea', expectedBoardVersion: 0, idea: '恢复浏览器需求的连续性\n具体范围和验收暂不确认。' }
      const forged = await client.callTool({ name: 'dsh_planning_propose', arguments: { ...input, actorId: 'forged-actor', sessionId: 'forged-session', workspaceId: foreignWorkspaceId } })
      expect(forged).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('DSH_GATEWAY_INVALID_INPUT') }] })
      const created = await client.callTool({ name: 'dsh_planning_propose', arguments: input })
      expect(created.isError).not.toBe(true)
      const retried = await client.callTool({ name: 'dsh_planning_propose', arguments: input })
      expect(valueOf(retried)).toEqual(valueOf(created))
      const mismatch = await client.callTool({ name: 'dsh_planning_propose', arguments: { ...input, idea: '相同 requestId 不能改写' } })
      expect(mismatch).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('idempotency-conflict') }] })
      const proposalId = String(valueOf(created).proposalId)
      const another = await client.callTool({ name: 'dsh_planning_propose', arguments: { ...input, requestId: 'next-page', expectedBoardVersion: 1, idea: '第二个待整理想法' } })
      expect(another.isError).not.toBe(true)
      const listed = valueOf(await client.callTool({ name: 'dsh_planning_list', arguments: { workspace, limit: 1 } }))
      expect(listed).toMatchObject({ boardVersion: 2, total: 2, nextCursor: expect.any(Number) })
      const next = valueOf(await client.callTool({ name: 'dsh_planning_list', arguments: { workspace, cursor: listed.nextCursor, limit: 1, boardVersion: listed.boardVersion } }))
      expect(next).toMatchObject({ boardVersion: 2, total: 2, nextCursor: null })
      const read = valueOf(await client.callTool({ name: 'dsh_planning_read', arguments: { workspace, id: proposalId, limit: 10 } }))
      expect(read).toMatchObject({ encoding: 'json', chunk: expect.any(String), nextCursor: expect.any(Number), objectVersion: 1 })
      const continued = valueOf(await client.callTool({ name: 'dsh_planning_read', arguments: { workspace, id: proposalId, cursor: read.nextCursor, limit: 10, proposalVersion: 1 } }))
      expect(continued).toMatchObject({ encoding: 'json', objectVersion: 1 })
      await expect(planning.snapshot({ workspaceId: foreignWorkspaceId, actorId: 'inspector', kind: 'human', authorize() {} })).resolves.toMatchObject({ version: 0, items: [], proposals: [] })
    } finally { await client.close() }
  })

  it('rejects absent credentials and browser origins, then unregisters the endpoint on Host disposal', async () => {
    const { disposeGateway, url } = await boot()
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
    const unauthenticated = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    const browserOrigin = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', origin: 'https://example.test' }, body })
    expect(unauthenticated.status).toBe(401); expect(browserOrigin.status).toBe(403)
    await disposeGateway()
    const removed = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body })
    expect(removed.status).toBe(404)
  })
})
