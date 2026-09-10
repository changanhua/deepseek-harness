import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '../src/host.ts'

describe('DSH control Host adapter', () => {
  it('registers one authenticated exact route and returns structured operation results', async () => {
    type Dispatch = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>
    const handle = vi.fn<(channel: string, dispatch: Dispatch) => () => void>(() => () => {})
    const ctx = new Context()
    ctx.provide('connection', { rpc: { handle } } as never)
    ctx.provide('sessionController', {
      create: async () => ({ sessionId: 'session-1' }),
      prompt: async () => ({ accepted: true }),
      inspect: async (sessionId: string) => ({ meta: { id: sessionId }, events: [] }),
    } as never)
    ctx.provide('agents', { get: () => undefined } as never)

    apply(ctx, { runId: 'run-1' } satisfies Config)

    expect(handle).toHaveBeenCalledOnce()
    expect(handle.mock.calls[0]![0]).toBe('/dsh-control')
    const dispatch = handle.mock.calls[0]![1]
    const signal = new AbortController().signal
    await expect(dispatch('invoke', {
      runId: 'run-1', requestId: 'open-1', method: 'session_open',
      params: { sessionId: 'session-1', cwd: 'C:/task' },
    }, signal)).resolves.toEqual({
      ok: true, value: { sessionId: 'session-1', runId: 'run-1' },
    })
    await expect(dispatch('invoke', null, signal)).resolves.toMatchObject({
      ok: false,
      error: { code: 'bad-request' },
    })
    await ctx.fiber.dispose()
  })

  it('resolves late optional services and forgets unloaded providers without losing the run', async () => {
    type Dispatch = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>
    const handle = vi.fn<(channel: string, dispatch: Dispatch) => () => void>(() => () => {})
    const ctx = new Context()
    ctx.provide('connection', { rpc: { handle } } as never)
    ctx.provide('sessionController', {
      create: async () => ({ sessionId: 'late-session' }),
      inspect: async () => ({ meta: {}, events: [] }),
    } as never)
    ctx.provide('agents', { get: () => undefined } as never)
    apply(ctx, { runId: 'late-run' })
    const dispatch = handle.mock.calls[0]![1]
    const signal = new AbortController().signal
    const call = (method: string, params: Record<string, unknown> = {}, requestId = method) =>
      dispatch('invoke', { runId: 'late-run', requestId, method, params }, signal)
    const session = { sessionId: 'late-session' }
    try {
      await expect(call('session_open', session)).resolves.toMatchObject({ ok: true })
      await expect(call('browser_instances', session)).resolves.toMatchObject({ ok: false, error: { message: 'browser service is unavailable' } })
      await expect(call('evidence_export', session)).resolves.toMatchObject({ ok: true, value: { browser: { instances: [] } } })
      const services = ctx.plugin((scope: Context) => {
        scope.provide('browser', { instances: async () => [{ installationId: 'late-browser', online: true }] } as never)
        scope.provide('dynamicCordisRunner', { inventory: () => [{ agentId: 'late-session', name: 'late-package' }] } as never)
        scope.provide('pluginInventory', { list: () => ({ entries: [{ id: 'late-plugin' }] }) } as never)
        scope.provide('capabilityRegistry', { list: async () => ({ tools: [{ name: 'late-tool' }] }) } as never)
      })
      await services
      await expect(call('browser_instances', session)).resolves.toMatchObject({ ok: true, value: { instances: [{ installationId: 'late-browser' }] } })
      await expect(call('cordis_inspect', session)).resolves.toMatchObject({ ok: true, value: { plugins: [{ name: 'late-package' }] } })
      await expect(call('runtime_inspect', { view: 'plugins' })).resolves.toMatchObject({ ok: true, value: { entries: [{ id: 'late-plugin' }] } })
      await expect(call('runtime_inspect', { view: 'capabilities' })).resolves.toMatchObject({ ok: true, value: { tools: { entries: [{ name: 'late-tool' }] } } })
      await services.dispose()
      await expect(call('browser_instances', session)).resolves.toMatchObject({ ok: false, error: { message: 'browser service is unavailable' } })
      await expect(call('cordis_inspect', session)).resolves.toMatchObject({ ok: true, value: { plugins: [] } })
      await expect(call('runtime_inspect', { view: 'plugins' })).resolves.toMatchObject({ ok: false, error: { message: 'plugin inventory is unavailable' } })
      await expect(call('runtime_inspect', { view: 'capabilities' })).resolves.toMatchObject({ ok: false, error: { message: 'capability registry is unavailable' } })
      await expect(call('request_receipt', { requestId: 'session_open' })).resolves.toMatchObject({ ok: true, value: { found: true, status: 'fulfilled' } })
      await expect(call('evidence_export', session)).resolves.toMatchObject({ ok: true, value: { binding: session, browser: { instances: [] } } })
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
