/** Deterministic, fail-closed fold for atomic Queue v2 ChangeSets. */
import { canonicalJson, digestIntent } from './canonical.ts'
import { canAutoRetry } from './transitions.ts'
import type {
  Attention, AttentionId, AttemptId, Batch, BatchId, ChangeSet, DomainEvent, Notification,
  NotificationId, QueueFoldSnapshot, Receipt, ResourceClaim, ResultId, WorkAttempt, WorkId, WorkItem, WorkResult, WorkState,
} from './types.ts'

/** Read-only durable Queue projection. Every map access returns a defensive snapshot. */
export interface FoldedQueue {
  readonly worksById: ReadonlyMap<WorkId, WorkItem>
  readonly statesByWorkId: ReadonlyMap<WorkId, WorkState>
  readonly attemptsById: ReadonlyMap<AttemptId, WorkAttempt>
  readonly resultsById: ReadonlyMap<ResultId, WorkResult>
  readonly batchesById: ReadonlyMap<BatchId, Batch>
  readonly attentionsById: ReadonlyMap<AttentionId, Attention>
  readonly notificationsById: ReadonlyMap<NotificationId, Notification>
  readonly receiptsByKey: ReadonlyMap<string, Receipt>
  readonly lastSeq: number
}

interface MutableQueue {
  worksById: Map<WorkId, WorkItem>
  statesByWorkId: Map<WorkId, WorkState>
  attemptsById: Map<AttemptId, WorkAttempt>
  resultsById: Map<ResultId, WorkResult>
  batchesById: Map<BatchId, Batch>
  attentionsById: Map<AttentionId, Attention>
  notificationsById: Map<NotificationId, Notification>
  receiptsByKey: Map<string, Receipt>
  changeIds: Set<string>
  lastSeq: number
}

const INTERNAL = new WeakMap<FoldedQueue, MutableQueue>()

/**
 * Fold ordered ChangeSets into a fresh projection.
 * @param changes - Ordered atomic changes beginning at sequence one.
 * @returns A read-only projection with defensive map snapshots.
 */
export function foldChanges(changes: readonly ChangeSet[]): FoldedQueue {
  const projection = createProjection(emptyMutable())
  for (const change of changes) applyChange(projection, change)
  return projection
}

/**
 * Atomically apply one ChangeSet to an existing projection.
 * @param folded - Projection returned by foldChanges.
 * @param change - Next consecutive ChangeSet.
 */
export function applyChange(folded: FoldedQueue, change: ChangeSet): void {
  const current = requireInternal(folded)
  if (!Number.isSafeInteger(change.seq) || change.seq !== current.lastSeq + 1) throw new Error(`fold: seq ${change.seq} out of order; expected ${current.lastSeq + 1}`)
  if (change.changeId === '' || current.changeIds.has(change.changeId)) throw new Error(`fold: duplicate or empty changeId ${change.changeId}`)
  if (change.events.length === 0) throw new Error('fold: ChangeSet must contain at least one event')

  const durable = cloneAndFreeze(change)
  validateAdmissionAtomicity(durable)
  const next = cloneMutable(current)
  for (const event of durable.events) applyEvent(next, event, durable.events, durable.seq)
  validateChangeSetOutboxes(current, next, durable)
  next.lastSeq = durable.seq
  next.changeIds.add(durable.changeId)
  INTERNAL.set(folded, next)
}

/**
 * Look up idempotency before resolving admission.
 * @param folded - Current projection.
 * @param owner - Authority scope that owns the receipt.
 * @param source - Stable admission source within the owner scope.
 * @param key - Caller idempotency key.
 * @param intentDigest - Canonical caller-intent digest.
 * @returns Original WorkIds, or null on a miss.
 */
export function lookupReceipt(
  folded: FoldedQueue,
  owner: Receipt['owner'],
  source: string,
  key: string,
  intentDigest: string,
): readonly WorkId[] | null {
  const receipt = requireInternal(folded).receiptsByKey.get(receiptStorageKey(owner, source, key))
  if (receipt === undefined) return null
  if (receipt.intentDigest !== intentDigest) throw new Error(`idempotency conflict for key ${key}`)
  return Object.freeze([...receipt.workIds])
}

/**
 * Serialize a projection after the store has independently protected its bytes and digest.
 * @param folded Projection to serialize.
 * @returns Defensive snapshot suitable for canonical persistence.
 */
