import { afterEach, expect, it, vi } from 'vitest'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Context } from '@deepseek-ai/cordis'
import { boot, propose, investigate } from '../../initiative-local/tests/harness.ts'
import * as Review from '../src/index.ts'
import type { PlanningBoardSnapshot } from '@changanhua/dsh-planning'
import type { z } from 'zod'
import type { attemptSchema } from '../src/spec.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'

type View = Partial<z.infer<typeof attemptSchema>> & {
  review: PlanningBoardSnapshot['reviews'][number]
  contextDigest: string
  version: number
  trustedAcceptance?: string
}

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function setup(root?: string, config?: Record<string, unknown>) {
  const h = await boot(root, undefined, undefined, [{ name: 'review-consumer', plugin: Review, ...(config ? { config } : {}) }])
  cleanups.push(root ? h.close : h.dispose)
  let scope!: ReturnType<typeof createScope>
  await h.ctx.plugin(Object.assign((ctx: Context) => { scope = createScope(ctx, h.agent) }, { inject: ['tools'] }))
  ;(h.agent as { ctx: Context }).ctx = scope.ctx
  scope.ctx.tools.restrict({ allow: ['initiative_review_read', 'initiative_review_decide'] })
  h.session.append('turn/start', { turn: 1 })
  const call = async (input: unknown, name = 'initiative_review_read') => {
    const result = await h.tool(input, name)
    if (result.isError) throw new Error(result.content.map(c => c.type === 'text' ? c.text : '').join(''))
    return JSON.parse(result.content[0]!.type === 'text' ? result.content[0]!.text : '') as View
  }
  const review = async (summary = 'Repeated manual checking remains after delivery.') => {
    const board = await h.ctx.planning.snapshot(h.access())
    const itemId = `item-${board.version}`
    const created = await h.ctx.planning.execute(h.access(), { kind: 'create', requestId: itemId,
      expectedBoardVersion: board.version, itemId, lane: 'inbox', title: 'Review test', intent: 'Reduce manual checks',
      scope: [], acceptance: [], sources: [{ kind: 'manual', text: 'Operator review fixture' }], reviewAt: null,
      estimate: { value: 1, urgency: 1, reuse: 1, compounding: 1, timeCost: 1, tokenCost: 1, risk: 1, cognitiveCost: 1, rationale: 'test' } })
    return (await h.ctx.planning.execute(h.access(), { kind: 'review', requestId: `review-${itemId}`,
      expectedBoardVersion: created.boardVersion, itemId, expectedRevisionId: created.revisionId!, outcome: 'learned',
      summary, lessons: ['Check existing solutions before adding work.'], followUpItemIds: [], acceptanceRef: null })).reviewId!
  }
  return { ...h, call, review, lift: () => scope.dispose() }
}
const decide = (read: View, decision: unknown) => ({ reviewId: read.review.id, expectedContextDigest: read.contextDigest,
  expectedDecisionVersion: read.version, rationale: 'Compared current outcome, evidence and existing work.', decision })

it.each(['create', 'no-op'] as const)('rejects %s when the comparison set changes outside the returned page', async (kind) => {
  const h = await setup()
  await h.humanOK(propose('visible'))
  const hidden = await h.humanOK(propose('outside-page'))
  const read = await h.call({ reviewId: await h.review(), limit: 1 })
  await h.humanOK(investigate(hidden, 'outside-page-change'))
  const input = decide(read, kind === 'create' ? { kind, candidateKind: 'simplify', claim: 'Avoid a duplicate' } : { kind })
  await expect(h.call(input, 'initiative_review_decide')).rejects.toThrow('changed')
  expect((await h.read()).total).toBe(2)
  expect(h.ctx.storageDomain.get('initiative_review_decisions')!.table('workspaces').get(h.workspace.id)).toBeUndefined()
})

