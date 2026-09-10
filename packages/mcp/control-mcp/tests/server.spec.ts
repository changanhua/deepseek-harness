import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply, createDshControlMcpServer } from '../src/server.ts'

describe('DSH control MCP server', () => {
  it('publishes the bounded tool set and forwards a prompt with its idempotency key', async () => {
    const call = vi.fn(async () => ({ accepted: true }))
    const close = vi.fn(async () => ({ closed: true }))
    const server = createDshControlMcpServer({ call, close })
    const client = new Client({ name: 'control-test', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])

    const listed = await client.listTools()
    expect(listed.tools.map(tool => tool.name).sort()).toEqual([
      'dsh_browser_entry_inspect',
      'dsh_browser_instances',
      'dsh_browser_snapshot',
      'dsh_browser_tabs',
      'dsh_control_close',
      'dsh_cordis_inspect',
      'dsh_evidence_export',
      'dsh_runtime_status',
      'dsh_session_attention_answer',
      'dsh_session_events',
      'dsh_session_observe',
      'dsh_session_open',
      'dsh_session_prompt',
      'dsh_session_wait',
    ])
    const result = await client.callTool({
      name: 'dsh_session_prompt',
      arguments: {
        requestId: 'prompt-1', sessionId: 'session-1', text: '继续执行', mode: 'queue',
      },
    })
    expect(result).toMatchObject({
      isError: false,
      structuredContent: { result: { accepted: true } },
    })
    expect(call).toHaveBeenCalledWith('session_prompt', {
      sessionId: 'session-1', text: '继续执行', mode: 'queue',
    }, 'prompt-1', expect.any(AbortSignal))
    await expect(client.callTool({
      name: 'dsh_session_observe', arguments: { sessionId: 'session-1' },
    })).resolves.toMatchObject({ isError: false, structuredContent: { result: { accepted: true } } })
    expect(call).toHaveBeenCalledWith('session_observe', {
      sessionId: 'session-1',
    }, expect.any(String), expect.any(AbortSignal))
    await expect(client.callTool({
      name: 'dsh_session_attention_answer',
      arguments: {
        requestId: 'answer-1', sessionId: 'session-1', attentionId: '00000000-0000-4000-8000-000000000001',
        answers: [{ id: 'next', selected: ['继续'] }],
      },
    })).resolves.toMatchObject({ isError: false, structuredContent: { result: { accepted: true } } })
    expect(call).toHaveBeenCalledWith('session_attention_answer', {
      sessionId: 'session-1', attentionId: '00000000-0000-4000-8000-000000000001',
      answers: [{ id: 'next', selected: ['继续'] }],
    }, 'answer-1', expect.any(AbortSignal))
    await expect(client.callTool({ name: 'dsh_control_close', arguments: {} })).resolves.toMatchObject({
      isError: false, structuredContent: { result: { closed: true } },
    })
    expect(close).toHaveBeenCalledOnce()

    await Promise.all([client.close(), server.close()])
  })

  it('connects the MCP transport for the control-mcp profile lifecycle', async () => {
    const ctx = new Context()
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const close = vi.spyOn(serverTransport, 'close')
    await apply(ctx, {
      origin: 'http://127.0.0.1:3089',
      runId: 'run-1',
      token: 'test-token',
      transport: serverTransport,
      fetch: vi.fn(),
    })
    const client = new Client({ name: 'profile-test', version: '1.0.0' })
    await client.connect(clientTransport)
    await expect(client.listTools()).resolves.toMatchObject({
      tools: expect.arrayContaining([expect.objectContaining({ name: 'dsh_session_open' })]),
    })
    await ctx.fiber.dispose()
    expect(close).toHaveBeenCalled()
    await client.close()
  })
})