export function snapshotFoldedQueue(folded: FoldedQueue): QueueFoldSnapshot {
  const value = requireInternal(folded)
  return cloneAndFreeze({
    lastSeq: value.lastSeq,
    changeIds: [...value.changeIds],
    works: [...value.worksById.values()],
    states: [...value.statesByWorkId.values()],
    attempts: [...value.attemptsById.values()],
    results: [...value.resultsById.values()],
    batches: [...value.batchesById.values()],
    attentions: [...value.attentionsById.values()],
    notifications: [...value.notificationsById.values()],
    receipts: [...value.receiptsByKey.values()],
  })
}

/**
 * Hydrate a validated snapshot so a store can fold only its consecutive tail.
 * @param snapshot Persisted defensive projection snapshot.
 * @returns Folded Queue projection ready for consecutive ChangeSets.
 */
export function hydrateFoldedQueue(snapshot: QueueFoldSnapshot): FoldedQueue {
  if (!Number.isSafeInteger(snapshot.lastSeq) || snapshot.lastSeq < 0) throw new Error('fold: snapshot lastSeq is invalid')
  const next = emptyMutable()
  next.lastSeq = snapshot.lastSeq
  for (const changeId of snapshot.changeIds) {
    if (changeId === '' || next.changeIds.has(changeId)) throw new Error('fold: snapshot changeIds are invalid')
    next.changeIds.add(changeId)
  }
  copySnapshot(next.worksById, snapshot.works, value => value.id, 'WorkItem')
  copySnapshot(next.statesByWorkId, snapshot.states, value => value.workId, 'WorkState')
  copySnapshot(next.attemptsById, snapshot.attempts, value => value.id, 'WorkAttempt')
  copySnapshot(next.resultsById, snapshot.results, value => value.id, 'WorkResult')
  copySnapshot(next.batchesById, snapshot.batches, value => value.id, 'Batch')
  copySnapshot(next.attentionsById, snapshot.attentions, value => value.id, 'Attention')
  copySnapshot(next.notificationsById, snapshot.notifications, value => value.id, 'Notification')
  for (const receipt of snapshot.receipts) {
    const key = receiptStorageKey(receipt.owner, receipt.source, receipt.key)
    if (next.receiptsByKey.has(key)) throw new Error('fold: snapshot contains duplicate Receipt')
    next.receiptsByKey.set(key, cloneAndFreeze(receipt))
  }
  validateHydrated(next)
  return createProjection(next)
}

function createProjection(initial: MutableQueue): FoldedQueue {
  const projection = Object.freeze({
    get worksById() { return snapshotMap(requireInternal(projection).worksById) },
    get statesByWorkId() { return snapshotMap(requireInternal(projection).statesByWorkId) },
    get attemptsById() { return snapshotMap(requireInternal(projection).attemptsById) },
    get resultsById() { return snapshotMap(requireInternal(projection).resultsById) },
    get batchesById() { return snapshotMap(requireInternal(projection).batchesById) },
    get attentionsById() { return snapshotMap(requireInternal(projection).attentionsById) },
    get notificationsById() { return snapshotMap(requireInternal(projection).notificationsById) },
    get receiptsByKey() { return snapshotMap(requireInternal(projection).receiptsByKey) },
    get lastSeq() { return requireInternal(projection).lastSeq },
  }) as FoldedQueue
  INTERNAL.set(projection, initial)
  return projection
}

function validateAdmissionAtomicity(change: ChangeSet): void {
  const admitted = change.events.filter((event): event is Extract<DomainEvent, { type: 'work/admitted' }> => event.type === 'work/admitted')
  const batches = change.events.filter((event): event is Extract<DomainEvent, { type: 'batch/admitted' }> => event.type === 'batch/admitted')
  const receipts = change.events.filter((event): event is Extract<DomainEvent, { type: 'receipt/recorded' }> => event.type === 'receipt/recorded')
  if (admitted.length === 0 && batches.length === 0) return
  if (receipts.length !== 1) throw new Error('fold: admission and its receipt must be atomic in one ChangeSet')
  const receiptEvent = receipts[0]
  if (receiptEvent === undefined) throw new Error('fold: admission Receipt disappeared during validation')
  const receipt = receiptEvent.receipt
  const admittedIds = admitted.map(event => event.work.id)
  if (!sameIds(receipt.workIds, admittedIds)) throw new Error('fold: admission receipt WorkIds must exactly match admitted WorkItems')
  if (batches.length === 0) {
    const workEvent = admitted[0]
    if (admitted.length !== 1 || workEvent === undefined || receipt.batchId !== null || workEvent.work.batchId !== null) {
      throw new Error('fold: single admission must atomically contain one non-Batch WorkItem and Receipt')
    }
    return
  }
  if (batches.length !== 1) throw new Error('fold: one ChangeSet may admit at most one Batch')
  const batchEvent = batches[0]
  if (batchEvent === undefined) throw new Error('fold: Batch disappeared during admission validation')
  const batch = batchEvent.batch
  if (batch.workIds.length === 0
    || !Number.isSafeInteger(batch.maxParallel)
    || batch.maxParallel < 1
    || receipt.batchId !== batch.id
    || !sameIds(batch.workIds, admittedIds)) {
    throw new Error(`fold: Batch ${batch.id} admission and Receipt must be atomic`)
  }
  if (admitted.some(event => event.work.batchId !== batch.id || event.work.kind !== batch.kind)) {
    throw new Error(`fold: Batch ${batch.id} must be homogeneous by WorkKind and membership`)
  }
  canonicalJson(batch.sharedPayload)
}

