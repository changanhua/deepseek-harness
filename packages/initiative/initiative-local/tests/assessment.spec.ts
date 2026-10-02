import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { initiativeCommandSchema } from '@changanhua/dsh-initiative'
import { AssessmentError } from '@changanhua/dsh-requirement-assessment'
import { boot, investigate, promotion, propose } from './harness.ts'
import { assessmentRelations, candidateReviewSource } from '../src/assessment.ts'
import { evaluation } from '../../../requirement-assessment/requirement-assessment/tests/fixtures.ts'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
class Adapter extends LlmAdapter {
  calls = 0
  requests: GenerateOptions[] = []
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls++; this.requests.push(options)
    expect(options.tools).toEqual([])
    const text = JSON.stringify(evaluation)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
async function setup(adapter?: Adapter) { const h = await boot(undefined, undefined, adapter); cleanup.push(h.dispose); return h }

it('requires ASSESSABLE before a new review and replays the accepted request without another model call', async () => {
  const adapter = new Adapter(), h = await setup(adapter)
  const created = await h.humanOK(propose())
  const before = await h.ctx.planning.snapshot(h.access())
  const denied = await h.human({ action: 'assess', key: 'review-too-early', id: created.id, version: 1 })
  expect(denied.kind).toBe('error')
  expect(denied.text).toContain('invalid-transition')
  expect(adapter.calls).toBe(0)
  expect((await h.ctx.requirementAssessment.snapshot(h.access())).assessments).toEqual([])
  const ready = await h.humanOK(investigate(created))
  const command = { action: 'assess', key: 'review-ready', id: ready.id, version: ready.headVersion }
  const assessed = await h.humanOK(command)
  expect(assessed.assessmentId).toBeDefined()
  expect(adapter.calls).toBe(1)
  expect(await h.humanOK(command)).toEqual(assessed)
  expect(adapter.calls).toBe(1)
  expect(await h.ctx.planning.snapshot(h.access())).toEqual(before)
  await h.humanOK({ ...promotion(ready), assessmentId: assessed.assessmentId })
  expect(await h.humanOK(command)).toEqual(assessed)
  expect(adapter.calls).toBe(1)
})

it('REAL Human commands assess an exact revision, expose drift and recover selected pending promotion without rebilling', async () => {
  const adapter = new Adapter()
  let h = await setup(adapter)
  const before = await h.ctx.planning.snapshot(h.access())
  const created = await h.humanOK(propose())
  const ready = await h.humanOK(investigate(created))
  const command = { action: 'assess', key: 'review-r2', id: ready.id, version: 2 }
  const assessed = await h.humanOK(command)
  const original = await h.ctx.requirementAssessment.get(h.access(), assessed.assessmentId!)
  expect(original.subject).toMatchObject({ kind: 'candidate', id: created.id, revision: 2 })
  expect(original.baseline.workspace).toBe(h.workspace.id)
  expect(original.baseline.planRevision).toBeUndefined()
  expect(original.actualInput.evidence[0]).toMatchObject({ provenance: 'owner_observation', verification: 'verified' })
  expect((await h.read(ready.id)).entries[0]!.rir).toMatchObject({ availability: 'available', assessments: [{ id: original.id, state: 'fresh' }] })
  expect(await h.humanOK(command)).toEqual(assessed)
  expect(adapter.calls).toBe(1)
  expect(await h.ctx.planning.snapshot(h.access())).toEqual(before)
  expect(h.ctx.get('delivery')).toBeUndefined()
  const refined = await h.humanOK(investigate(ready, 'refine-r3'))
  expect((await h.read(ready.id)).entries[0]!.rir.assessments[0]).toMatchObject({ candidateVersion: 2, state: 'drift' })
  expect(await h.ctx.requirementAssessment.get(h.access(), original.id)).toEqual(original)
  expect(await h.humanOK(command)).toEqual(assessed)
  expect((await h.human({ ...command, version: 3 })).text).toContain('idempotency-conflict')
  const selected = { ...promotion(refined), assessmentId: original.id }
  vi.spyOn(h.ctx.planning, 'execute').mockRejectedValueOnce(new Error('before Planning commit'))
  await expect(h.human(selected)).rejects.toThrow('before Planning commit')
  const frozen = (await h.read(ready.id)).entries[0]!.candidate.promotion!
  expect(frozen).toMatchObject({ phase: 'prepared', candidateVersion: 3, assessment: { id: original.id, baseline: original.baseline } })
  const root = h.root
  await h.close(); h = await boot(root, undefined, adapter); cleanup.push(h.close)
  expect(await h.humanOK(command)).toEqual(assessed)
  const promoted = await h.humanOK(selected)
  expect(await h.humanOK(selected)).toEqual(promoted)
  expect((await h.human({ ...selected, assessmentId: 'another-assessment' })).text).toContain('idempotency-conflict')
  expect(adapter.calls).toBe(1)
  const board = await h.ctx.planning.snapshot(h.access())
  expect(board.items).toEqual(before.items); expect(board.handoffs).toEqual(before.handoffs)
  expect(board.proposals).toHaveLength(1)
  const draft = board.proposals[0]!.generations[0]!.draft
  expect(board.proposals[0]!.status).toBe('pending')
  const baselineDigest = createHash('sha256').update(JSON.stringify(original.baseline)).digest('hex')
  expect(draft.stateEntries![0]!.sourceRefs).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'initiative-candidate', id: created.id, revision: '3' }),
    expect.objectContaining({ kind: 'requirement-assessment', id: original.id }),
    expect.objectContaining({ kind: 'requirement-assessment-baseline', id: original.id, revision: baselineDigest }),
  ]))
  await h.close(); h = await boot(root); cleanup.push(h.close)
  expect(await h.humanOK(selected)).toEqual(promoted)
  expect((await h.read(ready.id)).entries[0]!.rir.availability).toBe('unavailable')
})

