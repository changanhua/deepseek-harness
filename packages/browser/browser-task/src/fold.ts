import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { BROWSER_TASK_CHANGE_VERSION } from './runtime.ts'
import type { BrowserTaskChangeMeta, BrowserTaskOperation } from './domain.ts'
import type {
  BrowserTaskBlocker,
  BrowserTaskId,
  BrowserTaskSnapshot,
  BrowserTaskSourceFact,
  BrowserTaskSourceRef,
} from './types.ts'

export const BROWSER_TASK_LIMITS = {
  acceptance: 32,
  evidence: 128,
  evaluations: 32,
  attempts: 128,
  resources: 64,
  delegated: 32,
  evidenceRefs: 32,
  sourceFacts: 256,
  recentTaskIds: 64,
  text: 4096,
  maxBudget: 10_000,
} as const

const operations = new Set<BrowserTaskOperation>([
  'create', 'evidence', 'attempt', 'reconcile-attempt', 'resource',
  'reconcile-resource', 'capability', 'delegation', 'evaluate', 'transition',
  'rebind', 'acknowledge-target-loss', 'consume-budget', 'terminate',
  'acknowledge-human-interaction',
])
const phases = new Set(['running', 'waiting', 'verifying', 'settling', 'terminal'])
const blockers = new Set<BrowserTaskBlocker>([
  'approval', 'human-interaction', 'unknown-attempt', 'capability-drift',
  'target-lost', 'delegated-work', 'cleanup',
])
const outcomes = new Set(['completed', 'refused', 'cancelled', 'failed', 'budget-exhausted'])
const finalResources = new Set(['released', 'vanished', 'retained'])
const resourceCreateActions = new Set(['entry_mount', 'region_render'])
const resourceClearActions = new Set(['entry_unmount', 'region_clear'])
const resourceActions = new Set([...resourceCreateActions, ...resourceClearActions])
const derivedBlockers = new Set<BrowserTaskBlocker>([
  'human-interaction', 'unknown-attempt', 'capability-drift', 'target-lost', 'delegated-work', 'cleanup',
])

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function exact(value: unknown, field: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!record(value)) throw new Error(`${field} invalid`)
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${field} has unknown field ${key}`)
  for (const key of required) if (!(key in value)) throw new Error(`${field} missing ${key}`)
  return value
}

function text(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || Buffer.byteLength(value) > BROWSER_TASK_LIMITS.text) {
    throw new Error(`${field} invalid`)
  }
  return value
}

function integer(value: unknown, field: string, min = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) throw new Error(`${field} invalid`)
  return value as number
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

function uniqueStrings(values: unknown, field: string, limit = BROWSER_TASK_LIMITS.evidenceRefs): readonly string[] {
  if (!Array.isArray(values)) throw new Error(`${field} invalid`)
  const items: readonly unknown[] = values
  if (
    items.length > limit
    || items.some(value => typeof value !== 'string' || value.length === 0)
    || new Set(items).size !== items.length
  ) {
    throw new Error(`${field} invalid`)
  }
  return items as readonly string[]
}

function array(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} invalid`)
  return value as readonly unknown[]
}

function target(value: unknown, field: string): void {
  const binding = exact(value, field, ['installationId', 'page'])
  text(binding.installationId, `${field}.installationId`)
  const page = exact(binding.page, `${field}.page`, ['tabId', 'frameId', 'documentId', 'url'])
  integer(page.tabId, `${field}.page.tabId`)
  integer(page.frameId, `${field}.page.frameId`)
  text(page.documentId, `${field}.page.documentId`)
  text(page.url, `${field}.page.url`)
}

function sourceRef(value: unknown, field: string): BrowserTaskSourceRef {
  const ref = exact(value, field, ['kind'], ['sessionSeq', 'callId'])
  if (ref.kind === 'user' || ref.kind === 'message') {
    if (Object.keys(ref).length !== 2) throw new Error(`${field} invalid`)
    integer(ref.sessionSeq, `${field}.sessionSeq`)
    return ref as BrowserTaskSourceRef
  }
  if (ref.kind === 'tool-call') {
    if (Object.keys(ref).length !== 2) throw new Error(`${field} invalid`)
    text(ref.callId, `${field}.callId`)
    return ref as BrowserTaskSourceRef
  }
  if (ref.kind === 'tool-result') {
    if (Object.keys(ref).length !== 3) throw new Error(`${field} invalid`)
    text(ref.callId, `${field}.callId`)
    integer(ref.sessionSeq, `${field}.sessionSeq`)
    return ref as BrowserTaskSourceRef
  }
  if (ref.kind === 'browser-task-receipt' || ref.kind === 'browser-task-check') {
    if (Object.keys(ref).length !== 2) throw new Error(`${field} invalid`)
    integer(ref.sessionSeq, `${field}.sessionSeq`)
    return ref as BrowserTaskSourceRef
  }
  throw new Error(`${field} invalid`)
}

function validateClause(value: unknown): void {
  const clause = exact(value, 'acceptance clause', ['id', 'kind'], ['text', 'url', 'control', 'state'])
  text(clause.id, 'acceptance clause.id')
  if (clause.kind === 'text-contains' && Object.keys(clause).length === 3) return void text(clause.text, 'acceptance clause.text')
  if (clause.kind === 'url-equals' && Object.keys(clause).length === 3) return void text(clause.url, 'acceptance clause.url')
  if (clause.kind === 'control-state' && Object.keys(clause).length === 4) {
    text(clause.control, 'acceptance clause.control')
    return void text(clause.state, 'acceptance clause.state')
  }
  throw new Error('acceptance clause invalid')
}