interface TerminalDelivery {
  readonly workId: WorkId
  readonly attemptId: AttemptId | null
  readonly resultId: ResultId | null
}

/** Validate all mandatory outbox siblings after lifecycle events have folded, independent of event order. */
function validateChangeSetOutboxes(current: MutableQueue, next: MutableQueue, change: ChangeSet): void {
  const unknowns = change.events.filter((event): event is Extract<DomainEvent, { type: 'attempt/unknown' }> => event.type === 'attempt/unknown')
  const unknownAttentions = change.events.filter((event): event is Extract<DomainEvent, { type: 'attention/created' }> => event.type === 'attention/created' && event.attention.kind === 'unknown')
  for (const unknown of unknowns) {
    const attempt = current.attemptsById.get(unknown.attemptId) ?? next.attemptsById.get(unknown.attemptId)
    if (attempt === undefined) throw new Error(`fold: unknown WorkAttempt ${unknown.attemptId} disappeared during outbox validation`)
    const matching = unknownAttentions.filter(event => event.attention.workId === attempt.workId && event.attention.status === 'pending' && event.attention.resolvedAt === null)
    if (matching.length !== 1) throw new Error(`fold: attempt/unknown ${unknown.attemptId} requires exactly one matching unknown Attention`)
  }
  for (const attention of unknownAttentions) {
    const matching = unknowns.filter((event) => {
      const attempt = current.attemptsById.get(event.attemptId) ?? next.attemptsById.get(event.attemptId)
      return attempt?.workId === attention.attention.workId
    })
    if (matching.length !== 1) throw new Error(`fold: unknown Attention ${attention.attention.id} must match exactly one attempt/unknown`)
  }

  const terminals: TerminalDelivery[] = []
  for (const event of change.events) {
    if (event.type === 'attempt/succeeded') {
      const attempt = current.attemptsById.get(event.attemptId) ?? next.attemptsById.get(event.attemptId)
      if (attempt !== undefined && next.statesByWorkId.get(attempt.workId)?.status === 'succeeded') terminals.push({ workId: attempt.workId, attemptId: event.attemptId, resultId: event.result.id })
    } else if (event.type === 'attempt/failed' || (event.type === 'unknown/resolved' && event.resolution.kind === 'confirm-failed')) {
      const attempt = current.attemptsById.get(event.attemptId) ?? next.attemptsById.get(event.attemptId)
      if (attempt !== undefined && next.statesByWorkId.get(attempt.workId)?.status === 'failed') terminals.push({ workId: attempt.workId, attemptId: event.attemptId, resultId: null })
    } else if (event.type === 'work/canceled' && next.statesByWorkId.get(event.workId)?.status === 'canceled') {
      terminals.push({ workId: event.workId, attemptId: current.statesByWorkId.get(event.workId)?.activeAttemptId ?? null, resultId: null })
    }
  }
  const notifications = change.events.filter((event): event is Extract<DomainEvent, { type: 'notification/created' }> => event.type === 'notification/created')
  if (terminals.length === 0 && notifications.length !== 0) throw new Error('fold: Notification requires a terminal ChangeSet')
  for (const terminal of terminals) {
    const work = next.worksById.get(terminal.workId)
    if (work === undefined) throw new Error(`fold: terminal WorkItem ${terminal.workId} disappeared during outbox validation`)
    const matching = notifications.filter(event => event.notification.workId === terminal.workId
      && event.notification.attemptId === terminal.attemptId
      && event.notification.resultId === terminal.resultId)
    const expected = work.ownerSessionId === null ? 0 : 1
    if (matching.length !== expected) throw new Error(`fold: owned terminal WorkItem ${terminal.workId} requires exactly one matching Notification`)
  }
  for (const notification of notifications) {
    const matching = terminals.filter(terminal => terminal.workId === notification.notification.workId
      && terminal.attemptId === notification.notification.attemptId
      && terminal.resultId === notification.notification.resultId)
    if (matching.length !== 1) throw new Error(`fold: Notification ${notification.notification.id} must match exactly one terminal WorkItem`)
  }
}