it('rejects a create when another Candidate lands after bridge admission but before the owner write', async () => {
  const h = await setup(); const read = await h.call({ reviewId: await h.review() })
  const execute = h.ctx.initiative.execute.bind(h.ctx.initiative)
  vi.spyOn(h.ctx.initiative, 'execute').mockImplementationOnce(async (...args) => {
    await h.humanOK(propose('concurrent-candidate'))
    return execute(...args)
  })
  await expect(h.call(decide(read, { kind: 'create', candidateKind: 'simplify', claim: 'Avoid a duplicate' }),
    'initiative_review_decide')).rejects.toThrow('changed')
  expect((await h.read()).total).toBe(1)
})

it('rechecks no-op context after flushing the initiating Session', async () => {
  const h = await setup(); const read = await h.call({ reviewId: await h.review() })
  const flush = h.ctx.sessions.flush.bind(h.ctx.sessions)
  vi.spyOn(h.ctx.sessions, 'flush').mockImplementationOnce(async (session) => {
    await h.humanOK(propose('during-flush'))
    return flush(session)
  })
  await expect(h.call(decide(read, { kind: 'no-op' }), 'initiative_review_decide')).rejects.toThrow('changed')
  expect(h.ctx.storageDomain.get('initiative_review_decisions')!.table('workspaces').get(h.workspace.id)).toBeUndefined()
})

it('rejects a decision after the referenced follow-up head changes with an unchanged Review', async () => {
  const h = await setup(); const reviewId = await h.review()
  const board = await h.ctx.planning.snapshot(h.access())
  const source = board.items[0]!.revisions[0]!
  const draft = { title: 'Follow-up', intent: source.intent, scope: source.scope, acceptance: source.acceptance,
    estimate: source.estimate, reviewAt: null, sources: [{ kind: 'manual' as const, text: 'Follow-up source' }] }
  const followup = await h.ctx.planning.execute(h.access(), { kind: 'create', requestId: 'follow-up',
    expectedBoardVersion: board.version, lane: 'inbox', itemId: 'follow-up', fromReviewId: reviewId, ...draft })
  const before = await h.ctx.planning.snapshot(h.access())
  const read = await h.call({ reviewId })
  await h.ctx.planning.execute(h.access(), { kind: 'revise', requestId: 'revise-follow-up', expectedBoardVersion: before.version,
    itemId: followup.itemId!, expectedRevisionId: followup.revisionId!, ...draft, intent: 'A materially different follow-up' })
  expect((await h.ctx.planning.snapshot(h.access())).reviews).toEqual(before.reviews)
  await expect(h.call(decide(read, { kind: 'no-op' }), 'initiative_review_decide')).rejects.toThrow('changed')
})

it('pins pagination to one context and rejects a newly added Candidate', async () => {
  const h = await setup(); const reviewId = await h.review()
  await h.humanOK(propose('one')); await h.humanOK(propose('two'))
  const first = await h.call({ reviewId, limit: 1 })
  const second = await h.call({ reviewId, offset: 1, limit: 1, expectedContextDigest: first.contextDigest })
  expect(second.contextDigest).toBe(first.contextDigest)
  await h.humanOK(propose('three'))
  await expect(h.call({ reviewId, offset: 1, expectedContextDigest: first.contextDigest })).rejects.toThrow('changed')
  await expect(h.call(decide(first, { kind: 'create', candidateKind: 'simplify', claim: 'Outdated comparison' }),
    'initiative_review_decide')).rejects.toThrow('changed')
})

