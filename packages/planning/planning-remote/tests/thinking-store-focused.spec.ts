import { afterEach, expect, it } from 'vitest'
import { SbcDesignCaseStore } from '../src/sbc-design-case.ts'
import { createPlanningHarness } from '../../planning-local/tests/harness.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const dispose of cleanups.splice(0)) await dispose() })
const signal = () => new AbortController().signal

it('freezes one current Planning context and Case version for a prepared Thinking run', async () => {
  const h = await createPlanningHarness()
  cleanups.push(h.dispose)
  const created = await h.ctx.planning.execute(h.access(), h.create('seed'))
  const input = { workspaceId: h.workspace.id, subject: { kind: 'plan' as const, id: created.itemId! } }
  const store = await SbcDesignCaseStore.open(h.ctx.storageDomain, { maxCases: 10, maxCaseBytes: 1024 * 1024 })
  cleanups.push(() => store.close())
  await store.read(input, () => h.ctx.planning.snapshot(h.access()), signal())
  const prepared = await store.prepareThinking({ ...input, expectedCaseVersion: 0, runId: 'run-1', sessionId: 'session-1',
    question: '最小纵切在哪里？', requestId: 'prepare-1', bindRequestId: 'bind-1', promptRequestId: 'prompt-1' },
  () => h.ctx.planning.snapshot(h.access()), signal())
  expect(prepared.runs[0]).toMatchObject({
    id: 'run-1', planningRevisionAtStart: created.revisionId, caseVersionAtStart: 0,
    context: { planning: { revisionAtStart: created.revisionId, context: { plan: { revision: created.revisionId } } } },
    startup: { phase: 'prepared', bindRequestId: 'bind-1', promptRequestId: 'prompt-1' },
  })
  expect(prepared.design.case.version).toBe(0)
})

it('refuses a result before the exact Planning binding advances startup', async () => {
  const h = await createPlanningHarness(); cleanups.push(h.dispose)
  const created = await h.ctx.planning.execute(h.access(), h.create('seed'))
  const input = { workspaceId: h.workspace.id, subject: { kind: 'plan' as const, id: created.itemId! } }
  const store = await SbcDesignCaseStore.open(h.ctx.storageDomain, { maxCases: 10, maxCaseBytes: 1024 * 1024 })
  cleanups.push(() => store.close())
  await store.read(input, () => h.ctx.planning.snapshot(h.access()), signal())
  await store.prepareThinking({ ...input, expectedCaseVersion: 0, runId: 'run-1', sessionId: 'session-1', question: 'q', requestId: 'prepare', bindRequestId: 'bind', promptRequestId: 'prompt' }, () => h.ctx.planning.snapshot(h.access()), signal())
  await expect(store.submitThinking({ ...input, runId: 'run-1', expectedResultVersion: 0, requestId: 'result', draft: { summary: 's', findings: [], openQuestions: [] } }, () => h.ctx.planning.snapshot(h.access()), signal())).rejects.toMatchObject({ code: 'unauthorized' })
})

it('rejects startup jumps and reused run identities', async () => {
  const h = await createPlanningHarness(); cleanups.push(h.dispose)
  const created = await h.ctx.planning.execute(h.access(), h.create('seed'))
  const input = { workspaceId: h.workspace.id, subject: { kind: 'plan' as const, id: created.itemId! } }
  const store = await SbcDesignCaseStore.open(h.ctx.storageDomain, { maxCases: 10, maxCaseBytes: 1024 * 1024 })
  cleanups.push(() => store.close())
  await store.read(input, () => h.ctx.planning.snapshot(h.access()), signal())
  const prepare = { ...input, expectedCaseVersion: 0, runId: 'run-1', sessionId: 'session-1', question: 'q', requestId: 'prepare', bindRequestId: 'bind', promptRequestId: 'prompt' }
  await store.prepareThinking(prepare, () => h.ctx.planning.snapshot(h.access()), signal())
  await expect(store.advanceThinking({ ...input, runId: 'run-1', expectedRunVersion: 0, requestId: 'jump', phase: 'planning-bound' }, () => h.ctx.planning.snapshot(h.access()), signal())).rejects.toMatchObject({ code: 'conflict' })
  await expect(store.prepareThinking({ ...prepare, requestId: 'other', question: 'different' }, () => h.ctx.planning.snapshot(h.access()), signal())).rejects.toMatchObject({ code: 'idempotency-conflict' })
})

