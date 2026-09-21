import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { BROWSER_TASK_CHANGE_VERSION } from './runtime.ts'
import type { BrowserTargetChange, BrowserTaskChangeMeta, BrowserTaskOperation } from './domain.ts'
import type {
  BrowserTaskBlocker,
  BrowserTaskId,
  BrowserTaskDelegation,
  BrowserTaskDelegationCandidate,
  BrowserTaskSnapshot,
  BrowserTaskSourceFact,
  BrowserTaskSourceRef,
  BrowserFunctionOwner,
  BrowserFunctionScope,
  BrowserSessionTargetBinding,
  BrowserTaskFunctionHandoff,
  BrowserTargetBinding,
} from './types.ts'
import { BROWSER_PAGE_MAP_REGION_LIMIT } from './evidence.ts'

export const BROWSER_TASK_LIMITS = {
  acceptance: 32,
  evidence: 128,
  evaluations: 32,
  attempts: 128,
  resources: 64,
  delegated: 32,
  pendingDelegations: 32,
  evidenceRefs: 32,
  sourceFacts: 256,
  recentTaskIds: 64,
  text: 4096,
  presentationExcerpt: 512,
  maxBudget: 10_000,
} as const

const operations = new Set<BrowserTaskOperation>([
  'create', 'evidence', 'attempt', 'reconcile-attempt', 'resource',
  'reconcile-resource', 'capability', 'delegation', 'evaluate', 'transition',
  'rebind', 'acknowledge-target-loss', 'consume-budget', 'terminate', 'owner-cancel',
  'acknowledge-human-interaction', 'handoff-function',
])
const phases = new Set(['running', 'waiting', 'verifying', 'settling', 'terminal'])
const blockers = new Set<BrowserTaskBlocker>([
  'approval', 'human-interaction', 'unknown-attempt', 'capability-drift',
  'target-lost', 'delegated-work', 'cleanup', 'repeated-error', 'internal-invariant',
])
const outcomes = new Set(['completed', 'refused', 'cancelled', 'failed', 'budget-exhausted'])
const finalResources = new Set(['released', 'vanished', 'retained'])
const resourceCreateActions = new Set(['entry_mount', 'region_render'])
const resourceClearActions = new Set(['entry_unmount', 'region_clear'])
const resourceActions = new Set([...resourceCreateActions, ...resourceClearActions])
const derivedBlockers = new Set<BrowserTaskBlocker>([
  'human-interaction', 'unknown-attempt', 'capability-drift', 'target-lost', 'delegated-work', 'cleanup', 'internal-invariant',
])
const delegationPending = (work: { readonly kind: string; readonly status: string }): boolean => work.kind === 'cordis'
  ? ['starting', 'awaiting-approval', 'waiting', 'client-pending'].includes(work.status)
  : ['running', 'stopping', 'starting', 'awaiting-approval', 'waiting'].includes(work.status)

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

function uniqueStrings(values: unknown, field: string, limit: number = BROWSER_TASK_LIMITS.evidenceRefs): readonly string[] {
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

function sessionTarget(value: unknown, field: string): BrowserSessionTargetBinding {
  const binding = exact(value, field, ['installationId', 'page', 'revision', 'boundAt', 'boundBy'])
  target({ installationId: binding.installationId, page: binding.page }, field)
  integer(binding.revision, `${field}.revision`, 1)
  integer(binding.boundAt, `${field}.boundAt`)
  if (binding.boundBy !== 'user') throw new Error(`${field}.boundBy invalid`)
  return binding as unknown as BrowserSessionTargetBinding
}

function functionOwner(value: unknown, field: string): BrowserFunctionOwner {
  const owner = exact(value, field, ['kind', 'installationId', 'grantEpoch', 'pluginId', 'packageId', 'pluginRunId', 'handoffId'])
  if (owner.kind !== 'browser-installation') throw new Error(`${field}.kind invalid`)
  for (const key of ['installationId', 'pluginId', 'packageId', 'pluginRunId', 'handoffId'] as const) text(owner[key], `${field}.${key}`)
  integer(owner.grantEpoch, `${field}.grantEpoch`, 1)
  return owner as unknown as BrowserFunctionOwner
}

function functionScope(value: unknown, field: string): BrowserFunctionScope {
  const scope = exact(value, field, ['kind'], ['target', 'targetRevision'])
  if (scope.kind === 'global' && Object.keys(scope).length === 1) return { kind: 'global' }
  if (scope.kind === 'page' && Object.keys(scope).length === 3) {
    target(scope.target, `${field}.target`)
    integer(scope.targetRevision, `${field}.targetRevision`, 1)
    return scope as unknown as BrowserFunctionScope
  }
  throw new Error(`${field} invalid`)
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
  if (ref.kind === 'browser-task-receipt' || ref.kind === 'browser-task-check' || ref.kind === 'browser-task-delegation'
    || ref.kind === 'browser-task-function-handoff') {
    if (Object.keys(ref).length !== 2) throw new Error(`${field} invalid`)
    integer(ref.sessionSeq, `${field}.sessionSeq`)
    return ref as BrowserTaskSourceRef
  }
  throw new Error(`${field} invalid`)
}

function validateClause(value: unknown): void {
  const clause = exact(value, 'acceptance clause', ['id', 'kind'], ['text', 'url', 'control', 'state', 'resourceId'])
  text(clause.id, 'acceptance clause.id')
  if (clause.kind === 'text-contains' && Object.keys(clause).length === 3) return void text(clause.text, 'acceptance clause.text')
  if (clause.kind === 'url-equals' && Object.keys(clause).length === 3) return void text(clause.url, 'acceptance clause.url')
  if (clause.kind === 'control-state' && Object.keys(clause).length === 4) {
    text(clause.control, 'acceptance clause.control')
    return void text(clause.state, 'acceptance clause.state')
  }
  if (clause.kind === 'region-content' && Object.keys(clause).length === 4) {
    text(clause.resourceId, 'acceptance clause.resourceId')
    const expected = text(clause.text, 'acceptance clause.text')
    if (Buffer.byteLength(expected) > BROWSER_TASK_LIMITS.presentationExcerpt) {
      throw new Error('region acceptance text exceeds presentation excerpt')
    }
    return
  }
  throw new Error('acceptance clause invalid')
}

function validateEvidence(value: unknown): void {
  const evidence = exact(value, 'evidence', ['id', 'state', 'source', 'digest', 'target', 'grantEpoch'], ['coverage', 'pageMap'])
  text(evidence.id, 'evidence.id')
  if (!['current', 'stale', 'superseded'].includes(String(evidence.state))) throw new Error('evidence state invalid')
  sourceRef(evidence.source, 'evidence.source')
  text(evidence.digest, 'evidence.digest')
  if (evidence.coverage !== undefined) integer(evidence.coverage, 'evidence.coverage')
  if (evidence.pageMap !== undefined) {
    const pageMap = exact(evidence.pageMap, 'evidence.pageMap', ['regions'])
    if (!Array.isArray(pageMap.regions) || pageMap.regions.length > BROWSER_PAGE_MAP_REGION_LIMIT) throw new Error('evidence page map regions invalid')
    const refs = new Set<string>()
    for (const value of pageMap.regions) {
      const region = exact(value, 'evidence.pageMap.region', ['regionRef', 'disposable', 'protected'])
      const regionRef = text(region.regionRef, 'evidence.pageMap.region.regionRef')
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(regionRef)) throw new Error('evidence page map regionRef invalid')
      if (refs.has(regionRef)) throw new Error('evidence page map regionRef duplicated')
      refs.add(regionRef)
      if (typeof region.disposable !== 'boolean' || typeof region.protected !== 'boolean') throw new Error('evidence page map flags invalid')
    }
    if ((evidence.source as BrowserTaskSourceRef).kind !== 'browser-task-receipt') throw new Error('evidence page map needs browser receipt source')
  }
  target(evidence.target, 'evidence.target')
  integer(evidence.grantEpoch, 'evidence.grantEpoch')
}

