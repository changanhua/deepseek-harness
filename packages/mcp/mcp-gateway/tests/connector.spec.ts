import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { afterEach, describe, expect, it } from 'vitest'
import { registerPlanningTools } from '../src/connector.ts'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { while (cleanup.length) await cleanup.pop()?.() })

describe('Planning MCP connector extension', () => {
  it('keeps existing tools discoverable when the Host is unavailable and never retries a pending write', async () => {
    const server = new McpServer({ name: 'connector-extension-test', version: '1' })
    server.registerTool('legacy_tool', { inputSchema: z.object({}).strict() }, async () => ({ content: [{ type: 'text' as const, text: 'legacy' }] }))
    let tokenCalls = 0
    const unregister = registerPlanningTools(server, {
      url: 'http://127.0.0.1:1/mcp/planning', token: async () => { tokenCalls++; return 'test-token' },
    })
    const client = new Client({ name: 'connector-extension-client', version: '1' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    cleanup.push(async () => { unregister(); await server.close(); await client.close() })
    await server.connect(serverTransport); await client.connect(clientTransport)
    const listed = await client.listTools()
    expect(listed.tools.map(tool => tool.name).sort()).toEqual([
      'dsh_planning_list', 'dsh_planning_propose', 'dsh_planning_read', 'dsh_planning_workspaces', 'legacy_tool',
    ])
    await expect(client.callTool({ name: 'legacy_tool', arguments: {} })).resolves.toMatchObject({ content: [{ text: 'legacy' }] })
    const unknown = await client.callTool({ name: 'dsh_planning_propose', arguments: {
      requestId: 'unknown-write', expectedBoardVersion: 0, idea: '网络不可达时不得换 request id 重试',
    } })
    expect(unknown).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('PLANNING_UNAVAILABLE') }] })
    expect(tokenCalls).toBe(1)
  })
})
