/** Deterministic lexical ranking and exact-topic conflict detection. @module @changanhua/dsh-memory-local/search */
import type { MemoryRecord, MemorySearchRequest } from '@changanhua/dsh-memory'
import assert from 'node:assert/strict'

/**
 * Normalize text without a host-dependent locale.
 * @param text - Query, tag, or claim text to compare.
 * @returns NFKC lowercase text with collapsed whitespace.
 */
export const normalizeMemoryText = (text: string): string => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()

function tokens(text: string): Set<string> {
  const value = normalizeMemoryText(text)
  const out = new Set(value.match(/[a-z0-9_]+/gu) ?? [])
  for (const sequence of value.match(/\p{Script=Han}+/gu) ?? []) {
    const chars = Array.from(sequence)
    for (const [index, char] of chars.entries()) {
      if (chars.length === 1) out.add(char)
      const next = chars[index + 1]
      if (next !== undefined) out.add(char + next)
    }
  }
  return out
}

/**
 * Rank only active records; source availability is checked immediately before returning text.
 * @param records - Validated records already restricted to the caller's Workspace.
 * @param request - Lexical query and optional required tags.
 * @returns Matching active records in relevance and stable-identity order; eligibility still needs checking.
 */
export function rankMemories(records: readonly MemoryRecord[], request: MemorySearchRequest): MemoryRecord[] {
  const query = tokens(request.query)
  const tags = request.tags?.map(normalizeMemoryText) ?? []
  const ranked: Array<{ record: MemoryRecord; score: number }> = []
  for (const record of records) {
    if (record.activeRevision === null) continue
    const revision = record.revisions[record.activeRevision - 1]
    assert(revision !== undefined, 'validated memory history requires a valid active revision')
    if (!tags.every(tag => revision.tags.some(value => normalizeMemoryText(value) === tag))) continue
    const title = tokens(revision.title)
    const tagged = tokens(revision.tags.join(' '))
    const body = tokens(`${revision.statement} ${revision.conditions}`)
    let score = 0
    for (const term of query) score += (title.has(term) ? 4 : 0) + (tagged.has(term) ? 3 : 0) + (body.has(term) ? 1 : 0)
    if (score > 0) ranked.push({ record, score })
  }
  return ranked
    .sort((a, b) => b.score - a.score || (a.record.id < b.record.id ? -1 : a.record.id > b.record.id ? 1 : 0))
    .map(value => value.record)
}

/**
 * Distinct active claims sharing a topic are withheld together until a human resolves them.
 * @param records - Validated records from one Workspace.
 * @returns Every identity in a topic group containing different normalized active claims.
 */
export function conflictingMemoryIds(records: readonly MemoryRecord[]): Set<string> {
  const topics = new Map<string, Array<{ id: string; statement: string }>>()
  for (const record of records) {
    if (record.activeRevision === null) continue
    const revision = record.revisions[record.activeRevision - 1]
    assert(revision !== undefined, 'validated memory history requires a valid active revision')
    const items = topics.get(record.topicKey) ?? []
    items.push({ id: record.id, statement: normalizeMemoryText(revision.statement) })
    topics.set(record.topicKey, items)
  }
  const conflicts = new Set<string>()
  for (const items of topics.values()) {
    if (new Set(items.map(value => value.statement)).size > 1) {
      for (const item of items) conflicts.add(item.id)
    }
  }
  return conflicts
}