function applyEvent(queue: MutableQueue, event: DomainEvent, siblings: readonly DomainEvent[], seq: number): void {
  switch (event.type) {
    case 'work/admitted': {  admitWork(queue, event.work); return }
    case 'batch/admitted': {  admitBatch(queue, event.batch); return }
    case 'receipt/recorded': {  recordReceipt(queue, event.receipt); return }
    case 'attempt/started': {  startAttempt(queue, event.attempt); return }
    case 'attempt/running': {  runAttempt(queue, event.attemptId, event.at); return }
    case 'attempt/unknown': {  unknownAttempt(queue, event.attemptId, event.failure, event.at); return }
    case 'attempt/succeeded': {  succeedAttempt(queue, event.attemptId, event.result, event.at); return }
    case 'attempt/failed': {  failAttempt(queue, event.attemptId, event.failure, event.at); return }
    case 'cancel/requested': {  requestCancel(queue, event.workId, event.at); return }
    case 'work/canceled': {  settleCanceled(queue, event.workId, event.at); return }
    case 'work/manual-retry-authorized': {  manualRetry(queue, event.workId, event.at); return }
    case 'work/auto-retry-authorized': {  autoRetry(queue, event.workId, event.at, siblings); return }
    case 'unknown/resolved': {  resolveUnknown(queue, event.attemptId, event.resolution, event.at, siblings); return }
    case 'attention/created': {  createAttention(queue, event.attention); return }
    case 'attention/resolved': {  resolveAttention(queue, event.attentionId, event.at, siblings); return }
    case 'notification/created': {  createNotification(queue, event.notification, siblings, seq); return }
    case 'notification/acknowledged': {  acknowledgeNotification(queue, event.notificationId, event.expectedMessageId, event.at); return }
    default: {
      const type = (event as { type?: unknown }).type
      throw new Error(`fold: unsupported event ${JSON.stringify(type)}; lifecycle snapshots are forbidden`)
    }
  }
}

function admitWork(queue: MutableQueue, work: WorkItem): void {
  if (queue.worksById.has(work.id)) throw new Error(`fold: duplicate WorkItem ${work.id}`)
  if (work.title === '' || !Number.isSafeInteger(work.policy.maxAttempts) || work.policy.maxAttempts < 1) throw new Error(`fold: invalid WorkItem admission ${work.id}`)
  validateResources(work)
  if (work.intentDigest !== digestIntent(work.intent)) throw new Error(`fold: WorkItem ${work.id} intent digest mismatch`)
  const frozen = cloneAndFreeze(work)
  queue.worksById.set(work.id, frozen)
  queue.statesByWorkId.set(work.id, freeze({ workId: work.id, status: 'queued', attemptCount: 0, activeAttemptId: null, resultId: null, failure: null, cancelRequestedAt: null, updatedAt: work.createdAt }))
}

function validateResources(work: WorkItem): void {
  if (!Array.isArray(work.resources)) throw new Error(`fold: WorkItem ${work.id} has invalid resource claims`)
  const names = new Set<string>()
  const claims: readonly ResourceClaim[] = work.resources
  for (const claim of claims) {
    if (typeof claim.resource !== 'string'
      || claim.resource.trim() === ''
      || !Number.isSafeInteger(claim.units)
      || claim.units < 1
      || names.has(claim.resource)) {
      throw new Error(`fold: WorkItem ${work.id} has invalid resource claims`)
    }
    names.add(claim.resource)
  }
}

function admitBatch(queue: MutableQueue, batch: Batch): void {
  if (queue.batchesById.has(batch.id)) throw new Error(`fold: duplicate Batch ${batch.id}`)
  queue.batchesById.set(batch.id, cloneAndFreeze(batch))
}

