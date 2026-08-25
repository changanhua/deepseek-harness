/**
 * snapshot 测试：生成的 evidence capsule 必须通过 evidence-capsule schema。
 */

import { describe, it, expect } from 'vitest'
import { buildSnapshot } from './snapshot.ts'
import { loadSchema, validateEvidence } from './validate-adp.ts'

describe('snapshot (Evidence Capsule Builder static)', () => {
  it('produces a capsule that passes the evidence schema', () => {
    const snap = buildSnapshot()
    const schema = loadSchema('evidence-capsule.schema.json')
    const result = validateEvidence(snap, schema)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('records current revision, branch, and upstream base', () => {
    const snap = buildSnapshot()
    expect(snap.target_snapshot.revision).toMatch(/^[0-9a-f]{40}$/)
    expect(snap.target_snapshot.branch).toBeTruthy()
    expect(snap.target_snapshot.upstream_base).toMatch(/^[0-9a-f]{40}$/)
  })

  it('computes digests for generated catalogs', () => {
    const snap = buildSnapshot()
    expect(Array.isArray(snap.static_manifest.generated_catalogs)).toBe(true)
    expect(snap.static_manifest.generated_catalogs.length).toBeGreaterThan(0)
    for (const cat of snap.static_manifest.generated_catalogs) {
      expect(cat.kind).toBeTruthy()
      expect(typeof cat.digest).toBe('string')
    }
  })
})
