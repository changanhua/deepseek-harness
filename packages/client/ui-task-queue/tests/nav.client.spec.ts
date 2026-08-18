// @vitest-environment jsdom
/**
 * QueueNavEntry badge behavior: the hot failed badge reflects ONLY dismissed
 * failed tasks, so soft-concluding a failure clears the "N failed" hotspot
 * immediately. Covers the exact regression from the original analysis (the
 * "9 failures forever" badge).
 */
import { describe, expect, it } from 'vitest'
import { badgeFor } from '../src/client/QueueNavEntry.tsx'
import type { QueueSnapshot } from '../src/client/store.ts'
import type { LocaleKeysOf } from '@deepseek-ai/dsh-client-ui-slots'
import { en, type TaskQueueKey } from '../src/client/locales.ts'

const t = (key: LocaleKeysOf<'taskQueue'>): string => en[key as TaskQueueKey] ?? key

function snapshot(stats: QueueSnapshot['stats']): QueueSnapshot {
  return {
    stats,
    summaries: [],
    executors: [],
    selectedId: null,
    detail: null,
    loading: false,
    refreshing: false,
    error: null,
  }
}

describe('QueueNavEntry badgeFor', () => {
  it('is hot with the undismissed-failed count when some failures are not dismissed', () => {
    const stats = {
      serviceState: 'running',
      byStatus: { failed: 3, running: 0, pending: 0, starting: 0, stopping: 0, succeeded: 0, canceled: 0 },
      undismissedFailed: 2,
      byDismissed: 1,
    } as QueueSnapshot['stats']
    const badge = badgeFor(snapshot(stats), t)
    expect(badge?.kind).toBe('hot')
    expect(badge?.text).toContain('2')
  })

  it('is not hot when every failed task has been dismissed (undismissedFailed = 0)', () => {
    const stats = {
      serviceState: 'running',
      byStatus: { failed: 3, running: 0, pending: 0, starting: 0, stopping: 0, succeeded: 0, canceled: 0 },
      undismissedFailed: 0,
      byDismissed: 3,
    } as QueueSnapshot['stats']
    const badge = badgeFor(snapshot(stats), t)
    // All failures concluded: no hot "failed" hotspot — this is the bug being fixed.
    expect(badge?.kind).not.toBe('hot')
  })

  it('is hot when the service is faulted regardless of counts', () => {
    const stats = {
      serviceState: 'faulted',
      byStatus: { failed: 0, running: 0, pending: 0, starting: 0, stopping: 0, succeeded: 0, canceled: 0 },
      undismissedFailed: 0,
      byDismissed: 0,
    } as QueueSnapshot['stats']
    expect(badgeFor(snapshot(stats), t)?.kind).toBe('hot')
  })

  it('falls back to idle when no live-or-attention work exists', () => {
    const stats = {
      serviceState: 'running',
      byStatus: { failed: 0, running: 0, pending: 0, starting: 0, stopping: 0, succeeded: 1, canceled: 0 },
      undismissedFailed: 0,
      byDismissed: 0,
    } as QueueSnapshot['stats']
    expect(badgeFor(snapshot(stats), t)?.kind).toBe('plain')
  })
})
