import { Service, symbols } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import { evalContractDigest } from '@changanhua/dsh-eval'
import EvalRuns, { EvalRunError } from '@changanhua/dsh-eval-runs'
import type { EvalRunAccess, StartEvalRun, EvalRunControl, EvalRunView, EvalEvidenceView } from '@changanhua/dsh-eval-runs'
import type { EvalPlanAccess, RecoveredEvalPlan } from '@changanhua/dsh-eval-plans'
import type { GateSnapshotReader } from '@changanhua/dsh-eval-gates'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { recoverIsolatedEval } from '@changanhua/dsh-eval-isolated'
import type { AdmittedIsolatedEval, IsolatedCellBinding, PreparedIsolatedCell, IsolatedCellResult, ExecutionEvidenceBundle } from '@changanhua/dsh-eval-isolated'
import { createVerifiedOperatorAuthority, WorkId, AttemptId } from '@changanhua/dsh-task-queue'
import type { WorkKindDefinition, OperatorWorkQueue, WorkControlPrecondition, LiveAttempt } from '@changanhua/dsh-task-queue'
import { RunLedger, cellBindingSchema } from './ledger.ts'
import type { RunRecord, ControlRecord } from './ledger.ts'
import { startSchema, controlSchema } from './config.ts'
import type { Config } from './config.ts'
import type { RunPolicy } from './config.ts'
export type { Config, RunPolicy } from './config.ts'
import { projectRun } from './projection.ts'
import { validateBundle } from './evidence.ts'
import { projectEvidence } from './report.ts'
import { captureHostSnapshot } from './host-snapshot.ts'

const positive = () => Schema.number().step(1).min(1).required()
const hostReaders = new WeakMap<EvalRuns, GateSnapshotReader>()
function originalOwner(owner: EvalRuns): EvalRuns {
  return (owner as EvalRuns & { [symbols.original]?: EvalRuns })[symbols.original] ?? owner
}

/**
 * Bind the receiving Host's private verifier input capability in trusted Profile composition.
 * @param ctx Host context with the actual LocalEvalRuns owner; this function accepts no wire credentials.
 * @returns Reader that reauthorizes every call and returns original retained facts, never the public evidence projection.
 */
export function createEvalGateSnapshotReader(ctx: Context): GateSnapshotReader {
  return async (access, runId, signal) => {
    const owner = ctx.get('evalRuns'), read = owner && hostReaders.get(originalOwner(owner))
    if (!read) throw new EvalRunError('unavailable')
    return read(access, runId, signal)
  }
}

type CellOutput = { cell: IsolatedCellResult; workspace: Parameters<Parameters<PreparedIsolatedCell['start']>[1]>[1] }
declare module '@changanhua/dsh-task-queue' {
  interface WorkKindMap {
    'eval.cell@1': WorkKindDefinition<{ runKey: string; cellId: string }, { eval: IsolatedCellBinding }, PreparedIsolatedCell, CellOutput>
  }
}

/** Durable Eval coordination bridge. It delegates every Attempt transition and side-effect boundary to existing owners. */
export class LocalEvalRuns extends EvalRuns {
  static inject = ['storageDomain', 'evalPlans', 'taskQueue', 'workspaceRegistry']
  static Config: Schema<Config> = Schema.object({ maxRuns: positive(), maxLedgerBytes: positive(), maxBundles: positive(),
    maxControls: positive(), maxCells: positive(), maxParallel: positive(), maxResponseBytes: positive(), retentionMs: positive(),
    resource: Schema.string().required(), policies: Schema.array(Schema.object({ id: Schema.string().required(),
      workspaceId: Schema.string().required(), execution: Schema.any().required() })).required() })
  private readonly config: Config
  private ledger?: RunLedger
  private queue?: OperatorWorkQueue
  private registration?: () => void
  private closing = false
  private readonly pending = new Map<string, Promise<unknown>>()
  private readonly owners = new Map<string, Promise<AdmittedIsolatedEval>>()
  private readonly live = new Set<LiveAttempt<'eval.cell@1'>>()
  private executionContext: Context | undefined