function validateEvidence(value: unknown): void {
  const evidence = exact(value, 'evidence', ['id', 'state', 'source', 'digest', 'target', 'grantEpoch'], ['coverage'])
  text(evidence.id, 'evidence.id')
  if (!['current', 'stale', 'superseded'].includes(String(evidence.state))) throw new Error('evidence state invalid')
  sourceRef(evidence.source, 'evidence.source')
  text(evidence.digest, 'evidence.digest')
  if (evidence.coverage !== undefined) integer(evidence.coverage, 'evidence.coverage')
  target(evidence.target, 'evidence.target')
  integer(evidence.grantEpoch, 'evidence.grantEpoch')
}

function validateAttempt(value: unknown): void {
  const attempt = exact(value, 'attempt', ['attemptId', 'requestId', 'actionKind', 'grantEpoch', 'stage', 'write', 'target'], ['resourceId', 'outcome', 'quiescent', 'settledBy', 'reconciledBy'])
  text(attempt.attemptId, 'attempt.id')
  text(attempt.requestId, 'attempt.request')
  text(attempt.actionKind, 'attempt.actionKind')
  integer(attempt.grantEpoch, 'attempt.grantEpoch')
  if (!['planned', 'prepared', 'dispatched', 'settled'].includes(String(attempt.stage)) || typeof attempt.write !== 'boolean') throw new Error('attempt invalid')
  target(attempt.target, 'attempt.target')
  if (attempt.resourceId !== undefined) text(attempt.resourceId, 'attempt.resourceId')
  const actionIsResourceScoped = resourceActions.has(attempt.actionKind as string)
  if ((attempt.resourceId !== undefined) !== actionIsResourceScoped) {
    throw new Error('resource action identity invalid')
  }
  if (attempt.outcome !== undefined && (
    typeof attempt.outcome !== 'string'
    || !['observed', 'failed', 'cancelled', 'unknown'].includes(attempt.outcome)
  )) throw new Error('attempt outcome invalid')
  if (attempt.quiescent !== undefined && typeof attempt.quiescent !== 'boolean') throw new Error('attempt quiescent invalid')
  if (attempt.stage === 'settled') {
    if (attempt.outcome === undefined || attempt.quiescent === undefined || attempt.settledBy === undefined || sourceRef(attempt.settledBy, 'attempt.settledBy').kind !== 'browser-task-receipt') throw new Error('settled attempt needs receipt')
    if (attempt.outcome !== 'unknown' && ! attempt.quiescent) throw new Error('settled known attempt must quiesce')
  } else if (
    attempt.outcome !== undefined
    || attempt.quiescent !== undefined
    || attempt.settledBy !== undefined
    || attempt.reconciledBy !== undefined
  ) {
    throw new Error('unsettled attempt cannot carry receipt')
  }
  if (attempt.reconciledBy !== undefined && sourceRef(attempt.reconciledBy, 'attempt.reconciledBy').kind !== 'browser-task-receipt') throw new Error('attempt reconciliation must cite receipt')
}

function validateResource(value: unknown): void {
  const resource = exact(value, 'resource', ['id', 'state', 'target'], ['owner', 'disposition', 'dispositionSource'])
  text(resource.id, 'resource.id')
  if (!['reserved', 'active', 'release-pending', 'released', 'vanished', 'unresolved', 'retained'].includes(String(resource.state))) throw new Error('resource state invalid')
  target(resource.target, 'resource.target')
  if (resource.owner !== undefined && resource.owner !== 'session' && resource.owner !== 'user') throw new Error('resource owner invalid')
  if (resource.disposition !== undefined && (
    typeof resource.disposition !== 'string'
    || ![
      'clear-observed', 'document-replaced', 'owner-transfer', 'reconcile-active',
      'reconcile-observed', 'not-sent',
    ].includes(resource.disposition)
  )) throw new Error('resource disposition invalid')
  if (resource.dispositionSource !== undefined && sourceRef(resource.dispositionSource, 'resource.dispositionSource').kind !== 'browser-task-receipt') throw new Error('resource disposition must cite receipt')
  const final = finalResources.has(String(resource.state))
  const reconciledActive = resource.state === 'active' && resource.disposition === 'reconcile-active'
  if (final && (resource.disposition === undefined || resource.dispositionSource === undefined)) throw new Error('final resource needs disposition source')
  if (reconciledActive && resource.dispositionSource === undefined) throw new Error('reconciled active resource needs disposition source')
  if (!final && !reconciledActive && (resource.disposition !== undefined || resource.dispositionSource !== undefined)) throw new Error('unfinished resource cannot have disposition')
  if (resource.state === 'retained') throw new Error('retained resource requires owner decision protocol')
  if (resource.state !== 'retained' && resource.owner !== undefined) throw new Error('resource owner invalid')
}

function validateCapability(value: unknown): void {
  const capability = exact(value, 'capability', ['installationId', 'state', 'grantEpoch', 'scopes', 'actions', 'protocol'])
  text(capability.installationId, 'capability.installationId')
  if (!['observed', 'degraded', 'unavailable'].includes(String(capability.state))) throw new Error('capability state invalid')
  integer(capability.grantEpoch, 'capability.grantEpoch')
  uniqueStrings(capability.scopes, 'capability.scopes', BROWSER_TASK_LIMITS.evidenceRefs)
  uniqueStrings(capability.actions, 'capability.actions', BROWSER_TASK_LIMITS.evidenceRefs)
  text(capability.protocol, 'capability.protocol')
}

