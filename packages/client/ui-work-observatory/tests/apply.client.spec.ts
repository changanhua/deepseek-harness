// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { SessionId } from '@deepseek-ai/dsh-session'
import { apply, inject } from '../src/client/index.ts'
import type { WorkObservatoryWorkspaceInjected } from '../src/client/contract.ts'

const contexts: Context[] = []

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function bench() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  const registerLocale = vi.spyOn(locale, 'register')
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }
  }
  new RemoteService(ctx)
  const observeClient = vi.fn(async () => ({ ok: true as const, value: { accepted: true } }))
  const readRange = vi.fn(async (request: { from: number; to: number; projectPath?: string }) => ({
    ok: true as const,
    value: {
      ...request,
      summary: { humanActiveMs: 0, pageVisibleMs: 0, agentRunningMs: 0, togetherMs: 0, agentSoloMs: 0 },
      timeline: { humanActive: [], pageVisible: [], agentRunning: [] },
      sessions: [],
    },
  }))
  ctx.provide('remote.workObservatory', { observeClient, readRange })
  const sessionId = SessionId('s1')
  const list = createSnapshotStore({
    ids: [sessionId],
    byId: { [sessionId]: { id: sessionId, cwd: 'C:\\repo' } },
    current: sessionId,
  })
  const open = vi.fn()
  ctx.provide('sessions', { list, open } as never)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'shell.view': { kind: 'list', scope: 'root' },
      'sidebar.modules': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  return { ctx, slots, registerLocale, observeClient, readRange, open, sessionId }
}

describe('ui-work-observatory client apply', () => {
  it('registers one HMR-safe tracker and a dedicated workspace/sidebar pair', async () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(b.observeClient).toHaveBeenCalledTimes(1) })
    await vi.waitFor(() => { expect(b.readRange).toHaveBeenCalledTimes(1) })

    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.workObservatory', 'sessions'])
    expect(b.observeClient).toHaveBeenCalledWith(expect.objectContaining({ sessionId: b.sessionId }))
    expect(b.registerLocale).toHaveBeenCalledWith('workObservatory', expect.any(Object))
    expect(b.slots.entries('shell.view')[0]!.options.id).toBe('work-observatory')
    expect(b.slots.entries('sidebar.modules')[0]!.options).toMatchObject({
      id: 'work-observatory-module', order: 6,
    })
    const face = (b.slots.entries('shell.view')[0]!.inject as unknown as () => WorkObservatoryWorkspaceInjected)()
    face.openSession(b.sessionId)
    expect(b.open).toHaveBeenCalledWith(b.sessionId)

    await fiber.dispose()
    expect(b.slots.entries('shell.view')).toHaveLength(0)
    expect(b.slots.entries('sidebar.modules')).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
