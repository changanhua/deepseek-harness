import { describe, expect, it, vi } from 'vitest'
import { DshControlHttpClient } from '../src/client.ts'

describe('DSH control HTTP client', () => {
  it('exchanges the launch token once and sends only the signed cookie to the control route', async () => {
    const requests: Array<{ url: URL; init: RequestInit | undefined }> = []
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      requests.push({ url, init })
      if (requests.length === 1) {
        return new Response(null, {
          status: 303,
          headers: { location: '/', 'set-cookie': 'dsh_session=signed; Path=/; HttpOnly; SameSite=Strict' },
        })
      }
      const body = JSON.parse(String(init?.body)) as {
        type: string
        rpcId: string
        method: string
        payload: Record<string, unknown>
      }
      return new Response(JSON.stringify({
        type: 'server-response', rpcId: body.rpcId,
        result: { ok: true, value: { echoed: body.payload } },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    const client = new DshControlHttpClient({
      origin: 'http://127.0.0.1:3089', token: 'launch-secret', runId: 'run-1', fetch,
    })

    await expect(client.call('session_events', { sessionId: 'session-1' }, 'read-1'))
      .resolves.toEqual({ echoed: {
        runId: 'run-1', requestId: 'read-1', method: 'session_events', params: { sessionId: 'session-1' },
      } })
    expect(requests[0]?.url.href).toBe('http://127.0.0.1:3089/?token=launch-secret')
    expect(requests[0]?.init).toMatchObject({ method: 'GET', redirect: 'manual' })
    expect(requests[1]?.url.href).toBe('http://127.0.0.1:3089/dsh-control/invoke')
    expect(new Headers(requests[1]?.init?.headers).get('cookie')).toBe('dsh_session=signed')
    expect(requests[1]?.url.searchParams.has('token')).toBe(false)

    await client.call('cordis_inspect', { sessionId: 'session-1' }, 'read-2')
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('rejects a non-loopback target before sending credentials', () => {
    expect(() => new DshControlHttpClient({
      origin: 'https://example.com', token: 'secret', runId: 'run-1', fetch: vi.fn(),
    })).toThrow('origin must use HTTP on a loopback host')
  })

  it('re-exchanges the launch token once when the current Host invalidates the cookie', async () => {
    const cookies: string[] = []
    let call = 0
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      call++
      if (call === 1 || call === 3) {
        return new Response(null, {
          status: 303,
          headers: { location: '/', 'set-cookie': `dsh_session=signed-${String(call)}; Path=/; HttpOnly` },
        })
      }
      cookies.push(new Headers(init?.headers).get('cookie') ?? '')
      if (call === 2) return new Response('unauthorized', { status: 401 })
      const request = JSON.parse(String(init?.body)) as { rpcId: string }
      return new Response(JSON.stringify({
        type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: { recovered: true } },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const client = new DshControlHttpClient({
      origin: 'http://127.0.0.1:3089', token: 'launch-secret', runId: 'run-1', fetch,
    })

    await expect(client.call('session_events', { sessionId: 'session-1' }, 'read-1'))
      .resolves.toEqual({ recovered: true })
    expect(cookies).toEqual(['dsh_session=signed-1', 'dsh_session=signed-3'])
  })
})
