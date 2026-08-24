// @vitest-environment jsdom
/** Work Observatory Client plugin lifecycle over a real Cordis Context. */

import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientObservation, WorkObservatoryRange } from '@deepseek-ai/dsh-api-remotes/client'
import { apply, inject } from '../src/client/index.ts'

const contexts: Context[] = []

function setDocumentState(): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
}

async function flushRemoteQueue(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

/** Boot the Client plugin with real Cordis effect and slot lifecycles. */
async function bench(): Promise<{
  ctx: Context
  calls: ClientObservation[]
  mount: () => ReturnType<Context['plugin']>
}> {
  const ctx = new Context()
  contexts.push(ctx)
  const calls: ClientObservation[] = []

  class RemoteService extends Service {
    constructor(serviceCtx: Context) {
      super(serviceCtx, 'remote')
    }
  }
  new RemoteService(ctx)
  ctx.provide('remote.workObservatory', {
    observeClient: (observation: ClientObservation) => {
      calls.push(observation)
      return Promise.resolve({ ok: true as const, value: { accepted: true } })
    },
    range: () => Promise.resolve({ ok: true as const, value: {} as WorkObservatoryRange }),
  })
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, (() => null) as never)
  ctx.provide('locale', new LocaleRuntime(ctx))

  return {
    ctx,
    calls,
    mount: () => ctx.plugin({ inject: [...inject], apply }),
  }
}

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

describe('Work Observatory Client plugin lifecycle', () => {
  it('removes the old producer before a Cordis fiber reload', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    setDocumentState()
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener')
    const b = await bench()

    const first = b.mount()
    await first.await()
    await flushRemoteQueue()
    expect(b.calls).toHaveLength(1)

    await first.dispose()
    expect(removeDocumentListener).toHaveBeenCalledWith('pointerdown', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(30_000)
    document.dispatchEvent(new Event('pointerdown'))
    await flushRemoteQueue()
    expect(b.calls).toHaveLength(1)

    const reloaded = b.mount()
    await reloaded.await()
    await flushRemoteQueue()
    document.dispatchEvent(new Event('pointerdown'))
    await flushRemoteQueue()
    await vi.advanceTimersByTimeAsync(15_000)

    expect(b.calls).toHaveLength(4)
    expect(new Set(b.calls.slice(1).map(call => call.clientId)).size).toBe(1)
    expect(b.calls.slice(1).map(call => call.seq)).toEqual([0, 1, 2])
  })
})
