import { z } from 'zod'
import { createHash } from 'node:crypto'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { PlanningError, buildPlanningContext, planningSubjectRefSchema, planningRevisionSchema, planningFocusSchema,
  planningSubjectPlan } from '@changanhua/dsh-planning'
import type { PlanningBoardSnapshot } from '@changanhua/dsh-planning'
import type { PlanningContextInput, SbcDesignCaseView, SbcExploreInput } from './types.ts'
import type { AdvanceThinkingInput, ApplyThinkingInput, PrepareThinkingInput, SubmitThinkingInput, SubmitThinkingProposalInput,
  ThinkingCaseView, ThinkingProposalSubmission, ThinkingResultRecord, ThinkingReviewSnapshot,
  ThinkingRunInput } from './thinking-types.ts'
import { contextId, designContextSchema, explorationNoteSchema, noteId, now, parseDraft, proposalId, resultId, thinkingRunSchema,
  thinkingStateSchema } from './thinking-store.ts'

const id = z.string().min(1).max(256)
const nodeId = z.string().min(1).max(262)
const coordinate = z.number().min(0).max(20000)
const exploration = z.strictObject({
  positions: z.record(nodeId, z.strictObject({ x: coordinate, y: coordinate })),
  selectedNodeId: nodeId.nullable(),
})
/** Workspace and subject identity for an exploratory case. */
export const sbcCaseInputSchema = z.strictObject({ workspaceId: id, subject: planningSubjectRefSchema })
/** Bounded local operations with case CAS and retry identity. */
export const sbcExploreInputSchema = sbcCaseInputSchema.extend({
  expectedVersion: z.number().int().nonnegative(), requestId: id,
  operation: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('select'), nodeId: nodeId.nullable() }),
    z.strictObject({ kind: z.literal('move'), nodeId, x: coordinate, y: coordinate }),
    z.strictObject({ kind: z.literal('delete-note'), nodeId }),
    z.strictObject({ kind: z.literal('create-note'), title: z.string().trim().min(1).max(2048),
      body: z.string().max(8192), x: coordinate, y: coordinate }),
    z.strictObject({ kind: z.literal('edit-note'), nodeId, title: z.string().trim().min(1).max(2048), body: z.string().max(8192) }),
    z.strictObject({ kind: z.literal('undo') }),
  ]),
})
const caseSchema = z.strictObject({
  workspaceId: id, subject: planningSubjectRefSchema, planId: id,
  baseRevision: planningRevisionSchema, baseFocus: planningFocusSchema.optional(),
  version: z.number().int().nonnegative(), local: exploration,
  history: z.array(z.strictObject({ nodeId, x: coordinate, y: coordinate })).max(30),
  notes: z.array(explorationNoteSchema).max(128).optional(),
  thinking: thinkingStateSchema.optional(),
  thinkingReceipts: z.array(z.strictObject({ requestId: id, digest: z.string(), resultId: id.optional(),
    resultVersion: z.number().int().positive().optional() })).max(128).optional(),
  lastOperation: z.strictObject({ requestId: id, digest: z.string() }).optional(),
})
const spec = defineDomain({ name: 'sbc_design_cases', version: 1, layout: 'per-record', tables: { cases: domainTable(caseSchema) } })
const caseKey = (input: PlanningContextInput) => createHash('sha256')
  .update(JSON.stringify([input.workspaceId, input.subject.kind, input.subject.id])).digest('hex')

/** Deployment limits for retained case count and each complete serialized record. */
export interface SbcLimits { maxCases: number; maxCaseBytes: number }

