import { describe, expect, it } from 'vitest'
import { applyChange as applyChangeStrict, foldChanges as foldChangesStrict, hydrateFoldedQueue, lookupReceipt, snapshotFoldedQueue, AttemptId, AttentionId, BatchId, NotificationId, WorkId } from '@changanhua/dsh-task-queue'
import type { ChangeSet, FoldedQueue } from '@changanhua/dsh-task-queue'
import { AT, LATER, admitted, batch, failure, receipt, result, running, started, work } from './fixtures.ts'

/** Feed untrusted persisted facts to the runtime fold, which must reject malformed records. */
const foldChanges = (changes: readonly unknown[]) => foldChangesStrict(changes as readonly ChangeSet[])
/** Apply one untrusted persisted fact to prove the fold remains fail-closed. */
const applyChange = (folded: FoldedQueue, change: unknown) =>{  applyChangeStrict(folded, change as ChangeSet) }
const ownerlessAdmitted = (seq = 1) => {
  const value = work('work-1', { ownerSessionId: null })
  return admitted(seq, value, receipt([value.id], { owner: { type: 'operator' } }))
}
const ownerNotification = (id: string, attemptId: AttemptId | null, resultId: string | null, terminalSeq: number) => ({
  id: NotificationId(id), workId: WorkId('work-1'), terminalSeq, attemptId, resultId, ownerSessionId: 'session-1',
  messageId: `task-queue-notification:${id}`, status: 'pending' as const, createdAt: LATER, acknowledgedAt: null,
})

