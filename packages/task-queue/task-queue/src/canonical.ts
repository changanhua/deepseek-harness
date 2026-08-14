/**
 * Deterministic canonical serialization for snapshot digests (spec §4.1): UTF-8
 * JSON with no extra whitespace, object keys sorted recursively by Unicode code
 * point, arrays in original order. Digest correctness must not depend on
 * runtime object insertion order.
 * @module @deepseek-ai/dsh-task-queue/canonical
 */

import type { FoldedQueue } from './fold.ts'

/**
 * Serialize `value` to a canonical JSON string: UTF-8, no extra whitespace,
 * object keys sorted recursively by Unicode code point, arrays in order.
 * `undefined` values and object keys are dropped; non-finite numbers serialize
 * to `null` (identical to `JSON.stringify`).
 * @param value - the value to serialize deterministically.
 * @returns the canonical JSON string.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value)
}

function serialize(value: unknown): string {
  if (value === null) return 'null'
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'null'
  }
  if (typeof value === 'string') {
    // JSON.stringify escapes the same characters; rely on it for exactness.
    return JSON.stringify(value)
  }
  if (typeof value === 'bigint') {
    throw new TypeError('canonicalJson does not accept bigint values')
  }
  if (Array.isArray(value)) {
    return `[${value.map(serialize).join(',')}]`
  }
  if (typeof value === 'object') {
    const entries: Array<[string, unknown]> = []
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const v = (value as Record<string, unknown>)[key]
      if (v === undefined) continue
      entries.push([key, v])
    }
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v)}`).join(',')}}`
  }
  // Functions, symbols: match JSON.stringify's undefined-in-object semantics.
  return 'null'
}

/**
 * Canonical, deterministic serialization of the folded queue state: tasks and
 * notifications keyed maps sorted by id ascending, independent of insertion
 * order. Used as {@link FoldedQueue} digest input.
 * @param folded - the folded queue state to serialize.
 * @returns the canonical state string.
 */
export function canonicalQueueState(folded: FoldedQueue): string {
  const tasks = [...folded.tasksById.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([, task]) => task)
  const notifications = [...folded.notificationsById.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([, notification]) => notification)
  return canonicalJson({ tasks, notifications })
}