function recordReceipt(queue: MutableQueue, receipt: Receipt): void {
  if (receipt.key === '' || receipt.source === '') throw new Error('fold: Receipt key and source must be non-empty')
  const storageKey = receiptStorageKey(receipt.owner, receipt.source, receipt.key)
  const prior = queue.receiptsByKey.get(storageKey)
  if (prior !== undefined) {
    if (canonicalJson(prior) !== canonicalJson(receipt)) throw new Error(`fold: idempotency conflict for key ${receipt.key}`)
    return
  }
  for (const id of receipt.workIds) {
    const work = queue.worksById.get(id)
    if (work === undefined) throw new Error(`fold: Receipt references unknown WorkItem ${id}`)
    if (receipt.owner.type === 'agent' && receipt.owner.sessionId !== work.ownerSessionId) throw new Error(`fold: Receipt owner does not match WorkItem ${id}`)
    if (receipt.batchId === null && receipt.intentDigest !== work.intentDigest) throw new Error(`fold: Receipt intent digest does not match WorkItem ${id}`)
  }
  queue.receiptsByKey.set(storageKey, cloneAndFreeze(receipt))
}

function startAttempt(queue: MutableQueue, event: Pick<WorkAttempt, 'id' | 'workId' | 'ordinal' | 'startedAt'>): void {
  if (queue.attemptsById.has(event.id)) throw new Error(`fold: duplicate WorkAttempt ${event.id}`)
  const state = requireState(queue, event.workId)
  if (state.status !== 'queued') throw new Error(`fold: WorkItem ${event.workId} must be queued before attempt start; got ${state.status}`)
  if (event.ordinal !== state.attemptCount + 1) throw new Error(`fold: WorkAttempt ordinal ${event.ordinal} is not consecutive for ${event.workId}`)
  queue.attemptsById.set(event.id, freeze({ ...event, status: 'starting', runningAt: null, finishedAt: null, failure: null }))
  queue.statesByWorkId.set(event.workId, freeze({ ...state, status: 'starting', attemptCount: event.ordinal, activeAttemptId: event.id, resultId: null, failure: null, cancelRequestedAt: null, updatedAt: event.startedAt }))
}

function runAttempt(queue: MutableQueue, attemptId: AttemptId, at: string): void {
  const attempt = requireAttempt(queue, attemptId)
  const state = requireActiveState(queue, attempt)
  if (attempt.status !== 'starting' || state.status !== 'starting') throw new Error(`fold: WorkAttempt ${attemptId} must be starting before running`)
  queue.attemptsById.set(attemptId, freeze({ ...attempt, status: 'running', runningAt: at }))
  queue.statesByWorkId.set(attempt.workId, freeze({ ...state, status: 'running', updatedAt: at }))
}

function unknownAttempt(queue: MutableQueue, attemptId: AttemptId, failure: WorkAttempt['failure'] & {}, at: string): void {
  const attempt = requireAttempt(queue, attemptId)
  const state = requireActiveState(queue, attempt)
  if ((attempt.status !== 'starting' && attempt.status !== 'running') || (state.status !== 'starting' && state.status !== 'running')) throw new Error(`fold: WorkAttempt ${attemptId} cannot become unknown from ${attempt.status}`)
  queue.attemptsById.set(attemptId, freeze({ ...attempt, status: 'unknown', failure }))
  queue.statesByWorkId.set(attempt.workId, freeze({ ...state, status: 'unknown', failure, updatedAt: at }))
}

function succeedAttempt(queue: MutableQueue, attemptId: AttemptId, result: WorkResult, at: string): void {
  const attempt = requireAttempt(queue, attemptId)
  const state = requireActiveState(queue, attempt)
  if (attempt.status !== 'running' || state.status !== 'running') throw new Error(`fold: WorkAttempt ${attemptId} must be running before success`)
  validateResult(queue, attempt, result)
  queue.resultsById.set(result.id, cloneAndFreeze(result))
  queue.attemptsById.set(attemptId, freeze({ ...attempt, status: 'succeeded', finishedAt: at, failure: null }))
  queue.statesByWorkId.set(attempt.workId, freeze({ ...state, status: 'succeeded', activeAttemptId: null, resultId: result.id, failure: null, cancelRequestedAt: null, updatedAt: at }))
}

function failAttempt(queue: MutableQueue, attemptId: AttemptId, failure: WorkAttempt['failure'] & {}, at: string): void {
  const attempt = requireAttempt(queue, attemptId)
  const state = requireActiveState(queue, attempt)
  if ((attempt.status !== 'starting' && attempt.status !== 'running') || (state.status !== 'starting' && state.status !== 'running')) throw new Error(`fold: WorkAttempt ${attemptId} cannot fail from ${attempt.status}`)
  queue.attemptsById.set(attemptId, freeze({ ...attempt, status: 'failed', finishedAt: at, failure }))
  queue.statesByWorkId.set(attempt.workId, freeze({ ...state, status: 'failed', activeAttemptId: null, failure, cancelRequestedAt: null, updatedAt: at }))
}