function validateDelegation(value: unknown): void {
  const delegation = exact(value, 'delegation', ['id', 'kind', 'status', 'expectedOutput', 'evidenceIds', 'source'])
  text(delegation.id, 'delegation.id')
  if (!['job', 'subagent', 'cordis'].includes(String(delegation.kind))) throw new Error('delegation kind invalid')
  text(delegation.status, 'delegation.status')
  text(delegation.expectedOutput, 'delegation.expectedOutput')
  uniqueStrings(delegation.evidenceIds, 'delegation.evidenceIds')
  sourceRef(delegation.source, 'delegation.source')
}

function ids(values: readonly unknown[], field: string, key: string): void {
  const found = values.map(value => record(value) ? value[key] : undefined)
  if (found.some(value => typeof value !== 'string' || value.length === 0) || new Set(found).size !== found.length) throw new Error(`${field} ids invalid`)
}

export function assertBrowserTaskSnapshot(value: unknown): BrowserTaskSnapshot {
  const task = exact(value, 'snapshot', [
    'id', 'revision', 'objective', 'sourceSeq', 'phase', 'blockers', 'targetLossAcknowledged',
    'acceptance', 'evidence', 'evaluations', 'attempts', 'resources', 'delegated', 'budget',
    'createdAt', 'updatedAt',
  ], ['outcome', 'target', 'capability'])
  text(task.id, 'id')
  integer(task.revision, 'revision', 1)
  text(task.objective, 'objective')
  integer(task.sourceSeq, 'sourceSeq')
  if (typeof task.phase !== 'string' || !phases.has(task.phase)) throw new Error('phase invalid')
  if (task.outcome !== undefined && (typeof task.outcome !== 'string' || !outcomes.has(task.outcome))) throw new Error('outcome invalid')
  if ((task.phase === 'terminal') !== (task.outcome !== undefined)) throw new Error('terminal outcome invalid')
  if (!Array.isArray(task.blockers) || task.blockers.some((value: unknown) => typeof value !== 'string' || !blockers.has(value as BrowserTaskBlocker)) || new Set(task.blockers).size !== task.blockers.length) throw new Error('blockers invalid')
  if (task.target !== undefined) target(task.target, 'target')
  if (typeof task.targetLossAcknowledged !== 'boolean') throw new Error('target acknowledgement invalid')
  const acceptance = array(task.acceptance, 'acceptance')
  const evidence = array(task.evidence, 'evidence')
  const evaluations = array(task.evaluations, 'evaluations')
  const attempts = array(task.attempts, 'attempts')
  const resources = array(task.resources, 'resources')
  const delegated = array(task.delegated, 'delegated')
  if (
    acceptance.length < 1 || acceptance.length > BROWSER_TASK_LIMITS.acceptance
    || evidence.length > BROWSER_TASK_LIMITS.evidence
    || evaluations.length > BROWSER_TASK_LIMITS.evaluations
    || attempts.length > BROWSER_TASK_LIMITS.attempts
    || resources.length > BROWSER_TASK_LIMITS.resources
    || delegated.length > BROWSER_TASK_LIMITS.delegated
  ) throw new Error('capacity exceeded')
  ids(acceptance, 'acceptance', 'id')
  ids(evidence, 'evidence', 'id')
  ids(attempts, 'attempt', 'attemptId')
  ids(resources, 'resource', 'id')
  ids(delegated, 'delegation', 'id')
  acceptance.forEach(validateClause)
  evidence.forEach(validateEvidence)
  for (const evaluation of evaluations) {
    const parsed = exact(evaluation, 'evaluation', ['clauseId', 'satisfied', 'evidenceIds', 'checkerRef'])
    text(parsed.clauseId, 'evaluation.clauseId')
    if (typeof parsed.satisfied !== 'boolean') throw new Error('evaluation satisfied invalid')
    uniqueStrings(parsed.evidenceIds, 'evaluation.evidenceIds')
    const checker = sourceRef(parsed.checkerRef, 'evaluation.checkerRef')
    if (checker.kind !== 'browser-task-check') throw new Error('evaluation checker must cite check fact')
  }
  attempts.forEach(validateAttempt)
  resources.forEach(validateResource)
  if (task.capability !== undefined) validateCapability(task.capability)
  delegated.forEach(validateDelegation)
  const budget = exact(task.budget, 'budget', ['maxSteps', 'maxActions', 'stepsUsed', 'actionsUsed'])
  const maxSteps = integer(budget.maxSteps, 'budget.maxSteps')
  const maxActions = integer(budget.maxActions, 'budget.maxActions')
  const stepsUsed = integer(budget.stepsUsed, 'budget.stepsUsed')
  const actionsUsed = integer(budget.actionsUsed, 'budget.actionsUsed')
  if (
    maxSteps > BROWSER_TASK_LIMITS.maxBudget
    || maxActions > BROWSER_TASK_LIMITS.maxBudget
    || stepsUsed > maxSteps
    || actionsUsed > maxActions
  ) throw new Error('budget exceeded')
  const createdAt = integer(task.createdAt, 'createdAt')
  const updatedAt = integer(task.updatedAt, 'updatedAt')
  if (updatedAt < createdAt) throw new Error('timestamps invalid')
  return task as unknown as BrowserTaskSnapshot
}

export function decodeBrowserTaskChange(value: unknown): BrowserTaskChangeMeta | undefined {
  if (!record(value) || value.kind !== 'browser-task/change') return undefined
  const change = exact(value, 'change', ['kind', 'version', 'operation', 'task'])
  if (change.version !== BROWSER_TASK_CHANGE_VERSION || typeof change.operation !== 'string' || !operations.has(change.operation as BrowserTaskOperation)) throw new Error('change header invalid')
  return { kind: 'browser-task/change', version: 2, operation: change.operation as BrowserTaskOperation, task: assertBrowserTaskSnapshot(change.task) }
}

