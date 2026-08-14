import { describe, expect, it } from 'vitest'
import { NotificationId, RunId, TaskId } from '../src/brand.ts'
import { canonicalJson, canonicalQueueState } from '../src/canonical.ts'
import type { FoldedQueue } from '../src/fold.ts'
import type { NotificationRecord, Task } from '../src/types.ts'

describe('canonicalJson', () => {
  it('sorts object keys by Unicode code point recursively', () => {
    expect(canonicalJson({ b: 1, a: 2, c: { y: 1, x: 2 } })).toBe('{"a":2,"b":1,"c":{"x":2,"y":1}}')
  })

  it('produces no extra whitespace', () => {
    expect(canonicalJson({ a: [1, 2, 3], b: 'x' })).toBe('{"a":[1,2,3],"b":"x"}')
  })

  it('preserves array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
  })

  it('sorts keys by code point, not insertion', () => {
    const a = { zebra: 1, Apple: 2, 'Éclair': 3 }
    // 'A'(65) < 'z'(122) < 'É'(U+00C9=201) by Unicode code point.
    expect(canonicalJson(a)).toBe('{"Apple":2,"zebra":1,"Éclair":3}')
  })

  it('drops undefined object values like JSON.stringify', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
  })
})

function makeTask(id: string): Task {
  return {
    id: TaskId(id),
    title: 't',
    prompt: 'p',
    executor: 'shell',
    status: 'pending',
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
  }
}

function makeNotification(id: string): NotificationRecord {
  return {
    notificationId: NotificationId(id),
    taskId: TaskId('tq-1'),
    runId: RunId('run-1'),
    attempt: 1,
    terminalSeq: 2,
    ownerSessionId: 'sess-1',
    messageId: 'msg-1',
    status: 'pending',
    acknowledgedAt: null,
  }
}

describe('canonicalQueueState', () => {
  it('is deterministic regardless of map insertion order', () => {
    const build = (order: string[], notes: string[]): FoldedQueue => {
      const tasksById = new Map()
      for (const id of order) tasksById.set(TaskId(id), makeTask(id))
      const notificationsById = new Map()
      for (const id of notes) notificationsById.set(NotificationId(id), makeNotification(id))
      return { tasksById, notificationsById, lastSeq: 3 }
    }

    const a = build(['tq-2', 'tq-1', 'tq-3'], ['n-2', 'n-1'])
    const b = build(['tq-3', 'tq-1', 'tq-2'], ['n-1', 'n-2'])

    expect(canonicalQueueState(a)).toBe(canonicalQueueState(b))
  })

  it('sorts tasks and notifications by id ascending', () => {
    const folded: FoldedQueue = {
      tasksById: new Map([
        [TaskId('tq-2'), makeTask('tq-2')],
        [TaskId('tq-1'), makeTask('tq-1')],
      ]),
      notificationsById: new Map([[NotificationId('n-1'), makeNotification('n-1')]]),
      lastSeq: 3,
    }
    const out = canonicalQueueState(folded)
    // notifications object key sorts before tasks; within tasks, tq-1 precedes tq-2.
    expect(out.indexOf('"notifications":')).toBeLessThan(out.indexOf('"tasks":'))
    expect(out.indexOf('"id":"tq-1"')).toBeLessThan(out.indexOf('"id":"tq-2"'))
  })
})
