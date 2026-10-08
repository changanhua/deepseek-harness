/** Regression: the base domain provider must share both consumer realms. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('dsh-base storage isolation', () => {
  it('routes the domain provider to the backend and projection-cache realms', () => {
    const patch = readFileSync(fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)), 'utf8')
    const start = patch.indexOf('    - id: storage-domain\n')
    const end = patch.indexOf('    - id:', start + 1)
    const row = patch.slice(start, end)
    expect(row).toContain('storage.backend.json: web-storage')
    expect(row).toContain('storageDomain: web-host')
  })
})
