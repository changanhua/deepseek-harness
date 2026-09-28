import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { afterEach, describe, expect, it } from 'vitest'
import type { PlanningCommand, PlanningSource } from '../../planning/src/types.ts'
import { PlanningStore } from '../src/store.ts'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function open(root?: string) {
  const dir = root ?? (await mkdtemp(join(tmpdir(), 'dsh-planning-')))
  if (root === undefined) roots.push(dir)
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('json', new JsonStorageBackend(dir))
  const facility = new DomainFacility(ctx, { backend: 'json', routes: {} })
  ctx.provide('storageDomain', facility)
  return {
    root: dir,
    ctx,
    store: await PlanningStore.open(facility),
    dispose: async () => {
      await ctx.fiber.dispose()
    },
  }
}
const estimate = {
  value: 5,
  urgency: 3,
  reuse: 2,
  compounding: 1,
  timeCost: 2,
  tokenCost: 1,
  risk: 2,
  cognitiveCost: 1,
  rationale: 'bounded fixture',
} as const
const create = (requestId: string, version = 0, itemId = 'plan-a'): Extract<PlanningCommand, { kind: 'create' }> => ({
  kind: 'create',
  requestId,
  expectedBoardVersion: version,
  itemId,
  lane: 'inbox',
  title: 'Persist the plan',
  intent: 'Keep the original intent durable.',
  scope: ['packages/planning'],
  acceptance: ['Restart reads the same card.'],
  sources: [{ kind: 'manual', text: 'Captured by the operator.' }],
  estimate,
  reviewAt: null,
})
const sources: PlanningSource[] = [{ kind: 'manual', text: 'Captured by the operator.', verification: 'unverified' }]

