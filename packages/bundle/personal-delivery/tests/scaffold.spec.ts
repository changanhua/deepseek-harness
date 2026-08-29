import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

describe('Personal Delivery bundle unavailable composition', () => {
  it('publishes an empty patch until the complete vertical is composed', () => {
    const patch = load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'))
    expect(patch).toEqual([])
  })
})
