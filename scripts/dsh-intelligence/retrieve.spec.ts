/** retrieve：生命周期过滤与预算。 */

import { describe, expect, it } from 'vitest'
import { retrieve } from './retrieve.ts'

describe('retrieve (Bounded Knowledge Retriever)', () => {
  it('does not return candidate knowledge in normal retrieval', () => {
    expect(retrieve('durable scheduler', { kinds: ['pattern'] })).toEqual([])
    expect(retrieve('persisted pid kill', { kinds: ['anti-pattern'] })).toEqual([])
  })

  it('can inspect candidate seeds only when explicitly requested', () => {
    const patterns = retrieve('durable scheduler', { kinds: ['pattern'], includeCandidates: true })
    expect(patterns.some(item => item.id === 'pattern-owned-durable-scheduler' && item.status === 'candidate')).toBe(true)

    const antiPatterns = retrieve('persisted pid kill', { kinds: ['anti-pattern'], includeCandidates: true })
    expect(antiPatterns.some(item => item.id === 'anti-pattern-recovered-pid-as-kill-authority')).toBe(true)
  })

  it('caps result count at the configured precedent budget', () => {
    const items = retrieve('scheduler', { max: 99, includeCandidates: true })
    expect(items.length).toBeLessThanOrEqual(3)
  })

  it('returns pointers rather than whole knowledge records', () => {
    const items = retrieve('scheduler', { max: 1, includeCandidates: true })
    for (const item of items) {
      expect(item.path).toMatch(/^\.agents\/dsh-intelligence\/knowledge\//)
      expect(item.snippet.length).toBeLessThanOrEqual(240)
    }
  })
})
