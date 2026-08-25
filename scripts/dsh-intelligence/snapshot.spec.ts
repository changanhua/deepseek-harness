/** snapshot / Evidence Capsule 协议测试。 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { artifactSha256, buildSnapshot } from './snapshot.ts'
import { loadSchema, validateEvidence } from './validate-adp.ts'

describe('snapshot (Evidence Capsule Builder static)', () => {
  it('produces a capsule that passes the evidence schema', () => {
    const snap = buildSnapshot()
    const result = validateEvidence(snap, loadSchema('evidence-capsule.schema.json'))
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(snap.id).toBe(`evidence:${snap.target_snapshot.revision.slice(0, 12)}`)
  })

  it('records current revision, branch, and upstream base', () => {
    const snap = buildSnapshot()
    expect(snap.target_snapshot.revision).toMatch(/^[0-9a-f]{40}$/)
    expect(snap.target_snapshot.branch).toBeTruthy()
    expect(snap.target_snapshot.upstream_base).toMatch(/^[0-9a-f]{40}$/)
  })

  it('computes non-empty digests for generated files and directories', () => {
    const snap = buildSnapshot()
    expect(snap.static_manifest.generated_catalogs.length).toBeGreaterThan(0)
    for (const catalog of snap.static_manifest.generated_catalogs) {
      expect(catalog.digest).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('hashes a directory deterministically from relative paths and contents', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-int-digest-'))
    mkdirSync(join(root, 'nested'))
    writeFileSync(join(root, 'a.txt'), 'a\n', 'utf8')
    writeFileSync(join(root, 'nested', 'b.txt'), 'b\n', 'utf8')
    const first = artifactSha256(root)
    const second = artifactSha256(root)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(second).toBe(first)
  })
})