/** Serial writes preserve case CAS and creation; disposal drains admitted work before closing storage. */
export class SbcDesignCaseStore {
  private tail: Promise<void> = Promise.resolve()
  private closing = false
  private constructor(private readonly domain: Domain<typeof spec>, private readonly limits: SbcLimits) {}
  /** Open the owned storage domain; callers must close the returned store.
   * @param facility - Composed storage-domain provider.
   * @param limits - Bounds enforced before case publication.
   * @returns Serial case owner over the opened domain.
   */
  static async open(facility: DomainFacility, limits: SbcLimits): Promise<SbcDesignCaseStore> {
    return new SbcDesignCaseStore(await facility.open(spec), limits)
  }
  /** List only retained cases. This never freezes a new baseline or writes a record.
   * @param workspaceId - Authorized Workspace to inspect.
   * @param planId - Owning Plan whose cases are requested.
   * @param readBoard - Reauthorize and read current canonical revisions.
   * @param signal - Caller cancellation.
   * @returns Detached summaries with drift against the current Board.
   */
  async summaries(workspaceId: string, planId: string, readBoard: () => Promise<PlanningBoardSnapshot>,
    signal: AbortSignal): Promise<import('./types.ts').DesignCaseSummary[]> {
    return this.enqueue(async () => {
      signal.throwIfAborted()
      const board = await readBoard()
      signal.throwIfAborted()
      return [...this.domain.table('cases').entries()].flatMap(([key, value]) => {
        if (value.workspaceId !== workspaceId || value.planId !== planId) return []
        const view = this.view(value, board)
        return [{ resource: { kind: 'design-case', id: key, provider: 'sbc' }, title: 'SBC 首个纵切',
          subjectRef: structuredClone(value.subject), baseRevision: value.baseRevision.id,
          currentRevision: view.currentRevision, drift: view.drift, status: 'exploration' as const,
          preview: value.baseFocus?.title ?? value.baseRevision.title }]
      })
    })
  }
  /** Read a case, creating its frozen exploratory baseline on first access.
   * @param input - Workspace and subject to open.
   * @param readBoard - Reauthorize and read canonical Planning through its owner.
   * @param signal - Caller cancellation.
   * @returns Case projection with current revision drift.
   */
  async read(
    input: PlanningContextInput, readBoard: () => Promise<PlanningBoardSnapshot>, signal: AbortSignal,
  ): Promise<SbcDesignCaseView> {
    return this.enqueue(async () => {
      signal.throwIfAborted()
      const board = await readBoard()
      const table = this.domain.table('cases')
      const key = caseKey(input)
      let value = table.get(key)
      if (!value) {
        if (table.size >= this.limits.maxCases) throw new PlanningError('capacity-exceeded', 'SBC case limit reached')
        const { plan, focus } = planningSubjectPlan(board, input.subject)
        const revision = plan.revisions.find(value => value.id === plan.headRevisionId)
        if (!revision) throw new PlanningError('invalid-reference', 'current Planning revision is unavailable')
        const positions: Record<string, { x: number; y: number }> = { [`plan:${plan.id}`]: { x: 40, y: 40 } }
        if (focus) positions[`focus:${focus.id}`] = { x: 360, y: 40 }
        for (const [index, entry] of (revision.stateEntries ?? []).entries())
          positions[`entry:${entry.id}`] = { x: 40 + index % 3 * 320, y: 260 + Math.floor(index / 3) * 180 }
        value = caseSchema.parse({ workspaceId: input.workspaceId, subject: input.subject, planId: plan.id,
          baseRevision: revision, ...(focus ? { baseFocus: focus } : {}),
          version: 0, local: { positions, selectedNodeId: null }, history: [] })
        signal.throwIfAborted()
        this.checkSize(value)
        await table.put(key, value)
      }
      return this.view(value, board)
    })
  }
  /** Commit a bounded local canvas edit; stale CAS and changed retry payloads reject.
   * @param input - Case version, retry identity and local edit.
   * @param readBoard - Reauthorize and read canonical Planning through its owner.
   * @param signal - Caller cancellation.
   * @returns Updated exploration without canonical Planning writes.
   */
  async explore(input: SbcExploreInput, readBoard: () => Promise<PlanningBoardSnapshot>, signal: AbortSignal): Promise<SbcDesignCaseView> {
    input = sbcExploreInputSchema.parse(input)
    return this.enqueue(async () => {
      signal.throwIfAborted()
      const board = await readBoard()
      const key = caseKey(input)
      const table = this.domain.table('cases')
      const current = table.get(key)
      if (!current) throw new PlanningError('not-found', 'open the SBC case first')
      const digest = JSON.stringify(input)
      if (current.lastOperation?.requestId === input.requestId) {
        if (current.lastOperation.digest !== digest) throw new PlanningError('idempotency-conflict', 'case request changed')
        return this.view(current, board)
      }
      if (current.version !== input.expectedVersion) throw new PlanningError('conflict', 'exploration version changed')
      const next = structuredClone(current)
      const op = input.operation
      if ('nodeId' in op && op.nodeId !== null && !Object.hasOwn(current.local.positions, op.nodeId))
        throw new PlanningError('invalid-reference', 'node is outside this projection')
      if (op.kind === 'create-note') {
        if ((next.notes?.length ?? 0) >= 128) throw new PlanningError('capacity-exceeded', 'Exploration note limit reached')
        const note = explorationNoteSchema.parse({ id: noteId(), title: op.title, body: op.body, source: 'manual',
          createdAt: now(), position: { x: op.x, y: op.y } })
        next.notes = [...(next.notes ?? []), note]
        next.local.positions[note.id] = note.position
        next.local.selectedNodeId = note.id
      } else if (op.kind === 'edit-note') {
        const note = next.notes?.find(value => value.id === op.nodeId)
        if (!note) throw new PlanningError('invalid-reference', 'node is not an exploration note')
        note.title = op.title
        note.body = op.body
      } else if (op.kind === 'undo') {
        const previous = next.history.pop()
        if (previous) next.local.positions[previous.nodeId] = { x: previous.x, y: previous.y }
      } else if (op.kind === 'select') next.local.selectedNodeId = op.nodeId
      else if (op.kind === 'delete-note') {
        if (!(next.notes ?? []).some(note => note.id === op.nodeId)) throw new PlanningError('invalid-reference',
          'node is not an exploration note')
        next.notes = next.notes?.filter(note => note.id !== op.nodeId)
        next.history = next.history.filter(move => move.nodeId !== op.nodeId)
        const { [op.nodeId]: _removed, ...positions } = next.local.positions
        next.local.positions = positions
        if (next.local.selectedNodeId === op.nodeId) next.local.selectedNodeId = null
      }
      else {
        const previous = current.local.positions[op.nodeId]
        if (!previous) throw new PlanningError('invalid-reference', 'node is outside this projection')
        if (previous.x !== op.x || previous.y !== op.y) next.history.push({ nodeId: op.nodeId, ...previous })
        next.history = next.history.slice(-30)
        next.local.positions[op.nodeId] = { x: op.x, y: op.y }
      }
      next.version++
      next.lastOperation = { requestId: input.requestId, digest }
      signal.throwIfAborted()
      this.checkSize(next)
      await table.put(key, caseSchema.parse(next))
      return this.view(next, board)
    })
  }
  /** Persist run identities and frozen context before native Session creation.
   * @param input - Question, original case CAS and admission identities.
   * @param readBoard - Reauthorize and read canonical Planning through its owner.
   * @param signal - Caller cancellation.
   * @returns Case projection including the prepared run.
   */
  async prepareThinking(input: PrepareThinkingInput, readBoard: () => Promise<PlanningBoardSnapshot>,
    signal: AbortSignal): Promise<ThinkingCaseView> {
    return this.enqueue(async () => {
      signal.throwIfAborted(); const board = await readBoard(); const { key, current } = this.current(input)
      const digest = JSON.stringify(input); const receipt = this.receipt(current, input.requestId, digest)
      if (receipt) return this.thinkingView(current, board)
      if (current.version !== input.expectedCaseVersion) throw new PlanningError('conflict', 'exploration version changed')
      const existing = current.thinking?.runs.find(run => run.id === input.runId)
      if (existing || current.thinking?.runs.some(run => run.sessionId === input.sessionId))
        throw new PlanningError('idempotency-conflict', 'Thinking run identity is already used')
      const context = buildPlanningContext(board, input.subject)
      const revision = context.plan.revision
      const bindCommand = { kind: 'bind-session' as const, requestId: input.bindRequestId, expectedBoardVersion: board.version,
        subject: input.subject, baseRevision: revision, sessionId: input.sessionId }
      const value = structuredClone(current); const state = value.thinking ?? { runs: [], designContexts: [] }
      const run = thinkingRunSchema.parse({ id: input.runId, version: 0, sessionId: input.sessionId, presetId: 'thinking-desk',
        question: input.question,
        createdAt: now(), subject: input.subject, planningRevisionAtStart: revision,
        caseResource: { kind: 'design-case', id: key, provider: 'sbc' }, caseVersionAtStart: value.version,
        caseBaseRevision: value.baseRevision.id,
        context: { run: { id: input.runId, question: input.question, sessionId: input.sessionId, presetId: 'thinking-desk',
          createdAt: now() }, subject: input.subject,
        planning: { revisionAtStart: revision, context }, designCase: { resource: { kind: 'design-case', id: key, provider: 'sbc' },
          title: value.baseFocus?.title ?? value.baseRevision.title,
          caseVersionAtStart: value.version, caseBaseRevision: value.baseRevision.id, currentRevisionAtStart: context.plan.revision,
          driftAtStart: context.plan.revision !== value.baseRevision.id,
          ...(this.selectedNode(value) ? { selectedNode: this.selectedNode(value) } : {}),
          existingExplorationNotes: (value.notes ?? []).map(({ position: _position, ...note }) => note),
          priorDesignContexts: state.designContexts.slice(-16) },
        availableResourceRefs: context.resourceRefs.map(link => link.resource) },
        reviewSnapshot: { planRevision: revision,
          focuses: (board.focuses ?? []).filter(focus => focus.planId === value.planId),
          resourceLinks: (board.resourceLinks ?? []).filter(link => link.subject.kind === 'plan' ? link.subject.id === value.planId : link.subject.id === input.subject.id) },
        startup: { phase: 'prepared', bindRequestId: input.bindRequestId, promptRequestId: input.promptRequestId,
          promptText: `你正在从 DSH 思考桌面推进一个 Design Case。\n\n用户问题：\n${input.question}\n\n先调用 thinking_context 读取本次 run 已冻结的 Planning + Design Case 上下文。不要直接修改 Planning，不要执行浏览器、Shell、Delivery 或外部写操作。形成可审阅结论后，用 thinking_submit_result 提交结构化候选结果。最终回复只需简要说明提交了哪些候选产物。`,
          bindCommand }, results: [], proposalSubmissions: [] })
      this.checkThinkingBytes(run.context, 'Thinking context capacity reached')
      state.runs.push(run); value.thinking = thinkingStateSchema.parse(state); this.remember(value, input.requestId, digest)
      this.checkSize(value); await this.domain.table('cases').put(key, caseSchema.parse(value)); return this.thinkingView(value, board)
    })
  }
  /** Read retained Thinking state from an existing exploration.
   * @param input - Workspace and subject; absent cases reject.
   * @param readBoard - Reauthorize and read canonical Planning through its owner.
   * @param signal - Caller cancellation.
   * @returns Detached run and design-context history.
   */
  async readThinking(input: PlanningContextInput, readBoard: () => Promise<PlanningBoardSnapshot>,
    signal: AbortSignal): Promise<ThinkingCaseView> {
    return this.enqueue(async () => { signal.throwIfAborted(); const board = await readBoard()
      return this.thinkingView(this.current(input).current, board) })
  }
  /** Review metadata is retained only for proposals this Case has durably linked.
   * @param workspaceId - Authorized Workspace to inspect.
   * @param signal - Caller cancellation.
   * @returns Proposal-keyed frozen review baselines; no unlinked attempt is included.
   */
  async thinkingReviewSnapshots(workspaceId: string, signal: AbortSignal): Promise<Record<string, ThinkingReviewSnapshot>> {
    return this.enqueue(() => {
      signal.throwIfAborted()
      const snapshots: Record<string, ThinkingReviewSnapshot> = {}
      for (const [, value] of this.domain.table('cases').entries()) {
        if (value.workspaceId !== workspaceId) continue
        for (const run of value.thinking?.runs ?? []) for (const submission of run.proposalSubmissions) {
          const linked = run.results.find(result => result.id === submission.resultId && result.version === submission.resultVersion)
          if (linked?.applied.planningProposalId === submission.proposalId)
            snapshots[submission.proposalId] = structuredClone(run.reviewSnapshot)
        }
      }
      return Promise.resolve(snapshots)
    })
  }
  /** Commit one legal startup transition with run CAS and idempotency.
   * @param input - Exact run, expected version and confirmed next phase.
   * @param readBoard - Reauthorize and read canonical Planning through its owner.
   * @param signal - Caller cancellation.
   * @returns Case projection after the transition.
   */
  async advanceThinking(input: AdvanceThinkingInput, readBoard: () => Promise<PlanningBoardSnapshot>,
    signal: AbortSignal): Promise<ThinkingCaseView> {
    return this.enqueue(async () => { signal.throwIfAborted(); const board = await readBoard()
      const { key, current } = this.current(input); const digest = JSON.stringify(input)
      if (this.receipt(current, input.requestId, digest)) return this.thinkingView(current, board)
      const next = structuredClone(current); const run = this.run(next, input.runId)
      if (run.version !== input.expectedRunVersion) throw new PlanningError('conflict', 'thinking run changed')
      const order = ['prepared', 'session-created', 'planning-bound', 'prompt-accepted'] as const
      if (run.startup.phase === input.phase) return this.thinkingView(current, board)
      if (run.startup.phase === 'blocked' || (input.phase !== 'blocked' && order.indexOf(input.phase) !== order.indexOf(run.startup.phase) + 1))
        throw new PlanningError('conflict', 'thinking startup phase is not a legal advance')
      run.startup = { ...run.startup, phase: input.phase,
        ...(input.blockedReason === undefined ? {} : { blockedReason: input.blockedReason }) }; run.version++; this.remember(next,
        input.requestId, digest); this.checkSize(next); await this.domain.table('cases').put(key, caseSchema.parse(next))
      return this.thinkingView(next, board) })
  }
  /** Append a bounded result only to an admitted run; identical retry returns the original result.
   * @param input - Exact run, previous result version and draft with retry identity.
   * @param readBoard - Reauthorize and read canonical Planning through its owner.
   * @param signal - Caller cancellation.
   * @returns Committed result; no output is applied automatically.
   */
  async submitThinking(input: ThinkingRunInput & Omit<SubmitThinkingInput, 'runId'>, readBoard: () => Promise<PlanningBoardSnapshot>,
    signal: AbortSignal): Promise<ThinkingResultRecord> {
    return this.enqueue(async () => { signal.throwIfAborted(); await readBoard(); signal.throwIfAborted()
      const { key, current } = this.current(input); const digest = JSON.stringify(input)
      const receipt = this.receipt(current, input.requestId, digest)
      if (receipt?.resultId) { const found = this.run(current,
        input.runId).results.find(value => value.id === receipt.resultId && value.version === receipt.resultVersion)
      if (found) return structuredClone(found) as unknown as ThinkingResultRecord }; const next = structuredClone(current)
      const run = this.run(next, input.runId); if (!['planning-bound',
        'prompt-accepted'].includes(run.startup.phase)) throw new PlanningError('unauthorized', 'Thinking run is not ready to submit')
      const prior = run.results.at(-1); if ((prior?.version ?? 0) !== input.expectedResultVersion) throw new PlanningError('conflict',
        'thinking result changed')
      const draft = parseDraft(input.draft); this.validateDraft(run, draft)
      const result = { id: resultId(), version: (prior?.version ?? 0) + 1, createdAt: now(), draft, applied: { explorationNoteIds: [] } }
      this.checkThinkingBytes(result, 'Thinking result capacity reached'); run.results.push(result); run.version++; this.remember(next,
        input.requestId, digest, result); this.checkSize(next); await this.domain.table('cases').put(key, caseSchema.parse(next))
      return structuredClone(result) as unknown as ThinkingResultRecord })
  }
  /** Apply one exact result to notes or design context without changing canonical Planning.
   * @param input - Result selection, case CAS and any explicit drift acknowledgement.
   * @param readBoard - Reauthorize and read canonical Planning through its owner.
   * @param signal - Caller cancellation.
   * @returns Updated case with durable application links.
   */
  async applyThinking(input: ApplyThinkingInput, readBoard: () => Promise<PlanningBoardSnapshot>,
    signal: AbortSignal): Promise<ThinkingCaseView> {
    return this.enqueue(async () => { signal.throwIfAborted(); const board = await readBoard()
      const { key, current } = this.current(input); const digest = JSON.stringify(input)
      if (this.receipt(current, input.requestId, digest)) return this.thinkingView(current, board)
      const runBefore = this.run(current, input.runId)
      const resultBefore = runBefore.results.find(value => value.id === input.resultId && value.version === input.resultVersion)
      if (!resultBefore) throw new PlanningError('not-found', 'thinking result is unavailable')
      if ((input.kind === 'notes' && resultBefore.applied.explorationNoteIds.length > 0) || (input.kind === 'context' && resultBefore.applied.designContextId)) return this.thinkingView(current, board); if (current.version !== input.expectedCaseVersion) throw new PlanningError('conflict', 'exploration version changed'); const next = structuredClone(current); const run = this.run(next, input.runId); const result = run.results.find(value => value.id === input.resultId && value.version === input.resultVersion); if (!result) throw new PlanningError('not-found', 'thinking result is unavailable'); if (board.items.find(item => item.id === current.planId)?.headRevisionId !== run.planningRevisionAtStart && !input.acknowledgeStale) throw new PlanningError('conflict', 'Planning revision changed')
      if (input.kind === 'notes') { const notes = result.draft.explorationNotes ?? []
        const created = notes.map((note, index) => explorationNoteSchema.parse({ id: noteId(), ...note, sourceResultId: result.id,
          sourceResultVersion: result.version, createdAt: now(), position: { x: 40 + index * 40, y: 600 + index * 40 } }))
        next.notes = [...(next.notes ?? []), ...created]; for (const note of created) next.local.positions[note.id] = note.position
        result.applied.explorationNoteIds = created.map(value => value.id) }
      else if (result.draft.designContext && !result.applied.designContextId) { const item = designContextSchema.parse({ id: contextId(),
        ...result.draft.designContext, sourceRunId: run.id, sourceSessionId: run.sessionId, sourceResultId: result.id,
        sourceResultVersion: result.version, caseVersionAtCreation: next.version, planningRevisionAtCreation: run.planningRevisionAtStart,
        createdAt: now() }); const thinking = next.thinking; if (!thinking) throw new PlanningError('not-found',
        'thinking run is unavailable'); thinking.designContexts.push(item); result.applied.designContextId = item.id }
      next.version++; this.remember(next, input.requestId, digest); this.checkSize(next)
      await this.domain.table('cases').put(key, caseSchema.parse(next)); return this.thinkingView(next, board) })
  }
  /** Freeze an exact Planning command before the cross-owner write; unknown attempts are retained.
   * @param input - Reviewed result and the caller retry identity.
   * @param readBoard - Reauthorize and read canonical Planning through its owner.
   * @param signal - Caller cancellation.
   * @returns Current case and a durable Proposal attempt to execute or recover.
   */
  async prepareThinkingProposal(input: SubmitThinkingProposalInput, readBoard: () => Promise<PlanningBoardSnapshot>,
    signal: AbortSignal): Promise<{ view: ThinkingCaseView; submission: ThinkingProposalSubmission }> {
    return this.enqueue(async () => { signal.throwIfAborted(); const board = await readBoard()
      const { key, current } = this.current(input); const next = structuredClone(current); const run = this.run(next, input.runId)
      const result = run.results.find(value => value.id === input.resultId && value.version === input.resultVersion)
      if (!result?.draft.planningDelta) throw new PlanningError('not-found', 'planning candidate is unavailable')
      const prior = run.proposalSubmissions.find(value => value.resultId === input.resultId && value.resultVersion === input.resultVersion)
      const head = board.items.find(item => item.id === current.planId)?.headRevisionId
      if (prior && prior.attempts.at(-1)?.status !== 'conflict') return { view: this.thinkingView(current, board), submission: structuredClone(prior) as unknown as ThinkingProposalSubmission }
      if (prior && prior.attempts.some(attempt => attempt.command.requestId === input.requestId)) {
        return { view: this.thinkingView(current, board), submission: structuredClone(prior) as unknown as ThinkingProposalSubmission }
      }
      if (head !== run.planningRevisionAtStart) throw new PlanningError('conflict', 'Planning revision changed')
      const revision = board.items.find(item => item.id === current.planId)?.revisions
        .find(value => value.id === run.planningRevisionAtStart)
      if (!revision) throw new PlanningError('invalid-reference', 'Thinking base revision is unavailable')
      const pid = prior?.proposalId ?? proposalId()
      const command = { kind: 'propose' as const, requestId: input.requestId, expectedBoardVersion: board.version, proposalId: pid,
        expectedProposalVersion: null, targetItemId: current.planId, baseRevisionId: run.planningRevisionAtStart,
        delta: { subject: run.subject, baseRevision: run.planningRevisionAtStart, operations: result.draft.planningDelta.operations,
          originRef: run.caseResource,
          evidenceRefs: [...(run.context as import('./thinking-types.ts').ThinkingContextPack).availableResourceRefs] },
        draft: { title: revision.title, intent: revision.intent, stateEntries: revision.stateEntries,
          scope: revision.scope, acceptance: revision.acceptance,
          sources: [{ kind: 'manual' as const, text: result.draft.planningDelta.rationale ?? result.draft.summary }],
          estimate: revision.estimate, reviewAt: revision.reviewAt }, suggestedLane: 'next' as const, assumptions: [] }
      const submission = prior ? { ...prior, attempts: [...prior.attempts, { command,
        status: 'prepared' as const }] } : { resultId: result.id, resultVersion: result.version, proposalId: pid, attempts: [{ command,
        status: 'prepared' as const }] }; if (prior) run.proposalSubmissions.splice(run.proposalSubmissions.indexOf(prior), 1,
        submission)
      else run.proposalSubmissions.push(submission); this.checkSize(next)
      await this.domain.table('cases').put(key, caseSchema.parse(next)); return { view: this.thinkingView(next, board),
        submission: structuredClone(submission) as unknown as ThinkingProposalSubmission } })
  }
  /** Record the outcome of an already prepared Planning command.
   * @param input - Exact result and command identity, with a confirmed conflict or receipt.
   * @param readBoard - Reauthorize and read canonical Planning through its owner.
   * @param signal - Caller cancellation.
   * @returns Case projection retaining the Proposal receipt and link.
   */
  async recordThinkingProposal(input: ThinkingRunInput & {
    resultId: string
    resultVersion: number
    commandRequestId: string
    receipt?: import('@changanhua/dsh-planning').PlanningMutationResult
    conflict?: boolean
  }, readBoard: () => Promise<PlanningBoardSnapshot>, signal: AbortSignal): Promise<ThinkingCaseView> {
    return this.enqueue(async () => { signal.throwIfAborted(); const board = await readBoard()
      const { key, current } = this.current(input); const next = structuredClone(current); const run = this.run(next, input.runId)
      const submission = run.proposalSubmissions.find(value => value.resultId === input.resultId && value.resultVersion === input.resultVersion); const attempt = submission?.attempts.find(value => value.command.requestId === input.commandRequestId); if (!submission || !attempt) throw new PlanningError('not-found', 'thinking proposal submission is unavailable'); attempt.status = input.conflict ? 'conflict' : 'committed'; if (input.receipt) attempt.receipt = input.receipt; if (input.receipt?.proposalId) { const result = run.results.find(value => value.id === input.resultId && value.version === input.resultVersion); if (result) result.applied.planningProposalId = input.receipt.proposalId }; this.checkSize(next); await this.domain.table('cases').put(key, caseSchema.parse(next)); return this.thinkingView(next, board) })
  }
  private checkSize(value: z.infer<typeof caseSchema>): void {
    if (Buffer.byteLength(JSON.stringify({ version: 1, record: value }, null, 2) + '\n', 'utf8') > this.limits.maxCaseBytes)
      throw new PlanningError('capacity-exceeded', 'SBC case byte limit reached')
  }
  private checkThinkingBytes(value: unknown, message: string): void {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 64 * 1024) throw new PlanningError('capacity-exceeded', message)
  }
  private current(input: PlanningContextInput): { key: string; current: z.infer<typeof caseSchema> } {
    const key = caseKey(input); const current = this.domain.table('cases').get(key)
    if (!current) throw new PlanningError('not-found', 'open the SBC case first')
    return { key, current }
  }
  private receipt(value: z.infer<typeof caseSchema>, requestId: string, digest: string) {
    const receipt = value.thinkingReceipts?.find(item => item.requestId === requestId)
    if (receipt && receipt.digest !== digest) throw new PlanningError('idempotency-conflict', 'thinking request changed')
    return receipt
  }
  private remember(value: z.infer<typeof caseSchema>, requestId: string, digest: string, result?: { id: string; version: number }) {
    value.thinkingReceipts = [...(value.thinkingReceipts ?? []), { requestId, digest, ...(result ? { resultId: result.id,
      resultVersion: result.version } : {}) }].slice(-128)
  }
  private validateDraft(run: z.infer<typeof thinkingRunSchema>, draft: ReturnType<typeof parseDraft>) {
    const context = run.context as import('./thinking-types.ts').ThinkingContextPack
    const entryIds = new Set([...context.planning.context.objective, ...context.planning.context.accepted,
      ...context.planning.context.open].map(entry => entry.id))
    const focusIds = new Set(run.reviewSnapshot.focuses.map(focus => focus.id))
    const links = new Map(run.reviewSnapshot.resourceLinks.map(link => [link.id, link]))
    const allowedResources = new Set([...context.availableResourceRefs,
      ...context.planning.context.resourceRefs.map(link => link.resource)].map(value => JSON.stringify(value)))
    for (const operation of draft.planningDelta?.operations ?? []) {
      if ((operation.kind === 'update-state-entry' || operation.kind === 'remove-state-entry') && !entryIds.has(operation.kind === 'remove-state-entry' ? operation.id : operation.entry.id))
        throw new PlanningError('invalid-reference', 'state entry is outside frozen Thinking context')
      if (operation.kind === 'create-focus' && run.subject.kind !== 'plan') throw new PlanningError('invalid-reference',
        'Focus creation requires a Plan subject')
      if (operation.kind === 'update-focus' && !focusIds.has(operation.id)) throw new PlanningError('invalid-reference',
        'Focus is outside frozen Thinking context')
      if (operation.kind === 'remove-resource-link' && !links.has(operation.id)) throw new PlanningError('invalid-reference',
        'resource link is outside frozen Thinking context')
      if (operation.kind === 'add-resource-link' && !allowedResources.has(JSON.stringify(operation.resource))) throw new PlanningError('invalid-reference', 'resource is outside frozen Thinking context')
      if ((operation.kind === 'add-state-entry' || operation.kind === 'update-state-entry') &&
        operation.entry.sourceRefs?.some(ref => !allowedResources.has(JSON.stringify(ref))))
        throw new PlanningError('invalid-reference', 'state entry source is outside frozen Thinking context')
    }
  }
  private selectedNode(value: z.infer<typeof caseSchema>) {
    const id = value.local.selectedNodeId
    if (!id) return undefined
    if (id === `plan:${value.planId}`) return { id, title: value.baseRevision.title, body: value.baseRevision.intent }
    if (id === `focus:${value.baseFocus?.id}` && value.baseFocus) return { id, title: value.baseFocus.title,
      ...(value.baseFocus.objective ? { body: value.baseFocus.objective } : {}) }
    const entry = (value.baseRevision.stateEntries ?? []).find(item => id === `entry:${item.id}`)
    if (entry) return { id, title: entry.kind, body: entry.content }
    const note = (value.notes ?? []).find(item => item.id === id)
    if (note) return { id, title: note.title, ...(note.body ? { body: note.body } : {}) }
    return undefined
  }
  private run(value: z.infer<typeof caseSchema>, runId: string) {
    const run = value.thinking?.runs.find(item => item.id === runId)
    if (!run) throw new PlanningError('not-found', 'thinking run is unavailable')
    return run
  }
  private thinkingView(value: z.infer<typeof caseSchema>, board: PlanningBoardSnapshot): ThinkingCaseView {
    const state = value.thinking ?? { runs: [], designContexts: [] }
    return { design: this.view(value, board), runs: structuredClone(state.runs) as unknown as ThinkingCaseView['runs'],
      designContexts: structuredClone(state.designContexts) }
  }
  private view(value: z.infer<typeof caseSchema>, board: PlanningBoardSnapshot): SbcDesignCaseView {
    const plan = board.items.find(item => item.id === value.planId)
    const focus = board.focuses?.find(item => item.id === value.baseFocus?.id && item.planId === value.planId)
    const { lastOperation: _receipt, thinking: _thinking, thinkingReceipts: _thinkingReceipts, ...saved } = structuredClone(value)
    const currentRevision = plan?.headRevisionId ?? null
    const currentFocusVersion = focus?.version ?? null
    return { case: saved as SbcDesignCaseView['case'], currentRevision, currentFocusVersion,
      drift: currentRevision !== value.baseRevision.id || currentFocusVersion !== (value.baseFocus?.version ?? null) }
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new PlanningError('closed', 'SBC exploration is closed'))
    const run = this.tail.then(operation)
    this.tail = run.then(() => {}, () => {})
    return run
  }
  /** Reject new work, drain admitted operations and close the storage domain.
   * @returns Completion after the owner and its storage have quiesced.
   */
  async close(): Promise<void> { this.closing = true; await this.tail; await this.domain.close() }
}
