import { describe, expect, it } from 'vitest'
import type { QueueWorkSummaryView } from '@changanhua/dsh-task-queue-remote/views'
import {
  countQueueRows, dotFor, projectQueueRows, queueAge,
} from '../src/client/view-model.ts'

/** One summary row with the required projection fields defaulted. */
function row(partial: Partial<QueueWorkSummaryView> & { id: string }): QueueWorkSummaryView {
  return {
    kind: 'agent.run@1',
    title: partial.id,
    status: 'queued',
    state: 'queued',
    outcome: null,
    attemptCount: 0,
    maxAttempts: 3,
    batchId: null,
    ownerSessionId: null,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
    ...partial,
  }
}

describe('projectQueueRows', () => {
  // Passed in reverse urgency order to prove the projection reorders.
  const rows: readonly QueueWorkSummaryView[] = [
    row({ id: 'done-old', state: 'done', outcome: 'failed', title: 'Old cleanup', updatedAt: '2026-08-27T08:00:00.000Z' }),
    row({ id: 'done-new', state: 'done', outcome: 'succeeded', title: 'Generate REPORT', updatedAt: '2026-08-27T09:00:00.000Z' }),
    row({ id: 'queued-1', state: 'queued', updatedAt: '2026-08-27T07:00:00.000Z' }),
    row({ id: 'running-1', state: 'running', status: 'running', updatedAt: '2026-08-27T06:00:00.000Z' }),
    row({ id: 'attention-1', state: 'attention', status: 'unknown', updatedAt: '2026-08-27T05:00:00.000Z' }),
  ]

  it('orders attention before running, queued, then done with newer done first', () => {
    expect(projectQueueRows(rows, 'all', '').map(r => r.id)).toEqual([
      'attention-1',
      'running-1',
      'queued-1',
      'done-new',
      'done-old',
    ])
  })

  it('keeps only queued and running rows for the active filter', () => {
    expect(projectQueueRows(rows, 'active', '').map(r => r.id)).toEqual(['running-1', 'queued-1'])
  })

  it('keeps only attention rows for the attention filter', () => {
    expect(projectQueueRows(rows, 'attention', '').map(r => r.id)).toEqual(['attention-1'])
  })

  it('keeps every done row for the done filter regardless of outcome', () => {
    expect(projectQueueRows(rows, 'done', '').map(r => r.id)).toEqual(['done-new', 'done-old'])
  })

  it('searches title and id case-insensitively', () => {
    expect(projectQueueRows(rows, 'all', 'REPORT').map(r => r.id)).toEqual(['done-new'])
    expect(projectQueueRows(rows, 'all', 'RUNNING-1').map(r => r.id)).toEqual(['running-1'])
  })

  it('does not mutate the Remote array', () => {
    const original = rows.map(r => r.id)
    projectQueueRows(rows, 'all', '')
    expect(rows.map(r => r.id)).toEqual(original)
  })
})

describe('countQueueRows', () => {
  const rows: readonly QueueWorkSummaryView[] = [
    row({ id: 'attention-1', state: 'attention', status: 'unknown' }),
    row({ id: 'running-1', state: 'running', status: 'running' }),
    row({ id: 'queued-1', state: 'queued' }),
    row({ id: 'done-a', state: 'done', outcome: 'succeeded' }),
    row({ id: 'done-b', state: 'done', outcome: 'failed' }),
  ]

  it('counts every filter from the same rows', () => {
    expect(countQueueRows(rows)).toEqual({ all: 5, active: 2, attention: 1, done: 2 })
  })

  it('counts an empty queue as all zeros', () => {
    expect(countQueueRows([])).toEqual({ all: 0, active: 0, attention: 0, done: 0 })
  })
})

describe('queueAge', () => {
  const NOW_MS = Date.parse('2026-08-27T12:00:00.000Z')
  function ageAgo(ms: number): string {
    return new Date(NOW_MS - ms).toISOString()
  }

  it('reports seconds below one minute', () => {
    expect(queueAge(ageAgo(59_000), NOW_MS)).toEqual({ value: 59, unit: 'seconds' })
  })

  it('promotes to minutes at 60 seconds', () => {
    expect(queueAge(ageAgo(60_000), NOW_MS)).toEqual({ value: 1, unit: 'minutes' })
  })

  it('reports minutes below one hour', () => {
    expect(queueAge(ageAgo(59 * 60_000), NOW_MS)).toEqual({ value: 59, unit: 'minutes' })
  })

  it('promotes to hours at 60 minutes', () => {
    expect(queueAge(ageAgo(60 * 60_000), NOW_MS)).toEqual({ value: 1, unit: 'hours' })
  })

  it('reports hours below one day', () => {
    expect(queueAge(ageAgo(23 * 60 * 60_000), NOW_MS)).toEqual({ value: 23, unit: 'hours' })
  })

  it('promotes to days at 24 hours', () => {
    expect(queueAge(ageAgo(24 * 60 * 60_000), NOW_MS)).toEqual({ value: 1, unit: 'days' })
  })

  it('clamps a future timestamp to zero seconds', () => {
    expect(queueAge(new Date(NOW_MS + 60_000).toISOString(), NOW_MS)).toEqual({ value: 0, unit: 'seconds' })
  })
})

describe('dotFor', () => {
  it('maps queued to the warning dot', () => {
    expect(dotFor(row({ id: 'q', state: 'queued' }))).toBe('warning')
  })

  it('maps running to the ongoing dot', () => {
    expect(dotFor(row({ id: 'r', state: 'running', status: 'running' }))).toBe('ongoing')
  })

  it('maps attention to the error dot', () => {
    expect(dotFor(row({ id: 'a', state: 'attention', status: 'unknown' }))).toBe('error')
  })

  it('maps done plus succeeded to the done dot', () => {
    expect(dotFor(row({ id: 's', state: 'done', outcome: 'succeeded' }))).toBe('done')
  })

  it('maps done plus failed to the error dot', () => {
    expect(dotFor(row({ id: 'f', state: 'done', outcome: 'failed' }))).toBe('error')
  })

  it('maps done plus canceled to the warning dot', () => {
    expect(dotFor(row({ id: 'c', state: 'done', outcome: 'canceled' }))).toBe('warning')
  })

  it('rejects a terminal row without a terminal outcome', () => {
    expect(() => dotFor(row({ id: 'x', state: 'done', outcome: null })))
      .toThrow('Queue done row requires an outcome')
  })
})
