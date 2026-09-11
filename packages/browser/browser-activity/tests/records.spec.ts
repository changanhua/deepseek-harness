import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { appendActivity, configureActivity, pruneActivity } from '../src/records.ts'
import { ActivityRecordSchema } from '../src/schemas.ts'
import type { ActivityBatch, ActivityEvent, ActivityRecord, ActivitySettings } from '../src/types.ts'

const now = 10 * 86400000
const settings = (patch: Partial<ActivitySettings> = {}): ActivitySettings => ({
  enabled: true, sessionId: 'session-a', origins: ['https://example.test'], kinds: ['visit', 'dwell', 'dom-change'],
  minIntervalMs: 1000, retentionDays: 7, maxEvents: 100, maxTextChars: 100, ...patch,
})
const record = (patch: Partial<ActivitySettings> = {}) => configureActivity(randomUUID(), settings(patch), 1, undefined, now)
const event = (patch: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: randomUUID(), kind: 'visit', at: now, tabId: 1, url: 'https://example.test/article', title: 'Article', ...patch,
})
const batch = (value: ActivityRecord, events = [event()]): ActivityBatch => ({
  id: randomUUID(), revision: value.policy.revision, sequence: value.sequence + 1, events,
})

describe('bounded browser activity', () => {
  it('replays only identical last batches after a storage reload', () => {
    const value = record(); const input = batch(value)
    const accepted = appendActivity(value, input, 1, now)
    const restored = ActivityRecordSchema.parse(JSON.parse(JSON.stringify(accepted)))
    expect(appendActivity(restored, input, 1, now)).toBe(restored)
    expect(restored.events).toHaveLength(1)
    expect(restored.lastBatch?.accepted).toBe(1)
    expect(() => appendActivity(restored, { ...input, events: [event({ title: 'changed' })] }, 1, now)).toThrow('activity_batch_conflict')
    expect(() => appendActivity(restored, { ...batch(restored), sequence: 3 }, 1, now)).toThrow('activity_sequence_mismatch')
  })

  it('invalidates buffered uploads on pause, resumption, or grant changes', () => {
    const value = record(); const input = batch(value)
    const paused = configureActivity(value.installationId, settings({ enabled: false }), 1, value, now)
    expect(() => appendActivity(paused, input, 1, now)).toThrow('activity_policy_changed')
    const resumed = configureActivity(value.installationId, settings(), 1, paused, now)
    expect(() => appendActivity(resumed, input, 1, now)).toThrow('activity_policy_changed')
    expect(() => appendActivity(value, input, 2, now)).toThrow('activity_policy_changed')
  })

  it.each([
    { url: 'https://elsewhere.test' }, { text: 'x'.repeat(101) }, { at: now + 5001 },
  ])('rejects an entire mixed batch outside the policy: %j', (patch) => {
    const value = record()
    expect(() => appendActivity(value, batch(value, [event(), event(patch)]), 1, now)).toThrow('activity_outside_policy')
    expect(value.events).toEqual([])
    expect(value.sequence).toBe(0)
  })

  it('does not accept unselected event kinds, credentials, wildcard origins, or implicit body collection', () => {
    const value = record({ kinds: ['visit'], maxTextChars: 0 })
    expect(() => appendActivity(value, batch(value, [event({ kind: 'dwell' })]), 1, now)).toThrow('activity_outside_policy')
    expect(() => appendActivity(value, batch(value, [event({ text: 'body' })]), 1, now)).toThrow('activity_outside_policy')
    expect(() => appendActivity(value, batch(value, [event({ url: 'https://u:p@example.test' })]), 1, now)).toThrow()
    expect(() => record({ origins: ['*'] })).toThrow()
    expect(() => record({ origins: ['https://example.test', 'https://example.test'] })).toThrow('invalid_activity_policy')
  })

  it('bounds frequency independently for each tab and event kind', () => {
    const value = record()
    const accepted = appendActivity(value, batch(value, [event(), event({ at: now + 500 }),
      event({ tabId: 2 }), event({ kind: 'dwell', durationMs: 1200 }), event({ at: now + 1000 })]), 1, now + 1000)
    expect(accepted.events).toHaveLength(4)
    expect(accepted.lastBatch?.accepted).toBe(4)
  })

  it('retains session and grant provenance and expires records while paused', () => {
    const value = record({ retentionDays: 1 })
    const accepted = appendActivity(value, batch(value), 1, now)
    expect(accepted.events[0]).toMatchObject({ sessionId: 'session-a', receivedAt: now, grantEpoch: 1 })
    const paused = configureActivity(value.installationId, settings({ enabled: false, retentionDays: 1 }), 2, accepted, now)
    expect(paused.events[0]?.grantEpoch).toBe(1)
    expect(pruneActivity(paused, now + 86400001).events).toEqual([])
  })

  it('keeps both event count and UTF-8 bytes bounded', () => {
    let value = record({ maxEvents: 2000, maxTextChars: 4000 })
    for (let i = 0; i < 24; i += 1) {
      value = appendActivity(value, batch(value, Array.from({ length: 32 }, (_, j) => event({
        tabId: i * 32 + j, text: '汉'.repeat(4000),
      }))), 1, now)
    }
    expect(value.events.length).toBeGreaterThan(100)
    expect(value.events.length).toBeLessThan(768)
    expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThanOrEqual(4 * 1024 * 1024)
    const limited = configureActivity(value.installationId, settings({ maxEvents: 10 }), 1, value, now)
    expect(limited.events).toHaveLength(10)
  })
})
