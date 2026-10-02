// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { afterEach, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.tsx'
const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })
async function bench() {
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const planning = { workspaces: vi.fn() }
  const remote = { list: vi.fn(), get: vi.fn(), review: vi.fn() }
  class Remotes extends Service {
    constructor(c: Context) { super(c, 'remote') }
    $mount(): Promise<() => Promise<void>> {
      const off = ctx.reflect.provide('remote.requirementAssessment', remote)
      return Promise.resolve(async () => { await off() })
    }
  }
  new Remotes(ctx)
  ctx.provide('remote.planning', planning as never)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({ name: 'root', children: {
    'shell.view': { kind: 'list', scope: 'root' },
    'sidebar.modules.group': { kind: 'list', scope: 'root' },
    'planning.subject.actions': { kind: 'list', scope: 'root' },
  } } as never, () => null)
  return { ctx, slots, remote }
}
it('registers optional entries without model calls and removes them and the Remote on disposal', async () => {
  const b = await bench()
  const fiber = b.ctx.plugin({ inject: [...inject], apply }); await fiber.await()
  for (const name of ['shell.view', 'sidebar.modules.group', 'planning.subject.actions']) expect(b.slots.entries(name as never)).toHaveLength(1)
  expect(b.remote.review).not.toHaveBeenCalled()
  await fiber.dispose()
  for (const name of ['shell.view', 'sidebar.modules.group', 'planning.subject.actions']) expect(b.slots.entries(name as never)).toHaveLength(0)
  expect(b.ctx.get('remote.requirementAssessment')).toBeUndefined()
})
it('cleans up the Remote when client registration fails', async () => {
  const b = await bench()
  vi.spyOn(b.slots, 'register').mockImplementation(() => { throw new Error('registration failed') })
  await expect(apply(b.ctx)).rejects.toThrow('registration failed')
  expect(b.ctx.get('remote.requirementAssessment')).toBeUndefined()
})
