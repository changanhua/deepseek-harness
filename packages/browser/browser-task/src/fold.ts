import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { BrowserTabReference } from '@changanhua/dsh-browser/types'
import { BROWSER_TASK_CHANGE_VERSION, isExactOwnedBrowserResourceCleanupTarget } from './runtime.ts'
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
  BrowserBootstrapAuthority,
  BrowserTaskChildObservation,
  BrowserScopeSelectionAuthority,
  BrowserActionAttempt,
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
  childCandidates: 8,
  maxBudget: 10_000,
} as const

const operations = new Set<BrowserTaskOperation>([
  'create', 'evidence', 'attempt', 'reconcile-attempt', 'resource',
  'reconcile-resource', 'capability', 'delegation', 'evaluate', 'transition',
  'rebind', 'acknowledge-target-loss', 'consume-budget', 'terminate', 'owner-cancel', 'bootstrap-settle', 'select-target', 'selection-settle',
  'advance-page', 'acknowledge-human-interaction', 'handoff-function',
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
const sameTab = (left: BrowserTabReference | undefined, right: BrowserTabReference | undefined) =>
  left !== undefined && right !== undefined && left.tabId === right.tabId && left.windowId === right.windowId
  && left.browserSessionId === right.browserSessionId
const sameDocumentTarget = (left: BrowserTargetBinding, right: BrowserTargetBinding): boolean =>
  left.installationId === right.installationId && left.page.tabId === right.page.tabId
  && left.page.frameId === right.page.frameId && left.page.documentId === right.page.documentId

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

function page(value: unknown, field: string): void {
  const observed = exact(value, field, ['tabId', 'frameId', 'documentId', 'url'])
  integer(observed.tabId, `${field}.tabId`)
  integer(observed.frameId, `${field}.frameId`)
  text(observed.documentId, `${field}.documentId`)
  text(observed.url, `${field}.url`)
}
function tabRef(value: unknown, field: string): void {
  const tab = exact(value, field, ['tabId', 'windowId', 'browserSessionId'])
  integer(tab.tabId, `${field}.tabId`); integer(tab.windowId, `${field}.windowId`)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(text(tab.browserSessionId, `${field}.browserSessionId`))) throw new Error(`${field}.browserSessionId invalid`)
}
function scope(value: unknown): void {
  const parsed = exact(value, 'scope', ['kind'], ['root', 'members', 'tabs'])
  if (parsed.kind === 'single-tab' && Object.keys(parsed).length === 1) return
  if (parsed.kind === 'explicit-set') {
    if (Object.keys(parsed).length !== 2) throw new Error('scope explicit set fields invalid')
    const tabs = array(parsed.tabs, 'scope.tabs')
    if (tabs.length < 1 || tabs.length > 32) throw new Error('scope tabs invalid')
    const ids = new Set<number>(); let session: unknown
    for (const item of tabs) { tabRef(item, 'scope.tab'); const tab = item as { tabId:number; browserSessionId:string }; if (ids.has(tab.tabId) || session !== undefined && session !== tab.browserSessionId) throw new Error('scope tabs identity invalid'); ids.add(tab.tabId); session = tab.browserSessionId }
    return
  }
  if (parsed.kind === 'descendants') {
    if (parsed.tabs !== undefined || Object.keys(parsed).length !== (parsed.root === undefined ? 2 : 3)) throw new Error('scope descendant fields invalid')
    if (parsed.root !== undefined) tabRef(parsed.root, 'scope.root')
    const root = parsed.root as BrowserTabReference | undefined
    const members = array(parsed.members, 'scope.members')
    if (members.length > 31 || root === undefined && members.length > 0) throw new Error('scope members invalid')
    const ids = new Set(root === undefined ? [] : [root.tabId])
    for (const item of members) {
      const member = exact(item, 'scope.member', ['tab', 'admittedBy'])
      tabRef(member.tab, 'scope.member.tab')
      const tab = member.tab as BrowserTabReference
      if (ids.has(tab.tabId) || tab.browserSessionId !== root?.browserSessionId) throw new Error('scope member identity invalid')
      ids.add(tab.tabId)
      if (sourceRef(member.admittedBy, 'scope.member.admittedBy').kind !== 'browser-task-receipt') throw new Error('scope member receipt invalid')
    }
    return
  }
  throw new Error('scope invalid')
}
function selection(value: unknown): void {
  const item = exact(value, 'selection', ['kind', 'installationId', 'targetRevision', 'tab', 'eligibility'], ['fromTarget'])
  if (item.kind !== 'scope-tab-snapshot') throw new Error('selection kind invalid')
  text(item.installationId, 'selection.installationId'); integer(item.targetRevision, 'selection.targetRevision'); tabRef(item.tab, 'selection.tab')
  if (item.fromTarget !== undefined) target(item.fromTarget, 'selection.fromTarget')
  const eligibility=exact(item.eligibility,'selection.eligibility',['kind'],['admittedBy','candidateReceipt'])
  if (!['explicit-set','descendant-root','admitted-descendant','descendant-candidate'].includes(String(eligibility.kind))) throw new Error('selection eligibility invalid')
  if (eligibility.kind === 'explicit-set' || eligibility.kind === 'descendant-root') {
    if (Object.keys(eligibility).length !== 1) throw new Error('selection eligibility fields invalid')
  } else {
    const key = eligibility.kind === 'admitted-descendant' ? 'admittedBy' : 'candidateReceipt'
    if (Object.keys(eligibility).length !== 2 || sourceRef(eligibility[key], 'selection.receipt').kind !== 'browser-task-receipt') throw new Error('selection receipt invalid')
  }
}

function transition(value: unknown, field: string): void {
  const observed = exact(value, field, ['source', 'observedAt', 'sameTab'])
  const source = exact(observed.source, `${field}.source`, ['tab', 'page'])
  const tab = exact(source.tab, `${field}.source.tab`, ['tabId', 'windowId', 'browserSessionId'])
  integer(tab.tabId, `${field}.source.tab.tabId`); integer(tab.windowId, `${field}.source.tab.windowId`)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(text(tab.browserSessionId, `${field}.source.tab.browserSessionId`))) throw new Error(`${field}.source.tab.browserSessionId invalid`)
  page(source.page, `${field}.source.page`); integer(observed.observedAt, `${field}.observedAt`)
  if (tab.tabId !== (source.page as { tabId: number }).tabId) throw new Error(`${field}.source tab mismatch`)
  const sameTab = exact(observed.sameTab, `${field}.sameTab`, ['kind', 'page'])
  if (sameTab.kind !== 'same-document' && sameTab.kind !== 'document-replaced') throw new Error(`${field}.sameTab.kind invalid`)
  page(sameTab.page, `${field}.sameTab.page`)
  if ((sameTab.page as { tabId: number }).tabId !== tab.tabId || (sameTab.page as { frameId: number }).frameId !== (source.page as { frameId: number }).frameId) throw new Error(`${field}.sameTab.page target mismatch`)
}

