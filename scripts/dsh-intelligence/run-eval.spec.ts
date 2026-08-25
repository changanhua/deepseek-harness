/**
 * run-eval 测试：weighted blocking finding score 与 placement blocker 度量。
 */

import { describe, it, expect } from 'vitest'
import { computeMetrics, runPairedTrial } from './run-eval.ts'

describe('run-eval metrics', () => {
  it('weights blocking findings P0=8, P1=3, P2=1', () => {
    const m = computeMetrics([{ severity: 'P0' }, { severity: 'P1' }, { severity: 'P2' }])
    expect(m.weightedBlockingScore).toBe(12)
  })

  it('counts only placement P0 blockers', () => {
    const m = computeMetrics([
      { severity: 'P0', rule_id: 'placement.parallel-runtime' },
      { severity: 'P0', rule_id: 'durable.recovery' },
      { severity: 'P1', rule_id: 'placement.settings-domain-data' },
    ])
    expect(m.placementBlockers).toBe(1)
  })

  it('counts hallucinated symbols and rejected inventions', () => {
    const m = computeMetrics([
      { severity: 'P0', rule_id: 'hallucinated-symbol' },
      { severity: 'P1', rule_id: 'hallucinated-symbol' },
      { severity: 'P0', rule_id: 'invention.rejected' },
    ])
    expect(m.hallucinatedSymbols).toBe(2)
    expect(m.inventionRejected).toBe(1)
  })

  it('paired trial passes when 3/4 tasks improve within 1.5x duration', () => {
    const baseline = [0, 1, 2, 3].map(i => ({ task: `t${i}`, findings: [{ severity: 'P0' as const }], durationMs: 100 }))
    const full = [
      { task: 't0', findings: [], durationMs: 120 },
      { task: 't1', findings: [], durationMs: 120 },
      { task: 't2', findings: [{ severity: 'P1' as const }], durationMs: 120 },
      { task: 't3', findings: [{ severity: 'P0' as const }], durationMs: 120 },
    ]
    const trial = runPairedTrial(baseline, full)
    expect(trial.improvedCount).toBe(3)
    expect(trial.improvedRatio).toBe(0.75)
    expect(trial.medianDurationRatio).toBe(1.2)
    expect(trial.pass).toBe(true)
  })

  it('fails when fewer than 3/4 improve', () => {
    const baseline = [0, 1, 2, 3].map(i => ({ task: `t${i}`, findings: [{ severity: 'P0' as const }], durationMs: 100 }))
    const full = [
      { task: 't0', findings: [], durationMs: 100 },
      { task: 't1', findings: [{ severity: 'P0' as const }], durationMs: 100 },
      { task: 't2', findings: [{ severity: 'P0' as const }], durationMs: 100 },
      { task: 't3', findings: [{ severity: 'P0' as const }], durationMs: 100 },
    ]
    const trial = runPairedTrial(baseline, full)
    expect(trial.improvedCount).toBe(1)
    expect(trial.pass).toBe(false)
  })
})
