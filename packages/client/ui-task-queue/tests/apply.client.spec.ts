// @vitest-environment jsdom
/**
 * Client apply wiring: the Queue module registers exactly two slot entries —
 * the center-column `shell.view` seat (id `queue`) and the sidebar
 * `sidebar.modules` seat — both carrying the shared store as their inject
 * face, plus the locale dictionary and the polled refresh chain. Teardown
 * removes both entries and disposes the store.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { QueueNavEntryInjected, QueueWorkspaceInjected } from '../src/client/contract/slots.ts'

/** Controllable panel Remote face for the apply bench. */
function makeRemoteFace() {
  return {
    stats: vi.fn(async () => ({ ok: true as const, value: { serviceState: 'running' as const, fault: null, byStatus: {}, byExecutor: {} } })),
    list: vi.fn(async () => ({ ok: true as const, value: [] })),
    get: vi.fn(async () => ({ ok: false as const, error: { code: 'internal', message: 'no', details: {} } })),
    cancel: vi.fn(async () => ({ ok: true as const, value: 'canceled' as const })),
    retry: vi.fn(async () => ({ ok: true as const, value: 'tq-1' })),
    pause: vi.fn(async () => ({ ok: true as const, value: undefined })),
    resume: vi.fn(async () => ({ ok: true as const, value: undefined })),
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
  ctx.provide('remote.taskQueue', remote)
  const slots = ctx.get('slots') as SlotRegistry
  // The two frame/sidebar owners must declare the holes first (inject waits
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

describe('ui-task-queue client apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.taskQueue', 'locale'])
  })

  it('registers the workspace view into shell.view under the queue id', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entries = b.slots.entries('shell.view')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options.id).toBe('queue')
    expect(entries[0]!.locale).toBe('taskQueue')
    const face = (entries[0]!.inject as unknown as () => QueueWorkspaceInjected)()
    expect(face.queue).toBeDefined()
    expect(face.queue.getSnapshot().summaries).toEqual([])
    await fiber.dispose()
    expect(b.slots.entries('shell.view')).toHaveLength(0)
  })

  it('registers the sidebar module entry carrying the same store', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entries = b.slots.entries('sidebar.modules')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options.id).toBe('queue-module')
    expect(entries[0]!.locale).toBe('taskQueue')
    const face = (entries[0]!.inject as unknown as () => QueueNavEntryInjected)()
    expect(face.queue).toBeDefined()
    await fiber.dispose()
    expect(b.slots.entries('sidebar.modules')).toHaveLength(0)
  })

  it('registers the taskQueue locale dictionary and primes the refresh chain', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(b.registerLocale).toHaveBeenCalledWith('taskQueue', expect.any(Object))
    // The initial refresh reads the remote on mount.
    await vi.waitFor(() => {
      expect(b.remote.stats).toHaveBeenCalled()
      expect(b.remote.list).toHaveBeenCalled()
    })
    await fiber.dispose()
  })

  it('both entries share one store instance', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const viewFace = (b.slots.entries('shell.view')[0]!.inject as unknown as () => QueueWorkspaceInjected)()
    const navFace = (b.slots.entries('sidebar.modules')[0]!.inject as unknown as () => QueueNavEntryInjected)()
    expect(navFace.queue).toBe(viewFace.queue)
    await fiber.dispose()
  })
})