function requestCancel(queue: MutableQueue, workId: WorkId, at: string): void {
  const state = requireState(queue, workId)
  if (state.status !== 'queued' && state.status !== 'starting' && state.status !== 'running') throw new Error(`fold: cannot request cancel from ${state.status}`)
  queue.statesByWorkId.set(workId, freeze({ ...state, cancelRequestedAt: at, updatedAt: at }))
}

function settleCanceled(queue: MutableQueue, workId: WorkId, at: string): void {
  const state = requireState(queue, workId)
  if (state.cancelRequestedAt === null) throw new Error(`fold: cancel settlement for ${workId} requires a prior cancel request`)
  if (state.status !== 'queued' && state.status !== 'starting' && state.status !== 'running') throw new Error(`fold: cancel settlement cannot overwrite terminal or unknown state ${state.status}`)
  if (state.activeAttemptId !== null) {
    const attempt = requireAttempt(queue, state.activeAttemptId)
    queue.attemptsById.set(attempt.id, freeze({ ...attempt, status: 'canceled', finishedAt: at }))
  }
  queue.statesByWorkId.set(workId, freeze({ ...state, status: 'canceled', activeAttemptId: null, cancelRequestedAt: null, updatedAt: at }))
}

function manualRetry(queue: MutableQueue, workId: WorkId, at: string): void {
  const state = requireState(queue, workId)
  if (state.status !== 'failed') throw new Error(`fold: manual retry requires failed WorkItem ${workId}`)
  queue.statesByWorkId.set(workId, freeze({ ...state, status: 'queued', activeAttemptId: null, resultId: null, failure: null, cancelRequestedAt: null, updatedAt: at }))
}

function autoRetry(queue: MutableQueue, workId: WorkId, at: string, siblings: readonly DomainEvent[]): void {
  const state = requireState(queue, workId)
  const failureEvent = siblings.find((event): event is Extract<DomainEvent, { type: 'attempt/failed' }> => event.type === 'attempt/failed' && queue.attemptsById.get(event.attemptId)?.workId === workId)
  const work = requireWork(queue, workId)
  if (state.status !== 'failed' || failureEvent === undefined || !canAutoRetry(failureEvent.failure)) throw new Error(`fold: automatic retry requires retriable failure with sideEffect not-started for ${workId}`)
  if (state.attemptCount >= work.policy.maxAttempts) throw new Error(`fold: automatic retry exceeds maxAttempts for ${workId}`)
  queue.statesByWorkId.set(workId, freeze({ ...state, status: 'queued', activeAttemptId: null, resultId: null, updatedAt: at }))
}

function resolveUnknown(queue: MutableQueue, attemptId: AttemptId, resolution: Extract<DomainEvent, { type: 'unknown/resolved' }>['resolution'], at: string, siblings: readonly DomainEvent[]): void {
  const attempt = requireAttempt(queue, attemptId)
  const state = requireActiveState(queue, attempt)
  if (attempt.status !== 'unknown' || state.status !== 'unknown') throw new Error(`fold: unknown resolution requires active unknown WorkAttempt ${attemptId}`)
  const attention = [...queue.attentionsById.values()].find(value => value.workId === attempt.workId && value.kind === 'unknown' && value.status === 'pending')
  if (attention === undefined || !siblings.some(event => event.type === 'attention/resolved' && event.attentionId === attention.id)) {
    throw new Error(`fold: unknown resolution for ${attemptId} must atomically resolve its pending Attention`)
  }
  const resolutionKind: unknown = (resolution as { readonly kind?: unknown }).kind
  if (resolutionKind === 'authorize-retry') {
    queue.attemptsById.set(attemptId, freeze({ ...attempt, status: 'failed', finishedAt: at }))
    queue.statesByWorkId.set(attempt.workId, freeze({ ...state, status: 'queued', activeAttemptId: null, failure: null, updatedAt: at }))
  } else if (resolutionKind === 'confirm-failed') {
    const failure = (resolution as {
      readonly failure: WorkAttempt['failure'] & {}
    }).failure
    queue.attemptsById.set(attemptId, freeze({ ...attempt, status: 'failed', finishedAt: at, failure }))
    queue.statesByWorkId.set(attempt.workId, freeze({ ...state, status: 'failed', activeAttemptId: null, failure, updatedAt: at }))
  } else {
    throw new Error(`fold: unsupported unknown resolution ${JSON.stringify(resolutionKind)}`)
  }
}

