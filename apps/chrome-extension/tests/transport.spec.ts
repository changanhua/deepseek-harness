import { describe, expect, test } from 'vitest'
import { createContentBrowserTransport } from '../src/transport.js'

const verifier = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const installationId = '123e4567-e89b-42d3-a456-426614174000'
type FetchInput = string | URL | Request
type Pending = { requestId: string; verifier: string }
const urlText = (url: FetchInput) => typeof url === 'string' ? url : url instanceof URL ? url.href : url.url

describe('内容库浏览器连接', () => {
  test('只接受 DSH origin 根地址，拒绝未支持的子路径', async () => {
    const transport = createContentBrowserTransport({ fetchImpl: fetch, openApproval: () => {} })
    await expect(transport.begin({ baseUrl: 'https://dsh.example.test/base', extensionId: 'a'.repeat(32), installationId, verifier })).rejects.toThrow('根地址')
  })

  test('授权尚未批准时有限次数轮询后保留可恢复 pending', async () => {
    let tokenAttempts = 0
    const transport = createContentBrowserTransport({
      fetchImpl: async (url: FetchInput) => {
        if (urlText(url).endsWith('/info')) return Response.json({ protocolVersion: 1, capabilities: ['content:import'] })
        if (urlText(url).endsWith('/connect')) return Response.json({ requestId: 'request-1', expiresAt: '2099-09-07T02:00:00.000Z' })
        tokenAttempts += 1
        return new Response(JSON.stringify({ status: 'pending' }), { status: 202, headers: { 'Retry-After': '1', 'Content-Type': 'application/json' } })
      },
      openApproval: () => {},
      sleep: async () => {},
    })

    await expect(transport.begin({ baseUrl: 'https://dsh.example.test', extensionId: 'a'.repeat(32), installationId, verifier, maximumTokenAttempts: 3 })).resolves.toMatchObject({ phase: 'pending', requestId: 'request-1', verifier })
    expect(tokenAttempts).toBe(3)
  })

  test('批准在五次 pending 之后发生时，仍在握手到期前自动取得令牌', async () => {
    let tokenAttempts = 0
    const transport = createContentBrowserTransport({
      fetchImpl: async (url: FetchInput) => {
        if (urlText(url).endsWith('/info')) return Response.json({ protocolVersion: 1, capabilities: ['content:import'] })
        if (urlText(url).endsWith('/connect')) return Response.json({ requestId: 'request-2', expiresAt: '2099-09-07T02:00:00.000Z' })
        tokenAttempts += 1
        return tokenAttempts < 7
          ? new Response(JSON.stringify({ status: 'pending' }), { status: 202, headers: { 'Retry-After': '1', 'Content-Type': 'application/json' } })
          : Response.json({ token: 'approved-token' })
      },
      openApproval: () => {},
      sleep: async () => {},
    })

    await expect(transport.begin({ baseUrl: 'https://dsh.example.test', extensionId: 'a'.repeat(32), installationId, verifier })).resolves.toMatchObject({ phase: 'connected', token: 'approved-token' })
    expect(tokenAttempts).toBe(7)
  })

  test('在打开批准页和首次轮询前，把可恢复的 requestId 交给持久化方', async () => {
    let persisted: Pending | null = null
    let openedAfterPersist = false
    const transport = createContentBrowserTransport({
      fetchImpl: async (url: FetchInput) => {
        if (urlText(url).endsWith('/info')) return Response.json({ protocolVersion: 1, capabilities: ['content:import'] })
        if (urlText(url).endsWith('/connect')) return Response.json({ requestId: 'request-3', expiresAt: '2099-09-07T02:00:00.000Z' })
        expect(persisted).toMatchObject({ requestId: 'request-3', verifier })
        return new Response(JSON.stringify({ status: 'pending' }), { status: 202, headers: { 'Content-Type': 'application/json' } })
      },
      openApproval: () => { openedAfterPersist = persisted?.requestId === 'request-3' },
      sleep: async () => {},
    })

    await transport.begin({ baseUrl: 'https://dsh.example.test', extensionId: 'a'.repeat(32), installationId, verifier, maximumTokenAttempts: 1, onPending: async (pending: Pending) => { persisted = pending } })
    expect(openedAfterPersist).toBe(true)
  })

  test('所有 HTTP 请求拒绝重定向，避免把授权材料交给其他目标', async () => {
    const options: RequestInit[] = []
    const transport = createContentBrowserTransport({
      fetchImpl: async (_url: FetchInput, init?: RequestInit) => { options.push(init ?? {}); return Response.json({ receipt: { entryId: 'web:id', operationId: 'id', entryRevision: 1, draftRevision: null, versionId: 'version-1' } }) },
      openApproval: () => {},
    })
    await transport.import({ baseUrl: 'https://dsh.example.test', token: 'trusted-token', request: { captureId: 'id', title: '标题', markdown: '正文', source: {} } })
    expect(options[0].redirect).toBe('error')
  })

  test('仅在服务端返回持久回执时把导入标为已保存', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const transport = createContentBrowserTransport({
      fetchImpl: async (url: FetchInput, init?: RequestInit) => {
        calls.push({ url: urlText(url), init: init ?? {} })
        return Response.json({ receipt: { entryId: 'web:123e4567-e89b-42d3-a456-426614174000', operationId: '123e4567-e89b-42d3-a456-426614174000', entryRevision: 1, draftRevision: null, versionId: 'version-1' } })
      },
      openApproval: () => {},
    })
    const request = { captureId: '123e4567-e89b-42d3-a456-426614174000', title: '标题', markdown: '正文', source: { url: 'https://example.test', pageTitle: '页面', site: 'Example', kind: 'selection', capturedAt: '2026-09-07T01:02:03.000Z' } }

    await expect(transport.import({ baseUrl: 'https://dsh.example.test', token: 'trusted-token', request })).resolves.toEqual({ phase: 'saved', entryId: 'web:123e4567-e89b-42d3-a456-426614174000', receipt: { entryId: 'web:123e4567-e89b-42d3-a456-426614174000', operationId: '123e4567-e89b-42d3-a456-426614174000', entryRevision: 1, draftRevision: null, versionId: 'version-1' } })
    expect(calls[0]).toMatchObject({ url: 'https://dsh.example.test/api/content-browser/v1/import', init: { headers: { Authorization: 'Bearer trusted-token' } } })
  })
})