function mapBy<T extends object>(values: readonly T[], key: string): Map<string, T> {
  return new Map(values.map(value => [String((value as Record<string, unknown>)[key]), value]))
}

function preserveCollection<T extends object>(previous: readonly T[], next: readonly T[], key: string, operation: string): void {
  const after = mapBy(next, key)
  for (const item of previous) if (!after.has(String((item as Record<string, unknown>)[key]))) throw new Error(`${operation} removed ${key}`)
  if (next.length > previous.length + 1) throw new Error(`${operation} added too many ${key}s`)
}

function only(next: BrowserTaskSnapshot, previous: BrowserTaskSnapshot, operation: string, fields: readonly string[]): void {
  const trim = (task: BrowserTaskSnapshot) => Object.fromEntries(Object.entries(task).filter(([key]) => !['revision', 'updatedAt', ...fields].includes(key)))
  if (!same(trim(next), trim(previous))) throw new Error(`${operation} changed unrelated state`)
}

function taskTarget(task: BrowserTaskSnapshot, value: unknown): void {
  if (task.target === undefined || !same(task.target, value)) throw new Error('target mismatch')
}

function hasFact(facts: readonly BrowserTaskSourceFact[], ref: BrowserTaskSourceRef): boolean {
  return facts.some((fact) => {
    if (fact.kind !== ref.kind) return false
    if ('sessionSeq' in ref && fact.sessionSeq !== ref.sessionSeq) return false
    if ('callId' in ref && fact.callId !== ref.callId) return false
    return true
  })
}

function requireFact(facts: readonly BrowserTaskSourceFact[], ref: BrowserTaskSourceRef, field: string): void {
  if (!hasFact(facts, ref)) throw new Error(`${field} does not cite an observed Session fact`)
}

function requireTaskFacts(task: BrowserTaskSnapshot, facts: readonly BrowserTaskSourceFact[]): void {
  for (const evidence of task.evidence) {
    requireFact(facts, evidence.source, 'evidence.source')
    const source = evidence.source
    if (source.kind === 'browser-task-receipt' && !facts.some(fact => fact.kind === 'browser-task-receipt' && fact.sessionSeq === source.sessionSeq && fact.taskId === task.id && same(fact.target, evidence.target) && fact.grantEpoch === evidence.grantEpoch && fact.outcome === 'observed' && fact.delivery === 'sent' && fact.quiescent === true && task.attempts.some(attempt => attempt.requestId === fact.requestId && attempt.actionKind === fact.actionKind && same(attempt.target, evidence.target) && attempt.grantEpoch === evidence.grantEpoch))) throw new Error('evidence receipt does not match target authority')
  }
  for (const evaluation of task.evaluations) {
    requireFact(facts, evaluation.checkerRef, 'evaluation.checkerRef')
    if (!facts.some(fact => fact.kind === 'browser-task-check' && fact.sessionSeq === evaluation.checkerRef.sessionSeq && fact.taskId === task.id && same(fact.target, task.target) && fact.grantEpoch === task.capability?.grantEpoch && fact.evaluations?.some(item => item.clauseId === evaluation.clauseId && item.satisfied === evaluation.satisfied && same(item.evidenceIds, evaluation.evidenceIds)))) throw new Error('evaluation check does not match')
  }
  for (const attempt of task.attempts) if (attempt.stage === 'settled') {
    const source = attempt.settledBy
    if (source === undefined) throw new Error('settled attempt has no receipt')
    requireFact(facts, source, 'attempt.settledBy')
    const hasMatchingReceipt = facts.some((fact) => {
      if (source.kind !== 'browser-task-receipt' || fact.kind !== 'browser-task-receipt') return false
      if (fact.sessionSeq !== source.sessionSeq || fact.taskId !== task.id) return false
      if (fact.requestId !== attempt.requestId || fact.actionKind !== attempt.actionKind) return false
      if (fact.grantEpoch !== attempt.grantEpoch || !same(fact.target, attempt.target)) return false
      if (fact.outcome !== attempt.outcome || fact.quiescent !== attempt.quiescent) return false
      return fact.delivery === 'sent'
        || (fact.delivery === 'not-sent' && (attempt.outcome === 'failed' || attempt.outcome === 'cancelled'))
    })
    if (!hasMatchingReceipt) throw new Error('attempt settlement receipt does not match')
  }
  for (const attempt of task.attempts) if (attempt.reconciledBy !== undefined) {
    requireFact(facts, attempt.reconciledBy, 'attempt.reconciledBy')
    const source = attempt.reconciledBy
    if (source.kind === 'browser-task-receipt' && !facts.some(fact => fact.kind === 'browser-task-receipt' && fact.sessionSeq === source.sessionSeq && fact.taskId === task.id && fact.requestId === attempt.requestId && fact.actionKind === attempt.actionKind && fact.grantEpoch === attempt.grantEpoch && same(fact.target, attempt.target) && fact.outcome === attempt.outcome && fact.quiescent === true && attempt.quiescent === true)) throw new Error('attempt recovery receipt does not match')
  }
  for (const resource of task.resources) if (resource.dispositionSource !== undefined) {
    requireFact(facts, resource.dispositionSource, 'resource.dispositionSource')
    const source = resource.dispositionSource
    if (source.kind === 'browser-task-receipt' && !facts.some((fact) => {
      if (fact.kind !== 'browser-task-receipt' || fact.sessionSeq !== source.sessionSeq) return false
      if (fact.taskId !== task.id || !same(fact.target, resource.target)) return false
      if (fact.resourceId !== resource.id || fact.quiescent !== true) return false
      const matchesResourceAttempt = task.attempts.some(attempt => (
        attempt.requestId === fact.requestId
        && attempt.actionKind === fact.actionKind
        && attempt.grantEpoch === fact.grantEpoch
        && attempt.resourceId === resource.id
        && same(attempt.target, resource.target)
      ))
      if (!matchesResourceAttempt) return false
      switch (resource.disposition) {
        case 'reconcile-active':
          return resourceCreateActions.has(fact.actionKind ?? '')
            && fact.delivery === 'sent' && fact.outcome === 'observed'
        case 'clear-observed':
        case 'reconcile-observed':
          return resourceClearActions.has(fact.actionKind ?? '')
            && fact.delivery === 'sent' && fact.outcome === 'observed'
        case 'document-replaced':
          return resourceActions.has(fact.actionKind ?? '') && fact.delivery === 'sent'
            && (fact.outcome === 'failed' || fact.outcome === 'unknown')
            && fact.reason === 'document_replaced'
        case 'not-sent':
          return resourceCreateActions.has(fact.actionKind ?? '') && fact.delivery === 'not-sent'
            && (fact.outcome === 'failed' || fact.outcome === 'cancelled')
        default:
          return false
      }
    })) throw new Error('resource receipt does not match')
  }
  for (const delegation of task.delegated) {
    requireFact(facts, delegation.source, 'delegation.source')
    const call = facts.find(fact => fact.kind === 'tool-call' && fact.callId === delegation.id)
    if (delegation.status === 'running' && (delegation.source.kind !== 'tool-call' || call?.name === undefined || !((delegation.kind === 'subagent' && /^subagent/i.test(call.name)) || (delegation.kind === 'cordis' && /^cordis_/i.test(call.name)) || (delegation.kind === 'job' && /^(job|jobs)[_./-]/i.test(call.name))))) throw new Error('delegation running source invalid')
    if (['completed', 'failed', 'cancelled'].includes(delegation.status) && delegation.source.kind !== 'tool-result') throw new Error('delegation terminal source invalid')
  }
}

