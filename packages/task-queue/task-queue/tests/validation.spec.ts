import { describe, expect, it } from 'vitest'
import {
  applyChange as applyChangeStrict, foldChanges as foldChangesStrict, lookupReceipt,
  AttentionId, AttemptId, BatchId, NotificationId, WorkId,
} from '@changanhua/dsh-task-queue'
import type { ChangeSet, FoldedQueue } from '@changanhua/dsh-task-queue'
import { AT, LATER, admitted, batch, failure, receipt, result, running, started, work } from './fixtures.ts'

/** Keep malformed persistence fixtures outside the production ChangeSet type. */
const foldChanges = (changes: readonly unknown[]) => foldChangesStrict(changes as readonly ChangeSet[])
/** The production fold remains the only validator for intentionally malformed facts. */
const applyChange = (folded: unknown, change: unknown) =>{  applyChangeStrict(folded as FoldedQueue, change as ChangeSet) }
const ownerlessAdmitted = (seq = 1) => {
  const value = work('work-1', { ownerSessionId: null })
  return admitted(seq, value, receipt([value.id], { owner: { type: 'operator' } }))
}
const ownerNotification = (id: string, attemptId: AttemptId | null, resultId: string | null, terminalSeq: number) => ({
  id: NotificationId(id), workId: WorkId('work-1'), terminalSeq, attemptId, resultId, ownerSessionId: 'session-1',
  messageId: `task-queue-notification:${id}`, status: 'pending' as const, createdAt: LATER, acknowledgedAt: null,
})

