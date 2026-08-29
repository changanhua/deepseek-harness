import { describe, expect, it } from 'vitest'
import { apply as applyHost } from '../src/index.ts'
import {
  apply as applyClient,
  inject,
} from '../src/client/index.ts'

describe('Personal Delivery UI empty composition', () => {
  it('loads both entries without registering runtime behavior', () => {
    applyHost()
    applyClient()
    expect(inject).toEqual([])
  })
})