it('rejects forged, foreign, missing and wrong-revision Assessment selections before preparing a Proposal', async () => {
  const adapter = new Adapter(), h = await setup(adapter)
  const ready = await h.humanOK(investigate(await h.humanOK(propose())))
  const assessed = await h.humanOK({ action: 'assess', key: 'review', id: ready.id, version: 2 })
  const original = await h.ctx.requirementAssessment.get(h.access(), assessed.assessmentId!)
  const source = candidateReviewSource({ ...(await h.read(ready.id)).entries[0]!.candidate,
    revisions: [(await h.read(ready.id, 1)).entries[0]!.revision, (await h.read(ready.id, 2)).entries[0]!.revision],
    investigations: [], dispositions: [] }, 2)
  await expect(h.ctx.requirementAssessmentReview.review(h.access(), { requestId: 'forged', subject: source.subject })).rejects.toMatchObject({ code: 'invalid-input' })
  await expect(h.ctx.requirementAssessmentReview.review(h.access(), { requestId: 'corrupt-source', subject: source.subject }, undefined,
    { ...source, text: `${source.text}corruption` })).rejects.toMatchObject({ code: 'invalid-input' })
  const fullCandidate = { ...(await h.read(ready.id)).entries[0]!.candidate, revisions: [(await h.read(ready.id, 1)).entries[0]!.revision,
    (await h.read(ready.id, 2)).entries[0]!.revision], investigations: [], dispositions: [] }
  expect(assessmentRelations(fullCandidate, [{ ...original, workspaceId: 'foreign' }]).assessments[0]?.state).toBe('unknown')
  expect((await h.human({ action: 'assess', key: 'spoof', id: ready.id, version: 2, actor: 'human' })).kind).toBe('error')
  expect((await h.human({ action: 'assess', key: 'missing-version', id: ready.id, version: 999 })).text).toContain('not-found')
  h.session.append('turn/start', { turn: 1 })
  await expect(h.ctx.initiative.execute(h.agent, initiativeCommandSchema.parse({ action: 'assess', key: 'agent', id: ready.id, version: 2 }))).rejects.toMatchObject({ code: 'unauthorized' })
  const foreignWorkspace = await h.ctx.workspaceRegistry.create(h.root)
  const foreignAccess = { ...h.access(), workspaceId: foreignWorkspace.id }
  const { id: _id, workspaceId: _workspace, createdAt: _at, createdBy: _actor, mode: _mode, ...input } = original
  const foreign = await h.ctx.requirementAssessment.create(foreignAccess, { ...input, requestId: 'foreign', baseline: { ...input.baseline, workspace: foreignWorkspace.id } })
  const subject = { ...source.subject, revision: 999 }
  const wrongVersion = await h.ctx.requirementAssessment.create(h.access(), { ...input, requestId: 'wrong-version', subject, baseline: { ...input.baseline, subject } })
  const forgedSubject = { ...source.subject, digest: '0'.repeat(64) }
  const forged = await h.ctx.requirementAssessment.create(h.access(), { ...input, requestId: 'wrong-digest', subject: forgedSubject, baseline: { ...input.baseline, subject: forgedSubject } })
  const relations = (await h.read(ready.id)).entries[0]!.rir.assessments
  expect(relations.find(value => value.id === wrongVersion.id)?.state).toBe('unavailable')
  expect(relations.find(value => value.id === forged.id)?.state).toBe('unknown')
  for (const id of ['missing', foreign.id, wrongVersion.id, forged.id]) {
    expect((await h.human({ ...promotion(ready, `select-${id}`), assessmentId: id })).kind).toBe('error')
    expect((await h.read(ready.id)).entries[0]!.candidate.promotion).toBeUndefined()
  }
  expect((await h.ctx.planning.snapshot(h.access())).proposals).toEqual([])
  expect(adapter.calls).toBe(1)
  vi.spyOn(h.ctx.requirementAssessment, 'snapshot').mockRejectedValueOnce(new AssessmentError('closed', 'provider closed'))
  expect((await h.read(ready.id)).entries[0]!.rir).toEqual({ availability: 'unavailable', assessments: [] })
})