  constructor(ctx: Context, supplied: Config) {
    super(ctx)
    this.config = structuredClone(supplied)
    for (const [key, value] of Object.entries(this.config)) {
      if (key.startsWith('max') || key === 'retentionMs') {
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new EvalRunError('capacity')
      }
    }
    if (!this.config.resource || !this.config.policies.length
      || new Set(this.config.policies.map(row => row.id)).size !== this.config.policies.length) throw new EvalRunError('blocked')
    this.ctx.inject(['repoWorkspace', 'llm', 'budget'], (executionContext) => {
      this.executionContext = executionContext
      executionContext.effect(() => async () => {
        if (this.executionContext === executionContext) this.executionContext = undefined
        this.owners.clear()
        await Promise.allSettled([...this.live].map(async (attempt) => { await attempt.cancel('Eval execution unavailable'); await attempt.done }))
      }, 'evalRuns.execution')
    })
    this.ctx.effect(() => async () => {
      this.closing = true
      hostReaders.delete(originalOwner(this))
      this.registration?.()
      await Promise.allSettled([...this.live].map(async (attempt) => { await attempt.cancel('Eval owner closing'); await attempt.done }))
      await Promise.allSettled([...this.pending.values()])
      await this.ledger?.close()
    }, 'evalRuns.close()')
    hostReaders.set(originalOwner(this), async (access, runId, signal) => {
      await this.access(access)
      signal?.throwIfAborted()
      const run = this.visible(access, runId)
      const recovered = await this.ctx.evalPlans.recover(access, this.admissionKey(run), signal)
      if (!recovered || recovered.admission.runId !== run.runId || recovered.admission.planDigest !== run.plan.digest) {
        throw new EvalRunError('conflict')
      }
      await this.access(access, run)
      signal?.throwIfAborted()
      return captureHostSnapshot(this.record(run.key), recovered, this.store().read(), this.operator().list(), this.ctx.get('budget'), Date.now())
    })
  }

  protected async [Service.init](): Promise<void> {
    this.ledger = await RunLedger.open(this.ctx, this.config)
    this.queue = this.ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
    const registration = this.ctx.taskQueue.registerHandler({ kind: 'eval.cell@1',
      resolveAdmission: (input) => {
        const run = this.record(input.runKey), cell = run.cells.find(row => row.id === input.cellId)
        if (!cell || run.phase === 'needs-attention') throw new EvalRunError('blocked')
        return Promise.resolve({ eval: cell.binding })
      },
      resources: () => [{ resource: this.config.resource, units: 1 }], policy: () => ({ maxAttempts: 1 }),
      prepare: async (resolved, context) => {
        const binding = cellBindingSchema.parse(resolved.eval)
        let run = this.byId(binding.runId)
        await this.pending.get(`start:${run.key}`)
        run = this.record(run.key)
        this.policy(run)
        const work = this.operator().list().find(row => row.state.activeAttemptId === context.attemptId)
        const cell = run.cells.find(row => row.workId === work?.work.id)
        if (run.phase !== 'bound' || !cell || evalContractDigest(cell.binding) !== evalContractDigest(binding)
          || this.operator().list().some(row => run.cells.some(item => item.workId === row.work.id) && row.state.status === 'unknown')) {
          throw new EvalRunError('blocked')
        }
        const executionContext = this.executionContext
        const prepared = await (await this.owner(run)).prepare(binding, context.signal)
        return { start: (context, output) => {
          if (this.closing || this.executionContext !== executionContext) throw new EvalRunError('blocked')
          return prepared.start(context, output)
        } }
      },
      start: (prepared, context) => {
        const attempt = prepared.start<'eval.cell@1'>(context, (cell, workspace) => ({ cell, workspace }))
        this.live.add(attempt)
        void attempt.done.then(() => { this.live.delete(attempt) }, () => { this.live.delete(attempt) })
        return attempt
      },
    }, { activation: 'staged' })
    this.registration = registration
    for (const run of this.store().read().runs) {
      try {
        if (run.phase === 'admitting' || run.phase === 'submitting') await this.reconcileAdmission(run.key)
        if (this.record(run.key).phase === 'bound') this.assertQueueBindings(this.record(run.key))
        for (const control of this.record(run.key).controls) if (control.phase === 'pending') await this.applyControl(run.key, control.operationId)
      } catch { await this.markAttention(run.key, 'recovery-needs-attention') }
    }
    registration.activate()
  }