function createAttention(queue: MutableQueue, attention: Attention): void {
  if (!queue.worksById.has(attention.workId) || queue.attentionsById.has(attention.id) || attention.status !== 'pending' || attention.resolvedAt !== null) throw new Error(`fold: invalid Attention ${attention.id}`)
  queue.attentionsById.set(attention.id, cloneAndFreeze(attention))
}

function resolveAttention(queue: MutableQueue, id: AttentionId, at: string, siblings: readonly DomainEvent[]): void {
  const prior = queue.attentionsById.get(id)
  if (prior === undefined) throw new Error(`fold: Attention resolution references unknown ${id}`)
  if (prior.status === 'resolved') return
  if (prior.kind === 'unknown' && !siblings.some(event => event.type === 'unknown/resolved' && queue.attemptsById.get(event.attemptId)?.workId === prior.workId)) {
    throw new Error(`fold: unknown Attention ${id} must be resolved with its unknown resolution`)
  }
  queue.attentionsById.set(id, freeze({ ...prior, status: 'resolved', resolvedAt: at }))
}

function createNotification(queue: MutableQueue, notification: Notification, siblings: readonly DomainEvent[], seq: number): void {
  const work = queue.worksById.get(notification.workId)
  const state = queue.statesByWorkId.get(notification.workId)
  const attempt = notification.attemptId === null ? undefined : queue.attemptsById.get(notification.attemptId)
  if (work === undefined || state === undefined || queue.notificationsById.has(notification.id) || notification.status !== 'pending' || notification.acknowledgedAt !== null) throw new Error(`fold: invalid Notification ${notification.id}`)
  if (work.ownerSessionId === null
    || notification.ownerSessionId !== work.ownerSessionId
    || notification.terminalSeq !== seq
    || (notification.attemptId !== null && (attempt === undefined || attempt.workId !== notification.workId))) {
    throw new Error(`fold: invalid Notification ${notification.id} ownership or terminal sequence`)
  }
  if (notification.messageId !== `task-queue-notification:${notification.id}`) throw new Error(`fold: Notification ${notification.id} messageId is invalid`)
  if (state.status === 'succeeded') {
    const success = notification.attemptId !== null && siblings.some(event => event.type === 'attempt/succeeded' && event.attemptId === notification.attemptId && event.result.id === notification.resultId)
    if (!success) throw new Error(`fold: success Notification ${notification.id} must be committed with its terminal result`)
  } else if (state.status === 'failed') {
    const failed = notification.attemptId !== null && (siblings.some(event => event.type === 'attempt/failed' && event.attemptId === notification.attemptId)
      || siblings.some(event => event.type === 'unknown/resolved' && event.attemptId === notification.attemptId && event.resolution.kind === 'confirm-failed'))
    if (notification.resultId !== null || !failed) throw new Error(`fold: failure Notification ${notification.id} must be committed with its terminal attempt`)
  } else if (state.status === 'canceled') {
    const queuedCancellation = notification.attemptId === null
      && ![...queue.attemptsById.values()].some(value => value.workId === notification.workId)
    const liveCancellation = notification.attemptId !== null && attempt?.status === 'canceled'
    if (notification.resultId !== null
      || (!queuedCancellation && !liveCancellation)
      || !siblings.some(event => event.type === 'work/canceled' && event.workId === notification.workId)) {
      throw new Error(`fold: canceled Notification ${notification.id} must be committed with cancellation`)
    }
  } else {
    throw new Error(`fold: Notification ${notification.id} requires a terminal WorkItem`)
  }
  queue.notificationsById.set(notification.id, cloneAndFreeze(notification))
}

function acknowledgeNotification(queue: MutableQueue, id: NotificationId, messageId: string, at: string): void {
  const prior = queue.notificationsById.get(id)
  if (prior === undefined) throw new Error(`fold: Notification ack references unknown ${id}`)
  if (prior.messageId !== messageId) throw new Error(`fold: Notification ack messageId mismatch for ${id}`)
  if (prior.status === 'acknowledged') return
  queue.notificationsById.set(id, freeze({ ...prior, status: 'acknowledged', acknowledgedAt: at }))
}

function validateResult(queue: MutableQueue, attempt: WorkAttempt, result: WorkResult): void {
  const work = requireWork(queue, attempt.workId)
  if (result.workId !== attempt.workId) throw new Error(`fold: result workId does not own WorkAttempt ${attempt.id}`)
  if (result.attemptId !== attempt.id) throw new Error(`fold: result attemptId does not match WorkAttempt ${attempt.id}`)
  if (result.kind !== work.kind) throw new Error(`fold: result kind does not match WorkItem ${work.id}`)
  if (queue.resultsById.has(result.id)) throw new Error(`fold: duplicate WorkResult ${result.id}`)
}

