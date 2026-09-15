import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'

describe('explicit project memory layer', () => {
  it('adds its consumers without replacing existing storage routing or unrelated configuration', () => {
    const patches = load(readFileSync(resolve(import.meta.dirname, '../cordis.patch.yml'), 'utf8'), { schema: entryListSchema }) as PatchOptions[]
    const base = [
      { id: 'storage-domain', name: '@deepseek-ai/dsh-storage-domain', config: { backend: 'json', routes: { other: 'sqlite' } } },
      { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt', config: { persona: 'user-owned persona' } },
    ]
    const result = applyEntryPatches(base, patches, (message) => { throw new Error(message) })
    expect(result.find(entry => entry.id === 'storage-domain')?.config).toEqual(base[0]?.config)
    expect(result.find(entry => entry.id === 'system-prompt')?.config).toEqual(base[1]?.config)
    expect(result.slice(2).map(entry => entry.name).sort()).toEqual([
      '@changanhua/dsh-command-memory', '@changanhua/dsh-memory-local', '@changanhua/dsh-tool-memory',
    ])
    expect(base).toHaveLength(2)
  })
})
