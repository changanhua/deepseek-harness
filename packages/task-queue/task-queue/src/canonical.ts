/** Strict canonical JSON for intent receipts and durable snapshot digests. */
import { createHash } from 'node:crypto'
import type { FoldedQueue } from './fold.ts'

/**
 * Serialize a JSON-safe value with recursively sorted object keys.
 * @param value - Plain JSON value without cycles, holes, accessors, or hidden keys.
 * @returns Canonical JSON without whitespace.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, new WeakSet())
}

/**
 * Digest canonical caller intent.
 * @param value - JSON-safe caller intent.
 * @returns A `sha256:`-prefixed lowercase hexadecimal digest.
 */
export function digestIntent(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`
}

/**
 * Canonically serialize every durable Queue projection.
 * @param folded - Folded Queue state.
 * @returns Stable canonical JSON independent of map insertion order.
 */
export function canonicalQueueState(folded: FoldedQueue): string {
  return canonicalJson({
    works: sortedValues(folded.worksById), states: sortedValues(folded.statesByWorkId),
    attempts: sortedValues(folded.attemptsById), results: sortedValues(folded.resultsById),
    batches: sortedValues(folded.batchesById), attentions: sortedValues(folded.attentionsById),
    notifications: sortedValues(folded.notificationsById),
    receipts: [...folded.receiptsByKey.values()].sort((left, right) => compare(left.key, right.key)),
  })
}

function serialize(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonicalJson requires finite JSON-safe numbers')
    return Object.is(value, -0) ? '0' : String(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value !== 'object') throw new TypeError(`canonicalJson received unsupported non-JSON-safe ${typeof value}`)
  if (ancestors.has(value)) throw new TypeError('canonicalJson received a cyclic value')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw new TypeError('canonicalJson rejects sparse non-JSON-safe arrays')
      }
      const keys = Reflect.ownKeys(value)
      if (keys.some(key => typeof key === 'symbol' || (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key)))) {
        throw new TypeError('canonicalJson rejects arrays with non-JSON-safe extra or symbol keys')
      }
      return `[${value.map(item => serialize(item, ancestors)).join(',')}]`
    }
    const prototype: unknown = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('canonicalJson requires plain JSON-safe objects')
    const keys = Reflect.ownKeys(value)
    if (keys.some(key => typeof key === 'symbol')) throw new TypeError('canonicalJson rejects symbol keys')
    const stringKeys = keys as string[]
    for (const key of stringKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor?.enumerable !== true || !('value' in descriptor)) throw new TypeError('canonicalJson requires enumerable data properties')
    }
    stringKeys.sort(compare)
    const record = value as Record<string, unknown>
    return `{${stringKeys.map(key => `${JSON.stringify(key)}:${serialize(record[key], ancestors)}`).join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

function sortedValues<K extends string, V>(map: ReadonlyMap<K, V>): V[] {
  return [...map.entries()].sort((left, right) => compare(left[0], right[0])).map(([, value]) => value)
}

function compare(left: string, right: string): number {
  return left < right ? -1 : 1
}