it('applies one result notes once across retries and concurrent requests', async () => {
  const h = await createPlanningHarness(); cleanups.push(h.dispose)
  const created = await h.ctx.planning.execute(h.access(), h.create('seed'))
  const input = { workspaceId: h.workspace.id, subject: { kind: 'plan' as const, id: created.itemId! } }
  const store = await SbcDesignCaseStore.open(h.ctx.storageDomain, { maxCases: 10, maxCaseBytes: 1024 * 1024 })
  cleanups.push(() => store.close())
  const read = () => h.ctx.planning.snapshot(h.access())
  await store.read(input, read, signal())
  await store.prepareThinking({ ...input, expectedCaseVersion: 0, runId: 'run-1', sessionId: 'session-1', question: 'q', requestId: 'prepare', bindRequestId: 'bind', promptRequestId: 'prompt' }, read, signal())
  await store.advanceThinking({ ...input, runId: 'run-1', expectedRunVersion: 0, requestId: 'session', phase: 'session-created' }, read, signal())
  await store.advanceThinking({ ...input, runId: 'run-1', expectedRunVersion: 1, requestId: 'bound', phase: 'planning-bound' }, read, signal())
  const result = await store.submitThinking({ ...input, runId: 'run-1', expectedResultVersion: 0, requestId: 'result', draft: { summary: 's', findings: [], openQuestions: [], explorationNotes: [{ title: 'note' }] } }, read, signal())
  const apply = { ...input, runId: 'run-1', resultId: result.id, resultVersion: result.version, expectedCaseVersion: 0, requestId: 'apply', kind: 'notes' as const }
  const first = await store.applyThinking(apply, read, signal())
  const retry = await store.applyThinking(apply, read, signal())
  const replay = await store.applyThinking({ ...apply, requestId: 'apply-other', expectedCaseVersion: 1 }, read, signal())
  expect(retry).toEqual(first)
  expect(replay.design.case.notes).toHaveLength(1)
  const concurrent = await Promise.all([store.applyThinking({ ...apply, requestId: 'apply-concurrent-a', expectedCaseVersion: 1 }, read, signal()), store.applyThinking({ ...apply, requestId: 'apply-concurrent-b', expectedCaseVersion: 1 }, read, signal())])
  expect(concurrent[0].design.case.notes).toHaveLength(1)
  expect(concurrent[1].design.case.notes).toHaveLength(1)
})

it('freezes semantic selected-node content for Plan, state entry, Focus and note', async () => {
  const h = await createPlanningHarness(); cleanups.push(h.dispose)
  const created = await h.ctx.planning.execute(h.access(), { ...h.create('seed'), stateEntries: [{ id: 'entry-1', kind: 'accepted', content: 'Entry body' }] })
  await h.ctx.planning.execute(h.access(), { kind: 'workspace-change', requestId: 'focus', expectedBoardVersion: created.boardVersion,
    subject: { kind: 'plan', id: created.itemId! }, baseRevision: created.revisionId!, operations: [{ kind: 'create-focus', id: 'focus-1', title: 'Focus title', objective: 'Focus body' }] })
  const store = await SbcDesignCaseStore.open(h.ctx.storageDomain, { maxCases: 10, maxCaseBytes: 1024 * 1024 })
  cleanups.push(() => store.close())
  const read = () => h.ctx.planning.snapshot(h.access())
  const plan = { workspaceId: h.workspace.id, subject: { kind: 'plan' as const, id: created.itemId! } }
  const focus = { workspaceId: h.workspace.id, subject: { kind: 'focus' as const, id: 'focus-1' } }
  const selections = [[plan, `plan:${created.itemId!}`, 'Provider plan', ''],
    [plan, 'entry:entry-1', 'accepted', 'Entry body'], [focus, 'focus:focus-1', 'Focus title', 'Focus body']] as const
  for (const [index, [item, nodeId, title, body]] of selections.entries()) {
    const opened = await store.read(item, read, signal())
    const selected = await store.explore({ ...item, expectedVersion: opened.case.version, requestId: `select-${index}`, operation: { kind: 'select', nodeId } } as never, read, signal())
    const view = await store.prepareThinking({ ...item, expectedCaseVersion: selected.case.version, runId: `run-${index}`, sessionId: `session-${index}`, question: 'q', requestId: `prepare-${index}`, bindRequestId: `bind-${index}`, promptRequestId: `prompt-${index}` } as never, read, signal())
    expect(view.runs.at(-1)!.context.designCase.selectedNode).toMatchObject({ title, ...(body ? { body } : {}) })
  }
})

