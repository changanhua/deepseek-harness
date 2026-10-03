import { createHash, randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import { evalContractDigest, parseEvalGateDecision, parseResolvedExecutionManifest, validateEvalDecisionContext, type EvalGateDecision, type ResolvedExecutionManifest } from '@changanhua/dsh-eval'
import type { EvalRunAccess } from '@changanhua/dsh-eval-runs'
import type { GateSnapshot, GateVerifierInput } from '@changanhua/dsh-eval-gates'
import EvalGates, { EvalGateError, type EvalGateView } from '@changanhua/dsh-eval-gates'
import { policyOf, type Config, type GatePolicy, type VerifierExecution } from './config.ts'
import { makeVerifierInput } from './input.ts'
import { GateLedger, type GateRecord } from './ledger.ts'
import { decideSnapshot } from './policy.ts'

const ref = (value: { id: string; version: string }) => ({ id: value.id, version: value.version, digest: evalContractDigest(value) })
const hashRef = (id: string, digest: string) => ({ id, version: '1', digest })
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const policyDigest = (policy: GatePolicy) => evalContractDigest({ id: policy.id, verifierPlan: policy.verifierPlan,
  coreDigest: policy.coreDigest, launch: policy.launch, maxInputBytes: policy.maxInputBytes,
  maxOutputBytes: policy.maxOutputBytes })

function verifiedManifests(snapshot: GateSnapshot, policy: GatePolicy, verifier: VerifierExecution): ResolvedExecutionManifest[] {
  return snapshot.cells.map((cell) => {
    const source = cell.work.output?.manifest
    if (!source) throw new EvalGateError('blocked')
    return parseResolvedExecutionManifest({ ...source, id: `${source.id}:verified:${verifier.executionId}`, verifier: {
      executionId: verifier.executionId,
      observerRef: hashRef(`verifier-observer:${verifier.executionId}`, sha(verifier.observer)),
      evidenceRef: hashRef(`verifier-report:${verifier.executionId}`, verifier.reportDigest),
      repository: { verifiedCommit: verifier.verifiedCommit,
        workspaceLeaseRef: hashRef(`verifier-home:${verifier.executionId}`, sha(verifier.workspace)) },
      buildDigest: policy.coreDigest,
      profile: { id: verifier.report.runtime.profile, source: 'profile:host-pinned', digest: verifier.profileDigest },
      configDigest: verifier.configDigest, route: null, tools: [], skills: [],
    } })
  })
}

function inputCoverage(input: GateVerifierInput, execution: VerifierExecution): boolean {
  const keys = new Set(input.expectedCells.map(cell => JSON.stringify([cell.caseId, cell.routeId, cell.repeatIndex])))
  if (keys.size !== input.expectedCells.length || execution.report.cells.length !== keys.size) return false
  for (const cell of execution.report.cells) {
    const key = JSON.stringify([cell.caseId, cell.routeId, cell.repeatIndex])
    if (!keys.delete(key) || cell.outcome !== 'approved') return false
  }
  return keys.size === 0
}

/** Reconcile retained material bytes with every observation used by a deciding manifest. */
function executionIntact(input: GateVerifierInput, execution: VerifierExecution, policy: GatePolicy): boolean {
  try {
    const observer = JSON.parse(execution.observer) as { executionId: string
      sourceCommit: string
      coreDigest: string
      profilePatch: string
      configuration: { inputDigest: string }
      sessionId: string
      quiescent: boolean }
    const workspace = JSON.parse(execution.workspace) as { executionId: string; sourceCommit: string }
    return execution.quiescent && observer.quiescent && execution.executionId === observer.executionId
      && execution.executionId === workspace.executionId && execution.verifiedCommit === policy.launch.core.sourceCommit
      && observer.sourceCommit === execution.verifiedCommit && workspace.sourceCommit === execution.verifiedCommit
      && observer.coreDigest === policy.coreDigest && sha(observer.profilePatch) === execution.profileDigest
      && evalContractDigest(observer.configuration) === execution.configDigest
      && observer.configuration.inputDigest === execution.inputDigest
      && sha(JSON.stringify(input)) === execution.inputDigest && sha(execution.reportText) === execution.reportDigest
      && evalContractDigest(JSON.parse(execution.reportText)) === evalContractDigest(execution.report)
      && execution.report.inputDigest === execution.inputDigest && execution.report.snapshotRevision === input.snapshotRevision
      && execution.report.runtime.profile === policy.launch.profile && execution.report.runtime.configDigest === execution.configDigest
      && execution.sessionId === execution.report.runtime.sessionId && observer.sessionId === execution.sessionId
      && execution.sessionId !== 'unbound'
  } catch { return false }
}

/** Durable Gate producer. Snapshot and verifier artifacts are retained as one bounded ledger record. */
export class LocalEvalGates extends EvalGates {
  static inject = ['storageDomain']
  private ledger?: GateLedger
  private readonly pending = new Map<string, Promise<EvalGateView>>()
  private readonly stop = new AbortController()
  constructor(ctx: ConstructorParameters<typeof EvalGates>[0], private readonly config: Config) { super(ctx) }
  protected async [Service.init](): Promise<void> {
    this.ledger = await GateLedger.open(this.ctx, this.config.maxDecisions, this.config.maxLedgerBytes)
    this.ctx.effect(() => async () => {
      this.stop.abort(new EvalGateError('unavailable'))
      await Promise.allSettled(this.pending.values())
      await this.ledger?.close()
    }, 'evalGates.close')
  }
  private store(): GateLedger { if (!this.ledger) throw new EvalGateError('unavailable'); return this.ledger }
  private decision(row: GateRecord): EvalGateDecision {
    const snapshot = row.snapshot as GateSnapshot | null, manifests = row.manifests as ResolvedExecutionManifest[]
    if (!snapshot || snapshot.revision !== row.snapshotRevision) throw new EvalGateError('blocked')
    const { revision: _revision, observedAt: _observedAt, ...facts } = snapshot
    if (evalContractDigest(facts) !== snapshot.revision) throw new EvalGateError('blocked')
    const decision = parseEvalGateDecision(row.decision)
    if (snapshot.run.id !== row.runId || decision.runId !== row.runId
      || row.id !== evalContractDigest({ workspaceId: row.workspaceId, runId: row.runId,
        policyId: row.policyId, snapshotRevision: row.snapshotRevision })) throw new EvalGateError('blocked')
    validateEvalDecisionContext({ plan: snapshot.plan, manifests, decision })
    if (decision.decision === 'pass' && (row.verifier === null || row.verifierInput === null)) throw new EvalGateError('blocked')
    if (row.verifier !== null) {
      const input = row.verifierInput as GateVerifierInput | null, execution = row.verifier as VerifierExecution | null
      const policy = row.policy as GatePolicy | null
      if (!input || !execution || !policy || !executionIntact(input, execution, policy)
        || policyDigest(policy) !== row.policyDigest
        || input.snapshotRevision !== row.snapshotRevision
        || execution.report.snapshotRevision !== row.snapshotRevision || execution.report.inputDigest !== execution.inputDigest
        || execution.sessionId !== execution.report.runtime.sessionId || !execution.profileDigest || !execution.configDigest) throw new EvalGateError('blocked')
      const reportRef = hashRef(`verifier-report:${execution.executionId}`, execution.reportDigest)
      if (evalContractDigest(input) !== evalContractDigest(makeVerifierInput(snapshot))
        || evalContractDigest(decision.report.ref) !== evalContractDigest(reportRef)) throw new EvalGateError('blocked')
      if (decision.decision === 'pass') {
        const budgetRef = snapshot.plan.budget.required
          ? hashRef('gate-budget', evalContractDigest(snapshot.cells.map(cell => cell.budget))) : null
        if (execution.report.outcome !== 'approved' || !inputCoverage(input, execution)
          || decision.verifier?.executionId !== execution.executionId
          || evalContractDigest(decision.verifier.evidenceRef) !== evalContractDigest(reportRef)
          || evalContractDigest(decision.evidenceIntegrity.receiptRef) !== evalContractDigest(hashRef('gate-snapshot', snapshot.revision))
          || evalContractDigest(decision.budget.receiptRef) !== evalContractDigest(budgetRef)
          || evalContractDigest(manifests) !== evalContractDigest(verifiedManifests(snapshot, policy, execution))) {
          throw new EvalGateError('blocked')
        }
      }
    }
    return decision
  }
  private view(row: GateRecord, current: boolean): EvalGateView { return { id: row.id, runId: row.runId, policyId: row.policyId, snapshotRevision: row.snapshotRevision, decision: this.decision(row), validity: current ? 'current' : 'stale', createdAt: row.createdAt } }
  private async current(access: EvalRunAccess, row: GateRecord): Promise<boolean> {
    const snapshot = await this.config.host.snapshots(access, row.runId)
    const policy = policyOf(this.config, row.policyId)
    if (!policy || policyDigest(policy) !== row.policyDigest) return false
    const verifier = row.verifier as VerifierExecution | null
    if (verifier && (policy.launch.core.digest !== policy.coreDigest
      || verifier.report.runtime.profile !== policy.launch.profile)) return false
    const now = this.config.host.now?.() ?? Date.now()
    if (!snapshot || snapshot.revision !== row.snapshotRevision || snapshot.expiresAt <= now
      || row.createdAt + this.config.retentionMs <= now) return false
    return decideSnapshot(snapshot, now).decision === 'pass' || this.decision(row).decision !== 'pass'
  }
  async get(access: EvalRunAccess, id: string): Promise<EvalGateView> {
    await access.authorize()
    const row = this.store().read().find(value => value.id === id && value.workspaceId === access.workspace.id)
    if (!row) throw new EvalGateError('not-found')
    return this.view(row, await this.current(access, row))
  }
  async evaluate(access: EvalRunAccess, runId: string, policyId: string, signal?: AbortSignal): Promise<EvalGateView> {
    this.stop.signal.throwIfAborted()
    const key = evalContractDigest({ workspaceId: access.workspace.id, runId, policyId })
    const before = this.pending.get(key) ?? Promise.resolve()
    const current = before.catch(() => {}).then(() => this.evaluateExclusive(access, runId, policyId,
      AbortSignal.any([this.stop.signal, ...(signal ? [signal] : [])])))
    this.pending.set(key, current)
    void current.then(() => { if (this.pending.get(key) === current) this.pending.delete(key) },
      () => { if (this.pending.get(key) === current) this.pending.delete(key) })
    return current
  }
  private async evaluateExclusive(access: EvalRunAccess, runId: string, policyId: string, signal: AbortSignal): Promise<EvalGateView> {
    await access.authorize(); signal.throwIfAborted()
    const policy = policyOf(this.config, policyId)
    if (!policy || policy.launch.core.digest !== policy.coreDigest) throw new EvalGateError('blocked')
    const snapshot = await this.config.host.snapshots(access, runId, signal)
    if (!snapshot) throw new EvalGateError('not-found')
    if (snapshot.run.id !== runId) throw new EvalGateError('conflict')
    if (evalContractDigest(snapshot.plan.verifierPlanRef) !== evalContractDigest(policy.verifierPlan)) throw new EvalGateError('blocked')
    const id = evalContractDigest({ workspaceId: access.workspace.id, runId, policyId, snapshotRevision: snapshot.revision })
    const existing = this.store().read().find(row => row.id === id)
    if (existing) return this.view(existing, await this.current(access, existing))
    if (this.store().read().length >= this.config.maxDecisions) throw new EvalGateError('blocked')
    const now = this.config.host.now?.() ?? Date.now(), preliminary = decideSnapshot(snapshot, now)
    let input: GateVerifierInput | null = null, verifier: VerifierExecution | null = null, nonComparable = false
    if (preliminary.decision === 'pass') try { input = makeVerifierInput(snapshot); verifier = await this.config.host.verify(input, policy, signal) }
    catch (error) { signal.throwIfAborted(); nonComparable = error instanceof Error && error.message.includes('baseline-unsupported') }
    const after = await this.config.host.snapshots(access, runId, signal)
    if (!after || after.revision !== snapshot.revision) throw new EvalGateError('conflict')
    if (input && verifier && !executionIntact(input, verifier, policy)) verifier = null
    const approved = preliminary.decision === 'pass' && input !== null && verifier !== null && verifier.quiescent && verifier.report.outcome === 'approved' && inputCoverage(input, verifier)
    const manifests = approved && verifier ? verifiedManifests(snapshot, policy, verifier) : []
    const reportRef = verifier ? hashRef(`verifier-report:${verifier.executionId}`, verifier.reportDigest) : hashRef('gate-snapshot', snapshot.revision)
    const decisionKind = approved ? 'pass' : preliminary.decision === 'block' || verifier?.report.outcome === 'rejected' ? 'block' : 'needs-attention'
    const reasonCode = approved ? 'criteria-satisfied' : nonComparable ? 'non-comparable' : preliminary.decision !== 'pass' ? preliminary.reasonCode : verifier?.report.outcome === 'rejected' ? 'criteria-failed' : 'pending-verification'
    const decision = parseEvalGateDecision({ kind: 'eval-gate-decision', schemaVersion: 1, id: randomUUID(), version: '1', decision: decisionKind, reasonCode, runId,
      planRef: ref(snapshot.plan), suiteRef: snapshot.plan.suiteRef, manifestRefs: manifests.map(ref), report: { ref: reportRef, outcome: approved ? 'passed' : decisionKind === 'block' ? 'failed' : 'infrastructure-uncertain' },
      verifier: approved && verifier ? { executionId: verifier.executionId, planRef: snapshot.plan.verifierPlanRef, reportRef, manifestRefs: manifests.map(ref), evidenceRef: reportRef, outcome: 'approved' } : null,
      evidenceIntegrity: { status: approved ? 'intact' : 'unknown', receiptRef: approved ? hashRef('gate-snapshot', snapshot.revision) : null },
      budget: { status: snapshot.plan.budget.required ? approved ? 'within-limit' : 'unknown' : 'not-required', authorizationRef: snapshot.plan.budget.required ? snapshot.plan.budget.authorizationRef : null,
        receiptRef: snapshot.plan.budget.required && approved ? hashRef('gate-budget', evalContractDigest(snapshot.cells.map(cell => cell.budget))) : null }, baselineDeltaRef: null, decidedAt: new Date(now).toISOString() })
    validateEvalDecisionContext({ plan: snapshot.plan, manifests, decision })
    signal.throwIfAborted()
    await this.store().change((rows) => { if (!rows.some(row => row.id === id)) rows.push({ id, runId,
      workspaceId: access.workspace.id, policyId, policyDigest: policyDigest(policy), snapshotRevision: snapshot.revision, createdAt: now,
      snapshot: structuredClone(snapshot), policy: structuredClone(policy), verifierInput: input,
      verifier: verifier && structuredClone(verifier), manifests: structuredClone(manifests), decision }) })
    const saved = this.store().read().find(row => row.id === id)
    if (!saved) throw new EvalGateError('unavailable')
    return this.view(saved, await this.current(access, saved))
  }
}
export default LocalEvalGates
export { createLocalVerifierExecution } from './runner.ts'
export type { Config, GatePolicy, GateHost, VerifierExecution } from './config.ts'
