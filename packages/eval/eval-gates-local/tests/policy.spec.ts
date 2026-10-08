import { describe, expect, test } from 'vitest'
import { decideSnapshot } from '../src/policy.ts'
import { snapshot } from './helpers/snapshot.ts'

describe('Gate snapshot policy', () => {
  test('requires every frozen Plan cell to have a current successful, intact and settled source fact', () => {
    const value = snapshot()
    expect(decideSnapshot(value, 2)).toEqual({ decision: 'pass', reasonCode: 'criteria-satisfied' })
    expect(decideSnapshot({ ...value, run: { ...value.run, expectedCells: [...value.run.expectedCells, { caseId: 'missing', routeId: 'route', repeatIndex: 0 }] } }, 2))
      .toEqual({ decision: 'needs-attention', reasonCode: 'identity-mismatch' })
    expect(decideSnapshot({ ...value, cells: [{ ...value.cells[0]!, budget: [{ ...value.cells[0]!.budget[0]!, phase: 'unknown', usage: null }] }] }, 2))
      .toEqual({ decision: 'needs-attention', reasonCode: 'budget-unknown' })
  })

  test('refuses expired snapshots and manifests whose tuple does not name the current Attempt', () => {
    const value = snapshot()
    expect(decideSnapshot(value, 10_000)).toEqual({ decision: 'needs-attention', reasonCode: 'evidence-missing' })
    const mismatched = structuredClone(value)
    const output = mismatched.cells[0]?.work.output
    if (!output?.manifest) throw new Error('fixture manifest missing')
    output.manifest.cell.attempt = 2
    expect(decideSnapshot(mismatched, 2)).toEqual({ decision: 'needs-attention', reasonCode: 'identity-mismatch' })
  })
})