function validateAttempt(value: unknown): void {
  const attempt = exact(value, 'attempt', ['attemptId', 'requestId', 'actionKind', 'grantEpoch', 'stage', 'write', 'target'], ['resourceId', 'presentationIntent', 'recoveryLocator', 'outcome', 'quiescent', 'settledBy', 'reconciledBy'])
  text(attempt.attemptId, 'attempt.id')
  text(attempt.requestId, 'attempt.request')
  text(attempt.actionKind, 'attempt.actionKind')
  integer(attempt.grantEpoch, 'attempt.grantEpoch')
  if (!['planned', 'prepared', 'dispatch-intent', 'dispatched', 'settled'].includes(String(attempt.stage)) || typeof attempt.write !== 'boolean') throw new Error('attempt invalid')
  target(attempt.target, 'attempt.target')
  if (attempt.recoveryLocator !== undefined) {
    const locator = exact(attempt.recoveryLocator, 'attempt.recoveryLocator', ['kind', 'protocolVersion', 'transportRequestId', 'installationId', 'grantEpoch'])
    if (locator.kind !== 'extension-journal-v1' || locator.protocolVersion !== 1) throw new Error('attempt recovery locator invalid')
    text(locator.transportRequestId, 'attempt.recoveryLocator.transportRequestId')
    text(locator.installationId, 'attempt.recoveryLocator.installationId')
    integer(locator.grantEpoch, 'attempt.recoveryLocator.grantEpoch')
    if (locator.installationId !== (attempt.target as BrowserTargetBinding).installationId || locator.grantEpoch !== attempt.grantEpoch) throw new Error('attempt recovery locator identity invalid')
  }
  if (attempt.resourceId !== undefined) text(attempt.resourceId, 'attempt.resourceId')
  const actionIsResourceScoped = resourceActions.has(attempt.actionKind as string)
  if ((attempt.resourceId !== undefined) !== actionIsResourceScoped) {
    throw new Error('resource action identity invalid')
  }
  if (attempt.presentationIntent !== undefined) {
    validatePresentation(attempt.presentationIntent, 'attempt.presentationIntent', false)
    if (attempt.actionKind !== 'region_render' || attempt.resourceId === undefined) throw new Error('presentation intent invalid')
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
  const resource = exact(value, 'resource', ['id', 'state', 'target'], ['owner', 'disposition', 'dispositionSource', 'presentation'])
  text(resource.id, 'resource.id')
  if (!['reserved', 'active', 'release-pending', 'released', 'vanished', 'unresolved', 'retained'].includes(String(resource.state))) throw new Error('resource state invalid')
  target(resource.target, 'resource.target')
  if (resource.owner !== undefined) functionOwner(resource.owner, 'resource.owner')
  if (resource.disposition !== undefined && (
    typeof resource.disposition !== 'string'
    || ![
      'clear-observed', 'document-replaced', 'absent', 'owner-transfer', 'reconcile-active',
      'reconcile-observed', 'not-sent',
    ].includes(resource.disposition)
  )) throw new Error('resource disposition invalid')
  const dispositionSource = resource.dispositionSource === undefined ? undefined
    : sourceRef(resource.dispositionSource, 'resource.dispositionSource')
  if (resource.state !== 'retained' && dispositionSource !== undefined
    && dispositionSource.kind !== 'browser-task-receipt') throw new Error('resource disposition must cite receipt')
  const final = finalResources.has(String(resource.state))
  const reconciledActive = resource.state === 'active' && resource.disposition === 'reconcile-active'
  if (final && (resource.disposition === undefined || resource.dispositionSource === undefined)) throw new Error('final resource needs disposition source')
  if (reconciledActive && resource.dispositionSource === undefined) throw new Error('reconciled active resource needs disposition source')
  if (!final && !reconciledActive && (resource.disposition !== undefined || resource.dispositionSource !== undefined)) throw new Error('unfinished resource cannot have disposition')
  if (resource.state === 'retained') {
    if (resource.owner === undefined || resource.disposition !== 'owner-transfer'
      || dispositionSource?.kind !== 'browser-task-function-handoff') throw new Error('retained resource requires exact handoff')
  } else if (resource.owner !== undefined || resource.disposition === 'owner-transfer'
    || dispositionSource?.kind === 'browser-task-function-handoff') throw new Error('resource owner invalid')
  if (resource.presentation !== undefined) validatePresentation(resource.presentation, 'resource.presentation', true)
}

function validatePresentation(value: unknown, field: string, withReceipt: boolean): void {
  const presentation = exact(value, field, ['contentDigest', 'excerpt', ...(withReceipt ? ['renderReceipt'] : [])], withReceipt ? ['evidenceId'] : [])
  if (!/^sha256:[a-f0-9]{64}$/u.test(text(presentation.contentDigest, `${field}.contentDigest`))) throw new Error(`${field}.contentDigest invalid`)
  text(presentation.excerpt, `${field}.excerpt`)
  if (Buffer.byteLength(presentation.excerpt as string) > 512) throw new Error(`${field}.excerpt too large`)
  if (withReceipt && sourceRef(presentation.renderReceipt, `${field}.renderReceipt`).kind !== 'browser-task-receipt') throw new Error(`${field}.renderReceipt invalid`)
  if (presentation.evidenceId !== undefined) text(presentation.evidenceId, `${field}.evidenceId`)
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
  const delegation = exact(value, 'delegation', ['callId', 'kind', 'status', 'identity', 'evidenceIds', 'source'], ['outputDigest'])
  text(delegation.callId, 'delegation.callId')
  if (!['job', 'subagent', 'cordis'].includes(String(delegation.kind))) throw new Error('delegation kind invalid')
  text(delegation.status, 'delegation.status')
  const identity = exact(delegation.identity, 'delegation.identity', ['mode'], ['runId', 'jobId', 'subagentId', 'pluginId', 'packageId', 'pluginRunId'])
  if (identity.mode === 'foreground') { text(identity.runId, 'delegation.identity.runId'); if (Object.keys(identity).length !== 2) throw new Error('delegation foreground identity invalid') }
  else if (identity.mode === 'background') { text(identity.jobId, 'delegation.identity.jobId'); if (Object.keys(identity).length !== 2) throw new Error('delegation background identity invalid') }
  else if (identity.mode === 'continuable') { text(identity.subagentId, 'delegation.identity.subagentId'); if (Object.keys(identity).length !== 2) throw new Error('delegation continuable identity invalid') }
  else if (identity.mode === 'cordis') {
    text(identity.pluginId, 'delegation.identity.pluginId'); text(identity.packageId, 'delegation.identity.packageId'); text(identity.pluginRunId, 'delegation.identity.pluginRunId')
    if (Object.keys(identity).length !== 4) throw new Error('delegation cordis identity invalid')
  } else if (identity.mode !== 'tool-call' || Object.keys(identity).length !== 1) throw new Error('delegation identity invalid')
  if (delegation.outputDigest !== undefined && !/^sha256:[a-f0-9]{64}$/u.test(text(delegation.outputDigest, 'delegation.outputDigest'))) throw new Error('delegation output digest invalid')
  uniqueStrings(delegation.evidenceIds, 'delegation.evidenceIds')
  if (sourceRef(delegation.source, 'delegation.source').kind !== 'browser-task-delegation') throw new Error('delegation source invalid')
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
  ], ['outcome', 'target', 'targetRevision', 'capability', 'terminationSource', 'functionHandoff'])
  text(task.id, 'id')
  integer(task.revision, 'revision', 1)
  text(task.objective, 'objective')
  integer(task.sourceSeq, 'sourceSeq')
  if (typeof task.phase !== 'string' || !phases.has(task.phase)) throw new Error('phase invalid')
  if (task.outcome !== undefined && (typeof task.outcome !== 'string' || !outcomes.has(task.outcome))) throw new Error('outcome invalid')
  if ((task.phase === 'terminal') !== (task.outcome !== undefined)) throw new Error('terminal outcome invalid')
  if (task.terminationSource !== undefined && sourceRef(task.terminationSource, 'terminationSource').kind !== 'user') throw new Error('termination source invalid')
  if (task.terminationSource !== undefined && (task.phase !== 'terminal' || task.outcome !== 'cancelled')) throw new Error('termination source requires cancelled terminal task')
  if (!Array.isArray(task.blockers) || task.blockers.some((value: unknown) => typeof value !== 'string' || !blockers.has(value as BrowserTaskBlocker)) || new Set(task.blockers).size !== task.blockers.length) throw new Error('blockers invalid')
  if (task.target !== undefined) target(task.target, 'target')
  if (task.targetRevision !== undefined) {
    integer(task.targetRevision, 'targetRevision', 1)
    if (task.target === undefined) throw new Error('target revision requires target')
  }
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
  ids(delegated, 'delegation', 'callId')
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
  if (task.functionHandoff !== undefined) {
    const handoff = exact(task.functionHandoff, 'functionHandoff', ['owner', 'scope', 'resourceIds', 'createdBySessionId', 'source'])
    functionOwner(handoff.owner, 'functionHandoff.owner'); functionScope(handoff.scope, 'functionHandoff.scope')
    uniqueStrings(handoff.resourceIds, 'functionHandoff.resourceIds', BROWSER_TASK_LIMITS.resources)
    text(handoff.createdBySessionId, 'functionHandoff.createdBySessionId')
    if (sourceRef(handoff.source, 'functionHandoff.source').kind !== 'browser-task-function-handoff') throw new Error('functionHandoff source invalid')
  }
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
  return { kind: 'browser-task/change', version: 3, operation: change.operation as BrowserTaskOperation, task: assertBrowserTaskSnapshot(change.task) }
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