function receiptStorageKey(owner: Receipt['owner'], source: string, key: string): string {
  return canonicalJson({ owner, source, key })
}

function copySnapshot<K, V>(target: Map<K, V>, values: readonly V[], keyOf: (value: V) => K, name: string): void {
  for (const value of values) {
    const key = keyOf(value)
    if (target.has(key)) throw new Error(`fold: snapshot contains duplicate ${name}`)
    target.set(key, cloneAndFreeze(value))
  }
}

function validateHydrated(queue: MutableQueue): void {
  for (const [workId, state] of queue.statesByWorkId) {
    if (!queue.worksById.has(workId) || state.workId !== workId) throw new Error(`fold: snapshot State references unknown WorkItem ${workId}`)
    if (state.activeAttemptId !== null) {
      const attempt = queue.attemptsById.get(state.activeAttemptId)
      if (attempt === undefined || attempt.workId !== workId || attempt.status !== state.status) throw new Error(`fold: snapshot active WorkAttempt is invalid for ${workId}`)
    }
    if (state.resultId !== null && !queue.resultsById.has(state.resultId)) throw new Error(`fold: snapshot WorkResult is missing for ${workId}`)
  }
  for (const [attemptId, attempt] of queue.attemptsById) {
    if (!queue.worksById.has(attempt.workId) || attempt.id !== attemptId) throw new Error(`fold: snapshot WorkAttempt ${attemptId} is invalid`)
  }
  for (const notification of queue.notificationsById.values()) {
    const work = queue.worksById.get(notification.workId)
    if (work === undefined || work.ownerSessionId !== notification.ownerSessionId) throw new Error(`fold: snapshot Notification ${notification.id} has invalid owner`)
  }
}

function requireState(queue: MutableQueue, workId: WorkId): WorkState {
  const state = queue.statesByWorkId.get(workId)
  if (state === undefined) throw new Error(`fold: unknown WorkItem ${workId}`)
  return state
}

function requireWork(queue: MutableQueue, workId: WorkId): WorkItem {
  const work = queue.worksById.get(workId)
  if (work === undefined) throw new Error(`fold: unknown WorkItem ${workId}`)
  return work
}

function requireAttempt(queue: MutableQueue, attemptId: AttemptId): WorkAttempt {
  const attempt = queue.attemptsById.get(attemptId)
  if (attempt === undefined) throw new Error(`fold: unknown WorkAttempt ${attemptId}`)
  return attempt
}

function requireActiveState(queue: MutableQueue, attempt: WorkAttempt): WorkState {
  const state = requireState(queue, attempt.workId)
  if (state.activeAttemptId !== attempt.id) throw new Error(`fold: WorkAttempt ${attempt.id} is not active for WorkItem ${attempt.workId}`)
  return state
}

function emptyMutable(): MutableQueue {
  return {
    worksById: new Map(),
    statesByWorkId: new Map(),
    attemptsById: new Map(),
    resultsById: new Map(),
    batchesById: new Map(),
    attentionsById: new Map(),
    notificationsById: new Map(),
    receiptsByKey: new Map(),
    changeIds: new Set(),
    lastSeq: 0,
  }
}

function cloneMutable(value: MutableQueue): MutableQueue {
  return {
    worksById: new Map(value.worksById),
    statesByWorkId: new Map(value.statesByWorkId),
    attemptsById: new Map(value.attemptsById),
    resultsById: new Map(value.resultsById),
    batchesById: new Map(value.batchesById),
    attentionsById: new Map(value.attentionsById),
    notificationsById: new Map(value.notificationsById),
    receiptsByKey: new Map(value.receiptsByKey),
    changeIds: new Set(value.changeIds),
    lastSeq: value.lastSeq,
  }
}

function requireInternal(folded: FoldedQueue): MutableQueue {
  const internal = INTERNAL.get(folded)
  if (internal === undefined) throw new Error('fold: projection was not created by foldChanges')
  return internal
}

function snapshotMap<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  return new Map(source)
}

function sameIds(left: readonly WorkId[], right: readonly WorkId[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function cloneAndFreeze<T>(value: T): T {
  return freeze(structuredClone(value))
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freeze(nested)
    Object.freeze(value)
  }
  return value
}
