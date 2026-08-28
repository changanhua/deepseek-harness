import { describe, expect, it } from 'vitest'
import { NotificationId, RunId, TaskId } from '../src/brand.ts'
import { foldChanges } from '../src/fold.ts'
import type { ChangeRecord, NotificationRecord, Task } from '../src/types.ts'

function task(id: string, status: Task['status'] = 'pending', extra: Partial<Task> = {}): Task {
  return {
    id: TaskId(id),
    title: 't',
    prompt: 'p',
    executor: 'shell',
    status,
    priority: 10,
    attempt: 0,
    maxAttempts: 3,
    backoffMs: 1000,
    delayUntil: null,
    timeoutMs: 1000,
    outputDir: '/out',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastError: null,
    result: null,
    ownerSessionId: null,
    source: 'tool',
    receiptId: 'tool:auto:1',
    terminalSeq: null,
    runs: [],
    dismissed: false,
    ...extra,
  }
}

function notification(id: string, taskId: string, messageId: string, status: 'pending' | 'acknowledged' = 'pending'): NotificationRecord {
  return {
    notificationId: NotificationId(id),
    taskId: TaskId(taskId),
    runId: RunId('run-1'),
    attempt: 1,
    terminalSeq: 2,
    ownerSessionId: 'sess-1',
    messageId,
    status,
    acknowledgedAt: null,
  }
}

function taskOp(seq: number, task: Task, notification?: NotificationRecord): Extract<ChangeRecord, { taskId: TaskId }> {
  return {
    seq,
    version: 1,
    op: 'created',
    taskId: task.id,
    state: task,
    ...(notification !== undefined ? { notification } : {}),
    at: '2026-01-01T00:00:00.000Z',
  }
}

describe('foldChanges', () => {
  it('folds an empty input to an empty queue with lastSeq 0', () => {
    const f = foldChanges([])
    expect(f.lastSeq).toBe(0)
    expect(f.tasksById.size).toBe(0)
    expect(f.notificationsById.size).toBe(0)
  })

  it('folds a normal created sequence', () => {
    const f = foldChanges([taskOp(1, task('tq-1'))])
    expect(f.lastSeq).toBe(1)
    expect(f.tasksById.get(TaskId('tq-1'))!.status).toBe('pending')
  })

  it('rejects a seq gap', () => {
    expect(() => foldChanges([taskOp(1, task('tq-1')), taskOp(3, task('tq-2'))])).toThrow(/seq 3 out of order; expected 2/)
  })

  it('rejects a duplicate seq', () => {
    expect(() => foldChanges([taskOp(1, task('tq-1')), taskOp(1, task('tq-2'))])).toThrow(/seq 1 out of order; expected 2/)
  })

  it('rejects out-of-order (non-consecutive) first seq', () => {
    expect(() => foldChanges([taskOp(5, task('tq-1'))])).toThrow(/seq 5 out of order; expected 1/)
  })

  it('defaults a missing `dismissed` field to false for records written before the flag existed', () => {
    // Old durable records (pre-dismiss) carry no `dismissed`; the fold must not
    // hand the projection a value of `undefined`, which the gateway rejects as
    // non-JSON-safe. Semantically a record without the flag was never dismissed.
    const t = task('tq-1')
    const { dismissed: _omitDismissed, ...legacy } = t as Task & { dismissed?: boolean }
    expect(Object.hasOwn(legacy, 'dismissed')).toBe(false)
    const f = foldChanges([taskOp(1, legacy as Task)])
    expect(f.tasksById.get(TaskId('tq-1'))!.dismissed).toBe(false)
  })

  it('defaults a missing workspace to the artifact directory for legacy records', () => {
    const f = foldChanges([taskOp(1, task('tq-1'))])
    expect(f.tasksById.get(TaskId('tq-1'))!.workspaceDir).toBe('/out')
  })

  it('rejects a task op whose state.taskId mismatches change.taskId', () => {
    const t = task('tq-1')
    const bad: ChangeRecord = { ...taskOp(1, t), taskId: TaskId('tq-2') }
    expect(() => foldChanges([bad])).toThrow(/does not match change taskId/)
  })

  it('keeps a terminal notification and rejects a duplicate notification id', () => {
    const t1 = task('tq-1', 'succeeded')
    const n = notification('n-1', 'tq-1', 'msg-1')
    const f = foldChanges([{ ...taskOp(1, t1, n), op: 'succeeded', notification: n }])
    expect(f.notificationsById.get(NotificationId('n-1'))!.messageId).toBe('msg-1')

    const t2 = task('tq-2', 'succeeded')
    const n2 = notification('n-1', 'tq-2', 'msg-2') // same notification id, different task
    expect(() => foldChanges([
      { ...taskOp(1, t1, n), op: 'succeeded', notification: n },
      { ...taskOp(2, t2, n2), op: 'succeeded', notification: n2 },
    ])).toThrow(/duplicate notification id n-1/)
  })

  it('rejects a terminal notification whose taskId mismatches', () => {
    const t = task('tq-1', 'succeeded')
    const n = notification('n-1', 'tq-OTHER', 'msg-1')
    expect(() => foldChanges([{ ...taskOp(1, t, n), op: 'succeeded', notification: n }]))
      .toThrow(/does not match change taskId/)
  })

  describe('ack semantics', () => {
    const pendingTask = task('tq-1', 'succeeded')
    const n = notification('n-1', 'tq-1', 'msg-1')
    const base: ChangeRecord = { ...taskOp(1, pendingTask, n), op: 'succeeded', notification: n }
    const ack: ChangeRecord = {
      seq: 2,
      version: 1,
      op: 'notification-acknowledged',
      notificationId: NotificationId('n-1'),
      expectedStatus: 'pending',
      expectedMessageId: 'msg-1',
      state: { ...n, status: 'acknowledged', acknowledgedAt: '2026-01-01T00:00:01.000Z' },
      at: '2026-01-01T00:00:01.000Z',
    }

    it('acks a pending notification matching messageId', () => {
      const f = foldChanges([base, ack])
      expect(f.notificationsById.get(NotificationId('n-1'))!.status).toBe('acknowledged')
    })

    it('is idempotent for a repeated ack of an already-acknowledged matching notification', () => {
      const dup: ChangeRecord = { ...ack, seq: 3 }
      const f2 = foldChanges([base, ack, dup])
      expect(f2.notificationsById.get(NotificationId('n-1'))!.status).toBe('acknowledged')
    })

    it('rejects an ack with a mismatched messageId', () => {
      const bad: ChangeRecord = { ...ack, expectedMessageId: 'msg-WRONG' }
      expect(() => foldChanges([base, bad])).toThrow(/messageId/)
    })

    it('rejects an ack of an unknown notification', () => {
      const unknown: ChangeRecord = { ...ack, notificationId: NotificationId('n-unknown') }
      expect(() => foldChanges([base, unknown])).toThrow(/unknown notification/)
    })

    it('rejects a late ack whose messageId mismatches the already-acknowledged record', () => {
      const late: ChangeRecord = { ...ack, seq: 3, expectedMessageId: 'msg-WRONG' }
      expect(() => foldChanges([base, ack, late])).toThrow(/messageId/)
    })
  })
})