function latestDirectUser(facts: readonly BrowserTaskSourceFact[]): BrowserTaskSourceFact | undefined {
  let latest: BrowserTaskSourceFact | undefined
  for (const fact of facts) if (fact.kind === 'user') latest = fact
  return latest
}

function requireFact(facts: readonly BrowserTaskSourceFact[], ref: BrowserTaskSourceRef, field: string): void {
  if (!hasFact(facts, ref)) throw new Error(`${field} does not cite an observed Session fact`)
}

function requireTaskFacts(task: BrowserTaskSnapshot, facts: readonly BrowserTaskSourceFact[]): void {
  if (task.terminationSource !== undefined) requireFact(facts, task.terminationSource, 'terminationSource')
  for (const evidence of task.evidence) {
    requireFact(facts, evidence.source, 'evidence.source')
    const source = evidence.source
    if (source.kind === 'browser-task-receipt' && !facts.some(fact => fact.kind === 'browser-task-receipt' && fact.sessionSeq === source.sessionSeq && fact.taskId === task.id && same(fact.target, evidence.target) && fact.grantEpoch === evidence.grantEpoch && fact.outcome === 'observed' && fact.delivery === 'sent' && fact.quiescent === true && (evidence.pageMap === undefined || fact.actionKind === 'page_map') && task.attempts.some(attempt => attempt.requestId === fact.requestId && attempt.actionKind === fact.actionKind && same(attempt.target, evidence.target) && attempt.grantEpoch === evidence.grantEpoch))) throw new Error('evidence receipt does not match target authority')
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
    if (source.kind === 'browser-task-function-handoff') {
      const fact = facts.find(item => item.kind === source.kind && item.sessionSeq === source.sessionSeq
        && item.taskId === task.id)
      if (resource.state !== 'retained' || resource.disposition !== 'owner-transfer'
        || fact?.owner === undefined || !same(resource.owner, fact.owner)
        || !fact.resourceIds?.includes(resource.id)) throw new Error('resource handoff fact does not match')
    } else if (source.kind === 'browser-task-receipt' && !facts.some((fact) => {
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
        case 'absent':
          return resourceClearActions.has(fact.actionKind ?? '') && fact.delivery === 'sent'
            && fact.outcome === 'observed' && fact.reason === 'absent'
        case 'not-sent':
          return resourceCreateActions.has(fact.actionKind ?? '') && fact.delivery === 'not-sent'
            && (fact.outcome === 'failed' || fact.outcome === 'cancelled')
        default:
          return false
      }
    })) throw new Error('resource receipt does not match')
  }
  if (task.functionHandoff !== undefined) {
    const source = task.functionHandoff.source
    const fact = facts.find(item => item.kind === source.kind && item.sessionSeq === source.sessionSeq && item.taskId === task.id)
    if (fact?.owner === undefined || !same(fact.owner, task.functionHandoff.owner)
      || !same(fact.scope, task.functionHandoff.scope) || !same(fact.resourceIds, task.functionHandoff.resourceIds)
      || fact.createdBySessionId !== task.functionHandoff.createdBySessionId) throw new Error('function handoff projection does not match fact')
  }
  for (const delegation of task.delegated) {
    requireFact(facts, delegation.source, 'delegation.source')
    const source = delegation.source
    if (source.kind !== 'browser-task-delegation') throw new Error('delegation source invalid')
    const fact = facts.find(candidate => candidate.kind === 'browser-task-delegation'
      && candidate.sessionSeq === source.sessionSeq && candidate.taskId === task.id)
    const { source: _source, ...work } = delegation
    if (fact?.work === undefined || !same(fact.work, work)) throw new Error('delegation fact does not match')
  }
  for (const resource of task.resources) {
    const presentation = resource.presentation
    if (presentation === undefined) continue
    const fact = facts.find(candidate => candidate.kind === 'browser-task-receipt'
      && candidate.sessionSeq === presentation.renderReceipt.sessionSeq && candidate.taskId === task.id)
    if (fact?.actionKind !== 'region_render' || fact.resourceId !== resource.id || fact.outcome !== 'observed'
      || fact.delivery !== 'sent' || fact.quiescent !== true || !same(fact.target, resource.target)
      || !same(fact.presentation, { contentDigest: presentation.contentDigest, excerpt: presentation.excerpt })) {
      throw new Error('resource presentation receipt does not match')
    }
    if (presentation.evidenceId !== undefined && !task.evidence.some(item => item.id === presentation.evidenceId && item.state === 'current' && same(item.target, resource.target))) {
      throw new Error('resource presentation evidence does not match')
    }
  }
}

