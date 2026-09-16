import { createHash, randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { BrowserTaskError, BrowserTaskId } from './runtime.ts'
import {
  applyBrowserTaskChange,
  applyBrowserTaskEvent,
  assertBrowserTaskSnapshot,
  BROWSER_TASK_LIMITS,
  validateCheck,
  validateReceipt,
  validateCompletion,
} from './fold.ts'
import type { BrowserTaskFoldState } from './fold.ts'
import type { BrowserTaskChangeMeta, BrowserTaskOperation } from './domain.ts'
import type {
  AcceptanceEvaluation,
  BrowserActionAttempt,
  BrowserCapability,
  BrowserPageResource,
  BrowserTargetBinding,
  BrowserTaskBlocker,
  BrowserTaskDelegation,
  BrowserTaskProjectionState,
  BrowserTaskReceipt,
  BrowserTaskRef,
  BrowserTaskSnapshot,
  BrowserTaskSourceRef,
  CreateBrowserTaskRequest,
  DelegatedWorkRef,
} from './types.ts'

export type * from './types.ts'
export type * from './domain.ts'
export { BrowserTaskError, BrowserTaskId } from './runtime.ts'
export { BROWSER_TASK_LIMITS, decodeBrowserTaskChange, foldBrowserTask, validateCompletion } from './fold.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { browserTasks: BrowserTaskService }
}

const clone = <T>(value: T): T => structuredClone(value)
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const delegationPending = (work: Pick<DelegatedWorkRef, 'kind' | 'status'>): boolean => work.kind === 'cordis'
  ? ['starting', 'awaiting-approval', 'waiting', 'client-pending'].includes(work.status)
  : ['running', 'stopping', 'starting', 'awaiting-approval', 'waiting'].includes(work.status)

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
  }
  return value
}

function foldState(state: BrowserTaskProjectionState): BrowserTaskFoldState {
  return {
    ...state.current === null ? {} : { current: clone(state.current) },
    recentTaskIds: [...state.recentTaskIds],
    lastSourceSeq: state.lastSourceSeq,
    lastTaskSourceSeq: state.lastTaskSourceSeq,
    sourceFacts: [...state.sourceFacts],
  }
}

function project(state: BrowserTaskFoldState): BrowserTaskProjectionState {
  return {
    current: state.current === undefined ? null : freeze(clone(state.current)),
    recentTaskIds: [...state.recentTaskIds],
    lastSourceSeq: state.lastSourceSeq,
    lastTaskSourceSeq: state.lastTaskSourceSeq,
    sourceFacts: clone(state.sourceFacts),
    failure: null,
  }
}