it('settles a recovered prepared Planning conflict so the Review can be decided again', async () => {
  const h = await setup(); const reviewId = await h.review()
  const read = await h.call({ reviewId })
  const input = decide(read, { kind: 'create', candidateKind: 'simplify', claim: 'Frozen comparison' })
  vi.spyOn(h.ctx.initiative, 'execute').mockRejectedValueOnce(new Error('before Candidate write'))
  await expect(h.call(input, 'initiative_review_decide')).rejects.toThrow('before Candidate write')
  const board = await h.ctx.planning.snapshot(h.access())
  const revision = board.items[0]!.revisions[0]!
  await h.ctx.planning.execute(h.access(), { kind: 'create', requestId: 'new-followup', expectedBoardVersion: board.version,
    itemId: 'new-followup', fromReviewId: reviewId, lane: 'inbox', reviewAt: null, title: 'Existing remedy', intent: 'Already handled',
    scope: [], acceptance: [], estimate: revision.estimate, sources: [{ kind: 'manual', text: 'Concurrent follow-up' }] })
  await expect(h.call(input, 'initiative_review_decide')).rejects.toThrow('changed')
  const record = h.ctx.storageDomain.get('initiative_review_decisions')!.table('workspaces').get(h.workspace.id) as {
    reviews: Record<string, Array<{ phase: string }>>
  }
  expect(record.reviews[reviewId]!.at(-1)!.phase).toBe('conflict')
  const next = await h.call({ reviewId })
  expect((await h.call(decide(next, { kind: 'no-op' }), 'initiative_review_decide')).phase).toBe('committed')
  expect((await h.read()).total).toBe(0)
})

it('replays a lost acknowledgement before checking later Candidate and Planning changes', async () => {
  const h = await setup(); const reviewId = await h.review(); const read = await h.call({ reviewId })
  const input = decide(read, { kind: 'create', candidateKind: 'simplify', claim: 'One recorded decision' })
  const table = h.ctx.storageDomain.get('initiative_review_decisions')!.table('workspaces')
  const put = table.put.bind(table); let writes = 0
  vi.spyOn(table, 'put').mockImplementation(async (...args) => { if (++writes === 2) throw new Error('receipt lost'); return put(...args) })
  await expect(h.call(input, 'initiative_review_decide')).rejects.toThrow('receipt lost')
  await h.humanOK(propose('later-candidate'))
  const board = await h.ctx.planning.snapshot(h.access())
  await h.ctx.planning.execute(h.access(), { kind: 'create', requestId: 'later-followup', expectedBoardVersion: board.version,
    itemId: 'later-followup', fromReviewId: reviewId, lane: 'inbox', reviewAt: null, title: 'Later remedy', intent: 'After the Candidate committed',
    scope: [], acceptance: [], estimate: board.items[0]!.revisions[0]!.estimate, sources: [{ kind: 'manual', text: 'Later observation' }] })
  expect((await h.call(input, 'initiative_review_decide')).phase).toBe('committed')
  expect((await h.read()).total).toBe(2)
  expect((await h.call({ reviewId }) as View & { drift: boolean }).drift).toBe(true)
})

it('creates once, retains unknown evidence, and replays after restart without changing Planning', async () => {
  let h = await setup(); const id = await h.review(); const before = await h.ctx.planning.snapshot(h.access())
  const read = await h.call({ reviewId: id })
  expect(read.trustedAcceptance).toBe('unknown')
  const input = decide(read, { kind: 'create', candidateKind: 'simplify', claim: 'Remove repeated manual checking.' })
  const result = await h.call(input, 'initiative_review_decide')
  expect(result.phase).toBe('committed')
  expect((await h.read()).total).toBe(1)
  expect((await h.read()).entries[0]!.revision.facts.evidenceRefs[0]).toMatchObject({ owner: 'planning', kind: 'review', id, verification: 'unverified' })
  const root = h.root; await h.close(); h = await setup(root)
  expect(await h.call(input, 'initiative_review_decide')).toEqual(result)
  expect((await h.read()).total).toBe(1)
  expect(await h.ctx.planning.snapshot(h.access())).toEqual(before)
})

it('enriches a Candidate without replacing earlier facts or origin', async () => {
  const h = await setup(); const candidate = await h.humanOK(propose())
  const original = (await h.read(candidate.id)).entries[0]!
  const read = await h.call({ reviewId: await h.review(), candidateId: candidate.id })
  const input = decide(read, { kind: 'enrich', candidateId: candidate.id, expectedRecordVersion: 1, expectedCandidateVersion: 1,
    observation: 'The outcome repeats the same costly manual check.' })
  await h.call(input, 'initiative_review_decide')
  const updated = (await h.read(candidate.id)).entries[0]!
  expect(updated.candidate.origin).toEqual(original.candidate.origin)
  expect(updated.revision.facts.claim).toEqual(original.revision.facts.claim)
  expect(updated.revision.facts.evidenceRefs).toHaveLength(1)
  expect(updated.revision.facts.evidenceRefs[0]!.excerpt).toBe('The outcome repeats the same costly manual check.')
  expect((await h.read()).total).toBe(1)
})

