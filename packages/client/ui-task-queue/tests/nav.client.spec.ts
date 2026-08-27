// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { LocaleKeysOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { QueueStatsView, QueueWorkStatus } from '@deepseek-ai/dsh-task-queue-remote/views'
import { badgeFor } from '../src/client/QueueNavEntry.tsx'
import { en, type TaskQueueKey } from '../src/client/locales.ts'
import type { QueueSnapshot } from '../src/client/store.ts'

const t = (key: LocaleKeysOf<'taskQueue'>): string => en[key as TaskQueueKey] ?? key

function stats(values: Partial<Record<QueueWorkStatus, number>> = {}, paused = false): QueueStatsView {
  return {
    paused,
    byStatus: {
      queued: 0, starting: 0, running: 0, unknown: 0, succeeded: 0, failed: 0, canceled: 0,
      ...values,
    },
    byKind: {},
  }
}

function snapshot(queueStats: QueueStatsView): QueueSnapshot {
  return {
    stats: queueStats,
    rows: [],
    selectedId: null,
    detail: null,
    loading: false,
    refreshing: false,
    error: null,
    lastSuccessfulRefreshAt: null,
  }
}

describe('QueueNavEntry badgeFor', () => {
  it('is hot with the combined failed and unknown attention count', () => {
    const badge = badgeFor(snapshot(stats({ failed: 2, unknown: 1 })), t)
    expect(badge).toMatchObject({ kind: 'hot' })
    expect(badge?.text).toContain('3')
  })

  it('reports running work without presenting an attention hotspot', () => {
    expect(badgeFor(snapshot(stats({ running: 2 })), t)).toMatchObject({ kind: 'idle' })
  })

  it('reports a paused empty Queue as plain status', () => {
    expect(badgeFor(snapshot(stats({}, true)), t)).toEqual({ text: 'paused', kind: 'plain' })
  })

  it('falls back to idle when no live or attention work exists', () => {
    expect(badgeFor(snapshot(stats({ succeeded: 1 })), t)?.kind).toBe('plain')
  })
})