describe('PlanningStore', () => {
  it('persists an immutable root revision and omits private receipts from snapshots after restart', async () => {
    const first = await open()
    const result = await first.store.execute('workspace-a', 'human-a', create('create-a'), sources)
    const before = first.store.snapshot('workspace-a')
    await first.store.close()
    await first.dispose()
    const reopened = await open(first.root)
    const after = reopened.store.snapshot('workspace-a')
    expect(result).toMatchObject({ boardVersion: 1, itemId: 'plan-a' })
    expect(after).toEqual(before)
    expect(after).not.toHaveProperty('receipts')
    expect(after.items[0]?.revisions[0]).toMatchObject({ previousRevisionId: null, sources })
    await reopened.store.close()
    await reopened.dispose()
  })
  it('returns the original receipt for an identical retry before checking a stale board version', async () => {
    const local = await open()
    const first = await local.store.execute('workspace-a', 'human-a', create('create-replay'), sources)
    await expect(local.store.execute('workspace-a', 'human-a', create('create-replay', 0), sources)).resolves.toEqual(
      first,
    )
    await expect(
      local.store.execute(
        'workspace-a',
        'human-a',
        { ...create('create-replay', 1), title: 'Different input' },
        sources,
      ),
    ).rejects.toMatchObject({ code: 'idempotency-conflict' })
    await local.store.close()
    await local.dispose()
  })
  it('rejects stale CAS writes, dependency cycles, and cross-lane before ids', async () => {
    const local = await open()
    await local.store.execute('workspace-a', 'human-a', create('first'), sources)
    await local.store.execute('workspace-a', 'human-a', create('second', 1, 'plan-b'), sources)
    await expect(
      local.store.execute('workspace-a', 'human-a', create('stale', 0, 'plan-c'), sources),
    ).rejects.toMatchObject({ code: 'conflict' })
    await local.store.execute(
      'workspace-a',
      'human-a',
      {
        kind: 'dependencies',
        requestId: 'dep-a',
        expectedBoardVersion: 2,
        itemId: 'plan-a',
        dependsOnItemIds: ['plan-b'],
      },
      [],
    )
    await expect(
      local.store.execute(
        'workspace-a',
        'human-a',
        {
          kind: 'dependencies',
          requestId: 'dep-b',
          expectedBoardVersion: 3,
          itemId: 'plan-b',
          dependsOnItemIds: ['plan-a'],
        },
        [],
      ),
    ).rejects.toMatchObject({ code: 'invalid-reference' })
    await expect(
      local.store.execute(
        'workspace-a',
        'human-a',
        {
          kind: 'move',
          requestId: 'bad-move',
          expectedBoardVersion: 3,
          itemId: 'plan-a',
          lane: 'now',
          beforeItemId: 'plan-b',
        },
        [],
      ),
    ).rejects.toMatchObject({ code: 'invalid-reference' })
    await local.store.close()
    await local.dispose()
  })
  it('records one durable timeline event for a successful mutation but not its replay', async () => {
    const local = await open()
    await local.store.execute('workspace-a', 'human-a', create('timeline'), sources)
    const first = local.store.snapshot('workspace-a')
    expect(first.events).toHaveLength(1)
    expect(first.events[0]).toMatchObject({ kind: 'created', itemId: 'plan-a', actorId: 'human-a' })
    await local.store.execute('workspace-a', 'human-a', create('timeline'), sources)
    expect(local.store.snapshot('workspace-a').events).toHaveLength(1)
    await local.store.close()
    await local.dispose()
  })
  it('reviews an exact historical revision without rebasing it to the current head', async () => {
    const local = await open()
    const created = await local.store.execute('workspace-a', 'human-a', create('review-history'), sources)
    await local.store.execute(
      'workspace-a',
      'human-a',
      {
        kind: 'revise',
        requestId: 'review-history-revise',
        expectedBoardVersion: 1,
        itemId: 'plan-a',
        expectedRevisionId: created.revisionId!,
        title: 'New head',
        intent: 'The completed work remains on the old revision.',
        scope: [],
        acceptance: [],
        sources: [{ kind: 'manual', text: 'new' }],
        estimate,
        reviewAt: null,
      },
      sources,
    )
    const second = await local.store.execute(
      'workspace-a',
      'human-a',
      create('review-history-other', 2, 'plan-b'),
      sources,
    )
    const beforeInvalid = local.store.snapshot('workspace-a')
    const review = {
      kind: 'review' as const,
      expectedBoardVersion: 3,
      itemId: 'plan-a',
      outcome: 'completed' as const,
      summary: 'Completed the original handoff.',
      lessons: [],
      followUpItemIds: [],
      acceptanceRef: null,
    }
    await expect(
      local.store.execute(
        'workspace-a',
        'human-a',
        { ...review, requestId: 'unknown-history', expectedRevisionId: 'unknown' },
        [],
      ),
    ).rejects.toMatchObject({ code: 'not-found' })
    await expect(
      local.store.execute(
        'workspace-a',
        'human-a',
        { ...review, requestId: 'foreign-history', expectedRevisionId: second.revisionId! },
        [],
      ),
    ).rejects.toMatchObject({ code: 'not-found' })
    expect(local.store.snapshot('workspace-a')).toEqual(beforeInvalid)
    const result = await local.store.execute(
      'workspace-a',
      'human-a',
      { ...review, requestId: 'review-old-history', expectedRevisionId: created.revisionId! },
      [],
    )
    expect(result).toMatchObject({ itemId: 'plan-a', revisionId: created.revisionId })
    expect(local.store.snapshot('workspace-a').reviews[0]).toMatchObject({
      itemId: 'plan-a',
      revisionId: created.revisionId,
    })
    await local.store.close()
    await local.dispose()
  })
  it('keeps immutable proposal generations and rejects a stale acceptance', async () => {
    const local = await open()
    const proposal = {
      kind: 'propose' as const,
      requestId: 'proposal-1',
      expectedBoardVersion: 0,
      proposalId: 'proposal-a',
      expectedProposalVersion: null,
      targetItemId: null,
      baseRevisionId: null,
      draft: {
        title: 'Draft',
        intent: 'Propose first.',
        scope: [],
        acceptance: [],
        sources: [{ kind: 'manual' as const, text: 'idea' }],
        estimate,
        reviewAt: null,
      },
      suggestedLane: 'next' as const,
      assumptions: ['needs review'],
    }
    await local.store.execute('workspace-a', 'agent-a', proposal, sources)
    expect(local.store.snapshot('workspace-a').proposals[0]).toMatchObject({ headVersion: 1, status: 'pending' })
    await expect(
      local.store.execute(
        'workspace-a',
        'human-a',
        {
          kind: 'accept-proposal',
          requestId: 'accept-stale',
          expectedBoardVersion: 1,
          proposalId: 'proposal-a',
          expectedProposalVersion: 2,
        },
        [],
      ),
    ).rejects.toMatchObject({ code: 'conflict' })
    await local.store.close()
    await local.dispose()
  })
  it('links review follow-ups atomically, preserves proposal provenance, and replays acceptance exactly', async () => {
    const local = await open()
    const first = await local.store.execute('workspace-a', 'human-a', create('review-source'), sources)
    await local.store.execute('workspace-a', 'human-a', create('review-target', 1, 'plan-b'), sources)
    const baseline = local.store.snapshot('workspace-a')
    await expect(
      local.store.execute(
        'workspace-a',
        'human-a',
        {
          kind: 'review',
          requestId: 'bad-follow-ups',
          expectedBoardVersion: 2,
          itemId: 'plan-a',
          expectedRevisionId: first.revisionId!,
          outcome: 'learned',
          summary: 'Review source.',
          lessons: [],
          followUpItemIds: ['missing'],
          acceptanceRef: null,
        },
        [],
      ),
    ).rejects.toMatchObject({ code: 'not-found' })
    expect(local.store.snapshot('workspace-a')).toEqual(baseline)
    await expect(
      local.store.execute(
        'workspace-a',
        'human-a',
        {
          kind: 'review',
          requestId: 'self-follow-up',
          expectedBoardVersion: 2,
          itemId: 'plan-a',
          expectedRevisionId: first.revisionId!,
          outcome: 'learned',
          summary: 'Review source.',
          lessons: [],
          followUpItemIds: ['plan-a'],
          acceptanceRef: null,
        },
        [],
      ),
    ).rejects.toMatchObject({ code: 'invalid-reference' })
    const review = await local.store.execute(
      'workspace-a',
      'human-a',
      {
        kind: 'review',
        requestId: 'review',
        expectedBoardVersion: 2,
        itemId: 'plan-a',
        expectedRevisionId: first.revisionId!,
        outcome: 'learned',
        summary: 'Review source.',
        lessons: [],
        followUpItemIds: ['plan-b', 'plan-b'],
        acceptanceRef: null,
      },
      [],
    )
    expect(local.store.snapshot('workspace-a').reviews[0]).toMatchObject({
      id: review.reviewId,
      itemId: 'plan-a',
      followUpItemIds: ['plan-b'],
    })
    expect(local.store.snapshot('workspace-a').events.at(-1)).toMatchObject({
      kind: 'reviewed',
      reviewId: review.reviewId,
    })
    await expect(
      local.store.execute(
        'workspace-a',
        'human-a',
        {
          kind: 'follow-up',
          requestId: 'source-self-link',
          expectedBoardVersion: 3,
          reviewId: review.reviewId!,
          itemId: 'plan-a',
        },
        [],
      ),
    ).rejects.toMatchObject({ code: 'invalid-reference' })
    const beforeInvalidProposal = local.store.snapshot('workspace-a')
    await expect(
      local.store.execute(
        'workspace-a',
        'agent-a',
        {
          kind: 'propose',
          requestId: 'missing-review-proposal',
          expectedBoardVersion: 3,
          proposalId: 'missing-review',
          expectedProposalVersion: null,
          targetItemId: null,
          baseRevisionId: null,
          fromReviewId: 'missing-review',
          draft: {
            title: 'Invalid proposal',
            intent: 'Must not persist.',
            scope: [],
            acceptance: [],
            sources: [{ kind: 'manual', text: 'idea' }],
            estimate,
            reviewAt: null,
          },
          suggestedLane: 'next',
          assumptions: [],
        },
        sources,
      ),
    ).rejects.toMatchObject({ code: 'not-found' })
    expect(local.store.snapshot('workspace-a')).toEqual(beforeInvalidProposal)
    const created = await local.store.execute(
      'workspace-a',
      'human-a',
      { ...create('create-follow-up', 3, 'plan-c'), fromReviewId: review.reviewId! },
      sources,
    )
    expect(created).toMatchObject({ itemId: 'plan-c', reviewId: review.reviewId })
    expect(local.store.snapshot('workspace-a').reviews[0]?.followUpItemIds).toEqual(['plan-b', 'plan-c'])
    const proposal = {
      kind: 'propose' as const,
      requestId: 'review-proposal',
      expectedBoardVersion: 4,
      proposalId: 'proposal-review',
      expectedProposalVersion: null,
      targetItemId: null,
      baseRevisionId: null,
      fromReviewId: review.reviewId!,
      draft: {
        title: 'Proposed follow-up',
        intent: 'Follow the review.',
        scope: [],
        acceptance: [],
        sources: [{ kind: 'manual' as const, text: 'idea' }],
        estimate,
        reviewAt: null,
      },
      suggestedLane: 'next' as const,
      assumptions: [],
    }
    await local.store.execute('workspace-a', 'agent-a', proposal, sources)
    await local.store.execute(
      'workspace-a',
      'agent-a',
      {
        ...proposal,
        requestId: 'review-proposal-v2',
        expectedBoardVersion: 5,
        expectedProposalVersion: 1,
        draft: { ...proposal.draft, title: 'Refined follow-up' },
      },
      sources,
    )
    expect(local.store.snapshot('workspace-a').proposals[0]).toMatchObject({
      fromReviewId: review.reviewId,
      targetItemId: null,
      headVersion: 2,
    })
    const accepted = await local.store.execute(
      'workspace-a',
      'human-a',
      {
        kind: 'accept-proposal',
        requestId: 'accept-review-proposal',
        expectedBoardVersion: 6,
        proposalId: proposal.proposalId,
        expectedProposalVersion: 2,
      },
      [],
    )
    const afterAcceptance = local.store.snapshot('workspace-a')
    expect(accepted.reviewId).toBe(review.reviewId)
    expect(afterAcceptance.reviews[0]?.followUpItemIds).toEqual(['plan-b', 'plan-c', accepted.itemId])
    expect(afterAcceptance.events.at(-1)).toMatchObject({ kind: 'proposal-accepted', reviewId: review.reviewId })
    await expect(
      local.store.execute(
        'workspace-a',
        'human-a',
        {
          kind: 'accept-proposal',
          requestId: 'accept-review-proposal',
          expectedBoardVersion: 6,
          proposalId: proposal.proposalId,
          expectedProposalVersion: 2,
        },
        [],
      ),
    ).resolves.toEqual(accepted)
    expect(local.store.snapshot('workspace-a')).toEqual(afterAcceptance)
    await local.store.close()
    await local.dispose()
  })
  it('freezes one exact handoff, replays it after a revision, and links without changing it twice', async () => {
    const local = await open()
    const actor = { kind: 'human' as const, id: 'human-a' }
    const key = 'a'.repeat(16)
    const digest = 'b'.repeat(64)
    const created = await local.store.execute('workspace-a', actor, create('handoff-create'), sources)
    await expect(
      local.store.prepareHandoff(
        'workspace-a',
        actor,
        {
          itemId: 'plan-a',
          expectedRevisionId: 'old',
          repositoryId: 'repo-a',
          key,
          mapperVersion: 1,
          operatorId: 'operator',
          deliveryRequestDigest: digest,
        },
        () => {},
      ),
    ).rejects.toMatchObject({ code: 'conflict' })
    const prepared = await local.store.prepareHandoff(
      'workspace-a',
      actor,
      {
        itemId: 'plan-a',
        expectedRevisionId: created.revisionId!,
        repositoryId: 'repo-a',
        key,
        mapperVersion: 1,
        operatorId: 'operator',
        deliveryRequestDigest: digest,
      },
      () => {},
    )
    await local.store.execute(
      'workspace-a',
      actor,
      {
        kind: 'revise',
        requestId: 'handoff-revise',
        expectedBoardVersion: 2,
        itemId: 'plan-a',
        expectedRevisionId: created.revisionId!,
        title: 'new head',
        intent: 'new',
        scope: [],
        acceptance: [],
        sources: [{ kind: 'manual', text: 'new' }],
        estimate,
        reviewAt: null,
      },
      sources,
    )
    await expect(
      local.store.prepareHandoff(
        'workspace-a',
        actor,
        {
          itemId: 'plan-a',
          expectedRevisionId: created.revisionId!,
          repositoryId: 'repo-a',
          key,
          mapperVersion: 1,
          operatorId: 'operator',
          deliveryRequestDigest: digest,
        },
        () => {},
      ),
    ).resolves.toEqual(prepared)
    await expect(
      local.store.prepareHandoff(
        'workspace-a',
        actor,
        {
          itemId: 'plan-a',
          expectedRevisionId: created.revisionId!,
          repositoryId: 'repo-a',
          key: 'c'.repeat(16),
          mapperVersion: 1,
          operatorId: 'operator',
          deliveryRequestDigest: digest,
        },
        () => {},
      ),
    ).rejects.toMatchObject({ code: 'conflict' })
    const linked = await local.store.linkHandoff(
      'workspace-a',
      { kind: 'bridge', id: 'bridge' },
      { key, caseId: 'case-a', contractRevisionId: 'contract-a' },
      () => {},
    )
    const version = local.store.snapshot('workspace-a').version
    await expect(
      local.store.linkHandoff(
        'workspace-a',
        { kind: 'bridge', id: 'bridge' },
        { key, caseId: 'case-a', contractRevisionId: 'contract-a' },
        () => {},
      ),
    ).resolves.toEqual(linked)
    expect(local.store.snapshot('workspace-a').version).toBe(version)
    await expect(
      local.store.linkHandoff(
        'workspace-a',
        { kind: 'bridge', id: 'bridge' },
        { key, caseId: 'case-b', contractRevisionId: 'contract-a' },
        () => {},
      ),
    ).rejects.toMatchObject({ code: 'idempotency-conflict' })
    await local.store.close()
    await local.dispose()
  })
})
