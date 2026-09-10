import { createHash, randomUUID } from 'node:crypto'
import { ActivityBatchSchema, ActivitySettingsSchema } from './schemas.ts'
import type { ActivityBatch, ActivityRecord, ActivitySettings } from './types.ts'

const MAX_RECORD_BYTES = 4 * 1024 * 1024

/** A new policy revision invalidates old buffered uploads without deleting retained activity. */
export function configureActivity(
  installationId: string, settings: ActivitySettings, grantEpoch: number, previous: ActivityRecord | undefined, now: number,
): ActivityRecord {
  const parsed = ActivitySettingsSchema.parse(settings)
  if (new Set(parsed.origins).size !== parsed.origins.length || new Set(parsed.kinds).size !== parsed.kinds.length) throw new Error('invalid_activity_policy')
  return pruneActivity({ installationId, policy: { ...parsed, revision: randomUUID(), grantEpoch },
    sequence: 0, configuration: null, lastBatch: null, events: structuredClone(previous?.events ?? []) }, now)
}

/** Consecutive batches make retry identity bounded without keeping an unbounded receipt database. */
export function appendActivity(record: ActivityRecord, input: ActivityBatch, grantEpoch: number, now: number): ActivityRecord {
  const batch = ActivityBatchSchema.parse(input)
  const digest = createHash('sha256').update(JSON.stringify(batch)).digest('hex')
  if (!record.policy.enabled || record.policy.revision !== batch.revision || record.policy.grantEpoch !== grantEpoch) throw new Error('activity_policy_changed')
  if (batch.sequence === record.sequence) {
    if (record.lastBatch?.id !== batch.id || record.lastBatch.digest !== digest) throw new Error('activity_batch_conflict')
    return record
  }
  if (batch.sequence !== record.sequence + 1) throw new Error('activity_sequence_mismatch')
  const next = pruneActivity(structuredClone(record), now)
  const ids = new Set(next.events.map(event => event.id))
  let accepted = 0
  for (const event of batch.events) {
    if (!record.policy.origins.includes(new URL(event.url).origin) || !record.policy.kinds.includes(event.kind)
      || (event.text?.length ?? 0) > record.policy.maxTextChars || event.at > now + 5000) throw new Error('activity_outside_policy')
    if (event.at < now - record.policy.retentionDays * 86400000) continue
    if (ids.has(event.id)) throw new Error('activity_event_conflict')
    const prior = next.events.findLast(item => item.tabId === event.tabId && item.kind === event.kind)
    if (prior && event.at - prior.at < record.policy.minIntervalMs) continue
    next.events.push({ ...event, sessionId: record.policy.sessionId, receivedAt: now, grantEpoch })
    ids.add(event.id); accepted += 1
  }
  next.sequence = batch.sequence; next.lastBatch = { id: batch.id, digest, accepted }
  return pruneActivity(next, now)
}

/** Retention applies even while paused; complete UTF-8 records also obey a byte ceiling. */
export function pruneActivity(record: ActivityRecord, now: number): ActivityRecord {
  const cutoff = now - record.policy.retentionDays * 86400000
  const next = { ...record, events: record.events.filter(event => event.at >= cutoff).slice(-record.policy.maxEvents) }
  while (next.events.length && Buffer.byteLength(JSON.stringify(next), 'utf8') > MAX_RECORD_BYTES) next.events = next.events.slice(1)
  return next
}