/** Validate the entire bounded candidate observation without granting any page authority. */
export function validateChildObservation(value: unknown, source: BrowserTargetBinding): asserts value is BrowserTaskChildObservation {
  const observation = exact(value, 'children', ['sourceTab', 'observedAt', 'candidates', 'truncated'])
  const tabRef = (raw: unknown) => {
    const tab = exact(raw, 'children.tab', ['tabId', 'windowId', 'browserSessionId'])
    integer(tab.tabId, 'children.tab.tabId'); integer(tab.windowId, 'children.tab.windowId')
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(text(tab.browserSessionId, 'children.tab.browserSessionId'))) throw new Error('children browser session invalid')
    return tab
  }
  const sourceTab = tabRef(observation.sourceTab)
  if (sourceTab.tabId !== source.page.tabId) throw new Error('children source tab mismatch')
  integer(observation.observedAt, 'children.observedAt')
  if (typeof observation.truncated !== 'boolean') throw new Error('children.truncated invalid')
  const candidates = array(observation.candidates, 'children.candidates')
  if (candidates.length > BROWSER_TASK_LIMITS.childCandidates) throw new Error('children candidate limit exceeded')
  const tabs = new Set<number>()
  for (const raw of candidates) {
    const candidate = exact(raw, 'children.candidate', ['tab', 'relation', 'attribution', 'evidence'], ['url'])
    const tab = tabRef(candidate.tab)
    if (tab.browserSessionId !== sourceTab.browserSessionId || tab.tabId === sourceTab.tabId || tabs.has(tab.tabId as number)) throw new Error('children candidate tab invalid')
    tabs.add(tab.tabId as number)
    if (candidate.relation !== 'opener' || candidate.attribution !== 'candidate'
      || candidate.evidence !== 'created-navigation-target' && candidate.evidence !== 'opener-tab') throw new Error('children candidate attribution invalid')
    if (candidate.url !== undefined) text(candidate.url, 'children.candidate.url')
  }
  text(JSON.stringify(value), 'children.complete')
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
    integer(scope.targetRevision, `${field}.targetRevision`, 0)
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
  const attempt = exact(value, 'attempt', ['attemptId', 'requestId', 'actionKind', 'grantEpoch', 'stage', 'write'], ['target', 'bootstrap', 'selection', 'resourceId', 'presentationIntent', 'recoveryLocator', 'outcome', 'quiescent', 'settledBy', 'reconciledBy'])
  text(attempt.attemptId, 'attempt.id')
  text(attempt.requestId, 'attempt.request')
  text(attempt.actionKind, 'attempt.actionKind')
  integer(attempt.grantEpoch, 'attempt.grantEpoch')
  if (!['planned', 'prepared', 'dispatch-intent', 'dispatched', 'settled'].includes(String(attempt.stage)) || typeof attempt.write !== 'boolean') throw new Error('attempt invalid')
  if ([attempt.target, attempt.bootstrap, attempt.selection].filter(value => value !== undefined).length !== 1) throw new Error('attempt authority invalid')
  if (attempt.target !== undefined) target(attempt.target, 'attempt.target')
  if (attempt.bootstrap !== undefined) {
    const bootstrap = exact(attempt.bootstrap, 'attempt.bootstrap', ['kind', 'installationId', 'targetRevision'], ['url', 'tabId', 'windowId', 'browserSessionId', 'openedByRequestId'])
    text(bootstrap.installationId, 'attempt.bootstrap.installationId'); integer(bootstrap.targetRevision, 'attempt.bootstrap.targetRevision')
    if (bootstrap.kind === 'target-free-open') { text(bootstrap.url, 'attempt.bootstrap.url'); if (Object.keys(bootstrap).length !== 4 || attempt.actionKind !== 'tab_open' || !attempt.write) throw new Error('open bootstrap invalid') }
    else if (bootstrap.kind === 'opened-tab-snapshot') { integer(bootstrap.tabId, 'attempt.bootstrap.tabId'); integer(bootstrap.windowId, 'attempt.bootstrap.windowId'); text(bootstrap.browserSessionId, 'attempt.bootstrap.browserSessionId'); text(bootstrap.openedByRequestId, 'attempt.bootstrap.openedByRequestId'); if (Object.keys(bootstrap).length !== 7 || attempt.actionKind !== 'snapshot' || attempt.write) throw new Error('snapshot bootstrap invalid') }
    else throw new Error('attempt bootstrap kind invalid')
  }
  if (attempt.selection !== undefined) { selection(attempt.selection); if (attempt.actionKind !== 'snapshot' || attempt.write) throw new Error('selection attempt invalid') }
  if (attempt.recoveryLocator !== undefined) {
    const locator = exact(attempt.recoveryLocator, 'attempt.recoveryLocator', ['kind', 'protocolVersion', 'transportRequestId', 'installationId', 'grantEpoch'])
    if (locator.kind !== 'extension-journal-v1' || locator.protocolVersion !== 1) throw new Error('attempt recovery locator invalid')
    text(locator.transportRequestId, 'attempt.recoveryLocator.transportRequestId')
    text(locator.installationId, 'attempt.recoveryLocator.installationId')
    integer(locator.grantEpoch, 'attempt.recoveryLocator.grantEpoch')
    const installationId = attempt.target !== undefined ? (attempt.target as BrowserTargetBinding).installationId
      : attempt.bootstrap !== undefined ? (attempt.bootstrap as { installationId: string }).installationId
        : (attempt.selection as BrowserScopeSelectionAuthority).installationId
    if (locator.installationId !== installationId || locator.grantEpoch !== attempt.grantEpoch) throw new Error('attempt recovery locator identity invalid')
  }
  if (attempt.resourceId !== undefined) text(attempt.resourceId, 'attempt.resourceId')
  const actionIsResourceScoped = resourceActions.has(attempt.actionKind as string)
  if ((attempt.resourceId !== undefined) !== actionIsResourceScoped) {
    throw new Error('resource action identity invalid')
  }
  if (attempt.bootstrap !== undefined && attempt.resourceId !== undefined) throw new Error('bootstrap cannot own resource')
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
  const capability = exact(value, 'capability', ['installationId', 'state', 'grantEpoch', 'scopes', 'actions', 'protocol'], ['targetFreeOpen'])
  text(capability.installationId, 'capability.installationId')
  if (!['observed', 'degraded', 'unavailable'].includes(String(capability.state))) throw new Error('capability state invalid')
  integer(capability.grantEpoch, 'capability.grantEpoch')
  uniqueStrings(capability.scopes, 'capability.scopes', BROWSER_TASK_LIMITS.evidenceRefs)
  uniqueStrings(capability.actions, 'capability.actions', BROWSER_TASK_LIMITS.evidenceRefs)
  text(capability.protocol, 'capability.protocol')
  if (capability.targetFreeOpen !== undefined && capability.targetFreeOpen !== true) throw new Error('capability.targetFreeOpen invalid')
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
    'id', 'revision', 'objective', 'sourceSeq', 'phase', 'blockers', 'scope', 'targetLossAcknowledged',
    'acceptance', 'evidence', 'evaluations', 'attempts', 'resources', 'delegated', 'budget',
    'createdAt', 'updatedAt',
  ], ['outcome', 'target', 'targetReceipt', 'targetRevision', 'pendingTarget', 'capability', 'terminationSource', 'functionHandoff'])
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
  scope(task.scope)
  if (task.target !== undefined) target(task.target, 'target')
  if (task.targetReceipt !== undefined && (task.target === undefined
    || sourceRef(task.targetReceipt, 'targetReceipt').kind !== 'browser-task-receipt')) throw new Error('target receipt invalid')
  if (task.targetRevision === undefined) throw new Error('target revision required')
  integer(task.targetRevision, 'targetRevision')
  if (task.pendingTarget !== undefined) {
    const pending = exact(task.pendingTarget, 'pendingTarget', ['installationId', 'targetRevision', 'tabId', 'windowId', 'browserSessionId', 'grantEpoch', 'openedByRequestId', 'openedByReceipt'])
    text(pending.installationId, 'pendingTarget.installationId'); integer(pending.targetRevision, 'pendingTarget.targetRevision')
    integer(pending.tabId, 'pendingTarget.tabId'); integer(pending.windowId, 'pendingTarget.windowId')
    text(pending.browserSessionId, 'pendingTarget.browserSessionId'); integer(pending.grantEpoch, 'pendingTarget.grantEpoch')
    text(pending.openedByRequestId, 'pendingTarget.openedByRequestId')
    if (sourceRef(pending.openedByReceipt, 'pendingTarget.openedByReceipt').kind !== 'browser-task-receipt') throw new Error('pending target receipt invalid')
    if (task.target !== undefined || pending.targetRevision !== task.targetRevision) throw new Error('pending target authority invalid')
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
  return { kind: 'browser-task/change', version: 6, operation: change.operation as BrowserTaskOperation, task: assertBrowserTaskSnapshot(change.task) }
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

function settledFact(task: BrowserTaskSnapshot, facts: readonly BrowserTaskSourceFact[], seq: number): BrowserTaskSourceFact {
  const fact = facts.find(item => item.kind === 'browser-task-receipt' && item.sessionSeq === seq && item.taskId === task.id)
  if (fact === undefined || fact.outcome !== 'observed' || fact.delivery !== 'sent' || fact.quiescent !== true
    || !task.attempts.some(attempt => attempt.requestId === fact.requestId && attempt.actionKind === fact.actionKind
      && attempt.grantEpoch === fact.grantEpoch && attempt.stage === 'settled' && attempt.outcome === 'observed'
      && attempt.quiescent === true && same(attempt.target, fact.target) && same(attempt.selection, fact.selection)
      && same(attempt.settledBy, { kind: 'browser-task-receipt', sessionSeq: seq }))) throw new Error('scope receipt is not settled')
  return fact
}

function validateSelectionEligibility(task: BrowserTaskSnapshot, authority: BrowserScopeSelectionAuthority,
  facts: readonly BrowserTaskSourceFact[], beforeSeq = Infinity): void {
  selection(authority)
  const policy = task.scope
  if (policy.kind === 'single-tab') throw new Error('single-tab scope cannot select another target')
  if (authority.fromTarget !== undefined && authority.fromTarget.installationId !== authority.installationId) {
    throw new Error('selection source installation invalid')
  }
  if (policy.kind === 'explicit-set') {
    if (authority.eligibility.kind !== 'explicit-set' || !policy.tabs.some(tab => sameTab(tab, authority.tab))
      || authority.fromTarget !== undefined && !policy.tabs.some(tab => tab.tabId === authority.fromTarget?.page.tabId)) {
      throw new Error('selection explicit scope invalid')
    }
    return
  }
  const sourceMember = (tab: BrowserTabReference) => sameTab(tab, policy.root) || policy.members.some(item => sameTab(item.tab, tab))
  if (policy.root === undefined || authority.fromTarget === undefined
    || ![policy.root, ...policy.members.map(item => item.tab)].some(tab => tab.tabId === authority.fromTarget?.page.tabId)) {
    throw new Error('selection descendant source invalid')
  }
  if (authority.eligibility.kind === 'descendant-root') {
    if (!sameTab(policy.root, authority.tab)) throw new Error('selection root invalid')
  } else if (authority.eligibility.kind === 'admitted-descendant') {
    const admittedBy = authority.eligibility.admittedBy
    const member = policy.members.find(item => sameTab(item.tab, authority.tab) && same(item.admittedBy, admittedBy))
    if (member === undefined || admittedBy.sessionSeq >= beforeSeq) throw new Error('selection member invalid')
    const admission = settledFact(task, facts, admittedBy.sessionSeq)
    if (admission.selection === undefined || !sameTab(admission.selection.tab, authority.tab)) throw new Error('selection member receipt invalid')
  } else if (authority.eligibility.kind === 'descendant-candidate') {
    if (policy.members.length >= 31 && !policy.members.some(item => sameTab(item.tab, authority.tab))) {
      throw new Error('selection descendant scope is full')
    }
    if (authority.eligibility.candidateReceipt.sessionSeq >= beforeSeq) throw new Error('selection candidate chronology invalid')
    const candidate = settledFact(task, facts, authority.eligibility.candidateReceipt.sessionSeq)
    if (candidate.target?.installationId !== authority.installationId || candidate.children === undefined
      || !sourceMember(candidate.children.sourceTab)
      || !candidate.children.candidates.some(item => sameTab(item.tab, authority.tab))) throw new Error('selection candidate invalid')
  } else throw new Error('selection descendant eligibility invalid')
}

function validateScopeFacts(task: BrowserTaskSnapshot, facts: readonly BrowserTaskSourceFact[]): void {
  if (task.scope.kind !== 'descendants') return
  const policy = task.scope
  const prior: typeof policy.members[number][] = []
  let lastAdmission = -1
  for (const member of policy.members) {
    if (member.admittedBy === undefined || member.admittedBy.sessionSeq <= lastAdmission) throw new Error('scope admission order invalid')
    const fact = settledFact(task, facts, member.admittedBy.sessionSeq)
    if (fact.selection?.eligibility.kind !== 'descendant-candidate' || !sameTab(fact.selection.tab, member.tab)
      || fact.observation?.kind !== 'page' || !('tab' in fact.observation)
      || !sameTab(fact.observation.tab as BrowserTabReference, member.tab)) throw new Error('scope member admission invalid')
    validateSelectionEligibility({ ...task, scope: { ...policy, members: prior } }, fact.selection, facts, fact.sessionSeq)
    prior.push(member)
    lastAdmission = member.admittedBy.sessionSeq
  }
  if (policy.root !== undefined && task.attempts.some(attempt => attempt.bootstrap !== undefined)) {
    if (!task.attempts.some(attempt => attempt.bootstrap?.kind === 'opened-tab-snapshot'
      && sameTab(attempt.bootstrap, policy.root) && attempt.stage === 'settled' && attempt.outcome === 'observed')) {
      throw new Error('scope root lacks bootstrap observation')
    }
  }
}

/** Enforce the same scoped snapshot authority at planning, dispatch and adoption. */
export function validateSelectionAdmission(task: BrowserTaskSnapshot, attempt: BrowserActionAttempt,
  facts: readonly BrowserTaskSourceFact[], userRevision: number): void {
  const authority = attempt.selection
  if (authority === undefined || task.phase === 'terminal' || task.blockers.some(blocker => blocker !== 'cleanup')
    || task.pendingTarget !== undefined || task.targetRevision !== userRevision || authority.targetRevision !== userRevision
    || !same(authority.fromTarget, task.target) || task.capability?.state !== 'observed'
    || task.capability.installationId !== authority.installationId || task.capability.grantEpoch !== attempt.grantEpoch
    || !task.capability.scopes.includes('browser:read') || !task.capability.actions.includes('snapshot')) {
    throw new Error('selection authority changed')
  }
  if (task.attempts.some(item => item.write && (item.stage !== 'settled' || item.outcome === 'unknown' || item.quiescent !== true))
    || task.attempts.some(item => item.requestId !== attempt.requestId && item.selection !== undefined
      && (item.stage !== 'settled' || item.quiescent !== true))) throw new Error('selection requires quiescence')
  const existing = task.attempts.find(item => item.requestId === attempt.requestId)
  if (existing !== undefined && [...task.attempts].reverse().find(item => item.selection !== undefined)?.requestId !== attempt.requestId) {
    throw new Error('selection was superseded')
  }
  validateScopeFacts(task, facts)
  validateSelectionEligibility(task, authority, facts)
}

function requireTaskFacts(task: BrowserTaskSnapshot, facts: readonly BrowserTaskSourceFact[]): void {
  validateScopeFacts(task, facts)
  if (task.targetReceipt !== undefined) {
    const receipt = facts.find(fact => fact.kind === 'browser-task-receipt' && fact.taskId === task.id
      && fact.sessionSeq === task.targetReceipt?.sessionSeq && fact.outcome === 'observed'
      && fact.delivery === 'sent' && fact.quiescent === true)
    const observedTarget = receipt?.observation?.kind === 'page' ? receipt.observation.target
      : receipt?.transition === undefined ? undefined
        : { installationId: receipt.target?.installationId, page: receipt.transition.sameTab.page }
    if (receipt === undefined || !same(observedTarget, task.target) || !task.attempts.some(attempt =>
      attempt.requestId === receipt.requestId && attempt.actionKind === receipt.actionKind
      && attempt.grantEpoch === receipt.grantEpoch && attempt.stage === 'settled' && attempt.outcome === 'observed'
      && same(attempt.settledBy, task.targetReceipt))) throw new Error('target authority receipt does not match a settled attempt')
    if (receipt.selection !== undefined) validateSelectionEligibility(task, receipt.selection, facts, receipt.sessionSeq)
  }
  if (task.terminationSource !== undefined) requireFact(facts, task.terminationSource, 'terminationSource')
  for (const evidence of task.evidence) {
    requireFact(facts, evidence.source, 'evidence.source')
    const source = evidence.source
    if (source.kind === 'browser-task-receipt' && !facts.some((fact) => {
      if (fact.kind !== 'browser-task-receipt' || fact.sessionSeq !== source.sessionSeq || fact.taskId !== task.id
        || fact.grantEpoch !== evidence.grantEpoch || fact.outcome !== 'observed' || fact.delivery !== 'sent'
        || fact.quiescent !== true || evidence.pageMap !== undefined && fact.actionKind !== 'page_map') return false
      const observedTarget = fact.target ?? (fact.observation?.kind === 'page' ? fact.observation.target : undefined)
      if (!same(observedTarget, evidence.target)) return false
      return task.attempts.some(attempt => attempt.requestId === fact.requestId
        && attempt.actionKind === fact.actionKind && attempt.grantEpoch === evidence.grantEpoch
        && (same(attempt.target, evidence.target)
          || attempt.bootstrap?.kind === 'opened-tab-snapshot' && same(observedTarget, evidence.target)
          || attempt.selection !== undefined && same(observedTarget, evidence.target)))
    })) throw new Error('evidence receipt does not match target authority')
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
      if (fact.grantEpoch !== attempt.grantEpoch || !same(fact.target, attempt.target)
        || !same(fact.bootstrap, attempt.bootstrap) || !same(fact.selection, attempt.selection)) return false
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
      if (fact.taskId !== task.id) return false
      if (fact.quiescent !== true) return false
      const replacement = resource.disposition === 'document-replaced'
        && fact.delivery === 'sent' && fact.outcome === 'observed'
        && fact.transition?.sameTab.kind === 'document-replaced'
        && fact.target !== undefined && sameDocumentTarget(fact.target, resource.target)
        && same(fact.transition.source.page, fact.target.page)
      if (!replacement && !same(fact.target, resource.target)) return false
      if (!replacement && fact.resourceId !== resource.id) return false
      const matchesResourceAttempt = task.attempts.some(attempt => (
        attempt.requestId === fact.requestId
        && attempt.actionKind === fact.actionKind
        && attempt.grantEpoch === fact.grantEpoch
        && attempt.resourceId === resource.id
        && same(attempt.target, resource.target)
      ))
      if (!replacement && !matchesResourceAttempt) return false
      switch (resource.disposition) {
        case 'reconcile-active':
          return resourceCreateActions.has(fact.actionKind ?? '')
            && fact.delivery === 'sent' && fact.outcome === 'observed'
        case 'clear-observed':
        case 'reconcile-observed':
          return resourceClearActions.has(fact.actionKind ?? '')
            && fact.delivery === 'sent' && fact.outcome === 'observed'
        case 'document-replaced':
          return replacement || resourceActions.has(fact.actionKind ?? '') && fact.delivery === 'sent'
            && (fact.outcome === 'failed' || fact.outcome === 'unknown') && fact.reason === 'document_replaced'
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
    if (presentation.evidenceId !== undefined && !task.evidence.some(item => item.id === presentation.evidenceId
      && same(item.target, resource.target)
      && (item.state === 'current' || !same(resource.target, task.target) || finalResources.has(resource.state)))) {
      throw new Error('resource presentation evidence does not match')
    }
  }
}

function validateCreate(next: BrowserTaskSnapshot, state: BrowserTaskFoldState): void {
  if (next.targetReceipt !== undefined) throw new Error('create cannot borrow target receipt authority')
  if (next.revision !== 1 || next.phase !== 'running' || next.outcome !== undefined || next.blockers.length !== 0 || next.evidence.length !== 0 || next.evaluations.length !== 0 || next.attempts.length !== 0 || next.resources.length !== 0 || next.functionHandoff !== undefined || next.capability !== undefined || next.delegated.length !== 0 || next.targetLossAcknowledged || next.budget.stepsUsed !== 0 || next.budget.actionsUsed !== 0) throw new Error('create baseline invalid')
  if (state.recentTaskIds.includes(next.id) || next.sourceSeq <= state.lastTaskSourceSeq) throw new Error('create task identity replayed')
  const source = state.sourceFacts.find(fact => fact.kind === 'user' && fact.sessionSeq === next.sourceSeq)
  if (source === undefined) throw new Error('create source must cite earlier user message')
  if (next.targetRevision !== state.targetRevision) throw new Error('create target revision changed')
  if (next.scope.kind === 'descendants' && (next.scope.members.length !== 0
    || next.target === undefined && next.scope.root !== undefined
    || next.target !== undefined && next.scope.root?.tabId !== next.target.page.tabId)) throw new Error('create descendants scope invalid')
  if (next.scope.kind === 'explicit-set' && next.target !== undefined
    && !next.scope.tabs.some(tab => tab.tabId === next.target?.page.tabId)) throw new Error('create explicit scope invalid')
  if (next.target === undefined) {
    if (state.targetBinding !== null || next.pendingTarget !== undefined) throw new Error('target-free create authority invalid')
  } else if (state.targetBinding !== null && (next.target.installationId !== state.targetBinding.installationId
    || next.target.page.tabId !== state.targetBinding.page.tabId)) throw new Error('create target binding invalid')
}

function evidence(next: BrowserTaskSnapshot, previous: BrowserTaskSnapshot): void {
  only(next, previous, 'evidence', ['evidence'])
  preserveCollection(previous.evidence, next.evidence, 'id', 'evidence')
  const old = mapBy(previous.evidence, 'id')
  for (const item of next.evidence) {
    const before = old.get(item.id)
    if (before !== undefined && same(before, item)) continue
    taskTarget(next, item.target)
    if (before === undefined) continue
    if (!same({ ...before, state: undefined }, { ...item, state: undefined }) || !['current:current', 'current:stale', 'current:superseded', 'stale:stale', 'superseded:superseded'].includes(`${before.state}:${item.state}`)) throw new Error('evidence mutation invalid')
  }
}

function attempts(next: BrowserTaskSnapshot, previous: BrowserTaskSnapshot, reconciliation: boolean, ownsOnly = true): void {
  if (ownsOnly) only(next, previous, reconciliation ? 'reconcile-attempt' : 'attempt', ['attempts', 'blockers'])
  preserveCollection(previous.attempts, next.attempts, 'attemptId', reconciliation ? 'reconcile-attempt' : 'attempt')
  const old = mapBy(previous.attempts, 'attemptId')
  const transitions: Record<string, readonly string[]> = {
    planned: ['prepared', 'dispatch-intent', 'dispatched', 'settled'],
    prepared: ['dispatch-intent', 'dispatched', 'settled'],
    'dispatch-intent': ['dispatched', 'settled'],
    dispatched: ['settled'], settled: [],
  }
  for (const item of next.attempts) {
    const before = old.get(item.attemptId)
    if (before !== undefined && same(before, item)) continue
    if (before === undefined) {
      if (item.target !== undefined && (!['entry_unmount', 'region_clear'].includes(item.actionKind)
        || !isExactOwnedBrowserResourceCleanupTarget(next, item.target, item.resourceId))) taskTarget(next, item.target)
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
      if (before.selection !== undefined && before.quiescent === true) throw new Error('terminal selection cannot change outcome')
      const stoppedSelection = item.selection !== undefined && !item.write && before.quiescent !== true && item.quiescent === true
      if (!reconciliation || item.outcome === 'unknown' && !stoppedSelection || item.stage !== 'settled'
        || item.quiescent !== true || item.reconciledBy === undefined) throw new Error('unknown attempt needs quiescent reconciliation')
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
    const before = old.get(item.id)
    if (before !== undefined && same(before, item)) continue
    if (item.state === 'retained' || item.disposition === 'owner-transfer'
      || item.dispositionSource?.kind === 'browser-task-function-handoff') {
      throw new Error('retained resource requires function handoff operation')
    }
    if (before === undefined || !isExactOwnedBrowserResourceCleanupTarget(previous, item.target, item.id)) taskTarget(next, item.target)
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

/**
 * Validate checkpoint facts through the same receipt and cross-reference rules as event replay.
 * @param task - Current task restored by the projection checkpoint, if present.
 * @param facts - Bounded canonical facts retained with that checkpoint.
 */
export function validateCheckpointFacts(task: BrowserTaskSnapshot | null, facts: readonly BrowserTaskSourceFact[]): void {
  for (const fact of facts) {
    if (fact.target !== undefined) target(fact.target, 'fact.target')
    if (fact.kind === 'browser-task-receipt') {
      const { kind: _kind, sessionSeq: _sessionSeq, ...receipt } = fact
      validateReceipt({ ...receipt, kind: 'browser-task/receipt', version: fact.selection !== undefined ? 3 : fact.bootstrap === undefined ? 1 : 2 })
    } else if (fact.transition !== undefined || fact.children !== undefined || fact.selection !== undefined
      || fact.observation !== undefined || fact.bootstrap !== undefined) {
      throw new Error('non-receipt fact carries browser observation')
    }
  }
  if (task !== null) requireTaskFacts(task, facts)
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
      case 'attempt':
        if (next.attempts.some(item => item.selection !== undefined
          && !previous.attempts.some(old => old.attemptId === item.attemptId))) throw new Error('selection requires atomic planning')
        attempts(next, previous, false); validateSettlementDelivery(next, previous, state.sourceFacts); break
      case 'reconcile-attempt': attempts(next, previous, true); validateSettlementDelivery(next, previous, state.sourceFacts); break
      case 'bootstrap-settle': {
        only(next, previous, 'bootstrap-settle', ['attempts', 'target', 'targetReceipt', 'pendingTarget', 'scope', 'evidence', 'evaluations', 'blockers'])
        if (same(previous.target, next.target) && !same(previous.targetReceipt, next.targetReceipt)) {
          throw new Error('bootstrap settlement cannot change existing target authority')
        }
        const changed = next.attempts.filter(item => !same(item, previous.attempts.find(before => before.attemptId === item.attemptId)))
        const settled = changed[0]
        if (changed.length !== 1 || settled?.bootstrap === undefined || settled.stage !== 'settled') throw new Error('bootstrap settlement attempt invalid')
        const before = previous.attempts.find(item => item.attemptId === settled.attemptId)
        if (before === undefined) throw new Error('bootstrap settlement attempt missing')
        attempts(next, previous, before.outcome === 'unknown', false)
        validateSettlementDelivery(next, previous, state.sourceFacts)
        if (!same(next.target, previous.target)) {
          const pending = previous.pendingTarget
          if (previous.target !== undefined || next.target === undefined || pending === undefined
            || settled.bootstrap.kind !== 'opened-tab-snapshot' || settled.outcome !== 'observed'
            || state.targetBinding !== null || state.targetRevision !== settled.bootstrap.targetRevision
            || pending.tabId !== settled.bootstrap.tabId || pending.windowId !== settled.bootstrap.windowId
            || pending.browserSessionId !== settled.bootstrap.browserSessionId || next.target.installationId !== pending.installationId
            || next.target.page.tabId !== pending.tabId || next.target.page.frameId !== 0
            || next.pendingTarget !== undefined || !same(next.targetReceipt, settled.settledBy)) {
            throw new Error('bootstrap adoption authority invalid')
          }
        }
        const expectedScope = previous.scope.kind === 'descendants' && previous.scope.root === undefined
          && next.target !== undefined && previous.pendingTarget !== undefined
          ? { ...previous.scope, root: { tabId: previous.pendingTarget.tabId, windowId: previous.pendingTarget.windowId,
            browserSessionId: previous.pendingTarget.browserSessionId } } : previous.scope
        if (!same(next.scope, expectedScope)) throw new Error('bootstrap scope root invalid')
        break
      }
      case 'select-target': {
        only(next, previous, 'select-target', ['attempts', 'budget'])
        const planned = next.attempts.at(-1)
        if (planned?.selection === undefined || planned.stage !== 'planned' || next.attempts.length !== previous.attempts.length + 1
          || !same(next.attempts.slice(0, -1), previous.attempts)
          || !same(next.budget, { ...previous.budget, actionsUsed: previous.budget.actionsUsed + 1 })) {
          throw new Error('selection planning mutation invalid')
        }
        validateSelectionAdmission(previous, planned, state.sourceFacts, state.targetRevision)
        break
      }
      case 'selection-settle': {
        only(next, previous, 'selection-settle', ['attempts', 'target', 'targetReceipt', 'scope', 'evidence', 'evaluations', 'blockers'])
        const changed = next.attempts.filter(item => !same(item, previous.attempts.find(before => before.attemptId === item.attemptId)))
        const settled = changed[0]
        const before = previous.attempts.find(item => item.attemptId === settled?.attemptId)
        if (changed.length !== 1 || settled?.selection === undefined || settled.stage !== 'settled' || before === undefined) {
          throw new Error('selection settlement attempt invalid')
        }
        attempts(next, previous, before.outcome === 'unknown', false)
        validateSettlementDelivery(next, previous, state.sourceFacts)
        const settledBy = settled.settledBy
        const receipt = settledBy?.kind === 'browser-task-receipt'
          ? state.sourceFacts.find(fact => fact.kind === 'browser-task-receipt' && fact.sessionSeq === settledBy.sessionSeq
            && fact.taskId === previous.id && fact.requestId === settled.requestId && same(fact.selection, settled.selection)) : undefined
        if (receipt === undefined) throw new Error('selection settlement receipt missing')
        let authorityCurrent = false
        try { validateSelectionAdmission(previous, before, state.sourceFacts, state.targetRevision); authorityCurrent = true } catch {}
        const adopts = authorityCurrent && receipt.outcome === 'observed' && receipt.delivery === 'sent'
          && receipt.quiescent === true && receipt.observation?.kind === 'page'
        const expectedBlockers = state.targetRevision !== previous.targetRevision
          ? [...new Set([...previous.blockers, 'target-lost'])] : previous.blockers
        if (!same(next.blockers, expectedBlockers)) throw new Error('selection settlement blockers invalid')
        if (!adopts || receipt.observation?.kind !== 'page') {
          for (const key of ['target', 'targetReceipt', 'scope', 'evidence', 'evaluations'] as const) {
            if (!same(next[key], previous[key])) throw new Error('unaccepted selection changed target state')
          }
          break
        }
        const observed = receipt.observation
        const expectedScope = previous.scope.kind === 'descendants' && settled.selection.eligibility.kind === 'descendant-candidate'
          ? { ...previous.scope, members: [...previous.scope.members, { tab: settled.selection.tab, admittedBy: settled.settledBy }] }
          : previous.scope
        const expectedEvidence = [...previous.evidence.map(item => item.state === 'current' ? { ...item, state: 'stale' } : item), {
          id: `evidence-${settled.requestId}`, state: 'current', source: settled.settledBy, digest: observed.digest,
          target: observed.target, grantEpoch: settled.grantEpoch,
        }]
        if (!same(next.target, observed.target) || !same(next.targetReceipt, settled.settledBy)
          || !same(next.scope, expectedScope) || !same(next.evidence, expectedEvidence) || next.evaluations.length !== 0) {
          throw new Error('selection adoption mutation invalid')
        }
        break
      }
      case 'advance-page': {
        only(next, previous, 'advance-page', ['target', 'targetReceipt', 'evidence', 'evaluations', 'resources'])
        const previousTarget = previous.target
        const nextTarget = next.target
        if (state.targetRevision !== previous.targetRevision || previousTarget === undefined || nextTarget === undefined
          || nextTarget.installationId !== previousTarget.installationId
          || nextTarget.page.tabId !== previousTarget.page.tabId
          || nextTarget.page.frameId !== previousTarget.page.frameId
          || same(nextTarget.page, previousTarget.page)
          || previous.attempts.some(attempt => attempt.write && (attempt.outcome === 'unknown' || attempt.stage !== 'settled'))) {
          throw new Error('page advance authority invalid')
        }
        const receipt = [...state.sourceFacts].reverse().find(fact => fact.kind === 'browser-task-receipt'
          && fact.taskId === previous.id && same(fact.target, previousTarget) && next.targetReceipt?.sessionSeq === fact.sessionSeq
          && fact.outcome === 'observed' && fact.delivery === 'sent' && fact.quiescent === true
          && fact.transition !== undefined && same(fact.transition.source.page, previousTarget.page)
          && same(fact.transition.sameTab.page, nextTarget.page))
        if (receipt?.transition === undefined || receipt.transition.sameTab.kind !== 'same-document'
          && receipt.transition.sameTab.kind !== 'document-replaced') throw new Error('page advance receipt invalid')
        if (!previous.attempts.some(attempt => attempt.stage === 'settled' && attempt.requestId === receipt.requestId
          && attempt.actionKind === receipt.actionKind && attempt.grantEpoch === receipt.grantEpoch
          && same(attempt.target, receipt.target) && attempt.outcome === 'observed'
          && attempt.settledBy?.kind === 'browser-task-receipt' && attempt.settledBy.sessionSeq === receipt.sessionSeq
          && previous.capability?.state === 'observed' && previous.capability.grantEpoch === attempt.grantEpoch)) throw new Error('page advance attempt invalid')
        preserveCollection(previous.evidence, next.evidence, 'id', 'advance-page')
        if (next.evidence.some(item => item.state === 'current') || next.evaluations.length !== 0) {
          throw new Error('page advance must stale evidence and clear evaluations')
        }
        preserveCollection(previous.resources, next.resources, 'id', 'advance-page')
        for (const before of previous.resources) {
          const after = next.resources.find(item => item.id === before.id)
          if (after === undefined || !same(after.target, before.target)) throw new Error('page advance resource identity invalid')
          const replacesDocument = receipt.transition.sameTab.kind === 'document-replaced'
            && sameDocumentTarget(before.target, previousTarget) && !finalResources.has(before.state)
          if (replacesDocument) {
            if (after.state !== 'vanished' || after.disposition !== 'document-replaced'
              || !same(after.dispositionSource, { kind: 'browser-task-receipt', sessionSeq: receipt.sessionSeq })) {
              throw new Error('page advance resource disposition invalid')
            }
          } else if (!same(after, before)) throw new Error('page advance changed unrelated resource')
        }
        break
      }
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
        }, state.sourceFacts.filter(item => item.sessionSeq !== fact.sessionSeq), state.targetBinding, state.targetRevision)
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
        only(next, previous, 'rebind', ['target', 'targetReceipt', 'targetRevision', 'scope', 'blockers', 'targetLossAcknowledged', 'evidence'])
        if (next.targetReceipt !== undefined) throw new Error('rebind cannot borrow target receipt authority')
        if (next.scope.kind !== 'single-tab' || state.targetBinding === null || next.targetRevision !== state.targetRevision
          || !same(next.target, { installationId: state.targetBinding.installationId, page: state.targetBinding.page })) {
          throw new Error('rebind requires current user target')
        }
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
    ...(event.data.target === undefined ? {} : { target: event.data.target }),
    ...(event.data.bootstrap === undefined ? {} : { bootstrap: event.data.bootstrap }),
    ...(event.data.selection === undefined ? {} : { selection: event.data.selection }),
    ...(event.data.observation === undefined ? {} : { observation: event.data.observation }),
    outcome: event.data.outcome,
    delivery: event.data.delivery,
    quiescent: event.data.quiescent,
    grantEpoch: event.data.grantEpoch,
    ...(event.data.resourceId === undefined ? {} : { resourceId: event.data.resourceId }),
    ...(event.data.reason === undefined ? {} : { reason: event.data.reason }),
    ...(event.data.failureFingerprint === undefined ? {} : { failureFingerprint: event.data.failureFingerprint }),
    ...(event.data.presentation === undefined ? {} : { presentation: event.data.presentation }),
    ...(event.data.transition === undefined ? {} : { transition: event.data.transition }),
    ...(event.data.children === undefined ? {} : { children: event.data.children }),
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
  const receipt = exact(value, 'receipt', ['kind', 'version', 'taskId', 'requestId', 'actionKind', 'outcome', 'delivery', 'quiescent', 'grantEpoch'], ['target', 'bootstrap', 'selection', 'observation', 'resourceId', 'reason', 'failureFingerprint', 'presentation', 'transition', 'children'])
  if (receipt.kind !== 'browser-task/receipt' || (receipt.version !== 1 && receipt.version !== 2 && receipt.version !== 3)) throw new Error('receipt header invalid')
  text(receipt.taskId, 'receipt.taskId')
  text(receipt.requestId, 'receipt.requestId')
  text(receipt.actionKind, 'receipt.actionKind')
  if (receipt.version === 1) {
    if (receipt.bootstrap !== undefined || receipt.observation !== undefined || receipt.selection !== undefined) throw new Error('page receipt carries bootstrap fields')
    target(receipt.target, 'receipt.target')
    if (receipt.transition !== undefined) transition(receipt.transition, 'receipt.transition')
    if (receipt.children !== undefined) {
      if (receipt.delivery !== 'sent') throw new Error('unsent receipt carries child observations')
      validateChildObservation(receipt.children, receipt.target as BrowserTargetBinding)
    }
  }
  else if (receipt.version === 2) {
    if (receipt.transition !== undefined || receipt.children !== undefined || receipt.selection !== undefined) throw new Error('bootstrap receipt carries transition')
    if ((receipt.target === undefined) === (receipt.bootstrap === undefined)) throw new Error('bootstrap receipt authority invalid')
    if (receipt.bootstrap === undefined || receipt.observation === undefined) throw new Error('bootstrap receipt observation missing')
    const bootstrap = receipt.bootstrap as BrowserBootstrapAuthority
    validateAttempt({ attemptId: receipt.requestId, requestId: receipt.requestId, actionKind: receipt.actionKind, grantEpoch: receipt.grantEpoch, stage: 'settled', write: receipt.actionKind === 'tab_open', bootstrap, outcome: receipt.outcome, quiescent: receipt.quiescent, settledBy: { kind: 'browser-task-receipt', sessionSeq: 0 } })
    const observation = exact(receipt.observation, 'receipt.observation', ['kind'], ['tab', 'target', 'digest'])
    if (observation.kind === 'none') {
      if (Object.keys(observation).length !== 1) throw new Error('receipt no-observation invalid')
    } else if (observation.kind === 'opened-tab') {
      const tab = exact(observation.tab, 'receipt.observation.tab', ['tabId', 'windowId', 'browserSessionId'])
      integer(tab.tabId, 'receipt.observation.tab.tabId'); integer(tab.windowId, 'receipt.observation.tab.windowId')
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(text(tab.browserSessionId, 'receipt.observation.tab.browserSessionId')) || Object.keys(observation).length !== 2) throw new Error('receipt opened-tab invalid')
      if (bootstrap.kind !== 'target-free-open' || receipt.outcome !== 'observed' || receipt.delivery !== 'sent') throw new Error('receipt opened-tab authority invalid')
    } else if (observation.kind === 'page') {
      target(observation.target, 'receipt.observation.target')
      if (!/^sha256:[a-f0-9]{64}$/u.test(text(observation.digest, 'receipt.observation.digest')) || Object.keys(observation).length !== 3) throw new Error('receipt page observation invalid')
      const observedTarget = observation.target as BrowserTargetBinding
      if (bootstrap.kind !== 'opened-tab-snapshot' || receipt.outcome !== 'observed' || receipt.delivery !== 'sent'
        || observedTarget.installationId !== bootstrap.installationId || observedTarget.page.tabId !== bootstrap.tabId
        || observedTarget.page.frameId !== 0) throw new Error('receipt page observation authority invalid')
    } else throw new Error('receipt observation kind invalid')
    if (receipt.outcome !== 'observed' && (observation as { kind: string }).kind !== 'none') throw new Error('non-observed bootstrap receipt cannot observe')
  } else {
    if (receipt.target !== undefined || receipt.bootstrap !== undefined || receipt.selection === undefined || receipt.observation === undefined || receipt.transition !== undefined || receipt.children !== undefined) throw new Error('selection receipt authority invalid')
    if (receipt.actionKind !== 'snapshot' || receipt.resourceId !== undefined || receipt.presentation !== undefined
      || receipt.failureFingerprint !== undefined) throw new Error('selection receipt action invalid')
    selection(receipt.selection)
    const observation = exact(receipt.observation, 'selection observation', ['kind'], ['target', 'tab', 'digest'])
    if (observation.kind === 'none') { if (Object.keys(observation).length !== 1) throw new Error('selection observation invalid') }
    else if (observation.kind === 'page') {
      target(observation.target, 'selection target'); tabRef(observation.tab, 'selection tab')
      if (Object.keys(observation).length !== 4 || !/^sha256:[a-f0-9]{64}$/u.test(text(observation.digest, 'selection digest'))
        || (observation.target as BrowserTargetBinding).installationId
          !== (receipt.selection as BrowserScopeSelectionAuthority).installationId
        || (observation.target as BrowserTargetBinding).page.tabId !== (receipt.selection as BrowserScopeSelectionAuthority).tab.tabId
        || (observation.target as BrowserTargetBinding).page.frameId !== 0
        || !sameTab(observation.tab as BrowserTabReference, (receipt.selection as BrowserScopeSelectionAuthority).tab)
        || receipt.outcome !== 'observed' || receipt.delivery !== 'sent' || receipt.quiescent !== true) throw new Error('selection observation invalid')
    } else throw new Error('selection observation invalid')
  }
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
  facts: readonly BrowserTaskSourceFact[], _userBinding: BrowserSessionTargetBinding | null,
  userTargetRevision: number): void {
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
      || userTargetRevision !== fact.scope.targetRevision
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
    validateFunctionHandoffAdmission(state.current, event.data, state.sourceFacts, state.targetBinding, state.targetRevision)
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