it('rejects multibyte Context and Result output over 64 KiB before persistence', async () => {
  const h = await createPlanningHarness(); cleanups.push(h.dispose)
  const created = await h.ctx.planning.execute(h.access(), { ...h.create('seed'), stateEntries: Array.from({ length: 6 }, (_, index) => ({ id: `entry-${index}`, kind: 'open' as const, content: '你'.repeat(4000) })) })
  const input = { workspaceId: h.workspace.id, subject: { kind: 'plan' as const, id: created.itemId! } }
  const store = await SbcDesignCaseStore.open(h.ctx.storageDomain, { maxCases: 10, maxCaseBytes: 2 * 1024 * 1024 })
  cleanups.push(() => store.close())
  const read = () => h.ctx.planning.snapshot(h.access())
  await store.read(input, read, signal())
  await expect(store.prepareThinking({ ...input, expectedCaseVersion: 0, runId: 'oversize-context', sessionId: 'session-1', question: 'q', requestId: 'prepare', bindRequestId: 'bind', promptRequestId: 'prompt' }, read, signal())).rejects.toMatchObject({ code: 'capacity-exceeded' })
  expect((await store.readThinking(input, read, signal())).runs).toHaveLength(0)
  const normal = await h.ctx.planning.execute(h.access(), { ...h.create('normal', 1), itemId: 'normal-plan' })
  const normalInput = { workspaceId: h.workspace.id, subject: { kind: 'plan' as const, id: normal.itemId! } }
  await store.read(normalInput, read, signal())
  await store.prepareThinking({ ...normalInput, expectedCaseVersion: 0, runId: 'oversize-result', sessionId: 'session-2', question: 'q', requestId: 'prepare-result', bindRequestId: 'bind-result', promptRequestId: 'prompt-result' }, read, signal())
  await store.advanceThinking({ ...normalInput, runId: 'oversize-result', expectedRunVersion: 0, requestId: 'session-result', phase: 'session-created' }, read, signal())
  await store.advanceThinking({ ...normalInput, runId: 'oversize-result', expectedRunVersion: 1, requestId: 'bound-result', phase: 'planning-bound' }, read, signal())
  await expect(store.submitThinking({ ...normalInput, runId: 'oversize-result', expectedResultVersion: 0, requestId: 'result', draft: { summary: '你'.repeat(8192), findings: Array.from({ length: 8 }, () => '你'.repeat(8192)), openQuestions: [] } }, read, signal())).rejects.toMatchObject({ code: 'capacity-exceeded' })
  expect((await store.readThinking(normalInput, read, signal())).runs[0]!.results).toHaveLength(0)
})