it('persists no-op and does not turn a duplicate into a Candidate', async () => {
  const h = await setup(); const read = await h.call({ reviewId: await h.review('Resolved by removing the unused path; no outstanding issue.') })
  const input = decide(read, { kind: 'no-op' })
  const result = await h.call(input, 'initiative_review_decide')
  expect(result).toMatchObject({ phase: 'committed', decision: { kind: 'no-op' } })
  expect(await h.call(decide(read, { kind: 'create', candidateKind: 'problem', claim: 'Duplicate' }), 'initiative_review_decide')).toEqual(result)
  expect((await h.read()).total).toBe(0)
})

it('recovers the original Candidate receipt after a lost bridge settlement', async () => {
  let h = await setup(); const read = await h.call({ reviewId: await h.review() })
  const input = decide(read, { kind: 'create', candidateKind: 'improvement', claim: 'A bounded improvement' })
  const table = h.ctx.storageDomain.get('initiative_review_decisions')!.table('workspaces')
  const put = table.put.bind(table); let writes = 0
  vi.spyOn(table, 'put').mockImplementation(async (...args) => { if (++writes === 2) throw new Error('settlement lost'); return put(...args) })
  await expect(h.call(input, 'initiative_review_decide')).rejects.toThrow('settlement lost')
  expect((await h.read()).total).toBe(1)
  const root = h.root; await h.close(); h = await setup(root)
  expect((await h.call(input, 'initiative_review_decide')).phase).toBe('committed')
  expect((await h.read()).total).toBe(1)
})

it('rejects stale input and a broad tool surface through the executor', async () => {
  const h = await setup(); const read = await h.call({ reviewId: await h.review() })
  await expect(h.call({ ...decide(read, { kind: 'no-op' }), expectedContextDigest: '0'.repeat(64) }, 'initiative_review_decide')).rejects.toThrow('changed')
  expect((await h.tool(propose())).isError).toBe(true)
  await h.lift()
  await expect(h.call(decide(read, { kind: 'no-op' }), 'initiative_review_decide')).rejects.toThrow('restricted')
  expect((await h.read()).total).toBe(0)
})

it('serializes duplicate decisions and preserves no-op across restart', async () => {
  let h = await setup(); const read = await h.call({ reviewId: await h.review('Already resolved.') })
  const input = decide(read, { kind: 'no-op' })
  const [a, b] = await Promise.all([h.call(input, 'initiative_review_decide'), h.call(input, 'initiative_review_decide')])
  expect(a).toEqual(b)
  const root = h.root; await h.close(); h = await setup(root)
  expect(await h.call(input, 'initiative_review_decide')).toEqual(a)
  expect((await h.read()).total).toBe(0)
})

it('records a definite Candidate race as conflict, then permits a fresh bounded decision', async () => {
  const h = await setup(); const candidate = await h.humanOK(propose())
  const read = await h.call({ reviewId: await h.review() })
  const input = decide(read, { kind: 'enrich', candidateId: candidate.id, expectedRecordVersion: 1, expectedCandidateVersion: 1, observation: 'Related outcome.' })
  const execute = h.ctx.initiative.execute.bind(h.ctx.initiative)
  vi.spyOn(h.ctx.initiative, 'execute').mockImplementationOnce(async (...args) => {
    await h.humanOK(investigate(candidate, 'concurrent-investigation'))
    return execute(...args)
  })
  await expect(h.call(input, 'initiative_review_decide')).rejects.toThrow('changed')
  const fresh = await h.call({ reviewId: read.review.id })
  expect(fresh.version).toBe(1)
  const next = decide(fresh, { kind: 'enrich', candidateId: candidate.id, expectedRecordVersion: 2, expectedCandidateVersion: 2, observation: 'Related outcome.' })
  const result = await h.call(next, 'initiative_review_decide')
  expect(result).toMatchObject({ phase: 'committed', version: 2, result: { headVersion: 3 } })
  const facts = (await h.read(candidate.id)).entries[0]!.revision.facts
  expect(facts.counterEvidenceRefs).toHaveLength(1)
  expect(facts.evidenceRefs).toHaveLength(2)
})

