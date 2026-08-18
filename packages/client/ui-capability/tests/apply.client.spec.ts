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
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { CapabilityNavEntryInjected, CapabilityWorkspaceInjected } from '../src/client/contract/slots.ts'

/** Controllable capabilityRegistry Remote face for the apply bench. */
function makeRemoteFace() {
  return {
    list: vi.fn(async () => ({
      ok: true as const,
      value: { sessionId: 's1', skills: [], mcpServers: [], tools: [] },
    })),
  }
}

async function bench() {
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
  return { ctx, slots, remote, registerLocale }
}

beforeEach(() => { vi.useRealTimers() })

describe('ui-capability client apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.capabilityRegistry', 'locale'])
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
