/** run-eval：paired input 必须 fail closed。 */

import { describe, expect, it } from 'vitest'
import { computeMetrics, runPairedTrial } from './run-eval.ts'

describe('run-eval metrics', () => {
  it('weights blocking findings P0=8, P1=3, P2=1', () => {
    expect(computeMetrics([{ severity: 'P0' }, { severity: 'P1' }, { severity: 'P2' }]).weightedBlockingScore).toBe(12)
  })

  it('counts only placement P0 blockers', () => {
    const metrics = computeMetrics([
      { severity: 'P0', rule_id: 'placement.parallel-runtime' },
      { severity: 'P0', rule_id: 'durable.recovery' },
      { severity: 'P1', rule_id: 'placement.settings-domain-data' },
    ])
    expect(metrics.placementBlockers).toBe(1)
  })

  it('passes when 3/4 tasks improve and all durations stay within 1.5x', () => {
    const baseline = [0, 1, 2, 3].map(index => ({ task: `t${index}`, findings: [{ severity: 'P0' as const }], durationMs: 100 }))
    const full = [
      { task: 't0', findings: [], durationMs: 120 },
      { task: 't1', findings: [], durationMs: 120 },
      { task: 't2', findings: [{ severity: 'P1' as const }], durationMs: 120 },
      { task: 't3', findings: [{ severity: 'P0' as const }], durationMs: 120 },
    ]
    const trial = runPairedTrial(baseline, full)
    expect(trial.improvedCount).toBe(3)
    expect(trial.improvedRatio).toBe(0.75)
    expect(trial.durationAvailable).toBe(true)
    expect(trial.medianDurationRatio).toBe(1.2)
    expect(trial.pass).toBe(true)
  })

  it('rejects task-set mismatch instead of treating a missing full result as improvement', () => {
    expect(() => runPairedTrial(
      [{ task: 't0', findings: [{ severity: 'P0' }], durationMs: 100 }],
      [],
    )).toThrow(/task mismatch/)
  })

  it('does not pass the cost gate when duration data is absent', () => {
    const baseline = [0, 1, 2, 3].map(index => ({ task: `t${index}`, findings: [{ severity: 'P0' as const }] }))
    const full = [0, 1, 2, 3].map(index => ({ task: `t${index}`, findings: [] }))
    const trial = runPairedTrial(baseline, full)
    expect(trial.improvedRatio).toBe(1)
    expect(trial.durationAvailable).toBe(false)
    expect(trial.medianDurationRatio).toBeNull()
    expect(trial.pass).toBe(false)
  })

  it('fails when fewer than 3/4 improve', () => {
    const baseline = [0, 1, 2, 3].map(index => ({ task: `t${index}`, findings: [{ severity: 'P0' as const }], durationMs: 100 }))
    const full = [
      { task: 't0', findings: [], durationMs: 100 },
      { task: 't1', findings: [{ severity: 'P0' as const }], durationMs: 100 },
      { task: 't2', findings: [{ severity: 'P0' as const }], durationMs: 100 },
      { task: 't3', findings: [{ severity: 'P0' as const }], durationMs: 100 },
    ]
    expect(runPairedTrial(baseline, full).pass).toBe(false)
  })
})
