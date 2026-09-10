import { createHash, randomUUID } from 'node:crypto'
import type { CreateMonitor, MonitorCheck, MonitorFailure, MonitorNotice, MonitorRecord, MonitorSample } from './types.ts'

const OUTBOX_CAPACITY = 32

/** Construct one detached monitor record with its immutable create identity. */
export function createRecord(input: CreateMonitor, grantEpoch: number, now: number): MonitorRecord {
  const fixed = structuredClone(input)
  const anchorAt = fixed.firstDueAt ?? now
  return {
    id: fixed.requestId, createDigest: digest(fixed), revision: randomUUID(), sessionId: fixed.sessionId,
    installationId: fixed.installationId, grantEpoch, title: fixed.title, url: fixed.url, intervalMs: fixed.intervalMs,
    missedPolicy: fixed.missedPolicy, match: fixed.match, enabled: true, createdAt: now, anchorAt,
    nextDue: fixed.firstDueAt ?? now, pending: null, settlement: null,
    lastCompletedSlot: null, lastSample: null, lastFailure: null, outbox: [],
  }
}

/** Select at most one due slot without replaying an overdue series. */
export function selectDue(record: MonitorRecord, now: number): { record: MonitorRecord; check: MonitorCheck | null } {
  const next = structuredClone(record)
  if (!next.enabled || next.pending !== null || next.settlement !== null || !hasNotificationCapacity(next) || next.nextDue > now) {
    return { record: next, check: null }
  }
  const slot = dueSlot(next, now)
  if (next.intervalMs !== null && next.missedPolicy === 'skip' && now - next.nextDue >= next.intervalMs) {
    next.nextDue = nextAfter(next, now)
    return { record: next, check: null }
  }
  next.pending = { revision: next.revision, slot, workId: null, recoveries: 0 }
  return { record: next, check: { monitorId: next.id, revision: next.revision, slot } }
}

/** Reserve all notices one check could produce, including an overlapping change and recovery. */
export function hasNotificationCapacity(record: MonitorRecord): boolean {
  const required = Math.max(1,
    Number(record.intervalMs === null) + Number(record.lastSample !== null) + Number(record.lastFailure !== null))
  return record.outbox.length + required <= OUTBOX_CAPACITY
}

/** Accept one matching sample exactly once and derive bounded owner notifications. */
export function acceptSample(record: MonitorRecord, check: MonitorCheck, sample: MonitorSample, now: number): MonitorRecord {
  if (!matches(record, check)) return record
  const notices = sampleNotices(record, sample)
  if (record.outbox.length + notices.length > OUTBOX_CAPACITY) return record
  const next = structuredClone(record)
  const pending = next.pending
  if (pending === null) return record
  next.lastSample = structuredClone(sample); next.lastFailure = null; next.lastCompletedSlot = check.slot
  next.settlement = { revision: pending.revision, slot: pending.slot, workId: pending.workId, recoveries: 0, failure: null }
  next.pending = null
  if (next.intervalMs === null) next.enabled = false
  else next.nextDue = nextAfter(next, now)
  for (const entry of notices) notice(next, entry.kind, entry.message, check.slot, now)
  return next
}

/** Record a matching failure without corrupting the last accepted sample. */
export function acceptFailure(record: MonitorRecord, check: MonitorCheck, failure: MonitorFailure, now: number): MonitorRecord {
  if (!matches(record, check) || record.outbox.length >= OUTBOX_CAPACITY) return record
  const next = structuredClone(record)
  const pending = next.pending
  if (pending === null) return record
  if (next.lastFailure === null || next.lastFailure.code !== failure.code) notice(next, 'failed', failure.message, check.slot, now)
  next.lastFailure = structuredClone(failure); next.lastCompletedSlot = check.slot
  next.settlement = {
    revision: pending.revision, slot: pending.slot, workId: pending.workId,
    recoveries: 0, failure: structuredClone(failure),
  }
  next.pending = null
  if (next.intervalMs === null) next.enabled = false
  else next.nextDue = nextAfter(next, now)
  return next
}

/** Acknowledge only one already-created owner notification. */
export function acknowledgeNotice(record: MonitorRecord, id: string): MonitorRecord {
  if (!record.outbox.some(notice => notice.id === id)) return record
  return { ...structuredClone(record), outbox: record.outbox.filter(notice => notice.id !== id) }
}

function matches(record: MonitorRecord, check: MonitorCheck): boolean {
  return record.enabled && record.revision === check.revision
    && record.pending?.slot === check.slot && record.pending.revision === check.revision
    && record.lastCompletedSlot !== check.slot
}
function dueSlot(record: MonitorRecord, now: number): number {
  if (record.intervalMs === null) return record.nextDue
  return record.missedPolicy === 'latest' ? record.anchorAt + Math.floor((now - record.anchorAt) / record.intervalMs) * record.intervalMs : record.nextDue
}
function nextAfter(record: MonitorRecord, now: number): number {
  if (record.intervalMs === null) return now
  return record.anchorAt + (Math.floor((now - record.anchorAt) / record.intervalMs) + 1) * record.intervalMs
}
function notice(record: MonitorRecord, kind: MonitorNotice['kind'], message: string, slot: number, now: number): void {
  record.outbox.push({ id: randomUUID(), monitorId: record.id, sessionId: record.sessionId, installationId: record.installationId,
    kind, title: record.title, message, createdAt: now, slot })
}
function sampleNotices(record: MonitorRecord, sample: MonitorSample): Array<{ kind: MonitorNotice['kind']; message: string }> {
  const notices: Array<{ kind: MonitorNotice['kind']; message: string }> = []
  if (record.intervalMs === null) notices.push({ kind: 'completed', message: '监控已完成一次检查' })
  const prior = record.lastSample
  if (prior !== null) {
    const changed = record.match.kind === 'changed' ? prior.digest !== sample.digest
      : record.match.kind === 'appears' ? !prior.matched && sample.matched : prior.matched && !sample.matched
    if (changed) notices.push({ kind: 'changed', message: '监控条件发生变化' })
  }
  if (record.lastFailure !== null) notices.push({ kind: 'recovered', message: '监控已恢复' })
  return notices
}
function digest(value: CreateMonitor): string { return createHash('sha256').update(canonical(value)).digest('hex') }
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
}
