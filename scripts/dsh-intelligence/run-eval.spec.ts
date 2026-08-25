/** run-eval：paired input 必须 fail closed。 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  computeMetrics,
  computePrimaryMetrics,
  evaluateHoldoutTrial,
  loadPrivateTasks,
  runPairedTrial,
  type HoldoutTask,
  type TrialArm,
} from './run-eval.ts'

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

describe('private-holdout protocol', () => {
  const identity = { prompt_hash: 'sha256:abc', model: 'v4-flash', temperature: 0, max_tokens: 2048, seed: null }
  const task: HoldoutTask = {
    id: 'holdout-001',
    category: 'seam-placement',
    prompt: { requirement: 'build a durable queue', constraints: ['cross-session'] },
    rubric: {
      blocking_findings: [{ id: 'bf-01', severity: 'P0', rule_id: 'placement.parallel-runtime', condition: 're-owns Agent lifecycle' }],
      expected_properties: ['single owner'],
      forbidden_patterns: ['Cognitive Kernel'],
    },
  }
  const arm = (overrides: Partial<TrialArm> = {}): TrialArm => ({
    system: 'full-intelligence',
    identity,
    raw_output_hash: 'sha256:xyz',
    execution_status: 'success',
    normalized_findings: [],
    metrics: { architectureBlockingFindings: 0 },
    ...overrides,
  })

  it('loads prompt and rubric as separate files into one task', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-'))
    try {
      writeFileSync(join(dir, 'holdout-001.prompt.yaml'), 'id: holdout-001\ncategory: seam-placement\nprompt:\n  requirement: build a durable queue\n  constraints: [cross-session]\n', 'utf8')
      writeFileSync(join(dir, 'holdout-001.rubric.yaml'), 'id: holdout-001\nrubric:\n  blocking_findings:\n    - id: bf-01\n      severity: P0\n      rule_id: placement.parallel-runtime\n      condition: x\n  expected_properties: [single owner]\n  forbidden_patterns: [Cognitive Kernel]\n', 'utf8')
      const tasks = loadPrivateTasks(dir)
      expect(tasks).toHaveLength(1)
      expect(tasks[0].prompt.requirement).toBe('build a durable queue')
      expect(tasks[0].rubric.blocking_findings[0].rule_id).toBe('placement.parallel-runtime')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('marks a trial INVALID when model execution failed (never counts as 0 findings)', () => {
    const result = evaluateHoldoutTrial(task, arm({ execution_status: 'failed' }), arm())
    expect(result.status).toBe('INVALID')
    expect(result.invalid_reasons).toContain('baseline model execution failed')
  })

  it('marks a trial INVALID when raw output hash is missing (immutability gate)', () => {
    const result = evaluateHoldoutTrial(task, arm({ raw_output_hash: 'no-hash' }), arm())
    expect(result.status).toBe('INVALID')
    expect(result.invalid_reasons.some(r => r.includes('immutable'))).toBe(true)
  })

  it('marks a trial INVALID when required metrics are missing', () => {
    const result = evaluateHoldoutTrial(task, arm({ metrics: {} }), arm())
    expect(result.status).toBe('INVALID')
    expect(result.invalid_reasons.some(r => r.includes('metrics'))).toBe(true)
  })

  it('marks a trial INVALID on paired-identity mismatch', () => {
    const result = evaluateHoldoutTrial(task, arm(), arm({ identity: { ...identity, model: 'other-model' } }))
    expect(result.status).toBe('INVALID')
    expect(result.invalid_reasons.some(r => r.includes('model mismatch'))).toBe(true)
  })

  it('produces a VALID comparison and an intelligence_better verdict when blockers drop', () => {
    const result = evaluateHoldoutTrial(
      task,
      arm({
        system: 'baseline-no-intelligence',
        raw_output_hash: 'sha256:base',
        normalized_findings: [{ severity: 'P0', rule_id: 'placement.parallel-runtime' }, { severity: 'P0', rule_id: 'hallucinated-symbol' }],
        metrics: { architectureBlockingFindings: 2 },
      }),
      arm({ raw_output_hash: 'sha256:full', normalized_findings: [], metrics: { architectureBlockingFindings: 0 } }),
    )
    expect(result.status).toBe('VALID')
    expect(result.comparison?.blocking_findings_delta).toBe(2)
    expect(result.comparison?.verdict).toBe('intelligence_better')
  })

  it('computes the four primary metrics from normalized findings', () => {
    const metrics = computePrimaryMetrics(
      [{ severity: 'P0', rule_id: 'placement.parallel-runtime' }, { severity: 'P0', rule_id: 'hallucinated-symbol' }, { severity: 'P1', rule_id: 'invention.rejected' }],
      task.rubric,
    )
    expect(metrics.architectureBlockingFindings).toBe(2)
    expect(metrics.hallucinatedSymbolRate).toBeCloseTo(1 / 3)
    expect(metrics.unsupportedInventionRate).toBeCloseTo(1 / 3)
  })
})