function validateCreate(next: BrowserTaskSnapshot, state: BrowserTaskFoldState): void {
  if (next.revision !== 1 || next.phase !== 'running' || next.outcome !== undefined || next.blockers.length !== 0 || next.evidence.length !== 0 || next.evaluations.length !== 0 || next.attempts.length !== 0 || next.resources.length !== 0 || next.capability !== undefined || next.delegated.length !== 0 || next.targetLossAcknowledged || next.budget.stepsUsed !== 0 || next.budget.actionsUsed !== 0) throw new Error('create baseline invalid')
  if (state.recentTaskIds.includes(next.id) || next.sourceSeq <= state.lastTaskSourceSeq) throw new Error('create task identity replayed')
  const source = state.sourceFacts.find(fact => fact.kind === 'user' && fact.sessionSeq === next.sourceSeq)
  if (source === undefined) throw new Error('create source must cite earlier user message')
}

function evidence(next: BrowserTaskSnapshot, previous: BrowserTaskSnapshot): void {
  only(next, previous, 'evidence', ['evidence'])
  preserveCollection(previous.evidence, next.evidence, 'id', 'evidence')
  const old = mapBy(previous.evidence, 'id')
  for (const item of next.evidence) {
    taskTarget(next, item.target)
    const before = old.get(item.id)
    if (before === undefined) continue
    if (!same({ ...before, state: undefined }, { ...item, state: undefined }) || !['current:current', 'current:stale', 'current:superseded', 'stale:stale', 'superseded:superseded'].includes(`${before.state}:${item.state}`)) throw new Error('evidence mutation invalid')
  }
}

function attempts(next: BrowserTaskSnapshot, previous: BrowserTaskSnapshot, reconciliation: boolean): void {
  only(next, previous, reconciliation ? 'reconcile-attempt' : 'attempt', ['attempts', 'blockers'])
  preserveCollection(previous.attempts, next.attempts, 'attemptId', reconciliation ? 'reconcile-attempt' : 'attempt')
  const old = mapBy(previous.attempts, 'attemptId')
  const transitions: Record<string, readonly string[]> = { planned: ['prepared', 'dispatched', 'settled'], prepared: ['dispatched', 'settled'], dispatched: ['settled'], settled: [] }
  for (const item of next.attempts) {
    taskTarget(next, item.target)
    const before = old.get(item.attemptId)
    if (before === undefined) {
      if (reconciliation || item.stage !== 'planned' || item.outcome !== undefined) throw new Error('attempt create invalid')
      continue
    }
    if (!same(
      { ...before, stage: undefined, outcome: undefined, quiescent: undefined, settledBy: undefined, reconciledBy: undefined },
      { ...item, stage: undefined, outcome: undefined, quiescent: undefined, settledBy: undefined, reconciledBy: undefined },
    )) throw new Error('attempt identity invalid')
    if (same(before, item)) continue
    if (before.outcome === 'unknown') {
      if (!reconciliation || item.outcome === 'unknown' || item.stage !== 'settled' || item.quiescent !== true || item.reconciledBy === undefined) throw new Error('unknown attempt needs quiescent reconciliation')
      continue
    }
    if (reconciliation || (before.stage !== item.stage && !transitions[before.stage]?.includes(item.stage))) throw new Error('attempt transition invalid')
  }
}