it('does not dispatch a paid review after Agent authority is lost during call preparation', async () => {
  const adapter = new Adapter(), h = await setup(adapter)
  const candidate = await h.humanOK(investigate(await h.humanOK(propose())))
  const prepare = h.ctx.llm.prepareCall.bind(h.ctx.llm)
  vi.spyOn(h.ctx.llm, 'prepareCall').mockImplementationOnce(async (...args) => {
    const prepared = await prepare(...args)
    h.unregister()
    return prepared
  })
  const denied = await h.human({ action: 'assess', key: 'scope-lost', id: candidate.id, version: candidate.headVersion })
  expect(denied.kind).toBe('error')
  expect(denied.text).toContain('unauthorized')
  expect(adapter.calls).toBe(0)
  expect((await h.ctx.requirementAssessment.snapshot(h.access())).assessments).toEqual([])
})

it('reports missing RIR and recovers after Assessment commit but before the Candidate receipt', async () => {
  let h = await setup()
  const created = await h.humanOK(investigate(await h.humanOK(propose())))
  expect((await h.human({ action: 'assess', key: 'review', id: created.id, version: created.headVersion })).text).toContain('unavailable')
  const root = h.root; await h.close()
  const adapter = new Adapter(); h = await boot(root, undefined, adapter); cleanup.push(h.close)
  const table = h.ctx.storageDomain.get('initiative_candidates')!.table('workspaces')
  vi.spyOn(table, 'put').mockRejectedValueOnce(new Error('lost Candidate receipt'))
  const command = { action: 'assess', key: 'review', id: created.id, version: created.headVersion }
  await expect(h.human(command)).rejects.toThrow('lost Candidate receipt')
  expect((await h.ctx.requirementAssessment.snapshot(h.access())).assessments).toHaveLength(1)
  const view = (await h.read(created.id)).entries[0]!
  const source = candidateReviewSource({ ...view.candidate, revisions: [view.revision], investigations: [], dispositions: [] },
    created.headVersion)
  await expect(h.ctx.requirementAssessmentReview.review({ ...h.access(), actorId: 'another-human' },
    { requestId: 'review', subject: source.subject }, undefined, source)).rejects.toMatchObject({ code: 'idempotency-conflict' })
  expect(adapter.calls).toBe(1)
  await h.close(); h = await boot(root, undefined, adapter); cleanup.push(h.close)
  expect((await h.humanOK(command)).assessmentId).toBeDefined()
  expect(adapter.calls).toBe(1)
})