export function applyBrowserTaskProjection(
  state: BrowserTaskProjectionState,
  event: SessionEvent,
): BrowserTaskProjectionState {
  if (state.failure !== null) return state
  try {
    const fold = foldState(state)
    applyBrowserTaskEvent(fold, event)
    if (event.type !== 'browser-task/change' && fold.lastSourceSeq === state.lastSourceSeq) return state
    return project(fold)
  } catch (error) {
    return {
      ...state,
      failure: `browser task replay failed at session event ${event.seq}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

const taskSchema: ZodType<BrowserTaskSnapshot> = zod.unknown().superRefine((value, context) => {
  try {
    assertBrowserTaskSnapshot(value)
  } catch (error) {
    context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) })
  }
}) as ZodType<BrowserTaskSnapshot>

const viewSchema: ZodType<BrowserTaskSnapshot | null> = zod.union([taskSchema, zod.null()])

const sourceFactSchema = zod.object({
  kind: zod.enum(['user', 'message', 'tool-call', 'tool-result', 'browser-task-receipt', 'browser-task-check', 'browser-task-delegation']),
  sessionSeq: zod.number().int().nonnegative(),
  callId: zod.string().min(1).optional(),
  name: zod.string().min(1).optional(),
  decision: zod.enum(['cancel', 'accept-unknown']).optional(),
  taskId: zod.string().min(1).optional(),
  requestId: zod.string().min(1).optional(),
  actionKind: zod.string().min(1).optional(),
  target: zod.unknown().optional(),
  outcome: zod.enum(['observed', 'failed', 'cancelled', 'unknown']).optional(),
  delivery: zod.enum(['sent', 'not-sent']).optional(),
  quiescent: zod.boolean().optional(),
  grantEpoch: zod.number().int().nonnegative().optional(),
  resourceId: zod.string().min(1).optional(),
  reason: zod.string().max(BROWSER_TASK_LIMITS.text).optional(),
  presentation: zod.unknown().optional(),
  checkerId: zod.string().min(1).optional(),
  evaluations: zod.array(zod.object({
    clauseId: zod.string().min(1),
    satisfied: zod.boolean(),
    evidenceIds: zod.array(zod.string().min(1)).max(BROWSER_TASK_LIMITS.evidenceRefs),
  }).strict()).max(BROWSER_TASK_LIMITS.evaluations).optional(),
  work: zod.unknown().optional(),
}).strict()

const stateSchema: ZodType<BrowserTaskProjectionState> = zod.object({
  current: viewSchema,
  recentTaskIds: zod.array(zod.string().min(1)).max(BROWSER_TASK_LIMITS.recentTaskIds),
  lastSourceSeq: zod.number().int().min(-1),
  lastTaskSourceSeq: zod.number().int().min(-1),
  sourceFacts: zod.array(sourceFactSchema).max(BROWSER_TASK_LIMITS.sourceFacts),
  failure: zod.string().min(1).nullable(),
}).strict().superRefine((value, context) => {
  try {
    if (value.current !== null) assertBrowserTaskSnapshot(value.current)
    if (new Set(value.recentTaskIds).size !== value.recentTaskIds.length) context.addIssue({ code: 'custom', message: 'duplicate recent task id' })
    let previous = -1
    for (const fact of value.sourceFacts) {
      if (fact.sessionSeq <= previous || fact.sessionSeq > value.lastSourceSeq) context.addIssue({ code: 'custom', message: 'source facts are not strictly increasing' })
      previous = fact.sessionSeq
      if ((fact.kind === 'tool-call' || fact.kind === 'tool-result') && fact.callId === undefined) context.addIssue({ code: 'custom', message: 'tool fact needs callId' })
      if (fact.kind !== 'tool-call' && fact.kind !== 'tool-result' && fact.callId !== undefined) context.addIssue({ code: 'custom', message: 'non-tool fact cannot have callId' })
      if (fact.decision !== undefined && fact.kind !== 'user') context.addIssue({ code: 'custom', message: 'only user facts carry decisions' })
      if ((fact.kind === 'browser-task-delegation') !== (fact.work !== undefined)) context.addIssue({ code: 'custom', message: 'delegation fact needs work only on its own kind' })
    }
  } catch (error) {
    context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) })
  }
}) as unknown as ZodType<BrowserTaskProjectionState>

export const browserTaskProjectionDefinition = {
  key: 'browserTask',
  stateSchema,
  init: (): BrowserTaskProjectionState => ({
    current: null,
    recentTaskIds: [],
    lastSourceSeq: -1,
    lastTaskSourceSeq: -1,
    sourceFacts: [],
    failure: null,
  }),
  apply: applyBrowserTaskProjection,
  wire: { viewSchema, view: (state: BrowserTaskProjectionState) => state.current === null ? null : clone(state.current) },
  stateVersion: 5,
} satisfies ProjectionDefinition<'browserTask', BrowserTaskProjectionState>

function target(task: BrowserTaskSnapshot, value: BrowserTargetBinding): void {
  if (task.target === undefined || !same(task.target, value)) throw new BrowserTaskError('operation target does not match task', 'BROWSER_TASK_TARGET_MISMATCH')
}

function unique(values: readonly string[], field: string): void {
  if (values.some(value => value.length === 0) || new Set(values).size !== values.length) throw new BrowserTaskError(`${field} must be unique non-empty ids`, 'BROWSER_TASK_INVALID_INPUT')
}

const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const nonEmpty = (value: unknown): string | undefined => typeof value === 'string' && value.length > 0 ? value : undefined
const outputDigest = (value: unknown): string => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
type CapturedDelegation =
  | { readonly type: 'work'; readonly work: Omit<DelegatedWorkRef, 'source'> }
  | { readonly type: 'job-result'; readonly jobId: string; readonly status: string; readonly outputDigest?: string }
  | { readonly type: 'cordis-inspect'; readonly pluginId: string; readonly packageId: string; readonly pluginRunId?: string; readonly status: string }
interface PendingDelegation {
  readonly result: CapturedDelegation
  readonly expires: ReturnType<typeof setTimeout>
}
const captured = (work: Omit<DelegatedWorkRef, 'source'>): CapturedDelegation => ({ type: 'work', work })

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => key in value)
}

function canonicalDelegation(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): CapturedDelegation | undefined {
  const value = result.isError ? undefined : object(result.value)
  if (value === undefined) return undefined
  const callId = String(exec.callId)
  // Subagent tools are configurable, so recognize only their closed result variants.
  if (value.kind === 'foreground' && exactKeys(value, ['kind', 'runId', 'output']) && typeof value.runId === 'string' && Array.isArray(value.output)) {
    return captured({ callId, kind: 'subagent', status: 'completed', identity: { mode: 'foreground', runId: value.runId }, outputDigest: outputDigest(value.output), evidenceIds: [] })
  }
  if (value.kind === 'background' && exactKeys(value, ['kind', 'jobId']) && typeof value.jobId === 'string') {
    return captured({ callId, kind: 'job', status: 'running', identity: { mode: 'background', jobId: value.jobId }, evidenceIds: [] })
  }
  if (value.kind === 'continuable' && exactKeys(value, ['kind', 'subagentId']) && typeof value.subagentId === 'string') {
    return captured({ callId, kind: 'subagent', status: 'running', identity: { mode: 'continuable', subagentId: value.subagentId }, evidenceIds: [] })
  }
  if (exec.name === 'cordis_run') {
    const pluginId = nonEmpty(value.pluginId); const packageId = nonEmpty(value.packageId)
    const pluginRunId = nonEmpty(value.pluginRunId); const status = nonEmpty(value.status)
    if (pluginId !== undefined && packageId !== undefined && pluginRunId !== undefined && status !== undefined) {
      return captured({ callId, kind: 'cordis', status, identity: { mode: 'cordis', pluginId, packageId, pluginRunId }, evidenceIds: [] })
    }
  }
  if (exec.name === 'job_output') {
    const job = object(value.job); const jobId = nonEmpty(job?.id); const status = nonEmpty(job?.status)
    if (jobId !== undefined && status !== undefined) return { type: 'job-result', jobId, status,
      ...(typeof value.text === 'string' ? { outputDigest: outputDigest(value.text) } : {}) }
  }
  if (exec.name === 'cordis_inspect_self') {
    const plugin = value.mode === 'package' ? object(value.plugin) : value
    const activeRun = object(plugin?.activeRun)
    const pluginId = nonEmpty(plugin?.pluginId)
    const packageId = value.mode === 'package' ? nonEmpty(value.packageId) : nonEmpty(activeRun?.packageId)
    const pluginRunId = nonEmpty(activeRun?.pluginRunId)
    const status = value.mode === 'package' ? nonEmpty(object(value.runtime)?.state) : nonEmpty(value.state)
    if (pluginId !== undefined && packageId !== undefined && status !== undefined) {
      return { type: 'cordis-inspect', pluginId, packageId, ...(pluginRunId === undefined ? {} : { pluginRunId }), status }
    }
  }
  return undefined
}

/** Session-log authority for one current browser task; no process-local task state exists. */
export class BrowserTaskService extends Service {
  static inject = ['agents', 'sessionProjections', 'tools']
  static Config = z.object({})
  private readonly capturing = new Set<string>()
  private readonly toolResults = new Map<string, PendingDelegation>()

  constructor(ctx: Context) {
    super(ctx, 'browserTasks')
    ctx.sessionProjections.register(browserTaskProjectionDefinition)
    ctx.on('tools/result', (exec, result) => {
      if (exec.agent === undefined || exec.parent !== undefined) return
      const resultFact = canonicalDelegation(exec, result)
      if (resultFact !== undefined) this.rememberDelegation(`${exec.agent.id}\u0000${exec.callId}`, resultFact)
    })
    ctx.on('agent/disposed', ({ agent }) => {
      for (const key of this.toolResults.keys()) if (key.startsWith(`${agent.id}\u0000`)) this.dropDelegation(key)
    })
    ctx.on('session/event', (session, event) => {
      queueMicrotask(() => {
        // Projection failure is authoritative; a best-effort observer must never leak it
        // into Cordis's microtask queue or contaminate the originating Session append.
        try { this.captureDelegation(session, event) } catch { /* observer is best effort */ }
      })
    })
  }

  /**
   * Read the current durable browser task for one live Agent.
   * @param agent - Exact live Agent whose Session owns the task.
   * @returns A detached task snapshot, or `undefined` when none exists.
   */
  get(agent: Agent): BrowserTaskSnapshot | undefined {
    this.live(agent)
    const current = this.projection(agent.session).current
    return current === null ? undefined : clone(current)
  }

  /**
   * Return the latest durable direct-user message available as a task source.
   * @param agent - Exact live Agent whose Session is inspected.
   * @returns The user-message sequence, or `undefined` before direct user input.
   */
  latestUserSource(agent: Agent): number | undefined {
    this.live(agent)
    let latest: number | undefined
    for (const fact of this.projection(agent.session).sourceFacts) {
      if (fact.kind === 'user') latest = fact.sessionSeq
    }
    return latest
  }

  /**
   * Create one task from a real user message after any prior task is terminal.
   * @param agent - Exact live Agent that owns the task.
   * @param request - Objective, acceptance clauses, target, source, and budgets.
   * @returns The committed revision-one task.
   */
  create(agent: Agent, request: CreateBrowserTaskRequest): BrowserTaskSnapshot {
    this.live(agent)
    const projection = this.projection(agent.session)
    if (projection.current !== null && projection.current.phase !== 'terminal') throw new BrowserTaskError('active browser task already exists', 'BROWSER_TASK_ALREADY_EXISTS')
    const objective = request.objective.trim()
    if (!objective || !Number.isSafeInteger(request.sourceSeq) || request.sourceSeq < 0 || !projection.sourceFacts.some(fact => fact.kind === 'user' && fact.sessionSeq === request.sourceSeq) || request.acceptance.length < 1 || request.acceptance.length > BROWSER_TASK_LIMITS.acceptance) throw new BrowserTaskError('create input must cite a prior user message', 'BROWSER_TASK_INVALID_INPUT')
    unique(request.acceptance.map(clause => clause.id), 'acceptance')
    const maxSteps = request.maxSteps ?? 128
    const maxActions = request.maxActions ?? 64
    if (!Number.isSafeInteger(maxSteps) || !Number.isSafeInteger(maxActions) || maxSteps < 1 || maxActions < 1 || maxSteps > BROWSER_TASK_LIMITS.maxBudget || maxActions > BROWSER_TASK_LIMITS.maxBudget) throw new BrowserTaskError('budget invalid', 'BROWSER_TASK_INVALID_INPUT')
    const now = Date.now()
    return this.commit(agent, 'create', {
      id: BrowserTaskId(`browser-task-${randomUUID()}`),
      revision: 1,
      objective,
      sourceSeq: request.sourceSeq,
      phase: 'running',
      blockers: [],
      ...request.target === undefined ? {} : { target: clone(request.target) },
      targetLossAcknowledged: false,
      acceptance: clone(request.acceptance),
      evidence: [],
      evaluations: [],
      attempts: [],
      resources: [],
      delegated: [],
      budget: { maxSteps, maxActions, stepsUsed: 0, actionsUsed: 0 },
      createdAt: now,
      updatedAt: now,
    })
  }

  /**
   * Append a bounded Browser receipt before any task mutation cites it.
   * @param agent - Exact live Agent that owns the task.
   * @param task - Current compare-and-set task revision.
   * @param receipt - Outcome bound to an existing attempt and exact authority.
   * @returns The durable receipt source reference.
   */
  recordReceipt(
    agent: Agent,
    task: BrowserTaskRef,
    receipt: Omit<BrowserTaskReceipt, 'kind' | 'version' | 'taskId'>,
  ): Extract<BrowserTaskSourceRef, { kind: 'browser-task-receipt' }> {
    this.live(agent)
    const current = this.requireCurrent(agent, task)
    target(current, receipt.target)
    const attempt = current.attempts.find(item => item.requestId === receipt.requestId)
    const beforeDispatch = attempt !== undefined && (attempt.stage === 'planned' || attempt.stage === 'prepared')
    const validDelivery = attempt !== undefined && (
      attempt.stage === 'dispatched' && receipt.delivery === 'sent'
      || attempt.stage === 'settled' && attempt.outcome === 'unknown' && receipt.delivery === 'sent'
      || beforeDispatch && receipt.delivery === 'not-sent' &&  receipt.quiescent
        && (receipt.outcome === 'failed' || receipt.outcome === 'cancelled')
    )
    if (
      !validDelivery
      || attempt.actionKind !== receipt.actionKind
      || attempt.grantEpoch !== receipt.grantEpoch
      || attempt.resourceId !== receipt.resourceId
      || !same(attempt.target, receipt.target)
    ) throw new BrowserTaskError('receipt does not match the attempt delivery boundary', 'BROWSER_TASK_INVALID_INPUT')
    const fact = { kind: 'browser-task/receipt', version: 1, taskId: current.id, ...clone(receipt) } as const
    try { validateReceipt(fact) } catch (error) { throw new BrowserTaskError(error instanceof Error ? error.message : String(error), 'BROWSER_TASK_INVALID_INPUT') }
    const event = agent.session.append('browser-task/receipt', fact)
    return { kind: 'browser-task-receipt', sessionSeq: event.seq }
  }

  /**
   * Append one deterministic acceptance check over current evidence.
   * @param agent - Exact live Agent that owns the task.
   * @param task - Current compare-and-set task revision.
   * @param check - Checker identity, target, authority epoch, and clause results.
   * @returns The durable checker source reference.
   */
  recordCheck(agent: Agent, task: BrowserTaskRef, check: Omit<import('./types.ts').BrowserTaskCheck, 'kind' | 'version' | 'taskId'>): { kind: 'browser-task-check'; sessionSeq: number } {
    const current = this.requireCurrent(agent, task)
    target(current, check.target)
    if (current.capability?.state !== 'observed' || current.capability.grantEpoch !== check.grantEpoch || check.evaluations.length > BROWSER_TASK_LIMITS.evaluations) throw new BrowserTaskError('check input invalid', 'BROWSER_TASK_INVALID_EVALUATION')
    const fact = { kind: 'browser-task/check', version: 1, taskId: current.id, ...clone(check) } as const
    try { validateCheck(fact) } catch (error) { throw new BrowserTaskError(error instanceof Error ? error.message : String(error), 'BROWSER_TASK_INVALID_EVALUATION') }
    const event = agent.session.append('browser-task/check', fact)
    return { kind: 'browser-task-check', sessionSeq: event.seq }
  }

  /**
   * Record the extension capability and authorization snapshot.
   * @param agent - Exact live Agent that owns the task.
   * @param ref - Current compare-and-set task revision.
   * @param capability - Installation, grant epoch, scopes, actions, and protocol.
   * @returns The next task revision.
   */
  recordCapability(agent: Agent, ref: BrowserTaskRef, capability: BrowserCapability): BrowserTaskSnapshot {
    return this.mutate(agent, ref, 'capability', (task) => {
      if (task.target !== undefined && task.target.installationId !== capability.installationId) throw new BrowserTaskError('capability installation mismatches target', 'BROWSER_TASK_TARGET_MISMATCH')
      const drift = task.capability !== undefined && !same(task.capability, capability)
      const blockers = new Set(task.blockers)
      if (drift || capability.state !== 'observed') blockers.add('capability-drift')
      else blockers.delete('capability-drift')
      return { ...task, capability: clone(capability), blockers: [...blockers], evidence: drift ? task.evidence.map(evidence => ({ ...evidence, state: evidence.state === 'current' ? 'stale' as const : evidence.state })) : task.evidence }
    })
  }

  /**
   * Add immutable bounded evidence from a real Session or Browser receipt fact.
   * @param agent - Exact live Agent that owns the task.
   * @param ref - Current compare-and-set task revision.
   * @param evidence - Digest, source, target, coverage, and authority epoch.
   * @returns The next task revision.
   */
  recordEvidence(agent: Agent, ref: BrowserTaskRef, evidence: BrowserTaskSnapshot['evidence'][number]): BrowserTaskSnapshot {
    return this.mutate(agent, ref, 'evidence', (task) => {
      target(task, evidence.target)
      if (task.capability?.state !== 'observed' || task.capability.installationId !== evidence.target.installationId || task.capability.grantEpoch !== evidence.grantEpoch) throw new BrowserTaskError('evidence has no current authority', 'BROWSER_TASK_INVALID_EVIDENCE')
      if (task.evidence.some(item => item.id === evidence.id)) throw new BrowserTaskError('evidence id already exists', 'BROWSER_TASK_INVALID_EVIDENCE')
      return { ...task, evidence: [...task.evidence, clone(evidence)] }
    })
  }

  /**
   * Invalidate current evidence without deleting its durable identity.
   * @param agent - Exact live Agent that owns the task.
   * @param ref - Current compare-and-set task revision.
   * @param id - Existing evidence identity.
   * @param state - Invalidated evidence disposition.
   * @returns The next task revision.
   */
  staleEvidence(agent: Agent, ref: BrowserTaskRef, id: string, state: 'stale' | 'superseded'): BrowserTaskSnapshot {
    return this.mutate(agent, ref, 'evidence', (task) => {
      const evidence = task.evidence.find(item => item.id === id)
      if (evidence === undefined || evidence.state !== 'current') throw new BrowserTaskError('only current evidence can be invalidated', 'BROWSER_TASK_INVALID_EVIDENCE')
      return { ...task, evidence: task.evidence.map(item => item.id === id ? { ...item, state } : item) }
    })
  }

  /**
   * Plan one caller-identified Browser attempt before dispatch.
   * @param agent - Exact live Agent that owns the task.
   * @param ref - Current compare-and-set task revision.
   * @param attempt - Planned request, action, target, and authority identity.
   * @returns The next task revision.
   */
  recordAttempt(agent: Agent, ref: BrowserTaskRef, attempt: BrowserActionAttempt): BrowserTaskSnapshot {
    return this.mutate(agent, ref, 'attempt', (task) => {
      target(task, attempt.target)
      if (task.attempts.some(item => item.attemptId === attempt.attemptId)) throw new BrowserTaskError('attempt id exists', 'BROWSER_TASK_INVALID_INPUT')
      return { ...task, attempts: [...task.attempts, clone(attempt)] }
    })
  }

  /**
   * Advance an existing attempt through its monotonic lifecycle.
   * @param agent - Exact live Agent that owns the task.
   * @param ref - Current compare-and-set task revision.
   * @param attempt - Complete next attempt state with matching identity.
   * @returns The next task revision.
   */
  advanceAttempt(agent: Agent, ref: BrowserTaskRef, attempt: BrowserActionAttempt): BrowserTaskSnapshot {
    return this.mutate(agent, ref, 'attempt', (task) => {
      target(task, attempt.target)
      if (!task.attempts.some(item => item.attemptId === attempt.attemptId)) throw new BrowserTaskError('attempt missing', 'BROWSER_TASK_INVALID_INPUT')
      const attempts = task.attempts.map(item => item.attemptId === attempt.attemptId ? clone(attempt) : item)
      return { ...task, attempts, blockers: (attempts.some(item => item.write && item.outcome === 'unknown') ? [...new Set([...task.blockers, 'unknown-attempt'])] : task.blockers.filter(blocker => blocker !== 'unknown-attempt')) as BrowserTaskBlocker[] }
    })
  }

  /**
   * Reconcile an unknown attempt from a matching quiescent receipt.
   * @param agent - Exact live Agent that owns the task.
   * @param ref - Current compare-and-set task revision.
   * @param attempt - Settled replacement citing the recovery receipt.
   * @returns The next task revision.
   */
  reconcileAttempt(agent: Agent, ref: BrowserTaskRef, attempt: BrowserActionAttempt): BrowserTaskSnapshot {
    return this.mutate(agent, ref, 'reconcile-attempt', (task) => {
      const attempts = task.attempts.map(item => item.attemptId === attempt.attemptId ? clone(attempt) : item)
      return { ...task, attempts, blockers: attempts.some(item => item.write && item.outcome === 'unknown') ? task.blockers : task.blockers.filter(blocker => blocker !== 'unknown-attempt') }
    })
  }

  /**
   * Reserve or advance one exact-page resource lease.
   * @param agent - Exact live Agent that owns the task.
   * @param ref - Current compare-and-set task revision.
   * @param resource - Complete next resource state and optional disposition.
   * @returns The next task revision.
   */
  upsertResource(agent: Agent, ref: BrowserTaskRef, resource: BrowserPageResource): BrowserTaskSnapshot {
    return this.mutate(agent, ref, 'resource', (task) => {
      target(task, resource.target)
      const resources = [...task.resources.filter(item => item.id !== resource.id), clone(resource)]
      return { ...task, resources, blockers: (resources.some(item => ['reserved', 'release-pending', 'unresolved'].includes(item.state)) ? [...new Set([...task.blockers, 'cleanup'])] : task.blockers.filter(blocker => blocker !== 'cleanup')) as BrowserTaskBlocker[] }
    })
  }

  /**
   * Resolve an uncertain resource from a matching Browser receipt.
   * @param agent - Exact live Agent that owns the task.
   * @param ref - Current compare-and-set task revision.
   * @param resource - Final resource disposition with its receipt source.
   * @returns The next task revision.
   */
  reconcileResource(agent: Agent, ref: BrowserTaskRef, resource: BrowserPageResource): BrowserTaskSnapshot {
    return this.mutate(agent, ref, 'reconcile-resource', (task) => {
      target(task, resource.target)
      const resources = task.resources.map(item => item.id === resource.id ? clone(resource) : item)
      return { ...task, resources, blockers: (resources.some(item => ['reserved', 'release-pending', 'unresolved'].includes(item.state)) ? [...new Set([...task.blockers, 'cleanup'])] : task.blockers.filter(blocker => blocker !== 'cleanup')) as BrowserTaskBlocker[] }
    })
  }

  /**
   * Link a Job, Subagent, or Cordis tool call without treating it as acceptance.
   * @param agent - Exact live Agent that owns the task.
   * @param ref - Current compare-and-set task revision.
   * @param work - Bounded delegated-work identity, status, source, and expectation.
   * @returns The next task revision.
   */
  linkDelegatedWork(agent: Agent, ref: BrowserTaskRef, work: DelegatedWorkRef): BrowserTaskSnapshot {
    return this.mutate(agent, ref, 'delegation', (task) => {
      const delegated = [...task.delegated.filter(item => item.callId !== work.callId), clone(work)]
      const blockers = new Set(task.blockers)
      if (delegated.some(delegationPending)) blockers.add('delegated-work')
      else blockers.delete('delegated-work')
      return { ...task, delegated, blockers: [...blockers] }
    })
  }

  /**
   * Apply checker-backed evaluations for declared acceptance clauses.
   * @param agent - Exact live Agent that owns the task.
   * @param ref - Current compare-and-set task revision.
   * @param evaluations - Clause results citing one matching check fact.
   * @returns The next verifying task revision.
   */
  evaluate(agent: Agent, ref: BrowserTaskRef, evaluations: readonly AcceptanceEvaluation[]): BrowserTaskSnapshot {
    return this.mutate(agent, ref, 'evaluate', (task) => {
      unique(evaluations.map(item => item.clauseId), 'evaluations')
      for (const evaluation of evaluations) {
        if (!task.acceptance.some(clause => clause.id === evaluation.clauseId)) throw new BrowserTaskError('evaluation clause invalid', 'BROWSER_TASK_INVALID_EVALUATION')
        if (evaluation.satisfied && (!evaluation.evidenceIds.length || evaluation.evidenceIds.some(id => !task.evidence.some(evidence => evidence.id === id && evidence.state === 'current' && same(evidence.target, task.target) && evidence.grantEpoch === task.capability?.grantEpoch)))) throw new BrowserTaskError('evaluation lacks current evidence', 'BROWSER_TASK_INVALID_EVALUATION')
      }
      return { ...task, phase: 'verifying', evaluations: clone(evaluations) }
    })
  }

  /**
   * Change a nonterminal task phase without clearing derived blockers.
   * @param agent - Exact live Agent that owns the task.
   * @param ref - Current compare-and-set task revision.
   * @param phase - Next nonterminal phase.
   * @param blockers - Optional complete blocker set; derived blockers cannot be removed here.
   * @returns The next task revision.
   */
  transition(agent: Agent, ref: BrowserTaskRef, phase: Exclude<BrowserTaskSnapshot['phase'], 'terminal'>, blockers?: readonly BrowserTaskBlocker[]): BrowserTaskSnapshot {
    return this.mutate(agent, ref, 'transition', (task) => {
      const next = blockers === undefined ? task.blockers : [...new Set(blockers)]
      for (const blocker of ['human-interaction', 'unknown-attempt', 'capability-drift', 'target-lost', 'delegated-work', 'cleanup'] as const) if (task.blockers.includes(blocker) && !next.includes(blocker)) throw new BrowserTaskError('transition cannot remove derived blocker', 'BROWSER_TASK_INVALID_TRANSITION')
      const humanStarted = next.includes('human-interaction') && !task.blockers.includes('human-interaction')
      return { ...task, phase, blockers: next, evidence: humanStarted ? task.evidence.map(evidence => ({ ...evidence, state: evidence.state === 'current' ? 'stale' as const : evidence.state })) : task.evidence, evaluations: humanStarted ? [] : task.evaluations }
    })
  }

  /**
   * Rebind a target only after an explicit target-loss edge.
   * @param agent - Exact live Agent that owns the task.
   * @param ref - Current compare-and-set task revision.
   * @param next - New exact installation and page identity.
   * @returns The next task revision with prior evidence stale.
   */
  rebind(agent: Agent, ref: BrowserTaskRef, next: BrowserTargetBinding): BrowserTaskSnapshot {
    return this.mutate(agent, ref, 'rebind', (task) => {
      if (!task.blockers.includes('target-lost')) throw new BrowserTaskError('rebind requires target-lost blocker', 'BROWSER_TASK_INVALID_TRANSITION')
      return { ...task, target: clone(next), targetLossAcknowledged: false, evidence: task.evidence.map(evidence => ({ ...evidence, state: evidence.state === 'current' ? 'stale' as const : evidence.state })) }
    })
  }

  /**
   * Acknowledge an explicit rebind and clear only its target-loss blocker.
   * @param agent - Exact live Agent that owns the task.
   * @param ref - Current compare-and-set task revision.
   * @returns The next task revision.
   */
  acknowledgeTargetLoss(agent: Agent, ref: BrowserTaskRef): BrowserTaskSnapshot {
    return this.mutate(agent, ref, 'acknowledge-target-loss', task => ({ ...task, targetLossAcknowledged: true, blockers: task.blockers.filter(blocker => blocker !== 'target-lost') }))
  }

  /**
   * Resume after human interaction only with fresh authority and evidence.
   * @param agent - Exact live Agent that owns the task.
   * @param ref - Current compare-and-set task revision.
   * @returns The next task revision without the human-interaction blocker.
   */
  acknowledgeHumanInteraction(agent: Agent, ref: BrowserTaskRef): BrowserTaskSnapshot {
    return this.mutate(agent, ref, 'acknowledge-human-interaction', (task) => {
      if (!task.blockers.includes('human-interaction') || task.capability?.state !== 'observed' || !task.evidence.some(evidence => evidence.state === 'current' && evidence.grantEpoch === task.capability?.grantEpoch)) throw new BrowserTaskError('human interaction requires fresh authority and evidence', 'BROWSER_TASK_INVALID_TRANSITION')
      return { ...task, blockers: task.blockers.filter(blocker => blocker !== 'human-interaction') }
    })
  }

  /**
   * Consume durable Agent-continuation budget.
   * @param agent - Exact live Agent that owns the task.
   * @param ref - Current compare-and-set task revision.
   * @param steps - Positive number of continuation steps to consume.
   * @returns The next task revision.
   */
  consumeContinuation(agent: Agent, ref: BrowserTaskRef, steps: number = 1): BrowserTaskSnapshot {
    return this.consume(agent, ref, steps, 0)
  }

  /**
   * Consume durable Browser-action budget.
   * @param agent - Exact live Agent that owns the task.
   * @param ref - Current compare-and-set task revision.
   * @param actions - Positive number of Browser actions to consume.
   * @returns The next task revision.
   */
  consumeAction(agent: Agent, ref: BrowserTaskRef, actions: number = 1): BrowserTaskSnapshot { return this.consume(agent, ref, 0, actions) }

  /**
   * Terminate a task; completed outcomes pass every acceptance and cleanup gate.
   * @param agent - Exact live Agent that owns the task.
   * @param ref - Current compare-and-set task revision.
   * @param outcome - Terminal outcome.
   * @returns The terminal task revision.
   */
  terminate(agent: Agent, ref: BrowserTaskRef, outcome: BrowserTaskSnapshot['outcome'] & string): BrowserTaskSnapshot {
    return this.mutate(agent, ref, 'terminate', (task) => {
      const next = { ...task, phase: 'terminal' as const, outcome }
      if (outcome === 'completed') validateCompletion(next, foldState(this.projection(agent.session)).sourceFacts)
      return next
    })
  }

  /**
   * End an uncertain task only from a newer direct user message. This records a
   * decision boundary; it never changes any unknown action or resource outcome.
   * @param agent - Exact live Agent that owns the task.
   * @param ref - Current compare-and-set task revision.
   * @param sourceSeq - Latest direct user message that explicitly requests cancellation.
   * @returns The terminal cancelled task revision.
   */
  cancelByOwner(agent: Agent, ref: BrowserTaskRef, sourceSeq: number): BrowserTaskSnapshot {
    return this.mutate(agent, ref, 'owner-cancel', (task) => {
      const latestUserSource = this.latestUserSource(agent)
      const decision = this.projection(agent.session).sourceFacts.find(fact => fact.kind === 'user' && fact.sessionSeq === sourceSeq)?.decision
      if (!Number.isSafeInteger(sourceSeq) || sourceSeq <= task.sourceSeq || sourceSeq !== latestUserSource
        || decision === undefined) {
        throw new BrowserTaskError('owner cancellation must cite a newer direct user message', 'BROWSER_TASK_INVALID_INPUT')
      }
      if (task.resources.some(resource => resource.state !== 'released' && resource.state !== 'vanished')) {
        throw new BrowserTaskError('owner cancellation requires every page resource to be disposed', 'BROWSER_TASK_INVALID_TRANSITION')
      }
      return { ...task, phase: 'terminal' as const, outcome: 'cancelled' as const,
        terminationSource: { kind: 'user', sessionSeq: sourceSeq } }
    })
  }

  private consume(agent: Agent, ref: BrowserTaskRef, steps: number, actions: number): BrowserTaskSnapshot {
    return this.mutate(agent, ref, 'consume-budget', (task) => {
      if (!Number.isSafeInteger(steps) || !Number.isSafeInteger(actions) || steps < 0 || actions < 0 || steps + actions === 0 || task.budget.stepsUsed + steps > task.budget.maxSteps || task.budget.actionsUsed + actions > task.budget.maxActions) throw new BrowserTaskError('budget exhausted or invalid', 'BROWSER_TASK_BUDGET')
      return {
        ...task,
        budget: {
          ...task.budget,
          stepsUsed: task.budget.stepsUsed + steps,
          actionsUsed: task.budget.actionsUsed + actions,
        },
      }
    })
  }

  private mutate(agent: Agent, ref: BrowserTaskRef, operation: Exclude<BrowserTaskOperation, 'create'>, fn: (task: BrowserTaskSnapshot) => Omit<BrowserTaskSnapshot, 'revision' | 'updatedAt'>): BrowserTaskSnapshot {
    const current = this.requireCurrent(agent, ref)
    return this.commit(agent, operation, {
      ...fn(clone(current)),
      revision: current.revision + 1,
      updatedAt: Math.max(Date.now(), current.updatedAt),
    })
  }

  private commit(agent: Agent, operation: BrowserTaskOperation, task: BrowserTaskSnapshot): BrowserTaskSnapshot {
    this.live(agent)
    const change: BrowserTaskChangeMeta = { kind: 'browser-task/change', version: 2, operation, task: clone(task) }
    try {
      assertBrowserTaskSnapshot(change.task)
      const fold = foldState(this.projection(agent.session))
      applyBrowserTaskChange(fold, change)
    } catch (error) {
      throw error instanceof BrowserTaskError ? error : new BrowserTaskError(error instanceof Error ? error.message : String(error), 'BROWSER_TASK_INVALID_INPUT')
    }
    agent.session.append('browser-task/change', change)
    const result = this.projection(agent.session).current
    if (result === null) throw new Error('browser task was not projected')
    return clone(result)
  }

  private requireCurrent(agent: Agent, ref: BrowserTaskRef): BrowserTaskSnapshot {
    this.live(agent)
    const current = this.projection(agent.session).current
    if (current === null) throw new BrowserTaskError('no browser task', 'BROWSER_TASK_NOT_FOUND')
    if (current.phase === 'terminal' || current.id !== ref.id || current.revision !== ref.revision) throw new BrowserTaskError('stale or terminal browser task', 'BROWSER_TASK_STALE_REVISION')
    return current
  }

  private projection(session: Session): BrowserTaskProjectionState {
    const projection = this.ctx.sessionProjections.stateOf(session, 'browserTask')
    if (projection === undefined) throw new Error('browser task projection is not registered')
    if (projection.failure !== null) throw new Error(projection.failure)
    return projection
  }

  private live(agent: Agent): void {
    if (this.ctx.agents.get(agent.id) !== agent) throw new BrowserTaskError('agent is not live', 'BROWSER_TASK_AGENT_NOT_LIVE')
  }

  private captureDelegation(session: Session, event: SessionEvent): void {
    const settlement = event.type === 'user/message' && (event.data as { source?: { kind?: unknown; senderSessionId?: unknown } }).source?.kind === 'subagent-settled'
      ? nonEmpty((event.data as { source?: { senderSessionId?: unknown } }).source?.senderSessionId)
      : undefined
    if (event.type !== 'tool/result' && settlement === undefined) return
    const callId = event.type === 'tool/result' ? String(event.data.message.source.callId) : undefined
    const key = callId === undefined ? undefined : `${session.id}\u0000${callId}`
    const agent = this.ctx.agents.get(session.id)
    if (agent === undefined || this.capturing.has(String(session.id))) return
    const current = this.projection(session).current
    if (current === null || current.phase === 'terminal') { if (key !== undefined) this.dropDelegation(key); return }
    const pending = key === undefined ? undefined : this.toolResults.get(key)
    if (settlement === undefined && pending === undefined) return
    const resultFact = pending?.result
    this.capturing.add(String(session.id))
    try {
      const ref: BrowserTaskRef = { id: current.id, revision: current.revision }
      const work = settlement !== undefined
        ? (() => {
          const existing = current.delegated.find(item => item.kind === 'subagent' && item.identity.mode === 'continuable'
              && item.identity.subagentId === settlement)
          return existing === undefined ? undefined : {
            callId: existing.callId, kind: existing.kind, status: 'settled', identity: existing.identity,
            evidenceIds: existing.evidenceIds,
          }
        })()
        : resultFact?.type === 'work'
          ? resultFact.work
          : resultFact?.type === 'job-result' ? (() => {
            const existing = current.delegated.find(item => item.kind === 'job' && item.identity.mode === 'background' && item.identity.jobId === resultFact.jobId)
            return existing === undefined ? undefined : {
              callId: existing.callId, kind: existing.kind, status: resultFact.status, identity: existing.identity,
              ...(resultFact.outputDigest === undefined ? {} : { outputDigest: resultFact.outputDigest }),
              evidenceIds: existing.evidenceIds,
            }
          })() : resultFact?.type === 'cordis-inspect' ? (() => {
            const existing = current.delegated.find(item => item.kind === 'cordis' && item.identity.mode === 'cordis'
              && item.identity.pluginId === resultFact.pluginId && item.identity.packageId === resultFact.packageId
              && (resultFact.pluginRunId === undefined || item.identity.pluginRunId === resultFact.pluginRunId))
            return existing === undefined ? undefined : {
              callId: existing.callId, kind: existing.kind, status: resultFact.status, identity: existing.identity,
              evidenceIds: existing.evidenceIds,
            }
          })() : undefined
      if (work === undefined) return
      const fact: BrowserTaskDelegation = { kind: 'browser-task/delegation', version: 1, taskId: current.id, work: clone(work) }
      const appended = session.append('browser-task/delegation', fact)
      this.linkDelegatedWork(agent, ref, { ...work, source: { kind: 'browser-task-delegation', sessionSeq: appended.seq } })
    } catch {
      // Capture must not contaminate the Session append that triggered it.
    } finally {
      if (key !== undefined) this.dropDelegation(key)
      this.capturing.delete(String(session.id))
    }
  }

  private rememberDelegation(key: string, result: CapturedDelegation): void {
    this.dropDelegation(key)
    const expires = setTimeout(() => { this.dropDelegation(key) }, 30_000)
    expires.unref()
    this.toolResults.set(key, { result, expires })
  }

  private dropDelegation(key: string): void {
    const pending = this.toolResults.get(key)
    if (pending === undefined) return
    clearTimeout(pending.expires)
    this.toolResults.delete(key)
  }
}

export default BrowserTaskService
