import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserAuth } from '../src/browser-auth.ts'
import { HostConnectionService } from '../src/rpc-host.ts'

async function mounted(): Promise<{
  readonly connection: HostConnectionService
  readonly dispose: () => Promise<void>
}> {
  const ctx = new Context()
  const fiber = ctx.plugin((pluginCtx) => {
    new HostConnectionService(pluginCtx, [], {} as BrowserAuth)
  })
  await fiber.await()
  return {
    connection: ctx.get('connection') as HostConnectionService,
    dispose: () => fiber.dispose(),
  }
}

async function mountedWithAuthentication(
  isAuthenticated: (request: { readonly headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>> }) => boolean,
): Promise<{
  readonly connection: HostConnectionService
  readonly dispose: () => Promise<void>
}> {
  const ctx = new Context()
  const fiber = ctx.plugin((pluginCtx) => {
    new HostConnectionService(pluginCtx, [], { isAuthenticated } as BrowserAuth)
  })
  await fiber.await()
  return {
    connection: ctx.get('connection') as HostConnectionService,
    dispose: () => fiber.dispose(),
  }
}

describe('Connection exact Fetch routes', () => {
  it('dispatches owned methods and returns 404 for unclaimed requests', async () => {
    const { connection, dispose: disposeFiber } = await mounted()
    const route = vi.fn(async (request: Request) =>
      Response.json({ query: new URL(request.url).searchParams.get('sessionId') }))
    const dispose = connection.fetch.register({
      path: '/api/session.export',
      methods: ['GET', 'HEAD'],
      fetch: route,
    })
    const shared = connection.createSharedFetchHandler('/api')

    const response = await shared.fetch(new Request(
      'http://host/api/session.export?sessionId=session-1',
    ))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ query: 'session-1' })
    expect(route).toHaveBeenCalledOnce()
    const post = await shared.fetch(new Request('http://host/api/session.export', { method: 'POST' }))
    expect(post.status).toBe(404)

    await dispose()
    const withdrawn = await shared.fetch(new Request('http://host/api/session.export'))
    expect(withdrawn.status).toBe(404)
    await disposeFiber()
  })

  it('rejects invalid and duplicate registrations', async () => {
    const { connection, dispose: disposeFiber } = await mounted()
    const fetch = async (): Promise<Response> => new Response()

    expect(() => connection.fetch.register({ path: '/outside', methods: ['GET'], fetch }))
      .toThrow('invalid exact Fetch route')
    expect(() => connection.fetch.register({ path: '/api/session.export', methods: [], fetch }))
      .toThrow('declares no methods')
    expect(() => connection.fetch.register({
      path: '/api/session.export', methods: ['GET', 'GET'], fetch,
    })).toThrow('repeats a method')
    const dispose = connection.fetch.register({
      path: '/api/session.export', methods: ['GET'], fetch,
    })
    expect(() => connection.fetch.register({
      path: '/api/session.export', methods: ['HEAD'], fetch,
    })).toThrow('already registered')
    await dispose()
    expect(() => connection.fetch.register({
      path: '/api/session.export', methods: ['HEAD'], fetch,
    })).not.toThrow()
    await disposeFiber()
  })

  it('binds each active shared request independently and releases its signal', async () => {
    const { connection, dispose } = await mountedWithAuthentication(() => true)
    const entered: AbortSignal[] = []
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const remove = connection.fetch.register({
      path: '/api/session.export',
      methods: ['GET'],
      fetch: async (request) => {
        entered.push(request.signal)
        if (entered.length === 2) release()
        await blocked
        connection.assertAuthorized(request.signal)
        return new Response()
      },
    })
    const shared = connection.createSharedFetchHandler('/api')
    const request = (cookie: string): Request => new Request('http://dsh.test/api/session.export', {
      headers: { host: '127.0.0.1', cookie },
    })
    const first = request('first')
    const second = request('second')

    await Promise.all([shared.fetch(first), shared.fetch(second)])
    expect(entered).toHaveLength(2)
    expect(entered[0]).not.toBe(entered[1])
    expect(() => { connection.assertAuthorized(new AbortController().signal) }).toThrow('request is not authorized')
    for (const signal of entered) {
      expect(() => { connection.assertAuthorized(signal) }).toThrow('request is not authorized')
    }

    await remove()
    await dispose()
  })

  it('rechecks captured request headers and current authentication at assertion time', async () => {
    let authenticated = true
    const { connection, dispose } = await mountedWithAuthentication(request =>
      authenticated && (request.headers instanceof Headers
        ? request.headers.get('cookie') === 'valid'
        : request.headers.cookie === 'valid'))
    const gates: (() => void)[] = []
    const remove = connection.fetch.register({
      path: '/api/session.export',
      methods: ['GET'],
      fetch: async (request) => {
        await new Promise<void>((resolve) => { gates.push(resolve) })
        connection.assertAuthorized(request.signal)
        return new Response()
      },
    })
    const shared = connection.createSharedFetchHandler('/api')
    const preservedHeaders = new Request('http://dsh.test/api/session.export', {
      headers: { host: '127.0.0.1', cookie: 'valid' },
    })
    const preserved = shared.fetch(preservedHeaders)
    preservedHeaders.headers.set('cookie', 'forged')
    gates.shift()?.()
    await expect(preserved).resolves.toBeInstanceOf(Response)

    const expired = shared.fetch(new Request('http://dsh.test/api/session.export', {
      headers: { host: '127.0.0.1', cookie: 'valid' },
    }))
    authenticated = false
    gates.shift()?.()

    await expect(expired).rejects.toThrow('request is not authorized')
    await remove()
    await dispose()
  })

  it('rejects an aborted shared request signal', async () => {
    const { connection, dispose } = await mountedWithAuthentication(() => true)
    const controller = new AbortController()
    const remove = connection.fetch.register({
      path: '/api/session.export',
      methods: ['GET'],
      fetch: async (request) => {
        controller.abort()
        expect(() => { connection.assertAuthorized(request.signal) }).toThrow('request is not authorized')
        return new Response()
      },
    })
    const shared = connection.createSharedFetchHandler('/api')
    const response = await shared.fetch(new Request('http://dsh.test/api/session.export', {
      headers: { host: '127.0.0.1', cookie: 'valid' },
      signal: controller.signal,
    }))
    expect(response.status).toBe(200)

    await remove()
    await dispose()
  })

  it('revokes awaited and retained shared-handler requests when Connection disposes', async () => {
    const { connection, dispose } = await mountedWithAuthentication(() => true)
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    let continueRequest!: () => void
    const waiting = new Promise<void>((resolve) => { continueRequest = resolve })
    connection.fetch.register({
      path: '/api/session.export',
      methods: ['GET'],
      fetch: async (request) => {
        entered()
        await waiting
        connection.assertAuthorized(request.signal)
        return new Response()
      },
    })
    const shared = connection.createSharedFetchHandler('/api')
    const request = (): Request => new Request('http://dsh.test/api/session.export', {
      headers: { host: '127.0.0.1', cookie: 'valid' },
    })
    const pending = shared.fetch(request())
    await started
    await dispose()
    continueRequest()

    await expect(pending).rejects.toThrow('request is not authorized')
    await expect(shared.fetch(request())).rejects.toThrow('request is not authorized')
  })
})
