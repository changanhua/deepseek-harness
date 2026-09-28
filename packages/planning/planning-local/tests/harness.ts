import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { PlanningAccess, PlanningCommand } from '../../planning/src/types.ts'
import LocalPlanning from '../src/index.ts'

/** Real local provider harness for planning consumers such as Remote. */
export async function createPlanningHarness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-planning-provider-test-'))
  const cwd = join(root, 'project')
  await mkdir(cwd)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(Storage)
  await ctx.plugin(JsonStorage, { root: join(root, 'storage') })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  const session = ctx.sessions.create(SessionId('planning-session'), { meta: { cwd } })
  const event = session.append(
    'user/message',
    createUserMessage({
      content: [{ type: 'text', text: 'source survives only when committed' }],
      source: { kind: 'user' },
    }),
    { surfaceOp: 'append' },
  )
  const writer = await ctx.sessionPersistence.create(session.header)
  await writer.append(session.snapshotEvents())
  await writer.close()
  await ctx.plugin(WorkspaceRegistry)
  const workspace = await ctx.workspaceRegistry.create(cwd)
  await ctx.plugin(SessionQuery, { path: ':memory:', openAt: 'never' })
  const planningFiber = await ctx.plugin(LocalPlanning, { ownershipRoot: join(root, 'owner') })
  const access = (authorize: () => void | Promise<void> = () => {}): PlanningAccess => ({
    workspaceId: workspace.id,
    actorId: 'human-a',
    kind: 'human',
    authorize,
  })
  const create = (requestId: string, expectedBoardVersion = 0): PlanningCommand => ({
    kind: 'create',
    requestId,
    expectedBoardVersion,
    itemId: 'provider-plan',
    lane: 'inbox',
    title: 'Provider plan',
    intent: 'Persist a verified session source.',
    scope: [],
    acceptance: [],
    sources: [{ kind: 'session-event', sessionId: session.id, seq: event.seq }],
    estimate: {
      value: 1,
      urgency: 1,
      reuse: 1,
      compounding: 1,
      timeCost: 1,
      tokenCost: 1,
      risk: 1,
      cognitiveCost: 1,
      rationale: 'test',
    },
    reviewAt: null,
  })
  return {
    ctx,
    root,
    workspace,
    session,
    event,
    access,
    create,
    planningFiber,
    dispose: async () => {
      await ctx.fiber.dispose()
      if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('unsafe cleanup')
      await rm(root, { recursive: true, force: true })
    },
  }
}
