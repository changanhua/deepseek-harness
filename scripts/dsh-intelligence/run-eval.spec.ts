/** run-eval：paired input 必须 fail closed；trial-result 必须通过自身 schema E2E。 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  computeMetrics,
  computePrimaryMetrics,
  evaluateHoldoutTrial,
  loadPrivateTasks,
  loadSuiteManifest,
  runPairedTrial,
  sha256Hex,
  type EvaluatorProvenance,
  type HoldoutTask,
  type TrialArm,
} from './run-eval.ts'
import { validateSchema } from './validate-adp.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EVALS_DIR = join(ROOT, '.agents', 'dsh-intelligence', 'evals')
const TRIAL_RESULT_SCHEMA: unknown = JSON.parse(readFileSync(join(EVALS_DIR, 'trial-result.schema.json'), 'utf8'))
const H64 = (hex: string) => hex.padEnd(64, '0').slice(0, 64)

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
  const identity = { prompt_hash: `sha256:${H64('a')}`, model: 'v4-flash', temperature: 0, max_tokens: 2048, seed: null }
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

  const arm = (opts: {
    system?: TrialArm['system']
    normalized_findings?: TrialArm['normalized_findings']
    raw_hash?: string
    raw_output_ref?: string
    execution_status?: TrialArm['execution_status']
    identity?: TrialArm['identity']
    metrics?: Record<string, unknown>
    evaluator_overrides?: Partial<EvaluatorProvenance>
  } = {}): TrialArm => {
    const system = opts.system ?? 'full-intelligence'
    const normalized_findings = opts.normalized_findings ?? []
    const raw_hash = opts.raw_hash ?? `sha256:${sha256Hex(`raw-${system}`)}`
    const evaluator: EvaluatorProvenance = {
      evaluator_type: 'deterministic',
      evaluator_prompt_hash: `sha256:${sha256Hex('eval-prompt')}`,
      rubric_hash: `sha256:${sha256Hex('rubric-content')}`,
      source_output_hash: raw_hash,
      evaluator_version: '1.0.0',
      normalized_findings_hash: `sha256:${sha256Hex(JSON.stringify(normalized_findings))}`,
      ...opts.evaluator_overrides,
    }
    return {
      system,
      identity: opts.identity ?? identity,
      raw_output_ref: opts.raw_output_ref ?? `${system === 'baseline-no-intelligence' ? 'baseline' : 'intelligence'}/holdout-001.raw.txt`,
      raw_output_hash: raw_hash,
      execution_status: opts.execution_status ?? 'success',
      normalized_findings,
      metrics: opts.metrics ?? { architectureBlockingFindings: 0 },
      evaluator,
    }
  }

  const baseline = (overrides: Parameters<typeof arm>[0] = {}) => arm({ system: 'baseline-no-intelligence', ...overrides })

  describe('suite manifest drives the task universe', () => {
    it('loads a manifest task from validated prompt and rubric files', () => {
      const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-'))
      try {
        writeFileSync(join(dir, 'manifest.yaml'), 'suite_id: test-suite-001\ntasks:\n  - holdout-001\n', 'utf8')
        writeFileSync(join(dir, 'holdout-001.prompt.yaml'), 'id: holdout-001\ncategory: seam-placement\nprompt:\n  requirement: build a durable queue\n  constraints: [cross-session]\n', 'utf8')
        writeFileSync(join(dir, 'holdout-001.rubric.yaml'), 'id: holdout-001\ncategory: seam-placement\nrubric:\n  blocking_findings:\n    - id: bf-01\n      severity: P0\n      rule_id: placement.parallel-runtime\n      condition: x\n  expected_properties: [single owner]\n  forbidden_patterns: [Cognitive Kernel]\n', 'utf8')
        const loaded = loadPrivateTasks(dir)
        expect(loaded.manifest.suite_id).toBe('test-suite-001')
        expect(loaded.tasks).toHaveLength(1)
        expect(loaded.fatalErrors).toEqual([])
        expect(loaded.warnings).toEqual([])
        expect(loaded.tasks[0]!.prompt.requirement).toBe('build a durable queue')
        expect(loaded.tasks[0]!.rubric.blocking_findings[0]!.rule_id).toBe('placement.parallel-runtime')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('rejects a prompt that smuggles answer fields via additionalProperties false', () => {
      const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-'))
      try {
        writeFileSync(join(dir, 'manifest.yaml'), 'suite_id: test-suite-001\ntasks:\n  - holdout-001\n', 'utf8')
        writeFileSync(join(dir, 'holdout-001.prompt.yaml'), 'id: holdout-001\ncategory: seam-placement\nexpected_design: use the existing owner\nprompt:\n  requirement: build a durable queue\n  constraints: [cross-session]\n', 'utf8')
        writeFileSync(join(dir, 'holdout-001.rubric.yaml'), 'id: holdout-001\ncategory: seam-placement\nrubric:\n  blocking_findings:\n    - id: bf-01\n      severity: P0\n      rule_id: placement.parallel-runtime\n      condition: x\n  expected_properties: [single owner]\n  forbidden_patterns: []\n', 'utf8')
        const loaded = loadPrivateTasks(dir)
        expect(loaded.tasks).toHaveLength(0)
        expect(loaded.fatalErrors.some(error => error.includes('unexpected property'))).toBe(true)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('turns a manifest task missing its rubric into a fatal error, not a silent skip', () => {
      const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-'))
      try {
        writeFileSync(join(dir, 'manifest.yaml'), 'suite_id: test-suite-001\ntasks:\n  - holdout-001\n', 'utf8')
        writeFileSync(join(dir, 'holdout-001.prompt.yaml'), 'id: holdout-001\ncategory: seam-placement\nprompt:\n  requirement: build a durable queue\n  constraints: [cross-session]\n', 'utf8')
        const loaded = loadPrivateTasks(dir)
        expect(loaded.tasks).toHaveLength(0)
        expect(loaded.fatalErrors).toContain('manifest task holdout-001 missing rubric file')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('flags tasks outside the manifest as warnings', () => {
      const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-'))
      try {
        writeFileSync(join(dir, 'manifest.yaml'), 'suite_id: test-suite-001\ntasks:\n  - holdout-001\n', 'utf8')
        writeFileSync(join(dir, 'holdout-001.prompt.yaml'), 'id: holdout-001\ncategory: seam-placement\nprompt:\n  requirement: a\n  constraints: []\n', 'utf8')
        writeFileSync(join(dir, 'holdout-001.rubric.yaml'), 'id: holdout-001\ncategory: seam-placement\nrubric:\n  blocking_findings:\n    - id: bf-01\n      severity: P0\n      rule_id: r\n      condition: c\n  expected_properties: []\n  forbidden_patterns: []\n', 'utf8')
        writeFileSync(join(dir, 'holdout-999.prompt.yaml'), 'id: holdout-999\ncategory: seam-placement\nprompt:\n  requirement: b\n  constraints: []\n', 'utf8')
        const loaded = loadPrivateTasks(dir)
        expect(loaded.warnings.some(warning => warning.includes('holdout-999'))).toBe(true)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('throws when the suite manifest is missing', () => {
      const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-'))
      try {
        expect(() => loadSuiteManifest(dir)).toThrow(/suite manifest missing/)
        expect(() => loadPrivateTasks(dir)).toThrow(/suite manifest missing/)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('throws when the suite manifest declares no tasks', () => {
      const dir = mkdtempSync(join(tmpdir(), 'dsh-eval-'))
      try {
        writeFileSync(join(dir, 'manifest.yaml'), 'suite_id: test-suite-001\ntasks: []\n', 'utf8')
        expect(() => loadSuiteManifest(dir)).toThrow(/non-empty tasks/)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('hard invariants', () => {
    it('rejects a baseline that is not baseline-no-intelligence (causal variable gate)', () => {
      const result = evaluateHoldoutTrial(task, arm(), arm())
      expect(result.status).toBe('INVALID')
      expect(result.invalid_reasons.some(reason => reason.includes('baseline system'))).toBe(true)
    })

    it('rejects an intelligence arm that is not full-intelligence', () => {
      const result = evaluateHoldoutTrial(task, baseline(), baseline())
      expect(result.status).toBe('INVALID')
      expect(result.invalid_reasons.some(reason => reason.includes('intelligence system'))).toBe(true)
    })

    it('rejects a raw hash that merely looks like a hash', () => {
      const result = evaluateHoldoutTrial(task, baseline({ raw_hash: 'sha256:xyz' }), arm())
      expect(result.status).toBe('INVALID')
      expect(result.invalid_reasons.some(reason => reason.includes('sha256:64hex'))).toBe(true)
    })

    it('rejects a trial whose raw file content does not match the declared hash', () => {
      const ctx = { readRawFile: () => 'different content' }
      const result = evaluateHoldoutTrial(task, baseline(), arm(), ctx)
      expect(result.status).toBe('INVALID')
      expect(result.invalid_reasons.some(reason => reason.includes('hash mismatch'))).toBe(true)
    })

    it('rejects a trial whose raw output file is missing', () => {
      const ctx = { readRawFile: () => null }
      const result = evaluateHoldoutTrial(task, baseline(), arm(), ctx)
      expect(result.status).toBe('INVALID')
      expect(result.invalid_reasons.some(reason => reason.includes('raw output file missing'))).toBe(true)
    })

    it('accepts a trial when the raw file content matches the declared hash', () => {
      const raw = 'exact raw output'
      const raw_hash = `sha256:${sha256Hex(raw)}`
      const ctx = { readRawFile: () => raw }
      const result = evaluateHoldoutTrial(task, baseline({ raw_hash }), arm({ raw_hash }), ctx)
      expect(result.status).toBe('VALID')
    })
  })

  describe('evaluator provenance', () => {
    it('rejects a trial whose evaluator provenance is missing', () => {
      const broken = baseline() as unknown as Record<string, unknown>
      delete broken.evaluator
      const result = evaluateHoldoutTrial(task, broken as unknown as TrialArm, arm())
      expect(result.status).toBe('INVALID')
      expect(result.invalid_reasons.some(reason => reason.includes('evaluator provenance missing'))).toBe(true)
    })

    it('rejects when evaluator source_output_hash does not match the raw hash', () => {
      const result = evaluateHoldoutTrial(
        task,
        baseline({ evaluator_overrides: { source_output_hash: `sha256:${H64('b')}` } }),
        arm(),
      )
      expect(result.status).toBe('INVALID')
      expect(result.invalid_reasons.some(reason => reason.includes('source_output_hash'))).toBe(true)
    })

    it('rejects when normalized_findings_hash does not match the findings content', () => {
      const result = evaluateHoldoutTrial(
        task,
        baseline({ evaluator_overrides: { normalized_findings_hash: `sha256:${H64('c')}` } }),
        arm(),
      )
      expect(result.status).toBe('INVALID')
      expect(result.invalid_reasons.some(reason => reason.includes('normalized_findings_hash does not match'))).toBe(true)
    })

    it('rejects when evaluator rubric_hash does not match the task rubric file', () => {
      const ctx = { rubricContent: 'id: holdout-001\nrubric: {}\n' }
      const result = evaluateHoldoutTrial(task, baseline(), arm(), ctx)
      expect(result.status).toBe('INVALID')
      expect(result.invalid_reasons.some(reason => reason.includes('rubric_hash'))).toBe(true)
    })

    it('accepts when evaluator rubric_hash matches the task rubric file', () => {
      const rubricContent = 'id: holdout-001\nrubric: {}\n'
      const rubricHash = `sha256:${sha256Hex(rubricContent)}`
      const ctx = { rubricContent }
      const result = evaluateHoldoutTrial(
        task,
        baseline({ evaluator_overrides: { rubric_hash: rubricHash } }),
        arm({ evaluator_overrides: { rubric_hash: rubricHash } }),
        ctx,
      )
      expect(result.status).toBe('VALID')
    })
  })

  describe('primary metrics semantics', () => {
    it('a perfect answer expressed as grounded claims gets evidenceGroundingRate 1, not 0', () => {
      const perfect = computePrimaryMetrics([{ severity: 'P0', rule_id: 'evidence.grounded' }], task.rubric)
      expect(perfect.requiredClaims).toBe(1)
      expect(perfect.groundedRequiredClaims).toBe(1)
      expect(perfect.evidenceGroundingRate).toBe(1)
    })

    it('counts raw metrics instead of rate-normalizing against all findings', () => {
      const metrics = computePrimaryMetrics([
        { severity: 'P0', rule_id: 'placement.parallel-runtime' },
        { severity: 'P0', rule_id: 'hallucinated-symbol' },
        { severity: 'P1', rule_id: 'invention.rejected' },
        { severity: 'P0', rule_id: 'evidence.grounded' },
      ], task.rubric)
      expect(metrics.architectureBlockingFindings).toBe(3)
      expect(metrics.unsupportedInventions).toBe(1)
      expect(metrics.hallucinatedSymbols).toBe(1)
      expect(metrics.groundedRequiredClaims).toBe(1)
      expect(metrics.evidenceGroundingRate).toBe(1)
    })

    it('treats unclaimed grounding as not grounded (fail closed)', () => {
      const metrics = computePrimaryMetrics([], task.rubric)
      expect(metrics.evidenceGroundingRate).toBe(0)
    })

    it('treats a rubric with no required claims as fully grounded', () => {
      const metrics = computePrimaryMetrics([], { ...task.rubric, expected_properties: [] })
      expect(metrics.evidenceGroundingRate).toBe(1)
    })
  })

  describe('fail-closed and identity', () => {
    it('marks a trial INVALID when model execution failed (never counts as 0 findings)', () => {
      const result = evaluateHoldoutTrial(task, baseline({ execution_status: 'failed' }), arm())
      expect(result.status).toBe('INVALID')
      expect(result.invalid_reasons).toContain('baseline model execution failed')
    })

    it('marks a trial INVALID when required metrics are missing', () => {
      const result = evaluateHoldoutTrial(task, baseline({ metrics: {} }), arm())
      expect(result.status).toBe('INVALID')
      expect(result.invalid_reasons.some(reason => reason.includes('metrics'))).toBe(true)
    })

    it('marks a trial INVALID on paired-identity mismatch', () => {
      const result = evaluateHoldoutTrial(task, baseline(), arm({ identity: { ...identity, model: 'other-model' } }))
      expect(result.status).toBe('INVALID')
      expect(result.invalid_reasons.some(reason => reason.includes('model mismatch'))).toBe(true)
    })

    it('produces a VALID comparison and an intelligence_better verdict when blockers drop', () => {
      const result = evaluateHoldoutTrial(
        task,
        baseline({
          normalized_findings: [
            { severity: 'P0', rule_id: 'placement.parallel-runtime' },
            { severity: 'P0', rule_id: 'hallucinated-symbol' },
          ],
          metrics: { architectureBlockingFindings: 2 },
        }),
        arm({ normalized_findings: [], metrics: { architectureBlockingFindings: 0 } }),
      )
      expect(result.status).toBe('VALID')
      expect(result.comparison?.blocking_findings_delta).toBe(2)
      expect(result.comparison?.verdict).toBe('intelligence_better')
    })
  })

  describe('trial-result schema E2E', () => {
    it('a VALID result passes trial-result.schema.json', () => {
      const result = evaluateHoldoutTrial(task, baseline(), arm())
      expect(result.status).toBe('VALID')
      expect(validateSchema(result, TRIAL_RESULT_SCHEMA)).toEqual([])
    })

    it('an INVALID result also satisfies trial-result.schema.json', () => {
      const result = evaluateHoldoutTrial(task, baseline({ execution_status: 'failed' }), arm())
      expect(result.status).toBe('INVALID')
      expect(validateSchema(result, TRIAL_RESULT_SCHEMA)).toEqual([])
    })

    it('rejects a legacy runtime object with no identity on the arm', () => {
      const parsed = JSON.parse(JSON.stringify(evaluateHoldoutTrial(task, baseline(), arm()))) as {
        task_id: string
        status: string
        invalid_reasons: string[]
        arms?: { baseline: Record<string, unknown>; intelligence: Record<string, unknown> }
      }
      delete parsed.arms!.baseline.identity
      const errors = validateSchema(parsed, TRIAL_RESULT_SCHEMA)
      expect(errors.some(error => error.message.includes('missing required property identity'))).toBe(true)
    })
  })
})
