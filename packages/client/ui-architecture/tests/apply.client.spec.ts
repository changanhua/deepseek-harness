// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
import type { ArchitectureNavInjected, ArchitectureWorkspaceInjected } from '../src/client/contract.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function bench() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  const list = vi.fn(async () => ({ ok: true as const, value: { entries: [] } }))
  const locale = new LocaleRuntime(ctx)
  const registerLocale = vi.spyOn(locale, 'register')
  ctx.provide('locale', locale)
  class RemoteService extends Service {
    constructor(serviceCtx: Context) { super(serviceCtx, 'remote') }
  }
  new RemoteService(ctx)
  ctx.provide('remote.pluginInventory', { list })
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'shell.view': { kind: 'list', scope: 'root' },
      'sidebar.modules': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  return { ctx, slots, list, registerLocale }
}

describe('ui-architecture client apply', () => {
  it('declares only the services used by the two entries', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.pluginInventory'])
  })

  it('registers one architecture workspace and one persistent sidebar module', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const workspace = b.slots.entries('shell.view')
    const navigation = b.slots.entries('sidebar.modules')
    expect(workspace).toHaveLength(1)
    expect(workspace[0]!.options.id).toBe('architecture')
    expect(navigation).toHaveLength(1)
    expect(navigation[0]!.options).toMatchObject({ id: 'architecture-module', order: 7 })
    expect(b.registerLocale).toHaveBeenCalledWith('architecture', expect.any(Object))

    const workspaceFace = (workspace[0]!.inject as unknown as () => ArchitectureWorkspaceInjected)()
    const navFace = (navigation[0]!.inject as unknown as () => ArchitectureNavInjected)()
    expect(workspaceFace.catalog).toBe(navFace.catalog)
    expect(workspaceFace.catalog.packages.length).toBeGreaterThan(250)
    await vi.waitFor(() => { expect(b.list).toHaveBeenCalledTimes(1) })
    expect(workspaceFace.hooks.runtime.getSnapshot().status).toBe('ready')

    await fiber.dispose()
    expect(b.slots.entries('shell.view')).toHaveLength(0)
    expect(b.slots.entries('sidebar.modules')).toHaveLength(0)
  })
})
