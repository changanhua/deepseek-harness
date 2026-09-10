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
  })
})
