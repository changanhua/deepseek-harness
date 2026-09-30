import { describe, expect, it } from 'vitest'
import { createPlanningHarness } from './harness.ts'
import { buildPlanningContext } from '../../planning/src/context.ts'

describe('canonical workspace', () => {
  it('keeps a title-only plan empty, applies an exact delta atomically and rejects stale proposals', async () => {
    const h = await createPlanningHarness()
    try {
      const created = await h.ctx.planning.execute(h.access(), { ...h.create('root'), intent: '' })
      const board = () => h.ctx.planning.snapshot(h.access())
      const initial = await board()
      expect(buildPlanningContext(initial, { kind: 'plan', id: 'provider-plan' }).accepted).toEqual([])
      const draft = initial.items[0]!.revisions[0]!
      const delta = {
        subject: { kind: 'plan' as const, id: 'provider-plan' }, baseRevision: created.revisionId!,
        originRef: { kind: 'thinking-workspace', id: 'exploration-1' },
        operations: [
          { kind: 'add-state-entry' as const, entry: { id: 'identity', kind: 'accepted' as const, content: 'Verify item identity before Submit' } },
          { kind: 'create-focus' as const, id: 'fill', title: 'Fill and validation' },
          { kind: 'add-resource-link' as const, id: 'case', resource: { kind: 'sbc-case', id: '27' } },
        ],
      }
      const propose = async (id: string) => h.ctx.planning.execute(h.access(), {
        kind: 'propose', requestId: id, expectedBoardVersion: (await board()).version,
        proposalId: id, expectedProposalVersion: null, targetItemId: 'provider-plan', baseRevisionId: created.revisionId!,
        draft: { title: draft.title, intent: draft.intent, scope: [], acceptance: [], estimate: draft.estimate,
          sources: [{ kind: 'manual', text: 'isolated pilot' }], reviewAt: null },
        suggestedLane: 'inbox', assumptions: [], delta,
      })
      await propose('candidate')
      await propose('stale')
      expect((await board()).items[0]!.headRevisionId).toBe(created.revisionId)
      await h.ctx.planning.execute(h.access(), { kind: 'accept-proposal', requestId: 'adopt',
        expectedBoardVersion: (await board()).version, proposalId: 'candidate', expectedProposalVersion: 1 })
      const adopted = await board()
      const context = buildPlanningContext(adopted, { kind: 'focus', id: 'fill' })
      expect(context.accepted[0]?.id).toBe('identity')
      expect(context.resourceRefs[0]?.resource.kind).toBe('sbc-case')
      expect(context).not.toHaveProperty('transcript')
      await expect(h.ctx.planning.execute(h.access(), { kind: 'accept-proposal', requestId: 'reject',
        expectedBoardVersion: adopted.version, proposalId: 'stale', expectedProposalVersion: 1 })).rejects.toMatchObject({ code: 'conflict' })
      expect(await board()).toEqual(adopted)
      await h.ctx.planning.execute(h.access(), { kind: 'workspace-change', requestId: 'update-stable',
        expectedBoardVersion: adopted.version, subject: delta.subject, baseRevision: context.plan.revision,
        operations: [{ kind: 'update-state-entry', entry: { id: 'identity', kind: 'accepted', content: 'Read back every item identity' } }],
      })
      const revised = await board()
      expect(revised.items[0]!.revisions.at(-1)!.stateEntries?.[0]).toMatchObject({ id: 'identity', content: 'Read back every item identity' })
      expect(revised.items[0]!.revisions.at(-2)!.stateEntries?.[0]?.content).toBe('Verify item identity before Submit')
      await expect(h.ctx.planning.execute(h.access(), { kind: 'workspace-change', requestId: 'atomic',
        expectedBoardVersion: revised.version, subject: delta.subject, baseRevision: revised.items[0]!.headRevisionId,
        operations: [ { kind: 'remove-state-entry', id: 'identity' }, { kind: 'update-focus', id: 'missing', expectedVersion: 1, status: 'done' } ],
      })).rejects.toMatchObject({ code: 'invalid-reference' })
      expect(await board()).toEqual(revised)
    } finally { await h.dispose() }
  })
})
