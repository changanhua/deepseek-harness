import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import LocalPlanning from '@changanhua/dsh-planning-local'
import LocalDelivery from '@changanhua/dsh-delivery-local'
import { createPlanningHarness } from '../../planning-local/tests/harness.ts'
import PlanningDelivery from '../src/index.ts'

const active: Awaited<ReturnType<typeof createPlanningHarness>>[] = []
afterEach(async () => {
  await Promise.all(active.splice(0).map(value => value.dispose()))
})

async function boot(root: string) {
  const cwd = join(root, 'project')
  await mkdir(cwd, { recursive: true })
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(WorkspaceRegistry)
  await ctx.plugin(SessionQuery, { path: ':memory:', openAt: 'never' })
  await ctx.plugin(LocalPlanning, { ownershipRoot: join(root, 'owner') })
  await ctx.plugin(LocalDelivery)
  await ctx.plugin(PlanningDelivery, { routes: [{ workspacePath: cwd, repositoryId: 'repository-fixture' }] })
  const workspace = await ctx.workspaceRegistry.create(cwd)
  const session = ctx.sessions.create(SessionId('restart-session'), { meta: { cwd } })
  const event = session.append(
    'user/message',
    createUserMessage({ content: [{ type: 'text', text: 'restart source' }], source: { kind: 'user' } }),
    { surfaceOp: 'append' },
  )
  return {
    ctx,
    workspace,
    access: () => ({ workspaceId: workspace.id, actorId: 'human', kind: 'human' as const, authorize() {} }),
    event,
  }
}

async function world() {
  const local = await createPlanningHarness()
  active.push(local)
  await local.ctx.plugin(LocalDelivery)
  await local.ctx.plugin(PlanningDelivery, {
    routes: [{ workspacePath: local.workspace.path, repositoryId: 'repository-fixture' }],
  })
  const created = await local.ctx.planning.execute(local.access(), local.create('bridge-create'))
  return { local, input: { itemId: created.itemId!, expectedRevisionId: created.revisionId! } }
}

describe('Planning Delivery bridge recovery', () => {
  it('reuses the one real LocalDelivery Case after a link failure', async () => {
    const { local, input } = await world()
    vi.spyOn(local.ctx.planning, 'linkDeliveryHandoff').mockRejectedValueOnce(new Error('link interrupted'))
    await expect(local.ctx.planningDelivery.handoff(local.access(), input)).rejects.toThrow('link interrupted')
    expect(local.ctx.delivery.snapshot().deliveryCases).toHaveLength(1)
    expect((await local.ctx.planning.snapshot(local.access())).handoffs[0]?.phase).toBe('prepared')
    const linked = await local.ctx.planningDelivery.handoff(local.access(), input)
    expect(linked.phase).toBe('linked')
    expect(local.ctx.delivery.snapshot().deliveryCases).toHaveLength(1)
  })

  it('refuses a persisted digest mismatch before calling real Delivery', async () => {
    const { local, input } = await world()
    await local.ctx.planningDelivery.handoff(local.access(), input)
    const snapshot = await local.ctx.planning.snapshot(local.access())
    vi.spyOn(local.ctx.planning, 'prepareDeliveryHandoff').mockResolvedValueOnce({
      ...snapshot.handoffs[0]!,
      phase: 'prepared',
      sourceDigest: 'wrong',
    })
    const create = vi.spyOn(local.ctx.delivery, 'createCase')
    await expect(local.ctx.planningDelivery.handoff(local.access(), input)).rejects.toMatchObject({ code: 'conflict' })
    expect(create).not.toHaveBeenCalled()
  })

  it('rechecks Planning direct-user authority while recovering a prepared handoff', async () => {
    const { local, input } = await world()
    vi.spyOn(local.ctx.planning, 'linkDeliveryHandoff').mockRejectedValueOnce(new Error('link interrupted'))
    await expect(local.ctx.planningDelivery.handoff(local.access(), input)).rejects.toThrow('link interrupted')
    const create = vi.spyOn(local.ctx.delivery, 'createCase')
    const link = vi.spyOn(local.ctx.planning, 'linkDeliveryHandoff')
    link.mockClear()
    await expect(
      local.ctx.planningDelivery.handoff({ ...local.access(), kind: 'bridge' }, input),
    ).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(local.ctx.planningDelivery.handoff({ ...local.access(), kind: 'agent' }, input)).rejects.toMatchObject(
      { code: 'unauthorized' },
    )
    expect(create).not.toHaveBeenCalled()
    expect(link).not.toHaveBeenCalled()
  })

  it('reopens both real providers after link failure without creating another Case', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-planning-bridge-restart-'))
    const contexts: Context[] = []
    try {
      const first = await boot(root)
      contexts.push(first.ctx)
      const created = await first.ctx.planning.execute(first.access(), {
        kind: 'create',
        requestId: 'restart-create',
        expectedBoardVersion: 0,
        itemId: 'restart-plan',
        lane: 'inbox',
        title: 'Restart plan',
        intent: 'Recover the exact frozen handoff.',
        scope: [],
        acceptance: [],
        sources: [{ kind: 'manual', text: 'restart' }],
        estimate: {
          value: null,
          urgency: null,
          reuse: null,
          compounding: null,
          timeCost: null,
          tokenCost: null,
          risk: null,
          cognitiveCost: null,
          rationale: '',
        },
        reviewAt: null,
      })
      vi.spyOn(first.ctx.planning, 'linkDeliveryHandoff').mockRejectedValueOnce(new Error('link interrupted'))
      await expect(
        first.ctx.planningDelivery.handoff(first.access(), {
          itemId: created.itemId!,
          expectedRevisionId: created.revisionId!,
        }),
      ).rejects.toThrow('link interrupted')
      await first.ctx.fiber.dispose()
      const second = await boot(root)
      contexts.push(second.ctx)
      const linked = await second.ctx.planningDelivery.handoff(second.access(), {
        itemId: created.itemId!,
        expectedRevisionId: created.revisionId!,
      })
      expect(linked.phase).toBe('linked')
      expect(second.ctx.delivery.snapshot().deliveryCases).toHaveLength(1)
    } finally {
      await Promise.allSettled(contexts.map(ctx => ctx.fiber.dispose()))
      await rm(root, { recursive: true, force: true })
    }
  })
})
