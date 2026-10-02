import { afterEach, expect, it } from 'vitest'
import { PlanningRemoteService } from '../src/index.ts'
import { createPlanningHarness } from '../../planning-local/tests/harness.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0)) await close() })
const signal = () => new AbortController().signal
it('prepares a durable frozen run before Session creation without changing Planning', async () => {
  const h = await createPlanningHarness(); cleanups.push(h.dispose)
  const created = await h.ctx.planning.execute(h.access(), h.create('seed'))
  const remote = new PlanningRemoteService(h.ctx, { enableSbcDesignCase: true })
  const input = { workspaceId: h.workspace.id, subject: { kind: 'plan' as const, id: created.itemId! } }
  await remote.sbcDesignCase(input, signal())
  const before = await h.ctx.planning.snapshot(h.access())
  const prepared = await remote.prepareThinking({ ...input, runId: 'run-1', sessionId: 'session-1', question: 'How to decide?',
    expectedCaseVersion: 0, requestId: 'prepare-1', bindRequestId: 'bind-1', promptRequestId: 'prompt-1' }, signal())
  expect(prepared.runs[0]?.startup.phase).toBe('prepared')
  expect(prepared.runs[0]?.planningRevisionAtStart).toBe(created.revisionId)
  expect(prepared.runs[0]?.context.planning.context.plan.revision).toBe(created.revisionId)
  expect(await h.ctx.planning.snapshot(h.access())).toEqual(before)
  expect((await remote.thinkingCase(input, signal())).runs[0]?.id).toBe('run-1')
})
it('publishes a private Agent capability which rejects a foreign or unbound Agent', async () => {
  const h = await createPlanningHarness(); cleanups.push(h.dispose)
  new PlanningRemoteService(h.ctx, { enableSbcDesignCase: true })
  await expect(h.ctx.get('thinkingCase')!.context({ id: 'foreign', session: h.session } as never, signal())).rejects.toBeDefined()
})
