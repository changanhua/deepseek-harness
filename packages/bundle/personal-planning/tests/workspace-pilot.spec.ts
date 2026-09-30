import { expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { buildPlanningContext } from '@changanhua/dsh-planning'
import type { PlanningCommand } from '@changanhua/dsh-planning'
import { bootPlanningBundle } from './harness.ts'

it('SBC pilot: Plan → Focus → Session → references → exact adoption → restart', async () => {
  const world = await bootPlanningBundle()
  const signal = new AbortController().signal
  let reopened: Awaited<ReturnType<typeof bootPlanningBundle>> | undefined
  try {
    const snapshot = () => world.remote.snapshot(world.workspaceId, signal)
    const execute = async (command: Omit<PlanningCommand, 'expectedBoardVersion'>) => world.remote.execute({
      workspaceId: world.workspaceId, command: { ...command, expectedBoardVersion: (await snapshot()).version } as PlanningCommand,
    }, signal)
    const created = await execute({ ...world.create('pilot-root'), title: 'FC27 SBC 半自动化提交', intent: '' } as PlanningCommand)
    await execute({ kind: 'workspace-change', requestId: 'pilot-focus', subject: { kind: 'plan', id: created.itemId! },
      baseRevision: created.revisionId!, operations: [ { kind: 'create-focus', id: 'fill-validation', title: 'Fill + validation' },
        { kind: 'create-focus', id: 'approval-readback', title: 'Approval and read-back' },
        { kind: 'add-state-entry', entry: { id: 'manual-submit', kind: 'accepted', content: '最终 Submit 必须单独人工批准' } },
        { kind: 'add-resource-link', id: 'sbc', resource: { kind: 'sbc-case', id: '27' } } ],
    } as PlanningCommand)
    const base = buildPlanningContext(await snapshot(), { kind: 'focus', id: 'fill-validation' })
    const workspaceEntry = [...world.ctx.loader.entries()].find(entry => entry.options.id === 'workspace-registry')!
    const workspace = workspaceEntry.ctx.get('workspaceRegistry')!.list().find(value => value.id === world.workspaceId)!
    for (const id of ['pilot-session-a', 'pilot-session-b']) {
      const session = world.ctx.sessions.create(SessionId(id), { meta: { cwd: world.project } })
      const writer = await world.ctx.sessionPersistence.create(session.header)
      await writer.close()
      await workspace.attachSession(session.id)
      await execute({ kind: 'bind-session', requestId: `bind-${id}`, subject: base.subject,
        baseRevision: base.plan.revision, sessionId: id } as PlanningCommand)
    }
    const head = (await snapshot()).items[0]!.revisions.at(-1)!
    const proposal: PlanningCommand = {
      kind: 'propose', requestId: 'pilot-result', expectedBoardVersion: 0, proposalId: 'pilot-proposal',
      expectedProposalVersion: null, targetItemId: created.itemId!, baseRevisionId: base.plan.revision,
      draft: { title: head.title, intent: head.intent, scope: head.scope, acceptance: head.acceptance,
        sources: [{ kind: 'manual', text: 'Isolated Browser/Solver fixture: one item identity mismatch' }],
        estimate: head.estimate, reviewAt: null }, suggestedLane: 'inbox', assumptions: [],
      delta: { subject: base.subject, baseRevision: base.plan.revision, originRef: { kind: 'session', id: 'pilot-session-a' },
        evidenceRefs: [{ kind: 'browser-run', id: '42' }, { kind: 'solver-result', id: '19' }],
        operations: [
          { kind: 'add-state-entry', entry: { id: 'verify-item', kind: 'accepted', content: 'Submit 前重读并逐项核对 item identity' } },
          { kind: 'add-state-entry', entry: { id: 'mismatch-policy', kind: 'open', content: 'Mismatch 后阻断还是允许局部替换？' } },
          { kind: 'add-resource-link', id: 'browser', resource: { kind: 'browser-run', id: '42' }, role: 'evidence' },
          { kind: 'add-resource-link', id: 'solver', resource: { kind: 'solver-result', id: '19' }, role: 'evidence' },
          { kind: 'update-focus', id: 'fill-validation', expectedVersion: 1, status: 'done' },
        ] },
    }
    await execute(proposal)
    expect(buildPlanningContext(await snapshot(), base.subject).accepted).toHaveLength(1)
    const adoption = { kind: 'accept-proposal' as const, requestId: 'pilot-adopt', expectedBoardVersion: (await snapshot()).version,
      proposalId: 'pilot-proposal', expectedProposalVersion: 1 }
    const adopted = await world.remote.execute({ workspaceId: world.workspaceId, command: adoption }, signal)
    const final = await snapshot()
    expect(final.items[0]!.disposition).toBe('active')
    expect(final.focuses).toHaveLength(2)
    expect(final.handoffs).toEqual([])
    expect(final.sessionBindings).toHaveLength(2)
    expect(final.sessionBindings!.every(value => value.baseRevision === base.plan.revision)).toBe(true)
    const pack = buildPlanningContext(final, base.subject)
    expect(pack.accepted.map(value => value.id)).toEqual(['manual-submit', 'verify-item'])
    expect(pack.selectedFocus?.status).toBe('done')
    expect(pack.resourceRefs.map(value => value.resource.kind)).toEqual(['sbc-case', 'session', 'session', 'browser-run', 'solver-result'])
    expect(pack.plan.revision).not.toBe(base.plan.revision)
    expect(JSON.stringify(final)).not.toMatch(/"(?:rating|chemistry|formation|inventory|players)"/u)
    await world.close()
    reopened = await world.reopen()
    expect(await reopened.remote.snapshot(reopened.workspaceId, signal)).toEqual(final)
    expect(await reopened.remote.execute({ workspaceId: reopened.workspaceId, command: adoption }, signal)).toEqual(adopted)
  } finally { await reopened?.close(); await world.dispose() }
})