it('rejects stale authority before a no-op commit and refuses an oversized complete read', async () => {
  const h = await setup(); const read = await h.call({ reviewId: await h.review() })
  const flush = h.ctx.sessions.flush.bind(h.ctx.sessions)
  vi.spyOn(h.ctx.sessions, 'flush').mockImplementationOnce(async (session) => { h.unregister(); return flush(session) })
  await expect(h.call(decide(read, { kind: 'no-op' }), 'initiative_review_decide')).rejects.toThrow('same live Agent')
  expect(h.ctx.storageDomain.get('initiative_review_decisions')!.table('workspaces').get(h.workspace.id)).toBeUndefined()
  const small = await setup(undefined, { maxOutputBytes: 512 })
  await expect(small.call({ reviewId: await small.review('字'.repeat(1000)) })).rejects.toThrow('output exceeds')
  expect((await small.read()).total).toBe(0)
})

it('pins model guidance and removes Tools and ownership on Loader disposal', async () => {
  const h = await setup()
  const assembly = await h.ctx.systemPrompt.assemble({ scope: h.agent })
  await expect(JSON.stringify({ sections: assembly.sections.filter(section => section.name === 'tool:initiative-review'),
    tools: h.ctx.tools.schemas(h.agent) }, null, 2) + '\n').toMatchFileSnapshot('./expected/model-contract.json')
  const entry = [...h.ctx.loader.entries()].find(entry => entry.options.name === 'review-consumer')!
  await entry.parent.tree.remove(entry.options.id)
  expect(h.ctx.tools.schemas(h.agent)).toEqual([])
  expect((await h.ctx.systemPrompt.assemble({ scope: h.agent })).sections.some(section => section.name === 'tool:initiative-review')).toBe(false)
})

it('permits another Session to replay only after the original prepared write is settled', async () => {
  const h = await setup(); const read = await h.call({ reviewId: await h.review() })
  const input = decide(read, { kind: 'create', candidateKind: 'simplify', claim: 'Narrow repeated manual work.' })
  const table = h.ctx.storageDomain.get('initiative_review_decisions')!.table('workspaces')
  const put = table.put.bind(table); let writes = 0
  vi.spyOn(table, 'put').mockImplementation(async (...args) => { if (++writes === 2) throw new Error('lost acknowledgement'); return put(...args) })
  await expect(h.call(input, 'initiative_review_decide')).rejects.toThrow('lost acknowledgement')
  const session = h.ctx.sessions.create(SessionId('replacement-session'), { meta: { cwd: h.cwd } })
  session.append('turn/start', { turn: 1 })
  const replacement = { ...h.agent, id: session.id, session }
  await h.ctx.plugin(Object.assign((ctx: Context) => {
    const scope = createScope(ctx, replacement); replacement.ctx = scope.ctx
    scope.ctx.tools.restrict({ allow: ['initiative_review_read', 'initiative_review_decide'] })
  }, { inject: ['tools'] }))
  const unregister = h.ctx.agents.register(replacement)
  try {
    const replay = () => h.ctx.tools.execute({ name: 'initiative_review_decide', agent: replacement,
      arguments: { input_json: JSON.stringify(input) }, callId: ToolCallId('replacement-replay'), signal: new AbortController().signal })
    expect(await replay()).toMatchObject({ isError: true })
    const result = await h.call(input, 'initiative_review_decide')
    const settled = await replay()
    expect(settled.isError).toBe(false)
    expect(settled.content[0]!.type === 'text' ? JSON.parse(settled.content[0]!.text) : null).toEqual(result)
    expect((await h.read()).total).toBe(1)
  } finally { unregister() }
})
