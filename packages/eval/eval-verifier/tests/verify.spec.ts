import { describe, expect, test } from 'vitest'
import { verifySnapshot } from '../src/verify.ts'

describe('deterministic Eval verifier', () => {
  test('recomputes criteria from captured subject output instead of accepting a Host outcome', () => {
    const input = { kind: 'eval-verifier-input', schemaVersion: 1, snapshotRevision: 'a'.repeat(64),
      plan: { id: 'plan', version: '1', digest: 'b'.repeat(64), expectedCommit: 'c'.repeat(40), baseline: 'none' },
      suite: { id: 'suite', version: '1', digest: 'd'.repeat(64), sourceRevision: 'c'.repeat(40) },
      verifierPlan: { id: 'verifier', version: '1', digest: 'e'.repeat(64) }, expectedCells: [{ caseId: 'case', routeId: 'route', repeatIndex: 0 }],
      cases: [{ id: 'case', criteria: [{ kind: 'output-equals', text: 'READY' }], requiresGrader: false }],
      cells: [{ caseId: 'case', routeId: 'route', repeatIndex: 0, manifestDigest: 'f'.repeat(64), subjectOutput: 'READY', graderOutput: null,
        integrity: 'intact', budget: 'settled' }] }
    expect(verifySnapshot(input)).toMatchObject({ kind: 'eval-verifier-report', outcome: 'approved', snapshotRevision: input.snapshotRevision })
    expect(verifySnapshot({ ...input, cells: [{ ...input.cells[0]!, subjectOutput: 'NO' }] })).toMatchObject({ outcome: 'rejected', reason: 'criteria-failed' })
    expect(verifySnapshot({ ...input, expectedCells: [...input.expectedCells, { caseId: 'extra', routeId: 'route', repeatIndex: 0 }] })).toMatchObject({ outcome: 'unknown' })
  })
})
