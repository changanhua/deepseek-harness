import { describe, expect, it } from 'vitest'
import { canonicalJson, canonicalQueueState, digestIntent, foldChanges } from '@changanhua/dsh-task-queue'
import { admitted, receipt, work } from './fixtures.ts'

describe('canonical caller intent', () => {
  it('sorts plain JSON object keys and produces a stable digest', () => {
    expect(canonicalJson({ b: [2, 3], a: 1 })).toBe('{"a":1,"b":[2,3]}')
    expect(digestIntent({ b: 2, a: 1 })).toBe(digestIntent({ a: 1, b: 2 }))
  })

  it('serializes every JSON primitive and canonical Queue projection', () => {
    expect([canonicalJson(null), canonicalJson(true), canonicalJson(false), canonicalJson(-0), canonicalJson('x')]).toEqual(['null', 'true', 'false', '0', '"x"'])
    expect(canonicalQueueState(foldChanges([admitted()]))).toContain('"works"')
    const second = work('work-2')
    const twoItems = foldChanges([admitted(), admitted(2, second, receipt([second.id], { key: 'key-2' }))])
    expect(canonicalQueueState(twoItems).indexOf('work-1')).toBeLessThan(canonicalQueueState(twoItems).indexOf('work-2'))
  })

  it.each([
    undefined,
    { value: undefined },
    [undefined],
    () => undefined,
    Symbol('value'),
    1n,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    new Date(0),
  ])('rejects non-JSON-safe intent %#', (value) => {
    expect(() => canonicalJson(value)).toThrow(/JSON-safe|plain|finite|unsupported/i)
  })

  it('rejects cyclic intent instead of colliding with another value', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => canonicalJson(cyclic)).toThrow(/cyclic/i)
  })

  it('rejects sparse arrays and symbol or non-enumerable object keys', () => {
    const sparse = Array(1)
    const symbolKeyed = { value: 1, [Symbol('hidden')]: 2 }
    const nonEnumerable = { value: 1 }
    Object.defineProperty(nonEnumerable, 'hidden', { value: 2 })
    expect(() => canonicalJson(sparse)).toThrow(/sparse|JSON-safe/i)
    expect(() => canonicalJson(symbolKeyed)).toThrow(/symbol|JSON-safe/i)
    expect(() => canonicalJson(nonEnumerable)).toThrow(/enumerable|JSON-safe/i)
    const extra: number[] & { extra?: number } = [1]
    extra.extra = 2
    expect(() => canonicalJson(extra)).toThrow(/extra|JSON-safe/i)
  })
})
