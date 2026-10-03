import { expect, test } from 'vitest'
import { ExecutionEvidenceHandoff } from '../../eval-isolated/src/evidence.ts'
import { validateBundle } from '../src/evidence.ts'

test('accepts the actual producer bundle and rejects cross-attempt, missing and corrupted material', async () => {
  const handoff = new ExecutionEvidenceHandoff(8192, 8)
  const tuple = { runId: 'run', resolvedDigest: 'a'.repeat(64), corePolicyDigest: 'b'.repeat(64), graderPolicyDigest: 'c'.repeat(64),
    caseId: 'case', routeId: 'route', repeatIndex: 0, attemptId: 'attempt', attempt: 1 }
  handoff.retain('observer', 'subject', 'subject', { tuple, observation: { actual: 'private' } })
  handoff.retain('execution', 'subject', 'subject', { tuple, manifest: null })
  await handoff.offer(async (bundle) => {
    expect(validateBundle(bundle, tuple, 8192)).toEqual(bundle)
    expect(() => validateBundle(bundle, { ...tuple, attemptId: 'another-attempt' }, 8192)).toThrow('invalid-evidence')
    expect(() => validateBundle({ ...bundle, materials: bundle.materials.slice(1) }, tuple, 8192)).toThrow('invalid-evidence')
    const corrupt = structuredClone(bundle)
    const material = corrupt.materials[0]
    expect(material).toBeDefined()
    expect(() => validateBundle({ ...corrupt, materials: [{ ...material, content: '{}' }, ...corrupt.materials.slice(1)] }, tuple, 8192))
      .toThrow('invalid-evidence')
    expect(() => validateBundle(bundle, tuple, 16)).toThrow('capacity')
    return { acceptedDigest: bundle.digest }
  })
})