function validateCreate(next: BrowserTaskSnapshot, state: BrowserTaskFoldState): void {
  if (next.revision !== 1 || next.phase !== 'running' || next.outcome !== undefined || next.blockers.length !== 0 || next.evidence.length !== 0 || next.evaluations.length !== 0 || next.attempts.length !== 0 || next.resources.length !== 0 || next.functionHandoff !== undefined || next.capability !== undefined || next.delegated.length !== 0 || next.targetLossAcknowledged || next.budget.stepsUsed !== 0 || next.budget.actionsUsed !== 0) throw new Error('create baseline invalid')
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
  const transitions: Record<string, readonly string[]> = {
    planned: ['prepared', 'dispatch-intent', 'dispatched', 'settled'],
    prepared: ['dispatch-intent', 'dispatched', 'settled'],
    'dispatch-intent': ['dispatched', 'settled'],
    dispatched: ['settled'], settled: [],
  }
  for (const item of next.attempts) {
    taskTarget(next, item.target)
    const before = old.get(item.attemptId)
    if (before === undefined) {
      if (reconciliation || item.stage !== 'planned' || item.outcome !== undefined) throw new Error('attempt create invalid')
      continue
    }
    if (!same(
      {
        ...before, stage: undefined, recoveryLocator: undefined, outcome: undefined,
        quiescent: undefined, settledBy: undefined, reconciledBy: undefined,
      },
      {
        ...item, stage: undefined, recoveryLocator: undefined, outcome: undefined,
        quiescent: undefined, settledBy: undefined, reconciledBy: undefined,
      },
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
    if (item.state === 'retained' || item.disposition === 'owner-transfer'
      || item.dispositionSource?.kind === 'browser-task-function-handoff') {
      throw new Error('retained resource requires function handoff operation')
    }
    taskTarget(next, item.target)
    const before = old.get(item.id)
    if (before === undefined) {
      if (reconciliation || item.state !== 'reserved') throw new Error('resource create invalid')
      continue
    }
    if (!same(before.target, item.target)) throw new Error('resource identity invalid')
    if (before.presentation !== undefined) {
      const stablePresentation = item.presentation !== undefined
        && same({ ...before.presentation, evidenceId: undefined }, { ...item.presentation, evidenceId: undefined })
      const evidenceUnchanged = before.presentation.evidenceId === undefined
        || item.presentation?.evidenceId === before.presentation.evidenceId
      if (!stablePresentation || !evidenceUnchanged) throw new Error('resource presentation mutation invalid')
    }
    if (item.state === 'vanished' && item.disposition !== 'document-replaced' && item.disposition !== 'absent') {
      throw new Error('vanished resource requires a disappearance disposition')
    }
    if ((item.disposition === 'document-replaced' || item.disposition === 'absent') && item.state !== 'vanished') {
      throw new Error('disappearance disposition requires vanished resource')
    }
    if (reconciliation) {
      if (same(before, item)) continue
      if (before.state === 'unresolved') {
        const restoresActive = item.state === 'active' && item.disposition === 'reconcile-active'
        const clearsObserved = item.state === 'released'
          && ['clear-observed', 'reconcile-observed'].includes(item.disposition ?? '')
        const vanished = item.state === 'vanished' && (item.disposition === 'document-replaced' || item.disposition === 'absent')
        if (!restoresActive && !clearsObserved && !vanished) {
          throw new Error('unresolved resource reconciliation invalid')
        }
      } else if (before.state === 'release-pending') {
        const clearsObserved = item.state === 'released'
          && ['clear-observed', 'reconcile-observed'].includes(item.disposition ?? '')
        const vanished = item.state === 'vanished' && (item.disposition === 'document-replaced' || item.disposition === 'absent')
        if (!clearsObserved && !vanished) throw new Error('release-pending resource must reconcile to final state')
      } else {
        throw new Error('resource reconciliation must start from an uncertain resource')
      }
    } else if (before.state === 'unresolved') {
      throw new Error('unresolved resource needs reconciliation')
    } else if (before.state !== item.state
      && !(before.state === 'released' && before.disposition === 'not-sent' && item.state === 'reserved')
      && !transitions[before.state]?.includes(item.state)) {
      throw new Error('resource transition invalid')
    }
    if (before.state === 'reserved' && item.state === 'released' && item.disposition !== 'not-sent') throw new Error('reserved release requires not-sent')
    if (!same(before, item) && item.disposition === 'not-sent'
      && (before.state !== 'reserved' || item.state !== 'released')) throw new Error('not-sent requires a reserved release')
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
  if (task.delegated.some(delegationPending)) throw new Error('completed has unfinished delegated work')
  const pending = facts.filter(fact => fact.kind === 'tool-call' && fact.callId !== undefined && fact.name !== undefined && (/^subagent/i.test(fact.name) || /^cordis_/i.test(fact.name) || /^(job|jobs)[_./-]/i.test(fact.name)) && !facts.some(result => result.kind === 'tool-result' && result.callId === fact.callId))
  if (pending.length > 0) throw new Error('completed has unobserved delegated tool result')
}

export interface BrowserTaskFoldState {
  current?: BrowserTaskSnapshot
  recentTaskIds: BrowserTaskId[]
  lastSourceSeq: number
  lastTaskSourceSeq: number
  sourceFacts: BrowserTaskSourceFact[]
  pendingDelegations: BrowserTaskDelegationCandidate[]
  targetBinding: BrowserSessionTargetBinding | null
  targetRevision: number
}

export const emptyBrowserTaskFoldState = (): BrowserTaskFoldState => ({
  recentTaskIds: [],
  lastSourceSeq: -1,
  lastTaskSourceSeq: -1,
  sourceFacts: [],
  pendingDelegations: [],
  targetBinding: null,
  targetRevision: 0,
})

export function applyBrowserTargetChange(state: BrowserTaskFoldState, change: BrowserTargetChange): void {
  const parsed = exact(change, 'target change', ['kind', 'version', 'revision', 'binding'])
  if (parsed.kind !== 'browser-target/change' || parsed.version !== 1) throw new Error('target change header invalid')
  const revision = integer(parsed.revision, 'target change revision', 1)
  if (revision !== state.targetRevision + 1) throw new Error('target change revision is not monotonic')
  const binding = parsed.binding === null ? null : sessionTarget(parsed.binding, 'target change binding')
  if (binding !== null && binding.revision !== revision) throw new Error('target binding revision mismatch')
  state.targetRevision = revision
  state.targetBinding = binding === null ? null : structuredClone(binding)
}

export function applyBrowserTaskChange(state: BrowserTaskFoldState, change: BrowserTaskChangeMeta): void {
  const next = change.task
  const previous = state.current
  if (change.operation === 'create') {
    if (previous !== undefined && previous.phase !== 'terminal') throw new Error('create requires terminal predecessor')
    validateCreate(next, state)
    state.recentTaskIds = [...state.recentTaskIds, next.id].slice(-BROWSER_TASK_LIMITS.recentTaskIds)
    state.lastTaskSourceSeq = next.sourceSeq
    state.pendingDelegations = state.pendingDelegations.filter(candidate => candidate.originUserSeq !== next.sourceSeq)
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
        preserveCollection(previous.delegated, next.delegated, 'callId', 'delegation')
        break
      case 'handoff-function': {
        only(next, previous, 'handoff-function', ['resources', 'functionHandoff'])
        const fact = [...state.sourceFacts].reverse().find(item => item.kind === 'browser-task-function-handoff'
          && item.taskId === previous.id && item.taskRevision === previous.revision)
        if (fact?.owner === undefined || fact.scope === undefined || fact.resourceIds === undefined
          || fact.createdBySessionId === undefined || fact.taskId !== previous.id || fact.taskRevision !== previous.revision) {
          throw new Error('function handoff source invalid')
        }
        validateFunctionHandoffAdmission(previous, {
          kind: 'browser-task/function-handoff', version: 1, taskId: previous.id,
          taskRevision: previous.revision, createdBySessionId: fact.createdBySessionId, owner: fact.owner,
          scope: fact.scope, resourceIds: fact.resourceIds,
        }, state.sourceFacts.filter(item => item.sessionSeq !== fact.sessionSeq))
        if (next.functionHandoff === undefined || !same(next.functionHandoff, {
          owner: fact.owner, scope: fact.scope, resourceIds: fact.resourceIds,
          createdBySessionId: fact.createdBySessionId,
          source: { kind: 'browser-task-function-handoff', sessionSeq: fact.sessionSeq },
        })) throw new Error('function handoff projection invalid')
        for (const before of previous.resources) {
          const after = next.resources.find(item => item.id === before.id)
          if (after === undefined) throw new Error('function handoff removed resource')
          if (before.state === 'active') {
            if (after.state !== 'retained' || after.disposition !== 'owner-transfer'
              || after.dispositionSource?.kind !== 'browser-task-function-handoff'
              || after.dispositionSource.sessionSeq !== fact.sessionSeq || !same(after.owner, fact.owner)
              || !same(after.target, before.target)) throw new Error('function handoff transition invalid')
          } else if (!same(after, before)) throw new Error('function handoff changed final resource')
        }
        break
      }
      case 'evaluate':
        only(next, previous, 'evaluate', ['evaluations', 'phase'])
        break
      case 'transition':
        only(next, previous, 'transition', ['phase', 'blockers', 'evidence', 'evaluations'])
        validateDerivedBlockers(next, previous, change.operation)
        if ((next.blockers.includes('human-interaction') && !previous.blockers.includes('human-interaction')
          || next.blockers.includes('capability-drift') && !previous.blockers.includes('capability-drift'))
          && (next.evidence.some(item => item.state === 'current') || next.evaluations.length > 0)) {
          throw new Error('authority transition must stale evidence and evaluations')
        }
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
      case 'owner-cancel':
        only(next, previous, 'owner-cancel', ['phase', 'outcome', 'terminationSource'])
        if (next.phase !== 'terminal' || next.outcome !== 'cancelled' || next.terminationSource === undefined
          || next.terminationSource.sessionSeq <= previous.sourceSeq
          || previous.resources.some(resource => resource.state !== 'released' && resource.state !== 'vanished')) throw new Error('owner cancellation invalid')
        requireFact(state.sourceFacts, next.terminationSource, 'terminationSource')
        const latest = latestDirectUser(state.sourceFacts)
        if (latest?.sessionSeq !== next.terminationSource.sessionSeq || latest.decision === undefined) {
          throw new Error('owner cancellation must cite the latest direct user source')
        }
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
    const message = event.data as { source?: { kind?: unknown }; content?: readonly { type?: unknown; text?: unknown }[] }
    const source = message.source?.kind
    if (source !== 'user') return { kind: 'message', sessionSeq: event.seq }
    const marks = new Set((message.content ?? []).flatMap(block => block.type === 'text' && typeof block.text === 'string'
      ? [/\[browser-task:cancel\]/u.test(block.text) ? 'cancel' as const : undefined,
        /\[browser-task:accept-unknown\]/u.test(block.text) ? 'accept-unknown' as const : undefined].filter((value): value is 'cancel' | 'accept-unknown' => value !== undefined)
      : []))
    const decision = marks.size === 1 ? [...marks][0] : undefined
    return { kind: 'user', sessionSeq: event.seq, ...(decision === undefined ? {} : { decision }) }
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
    ...(event.data.failureFingerprint === undefined ? {} : { failureFingerprint: event.data.failureFingerprint }),
    ...(event.data.presentation === undefined ? {} : { presentation: event.data.presentation }),
  }
  if (event.type === 'browser-task/check') return { kind: 'browser-task-check', sessionSeq: event.seq, taskId: event.data.taskId, checkerId: event.data.checkerId, target: event.data.target, grantEpoch: event.data.grantEpoch, evaluations: event.data.evaluations }
  if (event.type === 'browser-task/delegation') return { kind: 'browser-task-delegation', sessionSeq: event.seq, taskId: event.data.taskId, work: event.data.work }
  if (event.type === 'browser-task/function-handoff') return { kind: 'browser-task-function-handoff',
    sessionSeq: event.seq, taskId: event.data.taskId, taskRevision: event.data.taskRevision,
    createdBySessionId: event.data.createdBySessionId, owner: event.data.owner, scope: event.data.scope,
    resourceIds: event.data.resourceIds }
  return undefined
}

export function validateReceipt(value: unknown): void {
  const receipt = exact(value, 'receipt', ['kind', 'version', 'taskId', 'requestId', 'actionKind', 'target', 'outcome', 'delivery', 'quiescent', 'grantEpoch'], ['resourceId', 'reason', 'failureFingerprint', 'presentation'])
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
  if (receipt.failureFingerprint !== undefined
    && (typeof receipt.failureFingerprint !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(receipt.failureFingerprint))) {
    throw new Error('receipt failure fingerprint invalid')
  }
  if (receipt.presentation !== undefined) {
    validatePresentation(receipt.presentation, 'receipt.presentation', false)
    if (receipt.actionKind !== 'region_render' || receipt.outcome !== 'observed' || receipt.delivery !== 'sent' || ! receipt.quiescent || receipt.resourceId === undefined) throw new Error('receipt presentation invalid')
  }
}

export function validateCheck(value: unknown): void {
  const check = exact(value, 'check', ['kind', 'version', 'taskId', 'checkerId', 'target', 'grantEpoch', 'evaluations'])
  if (check.kind !== 'browser-task/check' || check.version !== 1) throw new Error('check header invalid')
  text(check.taskId, 'check.taskId'); text(check.checkerId, 'check.checkerId'); target(check.target, 'check.target'); integer(check.grantEpoch, 'check.grantEpoch')
  if (!Array.isArray(check.evaluations) || check.evaluations.length > BROWSER_TASK_LIMITS.evaluations) throw new Error('check evaluations invalid')
  for (const evaluation of check.evaluations) { const item = exact(evaluation, 'check evaluation', ['clauseId', 'satisfied', 'evidenceIds']); text(item.clauseId, 'check clause'); if (typeof item.satisfied !== 'boolean') throw new Error('check satisfied invalid'); uniqueStrings(item.evidenceIds, 'check evidence') }
}

export function validateDelegationFact(value: unknown): asserts value is BrowserTaskDelegation {
  const fact = exact(value, 'delegation fact', ['kind', 'version', 'taskId', 'work'])
  if (fact.kind !== 'browser-task/delegation' || fact.version !== 1) throw new Error('delegation fact header invalid')
  text(fact.taskId, 'delegation fact.taskId')
  validateDelegation({ ...(fact.work as object), source: { kind: 'browser-task-delegation', sessionSeq: 0 } })
}

export function validateDelegationCandidate(value: unknown): asserts value is BrowserTaskDelegationCandidate {
  const fact = exact(value, 'delegation candidate', ['kind', 'version', 'originUserSeq', 'toolCallId', 'toolCallSeq', 'toolResultSeq', 'work'])
  if (fact.kind !== 'browser-task/delegation-candidate' || fact.version !== 1) throw new Error('delegation candidate header invalid')
  integer(fact.originUserSeq, 'delegation candidate.originUserSeq')
  text(fact.toolCallId, 'delegation candidate.toolCallId')
  integer(fact.toolCallSeq, 'delegation candidate.toolCallSeq')
  integer(fact.toolResultSeq, 'delegation candidate.toolResultSeq')
  validateDelegation({ ...(fact.work as object), source: { kind:'browser-task-delegation',sessionSeq:0 } })
}

export function validateFunctionHandoff(value: unknown): asserts value is BrowserTaskFunctionHandoff {
  const fact = exact(value, 'function handoff', ['kind', 'version', 'taskId', 'taskRevision', 'createdBySessionId', 'owner', 'scope', 'resourceIds'])
  if (fact.kind !== 'browser-task/function-handoff' || fact.version !== 1) throw new Error('function handoff header invalid')
  text(fact.taskId, 'function handoff.taskId'); integer(fact.taskRevision, 'function handoff.taskRevision', 1)
  text(fact.createdBySessionId, 'function handoff.createdBySessionId')
  functionOwner(fact.owner, 'function handoff.owner'); functionScope(fact.scope, 'function handoff.scope')
  uniqueStrings(fact.resourceIds, 'function handoff.resourceIds', BROWSER_TASK_LIMITS.resources)
}

function acceptanceCurrent(task: BrowserTaskSnapshot): boolean {
  return task.target !== undefined && task.capability?.state === 'observed'
    && task.acceptance.every(clause => task.evaluations.some(evaluation => evaluation.clauseId === clause.id
      && evaluation.satisfied && evaluation.evidenceIds.length > 0
      && evaluation.evidenceIds.every(id => task.evidence.some(evidence => evidence.id === id
        && evidence.state === 'current' && same(evidence.target, task.target)
        && evidence.grantEpoch === task.capability?.grantEpoch))))
}

export function validateFunctionHandoffAdmission(task: BrowserTaskSnapshot, fact: BrowserTaskFunctionHandoff,
  facts: readonly BrowserTaskSourceFact[]): void {
  if (task.phase === 'terminal' || fact.taskId !== task.id || fact.taskRevision !== task.revision) throw new Error('function handoff task identity invalid')
  if (facts.some(item => item.kind === 'browser-task-function-handoff' && item.taskId === task.id)) throw new Error('function handoff already exists')
  if (task.target === undefined || task.targetRevision === undefined || task.capability?.state !== 'observed'
    || task.capability.installationId !== task.target.installationId || task.capability.installationId !== fact.owner.installationId
    || task.capability.grantEpoch !== fact.owner.grantEpoch || task.blockers.length > 0 || !acceptanceCurrent(task)) {
    throw new Error('function handoff authority or acceptance invalid')
  }
  if (task.attempts.some(attempt => attempt.write
    && (attempt.stage !== 'settled' || attempt.outcome === 'unknown' || attempt.quiescent !== true))) {
    throw new Error('function handoff has unsettled write')
  }
  const delegated = task.delegated.filter(item => item.kind === 'cordis' && item.status === 'running'
    && item.identity.mode === 'cordis' && item.identity.pluginId === fact.owner.pluginId
    && item.identity.packageId === fact.owner.packageId && item.identity.pluginRunId === fact.owner.pluginRunId)
  if (delegated.length !== 1) throw new Error('function handoff Cordis owner invalid')
  const active = task.resources.filter(resource => resource.state === 'active')
  const ids = [...active.map(resource => resource.id)].sort()
  if (!same(ids, [...fact.resourceIds].sort())
    || task.resources.some(resource => resource.state !== 'active' && !finalResources.has(resource.state))) {
    throw new Error('function handoff resource set invalid')
  }
  if (fact.scope.kind === 'global') {
    if (active.length !== 0) throw new Error('global function cannot retain page resources')
  } else {
    const scopeTarget = fact.scope.target
    if (!same(scopeTarget, task.target) || fact.scope.targetRevision !== task.targetRevision
      || active.length === 0 || active.some(resource => !same(resource.target, scopeTarget))) {
      throw new Error('page function scope invalid')
    }
  }
}

function applyDelegationCandidate(state: BrowserTaskFoldState, candidate: BrowserTaskDelegationCandidate): void {
  validateDelegationCandidate(candidate)
  const origin = state.sourceFacts.find(fact => fact.kind === 'user' && fact.sessionSeq === candidate.originUserSeq)
  const call = state.sourceFacts.find(fact => fact.kind === 'tool-call' && fact.sessionSeq === candidate.toolCallSeq
    && fact.callId === candidate.toolCallId)
  const result = state.sourceFacts.find(fact => fact.kind === 'tool-result' && fact.sessionSeq === candidate.toolResultSeq
    && fact.callId === candidate.toolCallId)
  if (origin === undefined || call === undefined || result === undefined
    || !(candidate.originUserSeq < candidate.toolCallSeq && candidate.toolCallSeq < candidate.toolResultSeq)) {
    throw new Error('delegation candidate source facts invalid')
  }
  const prior = state.pendingDelegations.find(item => item.work.callId === candidate.work.callId)
  if (prior === undefined) {
    if (candidate.toolCallId !== candidate.work.callId) throw new Error('delegation candidate initial call mismatch')
    if (state.pendingDelegations.length >= BROWSER_TASK_LIMITS.pendingDelegations) throw new Error('delegation candidate capacity exceeded')
  } else if (prior.originUserSeq !== candidate.originUserSeq || prior.work.kind !== candidate.work.kind
    || !same(prior.work.identity, candidate.work.identity)) throw new Error('delegation candidate update invalid')
  state.pendingDelegations = [
    ...state.pendingDelegations.filter(item => item.work.callId !== candidate.work.callId),
    structuredClone(candidate),
  ]
}

export function observeBrowserTaskSource(state: BrowserTaskFoldState, event: SessionEvent): boolean {
  const fact = factFor(event)
  if (fact === undefined) return false
  if (fact.sessionSeq <= state.lastSourceSeq) throw new Error('source sequence is not strictly increasing')
  state.lastSourceSeq = fact.sessionSeq
  const facts = [...state.sourceFacts, fact]
  if (fact.kind === 'user') state.pendingDelegations = []
  const protectedSeqs = new Set<number>()
  const protect = (ref: BrowserTaskSourceRef | undefined) => { if (ref !== undefined && 'sessionSeq' in ref) protectedSeqs.add(ref.sessionSeq) }
  if (state.current !== undefined) {
    protectedSeqs.add(state.current.sourceSeq)
    protect(state.current.terminationSource)
    state.current.evidence.forEach((item) =>{  protect(item.source) })
    state.current.evaluations.forEach((item) =>{  protect(item.checkerRef) })
    state.current.attempts.forEach((item) =>{  protect(item.reconciledBy) })
    state.current.attempts.forEach((item) =>{  protect(item.settledBy) })
    state.current.resources.forEach((item) =>{  protect(item.dispositionSource) })
    state.current.resources.forEach((item) =>{  protect(item.presentation?.renderReceipt) })
    state.current.delegated.forEach((item) =>{  protect(item.source) })
    protect(state.current.functionHandoff?.source)
  }
  for (const candidate of state.pendingDelegations) {
    protectedSeqs.add(candidate.originUserSeq)
    protectedSeqs.add(candidate.toolCallSeq)
    protectedSeqs.add(candidate.toolResultSeq)
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
  if (event.type === 'browser-target/change') {
    applyBrowserTargetChange(state, event.data)
    return
  }
  if (event.type === 'browser-task/receipt') validateReceipt(event.data)
  if (event.type === 'browser-task/check') validateCheck(event.data)
  if (event.type === 'browser-task/delegation') validateDelegationFact(event.data)
  if (event.type === 'browser-task/function-handoff') {
    validateFunctionHandoff(event.data)
    if (state.current === undefined) throw new Error('function handoff has no task')
    validateFunctionHandoffAdmission(state.current, event.data, state.sourceFacts)
  }
  if (event.type === 'browser-task/delegation-candidate') {
    applyDelegationCandidate(state, event.data)
    return
  }
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
