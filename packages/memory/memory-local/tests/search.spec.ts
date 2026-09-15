import { describe, expect, it } from 'vitest'
import { memoryHistory } from '../../memory/tests/fixtures.ts'
import { rankMemories } from '../src/search.ts'

describe('stable lexical memory ordering', () => {
  it('normalizes full-width text and case while ordering equal-scored and repeated entries by identity', () => {
    const first = memoryHistory()[1]
    first.id = 'b'
    first.revisions[0]!.title = 'ＣＡＣＨＥ'
    first.revisions[0]!.tags = ['PERF']
    const second = structuredClone(first)
    second.id = 'a'
    const input = [first, second, first]
    expect(rankMemories(input, { query: 'cache', tags: ['perf'] }).map(record => record.id)).toEqual(['a', 'b', 'b'])
    expect(input.map(record => record.id)).toEqual(['b', 'a', 'b'])
  })
})
