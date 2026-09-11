import { describe, expect, test, vi } from 'vitest'
import { createAssistantTransport } from '../src/assistant-transport.js'

const verifier = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const installationId = '123e4567-e89b-42d3-a456-426614174000'
const extensionId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const capabilities = ['session:interact', 'browser:read', 'browser:write', 'browser:observe']
type FetchInput = string | URL | Request

const urlText = (url: FetchInput) => typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
const pendingResponse = {
  requestId: '223e4567-e89b-42d3-a456-426614174000', extensionId, installationId,
  scopes: ['session:interact', 'browser:read'], origins: ['https://example.test'],
  expiresAt: '2099-09-07T02:00:00.000Z', status: 'pending',
}

describe('浏览器助手配对 transport', () => {
  test('用 verifier 的 SHA-256 challenge 创建可持久化配对，并只在连接创建后打开审批页', async () => {
    const openApproval = vi.fn()
    const calls: Array<{ url: string; init: RequestInit }> = []
    const transport = createAssistantTransport({
      openApproval,
      fetchImpl: async (url: FetchInput, init?: RequestInit) => {
        calls.push({ url: urlText(url), init: init ?? {} })
        if (urlText(url).endsWith('/info')) return Response.json({ protocolVersion: 1, capabilities: ['browser:rpc'], scopes: capabilities })
        return new Response(JSON.stringify(pendingResponse), { status: 201, headers: { 'Content-Type': 'application/json' } })
      },
    })

    const pending: unknown = await transport.begin({ baseUrl: 'HTTPS://dsh.example.test/', installationId, extensionId,
      scopes: ['session:interact', 'browser:read'], origins: ['https://EXAMPLE.test/path', 'https://example.test'], verifier })

    expect(pending).toEqual({ ...pendingResponse, baseUrl: 'https://dsh.example.test', verifier })
    expect(openApproval).toHaveBeenCalledWith('https://dsh.example.test/browser-assistant?requestId=223e4567-e89b-42d3-a456-426614174000')
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({ url: 'https://dsh.example.test/api/browser-extension/v1/connect', init: { method: 'POST', credentials: 'omit', redirect: 'error' } })
    expect(JSON.parse(calls[1].init.body as string)).toEqual({
      extensionId, installationId, scopes: ['session:interact', 'browser:read'], origins: ['https://example.test'],
      challenge: 'Zmh6rfhivXdsj8GLjp-OIAiXFIVu4jOzkCpZHQ1fKSU',
    })
  })

  test('单次交换在未批准时返回 pending，在批准后接受缩减后的 grant', async () => {
    let exchangeCount = 0
    const transport = createAssistantTransport({
      openApproval: () => {},
      fetchImpl: async (url: FetchInput) => {
        if (urlText(url).endsWith('/token')) {
          exchangeCount += 1
          if (exchangeCount === 1) return new Response(JSON.stringify({ status: 'pending' }), { status: 202, headers: { 'Content-Type': 'application/json' } })
          return Response.json({ status: 'connected', token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', grant: { installationId, extensionId, grantEpoch: 7, scopes: ['session:interact'], origins: pendingResponse.origins, createdAt: '2026-09-07T02:00:00.000Z' } })
        }
        throw new Error(`unexpected ${urlText(url)}`)
      },
    })
    const pending = { ...pendingResponse, baseUrl: 'https://dsh.example.test', verifier }

    await expect(transport.exchange(pending)).resolves.toEqual({ phase: 'pending' })
    await expect(transport.exchange(pending)).resolves.toEqual({ phase: 'connected', token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', grant: { installationId, extensionId, grantEpoch: 7, scopes: ['session:interact'], origins: pendingResponse.origins, createdAt: '2026-09-07T02:00:00.000Z' } })
    expect(exchangeCount).toBe(2)
  })

  test('拒绝不支持的协议、配对响应身份错配与伪造 grant', async () => {
    const unsupported = createAssistantTransport({ openApproval: () => {}, fetchImpl: async () => Response.json({ protocolVersion: 1, capabilities: ['browser:read'], scopes: capabilities }) })
    await expect(unsupported.info({ baseUrl: 'https://dsh.example.test' })).rejects.toMatchObject({ code: 'unsupported_protocol' })

    const mismatched = createAssistantTransport({ openApproval: () => {}, fetchImpl: async (url: FetchInput) => urlText(url).endsWith('/info')
      ? Response.json({ protocolVersion: 1, capabilities: ['browser:rpc'], scopes: capabilities })
      : new Response(JSON.stringify({ ...pendingResponse, extensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }), { status: 201, headers: { 'Content-Type': 'application/json' } }) })
    await expect(mismatched.begin({ baseUrl: 'https://dsh.example.test', installationId, extensionId, scopes: pendingResponse.scopes, origins: pendingResponse.origins, verifier })).rejects.toMatchObject({ code: 'identity_mismatch' })

    const forged = createAssistantTransport({ openApproval: () => {}, fetchImpl: async () => Response.json({ status: 'connected', token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', grant: { installationId, extensionId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', grantEpoch: 0, scopes: pendingResponse.scopes, origins: pendingResponse.origins, createdAt: '2026-09-07T02:00:00.000Z' } }) })
    await expect(forged.exchange({ ...pendingResponse, baseUrl: 'https://dsh.example.test', verifier })).rejects.toMatchObject({ code: 'invalid_grant' })
  })

  test('已取消、已经过期或超时的请求都安全失败且不重放', async () => {
    const cancelled = new AbortController()
    cancelled.abort()
    const fetchCancelled = vi.fn()
    const transport = createAssistantTransport({ openApproval: () => {}, fetchImpl: fetchCancelled })
    await expect(transport.info({ baseUrl: 'https://dsh.example.test', signal: cancelled.signal })).rejects.toMatchObject({ code: 'cancelled' })
    expect(fetchCancelled).not.toHaveBeenCalled()

    const expiredFetch = vi.fn()
    const expired = { ...pendingResponse, baseUrl: 'https://dsh.example.test', verifier, expiresAt: '2000-01-01T00:00:00.000Z' }
    await expect(transport.exchange(expired)).rejects.toMatchObject({ code: 'expired' })
    expect(expiredFetch).not.toHaveBeenCalled()

    vi.useFakeTimers()
    const timeoutTransport = createAssistantTransport({ openApproval: () => {},
      fetchImpl: async () => new Response(new ReadableStream({ start() {} })) })
    const request = timeoutTransport.info({ baseUrl: 'https://dsh.example.test' })
    const timeoutExpectation = expect(request).rejects.toMatchObject({ code: 'request_timeout' })
    await vi.advanceTimersByTimeAsync(3_001)
    await timeoutExpectation
    vi.useRealTimers()
  })

  test('拒绝非规范 token、升级授权与非规范关联 ID，接受会话专用空 origin 和通配 origin', async () => {
    const transport = createAssistantTransport({ openApproval: () => {}, fetchImpl: async () => Response.json({ status: 'connected', token: 'abc_DEF-123', grant: { installationId, extensionId, grantEpoch: 1, scopes: ['browser:write'], origins: ['https://other.example'], createdAt: '2026-09-07T02:00:00.000Z' } }) })
    await expect(transport.exchange({ ...pendingResponse, baseUrl: 'https://dsh.example.test', verifier })).rejects.toMatchObject({ code: 'invalid_token_response' })

    const upgrade = createAssistantTransport({ openApproval: () => {}, fetchImpl: async () => Response.json({ status: 'connected', token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', grant: { installationId, extensionId, grantEpoch: 1, scopes: ['browser:write'], origins: ['https://other.example'], createdAt: '2026-09-07T02:00:00.000Z' } }) })
    await expect(upgrade.exchange({ ...pendingResponse, baseUrl: 'https://dsh.example.test', verifier })).rejects.toMatchObject({ code: 'invalid_grant' })

    const pairing = createAssistantTransport({ openApproval: () => {}, fetchImpl: async (url: FetchInput, init?: RequestInit) => urlText(url).endsWith('/info')
      ? Response.json({ protocolVersion: 1, capabilities: ['browser:rpc'], scopes: capabilities })
      : new Response(JSON.stringify({ ...pendingResponse, scopes: ['session:interact'],
        origins: (JSON.parse(init?.body as string) as { origins: string[] }).origins }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }) })
    await expect(pairing.begin({ baseUrl: 'https://dsh.example.test', installationId, extensionId, scopes: ['session:interact'], origins: [], verifier })).resolves.toMatchObject({ origins: [] })
    await expect(pairing.begin({ baseUrl: 'https://dsh.example.test', installationId, extensionId, scopes: ['session:interact'], origins: ['*'], verifier })).resolves.toMatchObject({ origins: ['*'] })
    await expect(pairing.begin({ baseUrl: 'https://dsh.example.test', installationId: 'not-a-uuid', extensionId, scopes: ['session:interact'], origins: ['*'], verifier })).rejects.toMatchObject({ code: 'invalid_identity' })
    await expect(pairing.begin({ baseUrl: 'https://dsh.example.test', installationId, extensionId: 'z'.repeat(32), scopes: ['session:interact'], origins: ['*'], verifier })).rejects.toMatchObject({ code: 'invalid_identity' })
  })
})