function validateSettlementDelivery(
  next: BrowserTaskSnapshot,
  previous: BrowserTaskSnapshot,
  facts: readonly BrowserTaskSourceFact[],
): void {
  const before = mapBy(previous.attempts, 'attemptId')
  for (const attempt of next.attempts) {
    const old = before.get(attempt.attemptId)
    if (old === undefined || old.stage === 'settled' || attempt.stage !== 'settled') continue
    const settledBy = attempt.settledBy
    const receipt = settledBy !== undefined && settledBy.kind === 'browser-task-receipt' ? facts.find(fact => fact.kind === 'browser-task-receipt' && fact.sessionSeq === settledBy.sessionSeq) : undefined
    const deliveryInvalid = old.stage === 'dispatched'
      ? receipt?.delivery !== 'sent'
      : receipt?.delivery !== 'not-sent'
        || (attempt.outcome !== 'failed' && attempt.outcome !== 'cancelled')
    if (deliveryInvalid) throw new Error('attempt settlement delivery invalid')
  }
}

function resources(next: BrowserTaskSnapshot, previous: BrowserTaskSnapshot, reconciliation: boolean): void {
  only(next, previous, reconciliation ? 'reconcile-resource' : 'resource', ['resources', 'blockers'])
  preserveCollection(previous.resources, next.resources, 'id', reconciliation ? 'reconcile-resource' : 'resource')
  const old = mapBy(previous.resources, 'id')
  const transitions: Record<string, readonly string[]> = {
    reserved: ['active', 'release-pending', 'unresolved', 'released', 'vanished'],
    active: ['release-pending', 'unresolved', 'retained', 'vanished'],
    'release-pending': ['released', 'vanished', 'unresolved', 'retained'],
    unresolved: [], released: [], vanished: [], retained: [],
  }
  for (const item of next.resources) {
    taskTarget(next, item.target)
    const before = old.get(item.id)
    if (before === undefined) {
      if (reconciliation || item.state !== 'reserved') throw new Error('resource create invalid')
      continue
    }
    if (!same(before.target, item.target)) throw new Error('resource identity invalid')
    if (item.state === 'vanished' && item.disposition !== 'document-replaced') {
      throw new Error('vanished resource requires document-replaced disposition')
    }
    if (item.disposition === 'document-replaced' && item.state !== 'vanished') {
      throw new Error('document-replaced disposition requires vanished resource')
    }
    if (reconciliation) {
      if (same(before, item)) continue
      if (before.state === 'unresolved') {
        const restoresActive = item.state === 'active' && item.disposition === 'reconcile-active'
        const clearsObserved = item.state === 'released'
          && ['clear-observed', 'reconcile-observed'].includes(item.disposition ?? '')
        const replacesDocument = item.state === 'vanished' && item.disposition === 'document-replaced'
        if (!restoresActive && !clearsObserved && !replacesDocument) {
          throw new Error('unresolved resource reconciliation invalid')
        }
      } else if (before.state === 'release-pending') {
        const clearsObserved = item.state === 'released'
          && ['clear-observed', 'reconcile-observed'].includes(item.disposition ?? '')
        const replacesDocument = item.state === 'vanished' && item.disposition === 'document-replaced'
        if (!clearsObserved && !replacesDocument) throw new Error('release-pending resource must reconcile to final state')
      } else {
        throw new Error('resource reconciliation must start from an uncertain resource')
      }
    } else if (before.state === 'unresolved') {
      throw new Error('unresolved resource needs reconciliation')
    } else if (before.state !== item.state && !transitions[before.state]?.includes(item.state)) {
      throw new Error('resource transition invalid')
    }
    if (before.state === 'reserved' && item.state === 'released' && item.disposition !== 'not-sent') throw new Error('reserved release requires not-sent')
    if (item.disposition === 'not-sent' && (before.state !== 'reserved' || item.state !== 'released')) throw new Error('not-sent requires a reserved release')
  }
}

function validateDerivedBlockers(next: BrowserTaskSnapshot, previous: BrowserTaskSnapshot, operation: BrowserTaskOperation): void {
  if (operation !== 'transition') return
  for (const blocker of derivedBlockers) {
    if (previous.blockers.includes(blocker) && !next.blockers.includes(blocker)) throw new Error('transition cannot remove derived blocker')
  }
}

export function validateCompletion(task: BrowserTaskSnapshot, facts: readonly BrowserTaskSourceFact[] = []): void {
  if (task.phase !== 'terminal' || task.outcome !== 'completed') return
  if (task.target === undefined || task.capability?.state !== 'observed' || task.capability.installationId !== task.target.installationId) throw new Error('completed lacks observed matching capability')
  if (task.blockers.length > 0) throw new Error('completed has blockers')
  requireTaskFacts(task, facts)
  const accepted = (clauseId: string) => task.evaluations.some(evaluation => evaluation.clauseId === clauseId && evaluation.satisfied && evaluation.evidenceIds.length > 0 && evaluation.evidenceIds.every(id => task.evidence.some(evidence => evidence.id === id && evidence.state === 'current' && same(evidence.target, task.target) && evidence.grantEpoch === task.capability?.grantEpoch)))
  if (task.acceptance.some(clause => !accepted(clause.id))) throw new Error('completed has unsatisfied acceptance')
  if (task.attempts.some(attempt => attempt.write && (attempt.stage !== 'settled' || attempt.outcome === 'unknown' || attempt.quiescent !== true))) throw new Error('completed has unsettled write')
  if (task.resources.some(resource => !finalResources.has(resource.state) || resource.disposition === undefined || resource.dispositionSource === undefined)) throw new Error('completed has undisposed resource')
  if (task.delegated.some(work => !['completed', 'failed', 'cancelled'].includes(work.status))) throw new Error('completed has unfinished delegated work')
  const pending = facts.filter(fact => fact.kind === 'tool-call' && fact.callId !== undefined && fact.name !== undefined && (/^subagent/i.test(fact.name) || /^cordis_/i.test(fact.name) || /^(job|jobs)[_./-]/i.test(fact.name)) && !facts.some(result => result.kind === 'tool-result' && result.callId === fact.callId))
  if (pending.length > 0) throw new Error('completed has unobserved delegated tool result')
}