  private store(): RunLedger { if (!this.ledger) throw new EvalRunError('unavailable'); return this.ledger }
  private operator(): OperatorWorkQueue { if (!this.queue) throw new EvalRunError('unavailable'); return this.queue }
  private record(key: string): RunRecord {
    const row = this.store().read().runs.find(value => value.key === key)
    if (!row) throw new EvalRunError('not-found')
    return row
  }
  private byId(id: string): RunRecord {
    const row = this.store().read().runs.find(value => value.runId === id)
    if (!row) throw new EvalRunError('not-found')
    return row
  }
  private visible(access: EvalRunAccess, id: string): RunRecord {
    const row = this.store().read().runs.find(value => value.runId === id && value.workspaceId === access.workspace.id)
    if (!row) throw new EvalRunError('not-found')
    return row
  }
  private async access(access: EvalRunAccess, run?: RunRecord): Promise<void> {
    if (this.closing) throw new EvalRunError('unavailable')
    if (typeof access.authorize !== 'function' || !access.actorId || access.actorId.length > 256
      || this.ctx.workspaceRegistry.get(access.workspace.id) !== access.workspace
      || run && run.workspaceId !== access.workspace.id) throw new EvalRunError('unauthorized')
    try { await access.authorize() } catch { throw new EvalRunError('unauthorized') }
    if (this.ctx.workspaceRegistry.get(access.workspace.id) !== access.workspace) throw new EvalRunError('unauthorized')
  }
  private policy(run: RunRecord): RunPolicy {
    const policy = this.config.policies.find(row => row.id === run.policyId && row.workspaceId === run.workspaceId)
    if (!policy || evalContractDigest(policy.execution) !== run.policyDigest) throw new EvalRunError('blocked')
    return policy
  }
  private executionAccess(run: RunRecord): EvalPlanAccess {
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(run.workspaceId))
    if (!workspace) throw new EvalRunError('blocked')
    return { workspace, entrypoint: run.entrypoint, authorize: () => {
      if (this.closing || this.ctx.workspaceRegistry.get(WorkspaceId(run.workspaceId)) !== workspace) throw new EvalRunError('blocked')
      this.policy(this.record(run.key))
    } }
  }
  private admissionKey(run: RunRecord): string { return `eval-run:${run.key}` }
  private exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const before = this.pending.get(key) ?? Promise.resolve()
    const pending = before.catch(() => {}).then(operation)
    this.pending.set(key, pending)
    void pending.then(() => { if (this.pending.get(key) === pending) this.pending.delete(key) },
      () => { if (this.pending.get(key) === pending) this.pending.delete(key) })
    return pending
  }
  private async edit(key: string, update: (record: RunRecord) => void): Promise<void> {
    await this.store().change((state) => {
      const row = state.runs.find(value => value.key === key)
      if (!row) throw new EvalRunError('not-found')
      update(row)
    })
  }
  private async markAttention(key: string, reason: string): Promise<void> {
    await this.edit(key, (run) => { run.phase = 'needs-attention'; run.reason = reason })
  }
  private view(run: RunRecord): EvalRunView {
    const result = projectRun(run, this.store().read(), this.operator().list(), Date.now())
    if (Buffer.byteLength(JSON.stringify(result)) > this.config.maxResponseBytes) throw new EvalRunError('capacity')
    return result
  }

  async start(access: EvalRunAccess, input: StartEvalRun, signal?: AbortSignal): Promise<EvalRunView> {
    const request = startSchema.parse(input)
    await this.access(access)
    const key = evalContractDigest({ workspaceId: access.workspace.id, requestId: request.requestId })
    return this.exclusive(`start:${key}`, async () => {
      await this.access(access)
      signal?.throwIfAborted()
      const existing = this.store().read().runs.find(row => row.key === key)
      if (existing) {
        if (existing.plan.id !== request.plan.id || existing.plan.version !== request.plan.version
          || existing.policyId !== request.policyId) {
          throw new EvalRunError('conflict')
        }
        if (existing.phase === 'admitting' || existing.phase === 'submitting') await this.reconcileAdmission(key)
        return this.view(this.record(key))
      }
      const policy = this.config.policies.find(row => row.id === request.policyId && row.workspaceId === access.workspace.id)
      if (!policy) throw new EvalRunError('blocked')
      const resolved = await this.ctx.evalPlans.resolve(access, request.plan, signal)
      if (!resolved.ready || resolved.summary.cellCount > this.config.maxCells) throw new EvalRunError('blocked')
      await this.access(access)
      await this.store().change((state) => { state.runs.push({ key, workspaceId: access.workspace.id, requestId: request.requestId,
        actorId: access.actorId, entrypoint: access.entrypoint, policyId: policy.id, policyDigest: evalContractDigest(policy.execution),
        plan: { id: resolved.plan.id, version: resolved.plan.version, digest: resolved.summary.digest }, runId: null,
        phase: 'admitting', reason: null, batchId: null, cells: [], controls: [], createdAt: Date.now() }) })
      try {
        await this.ctx.evalPlans.admit(access, resolved, this.admissionKey(this.record(key)), signal)
        await this.reconcileAdmission(key)
      } catch (cause) { throw new EvalRunError('unavailable', { cause }) }
      return this.view(this.record(key))
    })
  }

  private async recoverPlan(run: RunRecord): Promise<RecoveredEvalPlan> {
    const access = this.executionAccess(run), requestId = this.admissionKey(run)
    let recovered = await this.ctx.evalPlans.recover(access, requestId)
    if (!recovered && run.phase === 'admitting') {
      const resolved = await this.ctx.evalPlans.resolve(access, { id: run.plan.id, version: run.plan.version })
      if (!resolved.ready || resolved.summary.digest !== run.plan.digest) throw new EvalRunError('blocked')
      await this.ctx.evalPlans.admit(access, resolved, requestId)
      recovered = await this.ctx.evalPlans.recover(access, requestId)
    }
    if (!recovered || recovered.admission.planDigest !== run.plan.digest
      || run.runId !== null && recovered.admission.runId !== run.runId) throw new EvalRunError('conflict')
    return recovered
  }
  private async reconcileAdmission(key: string): Promise<void> {
    let run = this.record(key)
    this.policy(run)
    const recovered = await this.recoverPlan(run)
    if (run.phase === 'admitting') {
      await this.edit(key, (row) => { row.runId = recovered.admission.runId; row.phase = 'submitting' })
      run = this.record(key)
      const policy = this.policy(run)
      const cells: RunRecord['cells'] = []
      for (const route of recovered.resolved.plan.routes) for (const evalCase of recovered.resolved.suite.cases) {
        for (let repeatIndex = 0; repeatIndex < recovered.resolved.plan.repeatPolicy.count; repeatIndex++) {
          const binding = { runId: recovered.admission.runId, resolvedDigest: recovered.resolved.resolvedDigest,
            corePolicyDigest: evalContractDigest(policy.execution.runtime.core),
            graderPolicyDigest: evalContractDigest(policy.execution.grader ?? null),
            routeId: route.id, caseId: evalCase.id, repeatIndex }
          cells.push({ id: evalContractDigest({ routeId: route.id, caseId: evalCase.id, repeatIndex }), binding, workId: null })
          if (cells.length > this.config.maxCells) throw new EvalRunError('capacity')
        }
      }
      await this.edit(key, (row) => { row.cells = cells })
    }
    run = this.record(key)
    if (run.phase !== 'submitting') return
    if (!run.cells.length) {
      await this.edit(key, (row) => { row.phase = 'admitting' })
      return this.reconcileAdmission(key)
    }
    const batchId = await this.operator().enqueueBatch({ kind: 'eval.cell@1', idempotencyKey: `eval:${run.runId}`,
      maxParallel: this.config.maxParallel, sharedPayload: { runId: run.runId },
      items: run.cells.map(cell => ({ title: `Eval ${cell.binding.caseId} / ${cell.binding.routeId}`, input: { runKey: run.key, cellId: cell.id } })) })
    const works = this.operator().list().filter(row => row.work.batchId === batchId)
    if (works.length !== run.cells.length) throw new EvalRunError('conflict')
    await this.edit(key, (row) => {
      for (const cell of row.cells) {
        const found = works.find(work => evalContractDigest(work.work.resolved) === evalContractDigest({ eval: cell.binding }))
        if (!found) throw new EvalRunError('conflict')
        cell.workId = String(found.work.id)
      }
      row.batchId = String(batchId); row.phase = 'bound'; row.reason = null
    })
    this.assertQueueBindings(this.record(key))
  }
  private assertQueueBindings(run: RunRecord): void {
    for (const cell of run.cells) {
      if (!cell.workId) throw new EvalRunError('conflict')
      const view = this.operator().get(WorkId(cell.workId))
      if (!['eval.cell@1'].includes(view.work.kind) || view.work.batchId !== run.batchId
        || evalContractDigest(view.work.resolved) !== evalContractDigest({ eval: cell.binding })) throw new EvalRunError('conflict')
    }
  }
  private owner(run: RunRecord): Promise<AdmittedIsolatedEval> {
    const executionContext = this.executionContext
    if (!executionContext) throw new EvalRunError('blocked')
    let pending = this.owners.get(run.key)
    if (!pending) {
      const policy = this.policy(run)
      pending = recoverIsolatedEval(executionContext, this.executionAccess(run), this.admissionKey(run),
        { ...policy.execution, receive: bundle => this.receive(run.key, bundle) })
      this.owners.set(run.key, pending)
    }
    return pending
  }
  private async receive(key: string, bundle: ExecutionEvidenceBundle): Promise<{ acceptedDigest: string }> {
    const run = this.record(key)
    const first = bundle.materials[0]
    if (!first) throw new EvalRunError('invalid-evidence')
    const body: unknown = JSON.parse(first.content)
    if (!body || typeof body !== 'object' || !('tuple' in body) || !body.tuple || typeof body.tuple !== 'object'
      || !('attemptId' in body.tuple) || typeof body.tuple.attemptId !== 'string') throw new EvalRunError('invalid-evidence')
    const attemptId = body.tuple.attemptId
    const view = this.operator().list().find(row => row.state.activeAttemptId === attemptId)
    const cell = run.cells.find(row => row.workId === view?.work.id)
    const attempt = view?.attempts.find(row => row.id === attemptId)
    if (!cell || !attempt || !['starting', 'running'].includes(attempt.status)) throw new EvalRunError('invalid-evidence')
    const validated = validateBundle(bundle, { ...cell.binding, attemptId, attempt: attempt.ordinal },
      this.policy(run).execution.evidenceLimits.maxBytes, run.plan)
    await this.store().change((state) => {
      const existing = state.bundles.find(row => row.runId === run.runId && row.cellId === cell.id && row.attemptId === attemptId)
      if (existing) {
        if (existing.bundle.digest !== validated.digest) throw new EvalRunError('conflict')
        return
      }
      state.bundles.push({ runId: cell.binding.runId, cellId: cell.id, attemptId, attempt: attempt.ordinal,
        receivedAt: Date.now(), expiresAt: Date.now() + this.config.retentionMs, bundle: structuredClone(validated) })
    })
    return { acceptedDigest: validated.digest }
  }

  async get(access: EvalRunAccess, runId: string): Promise<EvalRunView> {
    await this.access(access)
    const run = this.visible(access, runId)
    await this.access(access, run)
    return this.view(run)
  }
  async list(access: EvalRunAccess): Promise<readonly EvalRunView[]> {
    await this.access(access)
    const views = this.store().read().runs.filter(run => run.workspaceId === access.workspace.id).map(run => this.view(run))
    if (Buffer.byteLength(JSON.stringify(views)) > this.config.maxResponseBytes) throw new EvalRunError('capacity')
    return views
  }
  async evidence(access: EvalRunAccess, runId: string, cellId: string, attemptId: string): Promise<EvalEvidenceView> {
    await this.access(access)
    const run = this.visible(access, runId), cell = run.cells.find(row => row.id === cellId)
    if (!cell?.workId) throw new EvalRunError('not-found')
    this.assertQueueBindings(run)
    const attempt = this.operator().get(WorkId(cell.workId)).attempts.find(row => row.id === attemptId)
    if (!attempt) throw new EvalRunError('not-found')
    const record = this.store().read().bundles.find(row => row.runId === runId && row.cellId === cellId && row.attemptId === attemptId)
    const report = projectEvidence(run, cell, attempt, record, Date.now())
    if (Buffer.byteLength(JSON.stringify(report)) > this.config.maxResponseBytes) throw new EvalRunError('capacity')
    return report
  }
  async control(access: EvalRunAccess, input: EvalRunControl): Promise<EvalRunView> {
    const request = controlSchema.parse(input)
    await this.access(access)
    const run = this.visible(access, request.runId)
    await this.access(access, run)
    return this.exclusive(`control:${run.key}`, async () => {
      await this.access(access, this.record(run.key))
      const current = this.record(run.key), digest = evalContractDigest({ ...request, actorId: access.actorId })
      const existing = current.controls.find(row => row.operationId === request.operationId)
      if (existing) {
        if (existing.intentDigest !== digest) throw new EvalRunError('conflict')
        if (existing.phase === 'pending') await this.applyControl(run.key, request.operationId)
        return this.view(this.record(run.key))
      }
      if (this.view(current).revision !== request.expectedRevision) throw new EvalRunError('conflict')
      const targets: ControlRecord['targets'] = []
      for (const cell of current.cells) {
        if (request.action !== 'cancel' && cell.id !== request.cellId) continue
        if (!cell.workId) throw new EvalRunError('blocked')
        const view = this.operator().get(WorkId(cell.workId)), state = view.state
        if (request.action === 'cancel' && ['succeeded', 'failed', 'canceled'].includes(state.status)) continue
        if (request.action === 'retry' && state.status !== 'failed' || request.action === 'resolve-unknown' && state.status !== 'unknown') {
          throw new EvalRunError('blocked')
        }
        targets.push({ workId: String(view.work.id), status: state.status,
          attemptCount: state.attemptCount, activeAttemptId: state.activeAttemptId })
      }
      if (request.action !== 'cancel' && targets.length !== 1) throw new EvalRunError('not-found')
      await this.edit(run.key, (row) => { row.controls.push({ operationId: request.operationId, actorId: access.actorId,
        intentDigest: digest,
        action: request.action, cellId: request.action === 'cancel' ? null : request.cellId,
        resolution: request.action === 'resolve-unknown' ? request.resolution : null, evidence: request.action === 'resolve-unknown' ? request.evidence : null,
        phase: 'pending', reason: null, targets, appliedWorkIds: [], createdAt: Date.now() }) })
      await this.applyControl(run.key, request.operationId)
      return this.view(this.record(run.key))
    })
  }
  private async applyControl(key: string, operationId: string): Promise<void> {
    const run = this.record(key), control = run.controls.find(row => row.operationId === operationId)
    if (!control || control.phase !== 'pending') return
    await this.executionAccess(run).authorize()
    this.assertQueueBindings(run)
    for (const target of control.targets) {
      if (control.appliedWorkIds.includes(target.workId)) continue
      try {
        const current = this.operator().get(WorkId(target.workId)).state
        const exact = current.attemptCount === target.attemptCount && current.status === target.status
          && current.activeAttemptId === target.activeAttemptId
        if (exact) {
          const expected: WorkControlPrecondition = { ...target,
            activeAttemptId: target.activeAttemptId === null ? null : AttemptId(target.activeAttemptId) }
          if (control.action === 'cancel') await this.operator().cancel(WorkId(target.workId), expected)
          else if (control.action === 'retry') await this.operator().retry(WorkId(target.workId), expected)
          else await this.operator().resolveUnknown(WorkId(target.workId), control.resolution === 'authorize-retry' ? { kind: 'authorize-retry' }
            : { kind: 'confirm-failed', failure: { category: 'operator-confirmed', sideEffect: 'unknown', retriable: false, message: 'Operator resolution' } }, expected)
        } else {
          const applied = control.action === 'cancel' ? current.attemptCount === target.attemptCount
            && (current.status === 'canceled' || current.cancelRequestedAt !== null)
            : control.action === 'retry' || control.resolution === 'authorize-retry'
              ? current.attemptCount === target.attemptCount && current.status === 'queued' || current.attemptCount === target.attemptCount + 1
              : current.attemptCount === target.attemptCount && current.status === 'failed'
          if (!applied) throw new EvalRunError('conflict')
        }
        await this.edit(key, (row) => {
          const action = row.controls.find(item => item.operationId === operationId)
          action?.appliedWorkIds.push(target.workId)
        })
      } catch {
        await this.edit(key, (row) => { const action = row.controls.find(item => item.operationId === operationId)
          if (action) { action.phase = 'needs-attention'; action.reason = 'control-reconciliation-required' } })
        return
      }
    }
    await this.edit(key, (row) => { const action = row.controls.find(item => item.operationId === operationId); if (action) action.phase = 'applied' })
  }
}
export default LocalEvalRuns
