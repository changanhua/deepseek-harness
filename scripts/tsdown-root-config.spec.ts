import { describe, expect, it } from 'vitest'
import config from '../tsdown.config.ts'

function resolveConfig(face: 'host' | 'client') {
  if (typeof config !== 'function') throw new TypeError('root tsdown config must be environment-aware')
  return config({ env: { DSH_BUILD_FACE: face } }, { ci: false })
}

describe('root tsdown build faces', () => {
  it('bundles the standard emitted Host entries for packages without a local override', () => {
    expect(resolveConfig('host')).toMatchObject({
      entry: ['lib/types/{index,invariant,startup}.js'],
      platform: 'node',
      outDir: 'lib',
    })
  })

  it('leaves entry selection to Client package configs', () => {
    expect(resolveConfig('client')).toMatchObject({ entry: '' })
  })
})
