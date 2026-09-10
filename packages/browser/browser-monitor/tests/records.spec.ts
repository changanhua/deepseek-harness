import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { acknowledgeNotice, acceptFailure, acceptSample, createRecord, selectDue } from '../src/records.ts'
import type { CreateMonitor, MonitorCheck, MonitorRecord, MonitorSample } from '../src/types.ts'

const create = (overrides: Partial<CreateMonitor> = {}): CreateMonitor => ({
  requestId: randomUUID(), sessionId: 'session', installationId: randomUUID(), title: '监控', url: 'https://example.test',
  intervalMs: 1000, missedPolicy: 'latest', match: { kind: 'changed' }, ...overrides,
})
const sample = (digest: string, matched = false): MonitorSample => ({
  digest, matched, sampledAt: 1000, page: { tabId: 1, frameId: 0, documentId: 'document', url: 'https://example.test' },
})
function due(record: MonitorRecord, now: number): { record: MonitorRecord; check: MonitorCheck } {
  // The Queue terminal handler clears this durable handoff after consuming the cached result.
  const settled = record.settlement === null ? record : { ...record, settlement: null }
  const selected = selectDue(settled, now)
  if (selected.check === null) throw new Error('missing due check')
  return { record: selected.record, check: selected.check }
}
const hash = (letter: string) => letter.repeat(64)
function baseline(record: MonitorRecord, value: MonitorSample): MonitorRecord {
  const selected = due(record, 0)
  return acceptSample(selected.record, selected.check, value, 0)
}

