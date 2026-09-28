import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { UserConfig } from 'tsdown'
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

  it('selects only directories that own a package manifest', () => {
    const resolved = resolveConfig('host') as UserConfig
    expect(Array.isArray(resolved.workspace)).toBe(true)
    for (const directory of resolved.workspace as string[]) {
      expect(existsSync(resolve(directory, 'package.json')), directory).toBe(true)
    }
  })
})