export interface BrowserTaskFoldState {
  current?: BrowserTaskSnapshot
  recentTaskIds: BrowserTaskId[]
  lastSourceSeq: number
  lastTaskSourceSeq: number
  sourceFacts: BrowserTaskSourceFact[]
}

export const emptyBrowserTaskFoldState = (): BrowserTaskFoldState => ({
  recentTaskIds: [],
  lastSourceSeq: -1,
  lastTaskSourceSeq: -1,
  sourceFacts: [],
})

export function applyBrowserTaskChange(state: BrowserTaskFoldState, change: BrowserTaskChangeMeta): void {
  const next = change.task
  const previous = state.current
  if (change.operation === 'create') {
    if (previous !== undefined && previous.phase !== 'terminal') throw new Error('create requires terminal predecessor')
    validateCreate(next, state)
    state.recentTaskIds = [...state.recentTaskIds, next.id].slice(-BROWSER_TASK_LIMITS.recentTaskIds)
    state.lastTaskSourceSeq = next.sourceSeq
  } else {
    if (!previous || previous.phase === 'terminal' || next.id !== previous.id || next.revision !== previous.revision + 1 || next.createdAt !== previous.createdAt || next.updatedAt < previous.updatedAt || next.objective !== previous.objective || next.sourceSeq !== previous.sourceSeq || !same(next.acceptance, previous.acceptance)) throw new Error('mutation continuity invalid')
    switch (change.operation) {
      case 'evidence': evidence(next, previous); break
      case 'attempt': attempts(next, previous, false); validateSettlementDelivery(next, previous, state.sourceFacts); break
      case 'reconcile-attempt': attempts(next, previous, true); validateSettlementDelivery(next, previous, state.sourceFacts); break
      case 'resource': resources(next, previous, false); break
      case 'reconcile-resource': resources(next, previous, true); break
      case 'capability':
        only(next, previous, 'capability', ['capability', 'blockers', 'evidence'])
        if (previous.capability !== undefined && !same(next.capability, previous.capability) && !next.blockers.includes('capability-drift')) throw new Error('capability drift blocker missing')
        preserveCollection(previous.evidence, next.evidence, 'id', 'capability')
        break
      case 'delegation':
        only(next, previous, 'delegation', ['delegated', 'blockers'])
        preserveCollection(previous.delegated, next.delegated, 'id', 'delegation')
        break
      case 'evaluate':
        only(next, previous, 'evaluate', ['evaluations', 'phase'])
        break
      case 'transition':
        only(next, previous, 'transition', ['phase', 'blockers', 'evidence', 'evaluations'])
        validateDerivedBlockers(next, previous, change.operation)
        if (next.blockers.includes('human-interaction') && !previous.blockers.includes('human-interaction') && (next.evidence.some(item => item.state === 'current') || next.evaluations.length > 0)) throw new Error('human interaction must stale evidence and evaluations')
        break
      case 'rebind':
        only(next, previous, 'rebind', ['target', 'blockers', 'targetLossAcknowledged', 'evidence'])
        if (!previous.blockers.includes('target-lost') || next.targetLossAcknowledged) throw new Error('rebind invalid')
        preserveCollection(previous.evidence, next.evidence, 'id', 'rebind')
        break
      case 'acknowledge-target-loss':
        only(next, previous, 'acknowledge-target-loss', ['blockers', 'targetLossAcknowledged'])
        if (!previous.blockers.includes('target-lost') || !next.targetLossAcknowledged || next.blockers.includes('target-lost')) throw new Error('target acknowledgement invalid')
        break
      case 'acknowledge-human-interaction':
        only(next, previous, 'acknowledge-human-interaction', ['blockers'])
        if (!previous.blockers.includes('human-interaction') || next.blockers.includes('human-interaction')) throw new Error('human acknowledgement invalid')
        break
      case 'consume-budget':
        only(next, previous, 'consume-budget', ['budget'])
        if (next.budget.maxSteps !== previous.budget.maxSteps || next.budget.maxActions !== previous.budget.maxActions || next.budget.stepsUsed < previous.budget.stepsUsed || next.budget.actionsUsed < previous.budget.actionsUsed || (next.budget.stepsUsed === previous.budget.stepsUsed && next.budget.actionsUsed === previous.budget.actionsUsed)) throw new Error('budget mutation invalid')
        break
      case 'terminate':
        only(next, previous, 'terminate', ['phase', 'outcome'])
        break
      default: change.operation satisfies never
    }
  }
  requireTaskFacts(next, state.sourceFacts)
  validateCompletion(next, state.sourceFacts)
  state.current = structuredClone(next)
}