describe('fail-closed domain validation', () => {
  it('rejects malformed ChangeSet identity without mutating the projection', () => {
    const folded = foldChanges([admitted()])
    expect(() =>{  applyChange(folded, { seq: 4, changeId: 'gap', at: LATER, events: [{ type: 'cancel/requested', workId: WorkId('work-1'), at: LATER }] }) }).toThrow(/seq/)
    expect(() =>{  applyChange(folded, { seq: 2, changeId: '', at: LATER, events: [{ type: 'cancel/requested', workId: WorkId('work-1'), at: LATER }] }) }).toThrow(/changeId/)
    expect(() =>{  applyChange(folded, { seq: 2, changeId: 'change-1', at: LATER, events: [{ type: 'cancel/requested', workId: WorkId('work-1'), at: LATER }] }) }).toThrow(/changeId/)
    expect(() =>{  applyChange(folded, { seq: 2, changeId: 'empty', at: LATER, events: [] }) }).toThrow(/at least one event/)
    expect(() =>{  applyChange({}, admitted()) }).toThrow(/not created by foldChanges/)
    expect(folded.lastSeq).toBe(1)
  })

  it('rejects malformed single and Batch admission facts', () => {
    expect(() => foldChanges([{ ...admitted(), events: [admitted().events[0]] }])).toThrow(/receipt.*atomic/i)
    expect(() => foldChanges([admitted(1, work(), receipt([WorkId('other')]))])).toThrow(/WorkIds.*match/i)
    expect(() => foldChanges([admitted(1, work('work-1', { batchId: BatchId('batch-1') }))])).toThrow(/single admission/i)
    expect(() => foldChanges([admitted(1, work('work-1', { title: '' }))])).toThrow(/invalid WorkItem/i)
    expect(() => foldChanges([admitted(1, work('work-1', { policy: { maxAttempts: 0 } }))])).toThrow(/invalid WorkItem/i)
    expect(() => foldChanges([admitted(1, work('work-1', { intentDigest: 'sha256:wrong' }))])).toThrow(/digest mismatch/i)
    expect(() => foldChanges([admitted(1, work(), receipt([WorkId('work-1')], { owner: { type: 'agent', sessionId: 'other' } }))])).toThrow(/owner/i)
    expect(() => foldChanges([admitted(1, work(), receipt([WorkId('work-1')], { owner: { type: 'operator' }, source: 'operator' }))])).toThrow(/operator Receipt requires ownerless/i)
    expect(() => foldChanges([{ seq: 1, changeId: 'receipt-only', at: AT, events: [{ type: 'receipt/recorded', receipt: receipt([WorkId('missing')]) }] }])).toThrow(/unknown WorkItem/i)

    expect(() => foldChanges([admitted(1, work('work-1', { resources: undefined }))])).toThrow(/invalid resource claims/i)
    expect(() => foldChanges([admitted(1, work('work-1', { resources: [{ resource: '', units: 1 }] }))])).toThrow(/resource/i)
    expect(() => foldChanges([admitted(1, work('work-1', { resources: [{ resource: 1, units: 1 }] }))])).toThrow(/invalid resource claims/i)
    expect(() => foldChanges([admitted(1, work('work-1', { resources: [{ resource: 'gpu', units: 1 }, { resource: 'gpu', units: 1 }] }))])).toThrow(/resource/i)
    expect(() => foldChanges([admitted(1, work('work-1', { resources: [{ resource: 'gpu', units: 0 }] }))])).toThrow(/resource/i)
    expect(() => foldChanges([admitted(1, work('work-1', { resources: [{ resource: 'gpu', units: 1.5 }] }))])).toThrow(/resource/i)

    const first = work('work-1', { batchId: BatchId('batch-1') })
    const second = work('work-2', { batchId: BatchId('batch-1') })
    const events = [{ type: 'batch/admitted', batch: batch() }, { type: 'work/admitted', work: first }, { type: 'work/admitted', work: second }, { type: 'receipt/recorded', receipt: receipt([first.id, second.id], { batchId: BatchId('batch-1') }) }]
    expect(() => foldChanges([{ seq: 1, changeId: 'two-batches', at: AT, events: [events[0], events[0], ...events.slice(1)] }])).toThrow(/at most one Batch/i)
    expect(() => foldChanges([{ seq: 1, changeId: 'bad-batch', at: AT, events: events.map(event => event.type === 'batch/admitted' ? { ...event, batch: { ...event.batch, maxParallel: 0 } } : event) }])).toThrow(/Batch.*atomic/i)
    expect(() => foldChanges([{ seq: 1, changeId: 'fractional-batch', at: AT, events: events.map(event => event.type === 'batch/admitted' ? { ...event, batch: { ...event.batch, maxParallel: 1.5 } } : event) }])).toThrow(/Batch.*atomic/i)
    expect(() => foldChanges([{ seq: 1, changeId: 'duplicate-work', at: AT, events: [{ type: 'work/admitted', work: first }, { type: 'work/admitted', work: first }, { type: 'receipt/recorded', receipt: receipt([first.id, first.id], { batchId: null }) }] }])).toThrow(/single admission|duplicate WorkItem/i)

    const existing = foldChanges([admitted()])
    expect(() =>{  applyChange(existing, admitted(2)) }).toThrow(/duplicate WorkItem/i)
    expect(() =>{  applyChange(existing, { seq: 2, changeId: 'empty-receipt', at: LATER, events: [{ type: 'receipt/recorded', receipt: receipt([WorkId('work-1')], { key: '' }) }] }) }).toThrow(/non-empty/i)
    applyChange(existing, { seq: 2, changeId: 'same-receipt', at: LATER, events: [{ type: 'receipt/recorded', receipt: receipt() }] })
    expect(lookupReceipt(existing, { type: 'agent', sessionId: 'session-1' }, 'tool', 'key-1', work().intentDigest)).toEqual([WorkId('work-1')])
    applyChange(existing, { seq: 3, changeId: 'independent-receipt-source', at: LATER, events: [{ type: 'receipt/recorded', receipt: receipt([WorkId('work-1')], { source: 'other' }) }] })

    const batchFold = foldChanges([{ seq: 1, changeId: 'batch-ok', at: AT, events }])
    const third = work('work-3', { batchId: BatchId('batch-1') })
    const fourth = work('work-4', { batchId: BatchId('batch-1') })
    expect(() =>{  applyChange(batchFold, { seq: 2, changeId: 'duplicate-batch', at: LATER, events: [
      { type: 'batch/admitted', batch: batch({ workIds: [third.id, fourth.id] }) },
      { type: 'work/admitted', work: third }, { type: 'work/admitted', work: fourth },
      { type: 'receipt/recorded', receipt: receipt([third.id, fourth.id], { key: 'key-2', batchId: BatchId('batch-1') }) },
    ] }) }).toThrow(/duplicate Batch/i)
  })

  it('rejects illegal attempt, terminal, cancellation, and retry transitions', () => {
    expect(() => foldChanges([admitted(), running(2)])).toThrow(/unknown WorkAttempt/i)
    expect(() => foldChanges([admitted(), started(), started(3)])).toThrow(/duplicate WorkAttempt|queued/i)
    expect(() => foldChanges([admitted(), started(), running(), running(4)])).toThrow(/starting before running/i)
    expect(() => foldChanges([admitted(), started(), { seq: 3, changeId: 'second-attempt', at: LATER, events: [{ type: 'attempt/started', attempt: { id: AttemptId('attempt-2'), workId: WorkId('work-1'), ordinal: 2, startedAt: LATER } }] }])).toThrow(/must be queued/i)
    expect(() => foldChanges([admitted(), started(), { seq: 3, changeId: 'success-too-early', at: LATER, events: [{ type: 'attempt/succeeded', attemptId: AttemptId('attempt-1'), result: result(), at: LATER }] }])).toThrow(/running before success/i)
    expect(() => foldChanges([admitted(), started(), running(), { seq: 4, changeId: 'bad-result-attempt', at: LATER, events: [{ type: 'attempt/succeeded', attemptId: AttemptId('attempt-1'), result: result({ attemptId: AttemptId('other') }), at: LATER }] }])).toThrow(/result attemptId/i)

    const secondWork = work('work-2', { ownerSessionId: null })
    const secondReceipt = receipt([secondWork.id], { key: 'key-2', owner: { type: 'operator' } })
    const duplicateResult = [
      ownerlessAdmitted(), admitted(2, secondWork, secondReceipt), started(3),
      { seq: 4, changeId: 'start-second', at: LATER, events: [{ type: 'attempt/started', attempt: { id: AttemptId('attempt-2'), workId: WorkId('work-2'), ordinal: 1, startedAt: LATER } }] },
      running(5), { seq: 6, changeId: 'run-second', at: LATER, events: [{ type: 'attempt/running', attemptId: AttemptId('attempt-2'), at: LATER }] },
      { seq: 7, changeId: 'success-first', at: LATER, events: [{ type: 'attempt/succeeded', attemptId: AttemptId('attempt-1'), result: result(), at: LATER }] },
      { seq: 8, changeId: 'success-second', at: LATER, events: [{ type: 'attempt/succeeded', attemptId: AttemptId('attempt-2'), result: result({ workId: WorkId('work-2'), attemptId: AttemptId('attempt-2') }), at: LATER }] },
    ]
    expect(() => foldChanges(duplicateResult)).toThrow(/duplicate WorkResult/i)
    expect(() => foldChanges([ownerlessAdmitted(), { seq: 2, changeId: 'cancel-settle', at: LATER, events: [{ type: 'work/canceled', workId: WorkId('work-1'), at: LATER }] }])).toThrow(/cancel request/i)
    expect(foldChanges([ownerlessAdmitted(), started(), { seq: 3, changeId: 'active-cancel-2', at: LATER, events: [{ type: 'cancel/requested', workId: WorkId('work-1'), at: LATER }, { type: 'work/canceled', workId: WorkId('work-1'), at: LATER }] }]).attemptsById.get(AttemptId('attempt-1'))?.status).toBe('canceled')
    expect(() => foldChanges([admitted(), { seq: 2, changeId: 'unknown-resolution', at: LATER, events: [{ type: 'unknown/resolved', attemptId: AttemptId('missing'), resolution: { kind: 'authorize-retry' }, at: LATER }] }])).toThrow(/unknown WorkAttempt/i)
    const unknownAttention = { id: AttentionId('attention-unknown'), workId: WorkId('work-1'), kind: 'unknown' as const, status: 'pending' as const, createdAt: LATER, resolvedAt: null }
    const unknown = { seq: 4, changeId: 'unknown', at: LATER, events: [{ type: 'attempt/unknown', attemptId: AttemptId('attempt-1'), failure: failure({ sideEffect: 'unknown' }), at: LATER }, { type: 'attention/created' as const, attention: unknownAttention }] }
    expect(() => foldChanges([admitted(), started(), running(), unknown, { ...unknown, seq: 5, changeId: 'unknown-again' }])).toThrow(/cannot become unknown/i)
    expect(() => foldChanges([admitted(), started(), running(), unknown, { seq: 5, changeId: 'fail-unknown', at: LATER, events: [{ type: 'attempt/failed', attemptId: AttemptId('attempt-1'), failure: failure(), at: LATER }] }])).toThrow(/cannot fail/i)
    expect(() => foldChanges([admitted(), started(), running(), { seq: 4, changeId: 'resolve-running', at: LATER, events: [{ type: 'unknown/resolved', attemptId: AttemptId('attempt-1'), resolution: { kind: 'authorize-retry' }, at: LATER }] }])).toThrow(/requires active unknown/i)

    const oneAttemptWork = work('work-1', { policy: { maxAttempts: 1 }, ownerSessionId: null })
    const oneAttempt = admitted(1, oneAttemptWork, receipt([oneAttemptWork.id], { owner: { type: 'operator' } }))
    const unsafe = { seq: 4, changeId: 'unsafe', at: LATER, events: [{ type: 'attempt/failed', attemptId: AttemptId('attempt-1'), failure: failure(), at: LATER }, { type: 'work/auto-retry-authorized', workId: WorkId('work-1'), at: LATER }] }
    expect(() => foldChanges([oneAttempt, started(), running(), unsafe])).toThrow(/maxAttempts/i)

    const failedAttempt = { seq: 4, changeId: 'failed', at: LATER, events: [{ type: 'attempt/failed', attemptId: AttemptId('attempt-1'), failure: failure({ sideEffect: 'started' }), at: LATER }] }
    const manual = { seq: 5, changeId: 'manual', at: LATER, events: [{ type: 'work/manual-retry-authorized', workId: WorkId('work-1'), at: LATER }] }
    expect(() => foldChanges([ownerlessAdmitted(), started(), running(), failedAttempt, manual, started(6, WorkId('work-1'), 2), { seq: 7, changeId: 'stale-running', at: LATER, events: [{ type: 'attempt/running', attemptId: AttemptId('attempt-1'), at: LATER }] }])).toThrow(/not active/i)

    const canceled = { seq: 2, changeId: 'canceled', at: LATER, events: [{ type: 'cancel/requested', workId: WorkId('work-1'), at: LATER }, { type: 'work/canceled', workId: WorkId('work-1'), at: LATER }] }
    expect(() => foldChanges([ownerlessAdmitted(), canceled, { seq: 3, changeId: 'cancel-again', at: LATER, events: [{ type: 'cancel/requested', workId: WorkId('work-1'), at: LATER }] }])).toThrow(/cannot request cancel/i)
  })

  it('validates duplicate creation and idempotent outbox acknowledgements', () => {
    const attention = { id: AttentionId('attention-1'), workId: WorkId('work-1'), kind: 'failure', status: 'pending', createdAt: LATER, resolvedAt: null }
    const notification = ownerNotification('notification-1', AttemptId('attempt-1'), null, 2)
    const queuedCreated = { seq: 2, changeId: 'outbox-queued', at: LATER, events: [{ type: 'attention/created', attention }, { type: 'notification/created', notification }] }
    expect(() => foldChanges([
      admitted(),
      { ...queuedCreated, events: [queuedCreated.events[0], queuedCreated.events[0]] },
    ])).toThrow(/duplicate|invalid Attention/i)
    expect(() => foldChanges([admitted(), queuedCreated])).toThrow(/invalid Notification|terminal WorkItem/i)
    expect(() => foldChanges([admitted(), { seq: 2, changeId: 'unknown-ack', at: LATER, events: [{ type: 'attention/resolved', attentionId: AttentionId('missing'), at: LATER }] }])).toThrow(/unknown/i)
    expect(() => foldChanges([admitted(), { seq: 2, changeId: 'unknown-notification-ack', at: LATER, events: [{ type: 'notification/acknowledged', notificationId: NotificationId('missing'), expectedMessageId: 'x', at: LATER }] }])).toThrow(/unknown/i)
    const failed = { seq: 4, changeId: 'failed-with-outbox', at: LATER, events: [
      { type: 'attempt/failed', attemptId: AttemptId('attempt-1'), failure: failure({ sideEffect: 'started' }), at: LATER },
      { type: 'attention/created', attention },
      { type: 'notification/created', notification: { ...notification, terminalSeq: 4 } },
    ] }
    const ack = { seq: 5, changeId: 'ack', at: LATER, events: [{ type: 'attention/resolved', attentionId: attention.id, at: LATER }, { type: 'notification/acknowledged', notificationId: notification.id, expectedMessageId: notification.messageId, at: LATER }] }
    const repeated = { ...ack, seq: 6, changeId: 'ack-repeat' }
    expect(foldChanges([admitted(), started(), running(), failed, ack, repeated]).attentionsById.get(attention.id)?.status).toBe('resolved')
    expect(() => foldChanges([admitted(), started(), running(), failed, { seq: 5, changeId: 'bad-notification-message', at: LATER, events: [{ type: 'notification/acknowledged', notificationId: notification.id, expectedMessageId: 'wrong', at: LATER }] }])).toThrow(/messageId/i)
  })

  it('requires complete terminal owner delivery and unknown Attention ChangeSets', () => {
    const success = { seq: 4, changeId: 'success-without-outbox', at: LATER, events: [{ type: 'attempt/succeeded', attemptId: AttemptId('attempt-1'), result: result(), at: LATER }] }
    expect(() => foldChanges([admitted(), started(), running(), success])).toThrow(/owned terminal.*Notification/i)

    const unknown = { seq: 4, changeId: 'unknown-without-attention', at: LATER, events: [{ type: 'attempt/unknown', attemptId: AttemptId('attempt-1'), failure: failure({ sideEffect: 'unknown' }), at: LATER }] }
    expect(() => foldChanges([admitted(), started(), running(), unknown])).toThrow(/unknown.*Attention/i)

    const notification = { id: NotificationId('notification-1'), workId: WorkId('work-1'), terminalSeq: 4, attemptId: AttemptId('attempt-1'), resultId: result().id, ownerSessionId: 'session-1', messageId: 'wrong-message-id', status: 'pending', createdAt: LATER, acknowledgedAt: null }
    expect(() => foldChanges([admitted(), started(), running(), { ...success, changeId: 'bad-message-id', events: [...success.events, { type: 'notification/created', notification }] }])).toThrow(/messageId/i)

    const first = { ...notification, id: NotificationId('notification-duplicate-1'), messageId: 'task-queue-notification:notification-duplicate-1' }
    const second = { ...notification, id: NotificationId('notification-duplicate-2'), messageId: 'task-queue-notification:notification-duplicate-2' }
    expect(() => foldChanges([admitted(), started(), running(), { ...success, changeId: 'duplicate-terminal-delivery', events: [...success.events, { type: 'notification/created', notification: first }, { type: 'notification/created', notification: second }] }])).toThrow(/exactly one.*Notification/i)

    expect(() => foldChanges([ownerlessAdmitted(), started(), running(), { ...success, changeId: 'ownerless-outbox', events: [...success.events, { type: 'notification/created', notification: first }] }])).toThrow(/Notification/i)
    const retryWithOutbox = { seq: 4, changeId: 'auto-retry-outbox', at: LATER, events: [
      { type: 'attempt/failed', attemptId: AttemptId('attempt-1'), failure: failure(), at: LATER },
      { type: 'work/auto-retry-authorized', workId: WorkId('work-1'), at: LATER },
      { type: 'notification/created', notification: { ...ownerNotification('notification-auto-retry', AttemptId('attempt-1'), null, 4) } },
    ] }
    expect(() => foldChanges([admitted(), started(), running(), retryWithOutbox])).toThrow(/terminal/i)

    const wrongUnknownAttention = { id: AttentionId('attention-wrong-work'), workId: WorkId('other'), kind: 'unknown' as const, status: 'pending' as const, createdAt: LATER, resolvedAt: null }
    const unknownWithWrongAttention = { seq: 4, changeId: 'unknown-wrong-attention', at: LATER, events: [
      { type: 'attempt/unknown', attemptId: AttemptId('attempt-1'), failure: failure({ sideEffect: 'unknown' }), at: LATER },
      { type: 'attention/created' as const, attention: wrongUnknownAttention },
    ] }
    expect(() => foldChanges([admitted(), started(), running(), unknownWithWrongAttention])).toThrow(/invalid Attention/i)
    const orphanUnknownAttention = { id: AttentionId('attention-orphan'), workId: WorkId('work-1'), kind: 'unknown' as const, status: 'pending' as const, createdAt: LATER, resolvedAt: null }
    expect(() => foldChanges([admitted(), { seq: 2, changeId: 'orphan-unknown-attention', at: LATER, events: [{ type: 'attention/created', attention: orphanUnknownAttention }] }])).toThrow(/must match exactly one attempt\/unknown/i)
  })
})