describe('monitor records', () => {
  it('preserves create identity and deduplicates an already hydrated slot', () => {
    const input = create(); const record = createRecord(input, 1, 0); const selected = due(record, 0)
    const accepted = acceptSample(selected.record, selected.check, sample(hash('a')), 0)
    const restored = structuredClone(accepted)
    expect(createRecord(input, 1, 0)).toMatchObject({ id: input.requestId, createDigest: record.createDigest, anchorAt: 0 })
    expect(acceptSample(restored, selected.check, sample(hash('b')), 1)).toBe(restored)
    expect(accepted.settlement).toMatchObject({ revision: selected.check.revision, slot: selected.check.slot, workId: null, failure: null })
    const condition = create({ match: { kind: 'appears', text: 'x' } })
    expect(createRecord(condition, 1, 0).createDigest)
      .not.toBe(createRecord({ ...condition, match: { kind: 'disappears', text: 'y' } }, 1, 0).createDigest)
  })

  it('keeps baseline silent and reports changed and edge transitions once', () => {
    const initial = baseline(createRecord(create(), 1, 0), sample(hash('a')))
    const changed = due(initial, 1000)
    const observed = acceptSample(changed.record, changed.check, sample(hash('b')), 1000)
    expect(initial.outbox).toEqual([])
    expect(observed.outbox.map(notice => notice.kind)).toEqual(['changed'])

    const appears = createRecord(create({ match: { kind: 'appears', text: 'x' } }), 1, 0)
    const absent = baseline(appears, sample(hash('c'), false))
    const edge = due(absent, 1000)
    expect(acceptSample(edge.record, edge.check, sample(hash('d'), true), 1000).outbox[0]?.kind).toBe('changed')
    const disappears = createRecord(create({ match: { kind: 'disappears', text: 'x' } }), 1, 0)
    const present = baseline(disappears, sample(hash('e'), true))
    const disappeared = due(present, 1000)
    expect(acceptSample(disappeared.record, disappeared.check, sample(hash('f'), false), 1000).outbox[0]?.kind).toBe('changed')
  })

  it('retains samples through failures and emits one recovered notice', () => {
    const initial = baseline(createRecord(create(), 1, 0), sample(hash('a')))
    const failed = due(initial, 1000)
    const failure = { code: 'offline', message: 'offline', at: 1000 }
    const one = acceptFailure(failed.record, failed.check, failure, 1000)
    expect(one.settlement).toMatchObject({ revision: failed.check.revision, slot: failed.check.slot, workId: null, failure })
    const repeated = due(one, 2000)
    const two = acceptFailure(repeated.record, repeated.check, failure, 2000)
    expect(two.lastSample).toEqual(initial.lastSample)
    expect(two.outbox.filter(notice => notice.kind === 'failed')).toHaveLength(1)
    const recovered = due(two, 3000)
    expect(acceptSample(recovered.record, recovered.check, sample(hash('a')), 3000).outbox.map(notice => notice.kind)).toContain('recovered')
    const firstFailure = due(createRecord(create(), 1, 0), 0)
    const failedFirst = acceptFailure(firstFailure.record, firstFailure.check, { code: 'x', message: 'x', at: 0 }, 0)
    const firstRecovery = due(failedFirst, 1000)
    expect(acceptSample(firstRecovery.record, firstRecovery.check, sample(hash('z')), 1000).outbox.map(notice => notice.kind)).toEqual(['failed', 'recovered'])
  })

  it('completes one-shot plans and rejects stale or paused results', () => {
    const oneShot = due(createRecord(create({ intervalMs: null }), 1, 0), 0)
    const completed = acceptSample(oneShot.record, oneShot.check, sample(hash('a')), 0)
    expect(completed).toMatchObject({ enabled: false, outbox: [expect.objectContaining({ kind: 'completed' })] })
    const paused = { ...oneShot.record, enabled: false }
    expect(acceptSample(paused, oneShot.check, sample(hash('b')), 1)).toBe(paused)
    expect(acceptFailure(oneShot.record, { ...oneShot.check, revision: randomUUID() }, { code: 'x', message: 'x', at: 1 }, 1)).toBe(oneShot.record)
  })

  it('blocks new admission until the Queue terminal handler clears settlement', () => {
    const selected = due(createRecord(create(), 1, 0), 0)
    const accepted = acceptSample(selected.record, selected.check, sample(hash('a')), 0)
    expect(selectDue(accepted, 1000).check).toBeNull()
    expect(selectDue({ ...accepted, settlement: null }, 1000).check).not.toBeNull()
    expect(acceptSample(accepted, selected.check, sample(hash('b')), 1)).toBe(accepted)
  })

  it('coalesces latest, skips overdue slots, and preserves full outboxes until acknowledged', () => {
    const latest = createRecord(create(), 1, 0)
    expect(due(latest, 3500).check.slot).toBe(3000)
    const skip = createRecord(create({ missedPolicy: 'skip' }), 1, 0)
    expect(selectDue(skip, 1000).check).toBeNull()
    const full = { ...latest, outbox: Array.from({ length: 32 }, () => ({
      id: randomUUID(), monitorId: latest.id, sessionId: latest.sessionId, installationId: latest.installationId,
      kind: 'changed' as const, title: latest.title, message: 'x', createdAt: 0, slot: 0,
    })) }
    expect(selectDue(full, 0).check).toBeNull()
    const first = full.outbox[0]
    if (first === undefined) throw new Error('missing notice')
    expect(selectDue(acknowledgeNotice(full, first.id), 0).check).not.toBeNull()
    const blocked = { ...latest, outbox: full.outbox.slice(0, 31), lastFailure: { code: 'x', message: 'x', at: 0 }, lastSample: sample(hash('a')) }
    expect(selectDue(blocked, 0).check).toBeNull()
    const room = due({ ...latest, outbox: full.outbox.slice(0, 30), lastFailure: { code: 'x', message: 'x', at: 0 }, lastSample: sample(hash('a')) }, 0)
    expect(acceptSample(room.record, room.check, sample(hash('b')), 0).outbox).toHaveLength(32)
    expect(due(createRecord(create({ firstDueAt: 2500 }), 1, 0), 2500).check.slot).toBe(2500)
  })
})