describe('event-derived fold', () => {
  it('derives queued admission and rejects caller-supplied lifecycle snapshots', () => {
    const folded = foldChanges([admitted()])
    expect(folded.statesByWorkId.get(WorkId('work-1'))).toMatchObject({ status: 'queued', attemptCount: 0, activeAttemptId: null })
    const base = admitted(1)
    const invalid = {
      ...base,
      events: [...base.events, { type: 'work/state-changed', state: { workId: WorkId('work-1'), status: 'unknown', attemptCount: 77 } }],
    }
    expect(() => foldChanges([invalid])).toThrow(/unsupported|snapshot|state-changed/i)
  })

  it('binds a single admission Receipt to its canonical intent and original WorkId', () => {
    const folded = foldChanges([admitted()])
    const owner = { type: 'agent' as const, sessionId: 'session-1' }
    expect(lookupReceipt(folded, owner, 'tool', 'key-1', work().intentDigest)).toEqual([WorkId('work-1')])
    expect(() => lookupReceipt(folded, owner, 'tool', 'key-1', 'sha256:other')).toThrow(/idempotency conflict/i)
    expect(lookupReceipt(folded, owner, 'tool', 'missing', work().intentDigest)).toBeNull()
    expect(() => foldChanges([admitted(1, work(), receipt([WorkId('work-1')], { intentDigest: 'sha256:other' }))])).toThrow(/Receipt.*digest/i)
  })

  it('derives queued to starting to running and validates active attempt ownership and ordinal', () => {
    const folded = foldChanges([admitted(), started(), running()])
    expect(folded.statesByWorkId.get(WorkId('work-1'))).toMatchObject({ status: 'running', attemptCount: 1, activeAttemptId: AttemptId('attempt-1') })
    expect(() => foldChanges([admitted(), started(2, WorkId('work-other'))])).toThrow(/work|owner/i)
    expect(() => foldChanges([admitted(), started(2, WorkId('work-1'), 2)])).toThrow(/ordinal/i)
  })

  it('validates terminal result work, attempt, and kind in the same ChangeSet', () => {
    const terminal = { seq: 4, changeId: 'change-4', at: LATER, events: [{ type: 'attempt/succeeded', attemptId: AttemptId('attempt-1'), result: result(), at: LATER }] }
    const folded = foldChanges([ownerlessAdmitted(), started(), running(), terminal])
    expect(folded.statesByWorkId.get(WorkId('work-1'))).toMatchObject({ status: 'succeeded', resultId: 'result-1', activeAttemptId: null })
    expect(() => foldChanges([ownerlessAdmitted(), started(), running(), { ...terminal, events: [{ ...terminal.events[0], result: result({ workId: WorkId('work-other') }) }] }])).toThrow(/result.*work/i)
    expect(() => foldChanges([ownerlessAdmitted(), started(), running(), { ...terminal, events: [{ ...terminal.events[0], result: result({ kind: 'other@1' }) }] }])).toThrow(/result.*kind/i)
  })

  it('admits a homogeneous Batch and all member receipts atomically', () => {
    const first = work('work-1', { batchId: BatchId('batch-1') })
    const second = work('work-2', { batchId: BatchId('batch-1') })
    const change = {
      seq: 1, changeId: 'change-1', at: AT, events: [
        { type: 'batch/admitted', batch: batch() },
        { type: 'work/admitted', work: first }, { type: 'work/admitted', work: second },
        { type: 'receipt/recorded', receipt: receipt([first.id, second.id], { batchId: BatchId('batch-1') }) },
      ],
    }
    expect(foldChanges([change]).batchesById.get(BatchId('batch-1'))?.workIds).toEqual([WorkId('work-1'), WorkId('work-2')])
    expect(() => foldChanges([{ ...change, events: change.events.filter(event => event.type !== 'receipt/recorded') }])).toThrow(/receipt.*atomic/i)
    expect(() => foldChanges([{ ...change, events: change.events.map(event => event.type === 'work/admitted' && 'work' in event && event.work.id === WorkId('work-2') ? { ...event, work: { ...event.work, kind: 'other@1' } } : event) }])).toThrow(/batch.*kind|homogeneous/i)
  })

  it('records unknown and applies only confirmed failure or authorized retry', () => {
    const attention = { id: AttentionId('attention-unknown'), workId: WorkId('work-1'), kind: 'unknown' as const, status: 'pending' as const, createdAt: LATER, resolvedAt: null }
    const unknown = { seq: 4, changeId: 'change-4', at: LATER, events: [{ type: 'attempt/unknown', attemptId: AttemptId('attempt-1'), failure: failure({ sideEffect: 'unknown', retriable: false }), at: LATER }, { type: 'attention/created' as const, attention }] }
    const base = [admitted(), started(), running(), unknown]
    expect(foldChanges(base).statesByWorkId.get(WorkId('work-1'))?.status).toBe('unknown')

    const retry = { seq: 5, changeId: 'change-5', at: LATER, events: [{ type: 'unknown/resolved' as const, attemptId: AttemptId('attempt-1'), resolution: { kind: 'authorize-retry' as const }, at: LATER }, { type: 'attention/resolved' as const, attentionId: attention.id, at: LATER }] }
    expect(foldChanges([...base, retry]).statesByWorkId.get(WorkId('work-1'))?.status).toBe('queued')
    expect(() => foldChanges([...base, { ...retry, events: [retry.events[0]] }])).toThrow(/atomically resolve.*Attention/i)

    const notification = ownerNotification('notification-unknown-failed', AttemptId('attempt-1'), null, 5)
    const failed = { ...retry, events: [{ type: 'unknown/resolved' as const, attemptId: AttemptId('attempt-1'), resolution: { kind: 'confirm-failed' as const, failure: failure({ sideEffect: 'started', retriable: false }) }, at: LATER }, { type: 'attention/resolved' as const, attentionId: attention.id, at: LATER }, { type: 'notification/created' as const, notification }] }
    expect(foldChanges([...base, failed]).statesByWorkId.get(WorkId('work-1'))?.status).toBe('failed')
    expect(foldChanges([...base, failed]).notificationsById.get(notification.id)?.terminalSeq).toBe(5)
    expect(() => foldChanges([...base, { ...failed, events: [...failed.events.slice(0, 2), { type: 'notification/created' as const, notification: { ...notification, attemptId: AttemptId('other') } }] }])).toThrow(/invalid Notification|terminal attempt/i)

    const unsupported = { ...retry, events: [{ type: 'unknown/resolved' as const, attemptId: AttemptId('attempt-1'), resolution: { kind: 'reconcile' }, at: LATER }, { type: 'attention/resolved' as const, attentionId: attention.id, at: LATER }] }
    expect(() => foldChanges([...base, unsupported])).toThrow(/unsupported unknown resolution/i)
  })

  it('enforces cancel settlement and manual or automatic retry preconditions', () => {
    const cancel = { seq: 2, changeId: 'change-2', at: LATER, events: [{ type: 'cancel/requested', workId: WorkId('work-1'), at: LATER }, { type: 'work/canceled', workId: WorkId('work-1'), at: LATER }] }
    expect(foldChanges([ownerlessAdmitted(), cancel]).statesByWorkId.get(WorkId('work-1'))?.status).toBe('canceled')
    expect(() => foldChanges([ownerlessAdmitted(), { ...cancel, events: [cancel.events[1]] }])).toThrow(/cancel.*request/i)

    const failedAttempt = { seq: 4, changeId: 'change-4', at: LATER, events: [{ type: 'attempt/failed', attemptId: AttemptId('attempt-1'), failure: failure({ sideEffect: 'started' }), at: LATER }] }
    const manual = { seq: 5, changeId: 'change-5', at: LATER, events: [{ type: 'work/manual-retry-authorized', workId: WorkId('work-1'), at: LATER }] }
    expect(foldChanges([ownerlessAdmitted(), started(), running(), failedAttempt, manual]).statesByWorkId.get(WorkId('work-1'))?.status).toBe('queued')
    const ownerlessOneAttempt = work('work-1', { policy: { maxAttempts: 1 }, ownerSessionId: null })
    expect(foldChanges([admitted(1, ownerlessOneAttempt, receipt([ownerlessOneAttempt.id], { owner: { type: 'operator' } })), started(), running(), failedAttempt, manual, started(6, WorkId('work-1'), 2)]).statesByWorkId.get(WorkId('work-1'))).toMatchObject({ status: 'starting', attemptCount: 2 })
    expect(() => foldChanges([admitted(), { ...manual, seq: 2, changeId: 'invalid-manual' }])).toThrow(/manual retry.*failed/i)

    const unsafeAuto = { ...failedAttempt, events: [...failedAttempt.events, { type: 'work/auto-retry-authorized', workId: WorkId('work-1'), at: LATER }] }
    expect(() => foldChanges([ownerlessAdmitted(), started(), running(), unsafeAuto])).toThrow(/automatic retry.*not-started/i)
    const safeAuto = { ...unsafeAuto, events: [{ ...failedAttempt.events[0], failure: failure() }, unsafeAuto.events[1]] }
    expect(foldChanges([ownerlessAdmitted(), started(), running(), safeAuto]).statesByWorkId.get(WorkId('work-1'))?.status).toBe('queued')
  })

  it('cannot let a late cancellation overwrite a terminal outcome', () => {
    const succeeded = { seq: 4, changeId: 'change-4', at: LATER, events: [{ type: 'attempt/succeeded', attemptId: AttemptId('attempt-1'), result: result(), at: LATER }, { type: 'notification/created' as const, notification: ownerNotification('notification-success', AttemptId('attempt-1'), result().id, 4) }] }
    const cancel = { seq: 5, changeId: 'change-5', at: LATER, events: [{ type: 'cancel/requested', workId: WorkId('work-1'), at: LATER }, { type: 'work/canceled', workId: WorkId('work-1'), at: LATER }] }
    expect(() => foldChanges([admitted(), started(), running(), succeeded, cancel])).toThrow(/cannot request cancel|cannot cancel/i)
  })

  it('rehydrates a durable projection then folds only its tail', () => {
    const baseline = foldChanges([ownerlessAdmitted(), started(), running()])
    const restored = hydrateFoldedQueue(snapshotFoldedQueue(baseline))
    const terminal = { seq: 4, changeId: 'change-4', at: LATER, events: [{ type: 'attempt/succeeded', attemptId: AttemptId('attempt-1'), result: result(), at: LATER }] }
    expect(restored.lastSeq).toBe(3)
    applyChange(restored, terminal)
    expect(restored.statesByWorkId.get(WorkId('work-1'))?.status).toBe('succeeded')
  })

  it('folds independent Attention and Notification outboxes with CAS acknowledgement', () => {
    const attention = { id: AttentionId('attention-1'), workId: WorkId('work-1'), kind: 'failure', status: 'pending', createdAt: LATER, resolvedAt: null }
    const notification = ownerNotification('notification-1', AttemptId('attempt-1'), null, 4)
    const outbox = { seq: 4, changeId: 'change-4', at: LATER, events: [{ type: 'attempt/failed', attemptId: AttemptId('attempt-1'), failure: failure({ sideEffect: 'started' }), at: LATER }, { type: 'attention/created', attention }, { type: 'notification/created', notification }] }
    const ack = { seq: 5, changeId: 'change-5', at: LATER, events: [{ type: 'attention/resolved', attentionId: attention.id, at: LATER }, { type: 'notification/acknowledged', notificationId: notification.id, expectedMessageId: notification.messageId, at: LATER }] }
    const folded = foldChanges([admitted(), started(), running(), outbox, ack])
    expect(folded.attentionsById.get(attention.id)?.status).toBe('resolved')
    expect(folded.notificationsById.get(notification.id)?.status).toBe('acknowledged')
  })
})