it('retries a recorded Planning CAS conflict with one proposal and recovers a delayed receipt', async () => {
  const h = await createPlanningHarness(); cleanups.push(h.dispose)
  const created = await h.ctx.planning.execute(h.access(), h.create('seed'))
  const input = { workspaceId: h.workspace.id, subject: { kind: 'plan' as const, id: created.itemId! } }
  const store = await SbcDesignCaseStore.open(h.ctx.storageDomain, { maxCases: 10, maxCaseBytes: 1024 * 1024 })
  cleanups.push(() => store.close())
  const read = () => h.ctx.planning.snapshot(h.access())
  await store.read(input, read, signal())
  await store.prepareThinking({ ...input, expectedCaseVersion: 0, runId: 'run', sessionId: 'session', question: 'q', requestId: 'prepare', bindRequestId: 'bind', promptRequestId: 'prompt' }, read, signal())
  await store.advanceThinking({ ...input, runId: 'run', expectedRunVersion: 0, requestId: 'session', phase: 'session-created' }, read, signal())
  await store.advanceThinking({ ...input, runId: 'run', expectedRunVersion: 1, requestId: 'bound', phase: 'planning-bound' }, read, signal())
  const result = await store.submitThinking({ ...input, runId: 'run', expectedResultVersion: 0, requestId: 'result', draft: { summary: 's', findings: [], openQuestions: [], planningDelta: { operations: [{ kind: 'add-state-entry', entry: { id: 'agent-entry', kind: 'open', content: 'candidate' } }] } } }, read, signal())
  const first = await store.prepareThinkingProposal({ ...input, runId: 'run', resultId: result.id, resultVersion: result.version, requestId: 'proposal-1' }, read, signal())
  await h.ctx.planning.execute(h.access(), { ...h.create('unrelated', (await read()).version), itemId: 'unrelated-plan' })
  await expect(h.ctx.planning.execute(h.access(), first.submission.attempts[0]!.command)).rejects.toMatchObject({ code: 'conflict' })
  await store.recordThinkingProposal({ ...input, runId: 'run', resultId: result.id, resultVersion: result.version, commandRequestId: 'proposal-1', conflict: true }, read, signal())
  const retry = await store.prepareThinkingProposal({ ...input, runId: 'run', resultId: result.id, resultVersion: result.version, requestId: 'proposal-2' }, read, signal())
  expect(retry.submission.proposalId).toBe(first.submission.proposalId)
  expect(retry.submission.attempts).toHaveLength(2)
  const receipt = await h.ctx.planning.execute(h.access(), retry.submission.attempts[1]!.command)
  const board = await read()
  await h.ctx.planning.execute(h.access(), { kind: 'accept-proposal', requestId: 'adopt', expectedBoardVersion: board.version, proposalId: receipt.proposalId!, expectedProposalVersion: receipt.proposalVersion! })
  const recovered = await store.recordThinkingProposal({ ...input, runId: 'run', resultId: result.id, resultVersion: result.version, commandRequestId: 'proposal-2', receipt }, read, signal())
  expect(recovered.runs[0]!.results[0]!.applied.planningProposalId).toBe(first.submission.proposalId)
  expect((await read()).proposals.filter(value => value.id === first.submission.proposalId)).toHaveLength(1)
})

it('creates and edits manual notes durably without modifying canonical Planning', async () => {
  const h = await createPlanningHarness(); cleanups.push(h.dispose)
  const created = await h.ctx.planning.execute(h.access(), h.create('manual-seed'))
  if (!created.itemId) throw new Error('Missing fixture plan')
  const input = { workspaceId: h.workspace.id, subject: { kind: 'plan' as const, id: created.itemId } }
  const store = await SbcDesignCaseStore.open(h.ctx.storageDomain, { maxCases: 10, maxCaseBytes: 1024 * 1024 })
  cleanups.push(() => store.close())
  const read = () => h.ctx.planning.snapshot(h.access())
  const before = await read()
  await store.read(input, read, signal())
  const request = { ...input, expectedVersion: 0, requestId: 'manual-add',
    operation: { kind: 'create-note' as const, title: 'My idea', body: 'A local thought', x: 120, y: 180 } }
  const added = await store.explore(request, read, signal())
  expect((await store.explore(request, read, signal())).case.notes).toHaveLength(1)
  const note = added.case.notes?.[0]
  if (!note) throw new Error('Missing manual note')
  expect(note).toMatchObject({ source: 'manual', title: 'My idea', position: { x: 120, y: 180 } })
  expect(note.sourceResultId).toBeUndefined()
  await expect(store.explore({ ...request, requestId: 'stale' }, read, signal())).rejects.toMatchObject({ code: 'conflict' })
  await store.explore({ ...input, expectedVersion: 1, requestId: 'manual-edit',
    operation: { kind: 'edit-note', nodeId: note.id, title: 'Revised', body: 'Updated content' } }, read, signal())
  expect((await store.read(input, read, signal())).case.notes?.[0]).toMatchObject({ title: 'Revised', body: 'Updated content' })
  await expect(store.explore({ ...input, expectedVersion: 2, requestId: 'edit-canonical',
    operation: { kind: 'edit-note', nodeId: `plan:${created.itemId}`, title: 'No', body: '' } }, read, signal()))
    .rejects.toMatchObject({ code: 'invalid-reference' })
  expect(await read()).toEqual(before)
})
