// @vitest-environment jsdom
/**
 * Client apply wiring: the Capability module registers exactly two slot
 * entries — the center-column `shell.view` seat (id `capability`) and the
 * sidebar `sidebar.modules` seat (id `capability-module`, order 5) — both
 * carrying the shared store as their inject face, plus the locale
 * dictionary. Teardown removes both entries and disposes the store.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'
import type { CapabilityNavEntryInjected, CapabilityWorkspaceInjected } from '../src/client/contract/slots.ts'

/** Controllable capabilityRegistry Remote face for the apply bench. */
function makeRemoteFace() {
  return {
    list: vi.fn(async ({ sessionId }: { sessionId: SessionId }) => ({
      ok: true as const,
      value: { sessionId, skills: [], mcpServers: [], tools: [] },
    })),
  }
}

async function bench(withSessions = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const remote = makeRemoteFace()
  const locale = new LocaleRuntime(ctx)
  const registerLocale = vi.fn()
  locale.register = registerLocale
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  // Provide capabilityRegistry on the remote service object so the apply
  // closure's cast finds it.
  ctx.provide('remote.capabilityRegistry', remote)
  let current: SessionId | undefined
  const listeners = new Set<() => void>()
  const sessions = {
    list: {
      getSnapshot: () => ({ current }),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
    },
  }
  const provideSessions = () => { ctx.provide('sessions', sessions) }
  const selectSession = (id: string | undefined) => {
    current = id as SessionId | undefined
    for (const listener of listeners) listener()
  }
  if (withSessions) provideSessions()
  const slots = ctx.get('slots') as SlotRegistry
  // The frame/sidebar owners must declare the holes first (inject waits
  // for a live declaration).
  slots.register({
    name: 'root',
    children: {
      'shell.view': { kind: 'list', scope: 'root' },
      'sidebar.modules': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  return { ctx, slots, remote, registerLocale, provideSessions, selectSession, listeners }
}

beforeEach(() => { vi.useRealTimers() })

describe('ui-capability client apply', () => {
  it('loads the selected session when the session service arrives after the plugin', async () => {
    const b = await bench(false)
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    try {
      await b.ctx.plugin(function bootBoundary() {}).await()
      b.selectSession('s1')
      b.provideSessions()
      await fiber.await()
      await vi.waitFor(() => { expect(b.remote.list).toHaveBeenCalledWith({ sessionId: 's1' }) })
      const face = (b.slots.entries('shell.view')[0]!.inject as unknown as () => CapabilityWorkspaceInjected)()
      await vi.waitFor(() => { expect(face.capability.getSnapshot().status).toBe('ready') })
    } finally {
      await fiber.dispose()
    }
    expect(b.listeners.size).toBe(0)
  })

  it('follows session selection and releases its subscription on disposal', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const face = (b.slots.entries('shell.view')[0]!.inject as unknown as () => CapabilityWorkspaceInjected)()
    b.selectSession('s1')
    await vi.waitFor(() => { expect(face.capability.getSnapshot().status).toBe('ready') })
    b.selectSession('s2')
    await vi.waitFor(() => { expect(b.remote.list).toHaveBeenLastCalledWith({ sessionId: 's2' }) })
    b.selectSession(undefined)
    expect(face.capability.getSnapshot()).toMatchObject({ status: 'idle', sessionId: undefined })
    await fiber.dispose()
    expect(b.listeners.size).toBe(0)
    b.remote.list.mockClear()
    b.selectSession('s3')
    expect(b.remote.list).not.toHaveBeenCalled()
  })

  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.capabilityRegistry', 'locale', 'sessions'])
  })

  it('registers the workspace view into shell.view under the capability id', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entries = b.slots.entries('shell.view')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options.id).toBe('capability')
    expect(entries[0]!.locale).toBe('capability')
    const face = (entries[0]!.inject as unknown as () => CapabilityWorkspaceInjected)()
    expect(face.capability).toBeDefined()
    expect(face.capability.getSnapshot().status).toBe('idle')
    await fiber.dispose()
    expect(b.slots.entries('shell.view')).toHaveLength(0)
  })

  it('registers the sidebar module entry with order below the Queue module', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entries = b.slots.entries('sidebar.modules')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options.id).toBe('capability-module')
    // The Capability module order (5) is below the Queue module order (10),
    // so the Capability entry sits directly above Queue in the sidebar stack.
    expect((entries[0]!.options as { order: number }).order).toBeLessThan(10)
    const face = (entries[0]!.inject as unknown as () => CapabilityNavEntryInjected)()
    expect(face.capability).toBeDefined()
    await fiber.dispose()
    expect(b.slots.entries('sidebar.modules')).toHaveLength(0)
  })

  it('registers the capability locale dictionary', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.registerLocale).toHaveBeenCalledWith('capability', expect.any(Object))
    await fiber.dispose()
  })

  it('both entries share one store instance', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const viewFace = (b.slots.entries('shell.view')[0]!.inject as unknown as () => CapabilityWorkspaceInjected)()
    const navFace = (b.slots.entries('sidebar.modules')[0]!.inject as unknown as () => CapabilityNavEntryInjected)()
    expect(navFace.capability).toBe(viewFace.capability)
    await fiber.dispose()
  })
})