function factFor(event: SessionEvent): BrowserTaskSourceFact | undefined {
  if (event.type === 'user/message') {
    const source = (event.data as { source?: { kind?: unknown } }).source?.kind
    return { kind: source === 'user' ? 'user' : 'message', sessionSeq: event.seq }
  }
  if (event.type === 'assistant/message') return { kind: 'message', sessionSeq: event.seq }
  if (event.type === 'tool/call') return { kind: 'tool-call', sessionSeq: event.seq, callId: String(event.data.callId), name: event.data.name }
  if (event.type === 'tool/result') return { kind: 'tool-result', sessionSeq: event.seq, callId: String(event.data.message.source.callId) }
  if (event.type === 'browser-task/receipt') return {
    kind: 'browser-task-receipt',
    sessionSeq: event.seq,
    taskId: event.data.taskId,
    requestId: event.data.requestId,
    actionKind: event.data.actionKind,
    target: event.data.target,
    outcome: event.data.outcome,
    delivery: event.data.delivery,
    quiescent: event.data.quiescent,
    grantEpoch: event.data.grantEpoch,
    ...(event.data.resourceId === undefined ? {} : { resourceId: event.data.resourceId }),
    ...(event.data.reason === undefined ? {} : { reason: event.data.reason }),
  }
  if (event.type === 'browser-task/check') return { kind: 'browser-task-check', sessionSeq: event.seq, taskId: event.data.taskId, checkerId: event.data.checkerId, target: event.data.target, grantEpoch: event.data.grantEpoch, evaluations: event.data.evaluations }
  return undefined
}

export function validateReceipt(value: unknown): void {
  const receipt = exact(value, 'receipt', ['kind', 'version', 'taskId', 'requestId', 'actionKind', 'target', 'outcome', 'delivery', 'quiescent', 'grantEpoch'], ['resourceId', 'reason'])
  if (receipt.kind !== 'browser-task/receipt' || receipt.version !== 1) throw new Error('receipt header invalid')
  text(receipt.taskId, 'receipt.taskId')
  text(receipt.requestId, 'receipt.requestId')
  text(receipt.actionKind, 'receipt.actionKind')
  target(receipt.target, 'receipt.target')
  if (!['observed', 'failed', 'cancelled', 'unknown'].includes(String(receipt.outcome))) throw new Error('receipt outcome invalid')
  if (receipt.delivery !== 'sent' && receipt.delivery !== 'not-sent') throw new Error('receipt delivery invalid')
  if (typeof receipt.quiescent !== 'boolean' || (receipt.outcome !== 'unknown' && ! receipt.quiescent)) throw new Error('receipt quiescence invalid')
  integer(receipt.grantEpoch, 'receipt.grantEpoch')
  if (receipt.resourceId !== undefined) text(receipt.resourceId, 'receipt.resourceId')
  if (receipt.reason !== undefined) text(receipt.reason, 'receipt.reason', true)
}

export function validateCheck(value: unknown): void {
  const check = exact(value, 'check', ['kind', 'version', 'taskId', 'checkerId', 'target', 'grantEpoch', 'evaluations'])
  if (check.kind !== 'browser-task/check' || check.version !== 1) throw new Error('check header invalid')
  text(check.taskId, 'check.taskId'); text(check.checkerId, 'check.checkerId'); target(check.target, 'check.target'); integer(check.grantEpoch, 'check.grantEpoch')
  if (!Array.isArray(check.evaluations) || check.evaluations.length > BROWSER_TASK_LIMITS.evaluations) throw new Error('check evaluations invalid')
  for (const evaluation of check.evaluations) { const item = exact(evaluation, 'check evaluation', ['clauseId', 'satisfied', 'evidenceIds']); text(item.clauseId, 'check clause'); if (typeof item.satisfied !== 'boolean') throw new Error('check satisfied invalid'); uniqueStrings(item.evidenceIds, 'check evidence') }
}

export function observeBrowserTaskSource(state: BrowserTaskFoldState, event: SessionEvent): boolean {
  const fact = factFor(event)
  if (fact === undefined) return false
  if (fact.sessionSeq <= state.lastSourceSeq) throw new Error('source sequence is not strictly increasing')
  state.lastSourceSeq = fact.sessionSeq
  const facts = [...state.sourceFacts, fact]
  const protectedSeqs = new Set<number>()
  const protect = (ref: BrowserTaskSourceRef | undefined) => { if (ref !== undefined && 'sessionSeq' in ref) protectedSeqs.add(ref.sessionSeq) }
  if (state.current !== undefined) {
    protectedSeqs.add(state.current.sourceSeq)
    state.current.evidence.forEach((item) =>{  protect(item.source) })
    state.current.evaluations.forEach((item) =>{  protect(item.checkerRef) })
    state.current.attempts.forEach((item) =>{  protect(item.reconciledBy) })
    state.current.attempts.forEach((item) =>{  protect(item.settledBy) })
    state.current.resources.forEach((item) =>{  protect(item.dispositionSource) })
    state.current.delegated.forEach((item) =>{  protect(item.source) })
  }
  for (const call of facts.filter(item => item.kind === 'tool-call' && item.callId !== undefined)) if (!facts.some(item => item.kind === 'tool-result' && item.callId === call.callId)) protectedSeqs.add(call.sessionSeq)
  while (facts.length > BROWSER_TASK_LIMITS.sourceFacts) {
    const index = facts.findIndex(item => !protectedSeqs.has(item.sessionSeq))
    if (index < 0) throw new Error('source fact capacity exhausted by active task references')
    facts.splice(index, 1)
  }
  state.sourceFacts = facts
  return true
}

export function applyBrowserTaskEvent(state: BrowserTaskFoldState, event: SessionEvent): void {
  if (event.type === 'browser-task/receipt') validateReceipt(event.data)
  if (event.type === 'browser-task/check') validateCheck(event.data)
  if (event.type !== 'browser-task/change') {
    observeBrowserTaskSource(state, event)
    return
  }
  const change = decodeBrowserTaskChange(event.data)
  if (change === undefined) throw new Error('browser task event invalid')
  applyBrowserTaskChange(state, change)
}

export function foldBrowserTask(events: readonly SessionEvent[]): BrowserTaskSnapshot | undefined {
  const state = emptyBrowserTaskFoldState()
  for (const event of events) applyBrowserTaskEvent(state, event)
  return state.current
}
