/**
 * retrieve 测试：词法检索命中知识种子并遵守预算。
 */

import { describe, it, expect } from 'vitest'
import { retrieve } from './retrieve.ts'

describe('retrieve (Bounded Retriever)', () => {
  it('finds the durable scheduler pattern seed', () => {
    const items = retrieve('durable scheduler', { kinds: ['pattern'] })
    expect(items.length).toBeGreaterThan(0)
    expect(items[0].id).toBe('pattern-owned-durable-scheduler')
  })

  it('returns an anti-pattern when querying its failure mechanism', () => {
    const items = retrieve('persisted pid kill', { kinds: ['anti-pattern'] })
    expect(items.some(i => i.id === 'anti-pattern-recovered-pid-as-kill-authority')).toBe(true)
  })

  it('respects the max result budget', () => {
    const items = retrieve('scheduler', { max: 1 })
    expect(items.length).toBeLessThanOrEqual(1)
  })

  it('returns pointers, not copied prose', () => {
    const items = retrieve('scheduler', { max: 1 })
    for (const item of items) expect(item.path).toMatch(/^\.agents\/dsh-intelligence\/knowledge\//)
  })
})
