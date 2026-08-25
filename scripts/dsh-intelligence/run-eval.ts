/**
 * run-eval.ts — Paired eval 度量器（V0）
 *
 * visible-tasks/ 是公开 regression suite，不是 holdout。正式 holdout 放在忽略目录
 * `.dsh-intelligence/private-evals/`，由外部 adapter 生成 baseline/full findings。
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export interface FindingInput {
  severity: 'P0' | 'P1' | 'P2'
  rule_id?: string
}

export interface EvalResult {
  task: string
  weightedBlockingScore: number
  placementBlockers: number
  hallucinatedSymbols: number
  inventionRejected: number
}

const WEIGHTS: Record<FindingInput['severity'], number> = { P0: 8, P1: 3, P2: 1 }

export function computeMetrics(findings: FindingInput[]): Omit<EvalResult, 'task'> {
  return {
    weightedBlockingScore: findings.reduce((sum, finding) => sum + WEIGHTS[finding.severity], 0),
    placementBlockers: findings.filter(finding => finding.rule_id?.startsWith('placement.') && finding.severity === 'P0').length,
    hallucinatedSymbols: findings.filter(finding => finding.rule_id === 'hallucinated-symbol').length,
    inventionRejected: findings.filter(finding => finding.rule_id === 'invention.rejected').length,
  }
}

export interface TrialGroup {
  task: string
  findings: FindingInput[]
  durationMs?: number
}

export interface PairedResult {
  task: string
  baseline: Omit<EvalResult, 'task'>
  full: Omit<EvalResult, 'task'>
  improved: boolean
}

export interface PairedTrial {
  results: PairedResult[]
  improvedCount: number
  improvedRatio: number
  durationAvailable: boolean
  medianDurationRatio: number | null
  pass: boolean
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function indexGroups(groups: TrialGroup[], label: string): Map<string, TrialGroup> {
  const map = new Map<string, TrialGroup>()
  for (const group of groups) {
    if (map.has(group.task)) throw new Error(`${label} contains duplicate task: ${group.task}`)
    map.set(group.task, group)
  }
  return map
}

function assertSameTaskSet(baseline: Map<string, TrialGroup>, full: Map<string, TrialGroup>): string[] {
  const baselineTasks = [...baseline.keys()].sort()
  const fullTasks = [...full.keys()].sort()
  if (baselineTasks.length !== fullTasks.length || baselineTasks.some((task, index) => task !== fullTasks[index])) {
    throw new Error(`paired trial task mismatch: baseline=[${baselineTasks.join(', ')}] full=[${fullTasks.join(', ')}]`)
  }
  if (baselineTasks.length === 0) throw new Error('paired trial requires at least one task')
  return baselineTasks
}

/** 通过条件：完整配对；≥3/4 task 降低 weighted blocker；duration 数据完整且中位数 ≤1.5x。 */
export function runPairedTrial(baseline: TrialGroup[], full: TrialGroup[]): PairedTrial {
  const baselineMap = indexGroups(baseline, 'baseline')
  const fullMap = indexGroups(full, 'full')
  const tasks = assertSameTaskSet(baselineMap, fullMap)

  const results = tasks.map((task) => {
    const baselineMetrics = computeMetrics(baselineMap.get(task)?.findings ?? [])
    const fullMetrics = computeMetrics(fullMap.get(task)?.findings ?? [])
    return {
      task,
      baseline: baselineMetrics,
      full: fullMetrics,
      improved: fullMetrics.weightedBlockingScore < baselineMetrics.weightedBlockingScore,
    }
  })
  const improvedCount = results.filter(result => result.improved).length
  const improvedRatio = improvedCount / results.length

  const durationAvailable = baseline.every(group => typeof group.durationMs === 'number' && group.durationMs > 0)
    && full.every(group => typeof group.durationMs === 'number' && group.durationMs > 0)
  const medianDurationRatio = durationAvailable
    ? median(full.map(group => group.durationMs as number)) / median(baseline.map(group => group.durationMs as number))
    : null

  const pass = improvedRatio >= 0.75 && durationAvailable && medianDurationRatio !== null && medianDurationRatio <= 1.5
  return { results, improvedCount, improvedRatio, durationAvailable, medianDurationRatio, pass }
}


// ---------------------------------------------------------------------------
// Private-holdout paired eval 协议（.dsh-intelligence/private-evals/**，永不提交）
// ---------------------------------------------------------------------------

export interface HoldoutPrompt {
  requirement: string
  constraints: string[]
}

export interface RubricFinding {
  id: string
  severity: 'P0' | 'P1' | 'P2'
  rule_id: string
  condition: string
}

export interface HoldoutRubric {
  blocking_findings: RubricFinding[]
  expected_properties: string[]
  forbidden_patterns: string[]
  severity_weights?: Partial<Record<FindingInput['severity'], number>>
}

export interface HoldoutTask {
  id: string
  category: string
  prompt: HoldoutPrompt
  rubric: HoldoutRubric
}

export interface TrialIdentity {
  prompt_hash: string
  model: string
  temperature: number
  max_tokens: number
  seed: number | null
}

export interface TrialArm {
  system: 'baseline-no-intelligence' | 'full-intelligence'
  identity: TrialIdentity
  raw_output_hash: string
  execution_status: 'success' | 'failed' | 'missing'
  normalized_findings: FindingInput[]
  metrics: Record<string, unknown>
}

export interface HoldoutTrialResult {
  task_id: string
  status: 'VALID' | 'INVALID'
  invalid_reasons: string[]
  identity?: TrialIdentity
  arms?: { baseline: TrialArm; intelligence: TrialArm }
  comparison?: Comparison | null
}

export interface Comparison {
  baseline: PrimaryMetrics
  intelligence: PrimaryMetrics
  blocking_findings_delta: number
  unsupported_invention_delta: number
  hallucinated_symbol_delta: number
  evidence_grounding_delta: number
  verdict: 'baseline_better' | 'intelligence_better' | 'tie'
}

export interface PrimaryMetrics {
  architectureBlockingFindings: number
  unsupportedInventionRate: number
  hallucinatedSymbolRate: number
  evidenceGroundingRate: number
}

/** 读 private holdout tasks：按 `<id>.prompt.yaml` + `<id>.rubric.yaml` 配对。 */
export function loadPrivateTasks(tasksDir: string): HoldoutTask[] {
  if (!existsSync(tasksDir)) return []
  const tasks: HoldoutTask[] = []
  for (const file of readdirSync(tasksDir).filter(name => name.endsWith('.prompt.yaml'))) {
    const id = file.replace(/\.prompt\.yaml$/, '')
    const rubricFile = join(tasksDir, `${id}.rubric.yaml`)
    if (!existsSync(rubricFile)) continue
    const promptDoc = loadYaml(readFileSync(join(tasksDir, file), 'utf8')) as HoldoutTask
    const rubricDoc = loadYaml(readFileSync(rubricFile, 'utf8')) as HoldoutTask
    tasks.push({
      id: promptDoc.id ?? id,
      category: promptDoc.category ?? '',
      prompt: promptDoc.prompt,
      rubric: rubricDoc.rubric,
    })
  }
  return tasks
}

/** 协议 2：paired identity 必须一致；返回不一致原因（空 = 一致）。 */
export function validatePairIdentity(baseline: TrialIdentity, intelligence: TrialIdentity): string[] {
  const reasons: string[] = []
  if (baseline.prompt_hash !== intelligence.prompt_hash) reasons.push(`prompt hash mismatch: ${baseline.prompt_hash} vs ${intelligence.prompt_hash}`)
  if (baseline.model !== intelligence.model) reasons.push(`model mismatch: ${baseline.model} vs ${intelligence.model}`)
  if (baseline.temperature !== intelligence.temperature) reasons.push(`temperature mismatch: ${baseline.temperature} vs ${intelligence.temperature}`)
  if (baseline.max_tokens !== intelligence.max_tokens) reasons.push(`max_tokens mismatch: ${baseline.max_tokens} vs ${intelligence.max_tokens}`)
  if (baseline.seed !== intelligence.seed) reasons.push(`seed mismatch: ${baseline.seed} vs ${intelligence.seed}`)
  return reasons
}

/** 主指标：第一轮最看重的四个。分数只来自 normalized findings（由不可变 raw 派生）。 */
export function computePrimaryMetrics(findings: FindingInput[], rubric?: HoldoutRubric): PrimaryMetrics {
  const total = findings.length
  const blocking = findings.filter(finding => finding.severity === 'P0').length
  const unsupportedInvention = findings.filter(finding => /invent|invention/.test(finding.rule_id ?? '')).length
  const hallucinated = findings.filter(finding => finding.rule_id === 'hallucinated-symbol').length
  const evidenceGap = findings.filter(finding => finding.rule_id === 'evidence.gap' || finding.rule_id === 'evidence.ungrounded').length
  return {
    architectureBlockingFindings: blocking,
    unsupportedInventionRate: total > 0 ? unsupportedInvention / total : 0,
    hallucinatedSymbolRate: total > 0 ? hallucinated / total : 0,
    evidenceGroundingRate: total > 0 ? 1 - evidenceGap / total : (rubric?.expected_properties?.length ? 0 : 1),
  }
}

function compareArms(baseline: PrimaryMetrics, intelligence: PrimaryMetrics): Comparison {
  const blockingDelta = baseline.architectureBlockingFindings - intelligence.architectureBlockingFindings
  const unsupportedDelta = baseline.unsupportedInventionRate - intelligence.unsupportedInventionRate
  const hallucinatedDelta = baseline.hallucinatedSymbolRate - intelligence.hallucinatedSymbolRate
  const groundingDelta = intelligence.evidenceGroundingRate - baseline.evidenceGroundingRate
  const score = blockingDelta + unsupportedDelta + hallucinatedDelta + groundingDelta
  const verdict = score > 0 ? 'intelligence_better' : score < 0 ? 'baseline_better' : 'tie'
  return {
    baseline,
    intelligence,
    blocking_findings_delta: blockingDelta,
    unsupported_invention_delta: unsupportedDelta,
    hallucinated_symbol_delta: hallucinatedDelta,
    evidence_grounding_delta: groundingDelta,
    verdict,
  }
}

/**
 * 协议 4（fail-closed）+ 5（raw immutable）+ 2（paired identity）：
 * 任一致命条件 → INVALID，绝不按 0 finding 计分。
 */
export function evaluateHoldoutTrial(
  task: HoldoutTask,
  baseline: TrialArm,
  intelligence: TrialArm,
): HoldoutTrialResult {
  const reasons: string[] = []
  if (!task?.rubric || !Array.isArray(task.rubric.blocking_findings) || task.rubric.blocking_findings.length === 0) {
    reasons.push('evaluator missing rubric')
  }
  if (baseline.execution_status !== 'success') reasons.push('baseline model execution failed')
  if (intelligence.execution_status !== 'success') reasons.push('intelligence model execution failed')
  if (!/^sha256:/.test(baseline.raw_output_hash)) reasons.push('baseline raw output not immutable (missing sha256 hash)')
  if (!/^sha256:/.test(intelligence.raw_output_hash)) reasons.push('intelligence raw output not immutable (missing sha256 hash)')
  if (typeof baseline.metrics?.architectureBlockingFindings !== 'number') reasons.push('baseline missing required metrics')
  if (typeof intelligence.metrics?.architectureBlockingFindings !== 'number') reasons.push('intelligence missing required metrics')
  reasons.push(...validatePairIdentity(baseline.identity, intelligence.identity))

  if (reasons.length > 0) {
    return { task_id: task.id, status: 'INVALID', invalid_reasons: reasons }
  }
  const baselineMetrics = computePrimaryMetrics(baseline.normalized_findings, task.rubric)
  const intelligenceMetrics = computePrimaryMetrics(intelligence.normalized_findings, task.rubric)
  return {
    task_id: task.id,
    status: 'VALID',
    invalid_reasons: [],
    identity: baseline.identity,
    arms: { baseline, intelligence },
    comparison: compareArms(baselineMetrics, intelligenceMetrics),
  }
}

export interface TaskDef {
  id?: string
  title?: string
  [key: string]: unknown
}

export function loadTasks(dir = join(ROOT, '.agents', 'dsh-intelligence', 'evals', 'visible-tasks')): TaskDef[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(file => file.endsWith('.yaml'))
    .map(file => loadYaml(readFileSync(join(dir, file), 'utf8')) as TaskDef)
}

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index >= 0) return args[index + 1]
  const equal = args.find(arg => arg.startsWith(`${flag}=`))
  return equal?.slice(flag.length + 1)
}

/** 私有 holdout 模式：读 tasks 目录 + run 目录，产出 comparison.json 与四主指标汇总。 */
function runPrivateHoldout(runDir: string, tasksDir: string): void {
  const tasks = loadPrivateTasks(tasksDir)
  const results: HoldoutTrialResult[] = tasks.map((task) => {
    const baseFile = join(runDir, 'baseline', `${task.id}.json`)
    const fullFile = join(runDir, 'intelligence', `${task.id}.json`)
    if (!existsSync(baseFile) || !existsSync(fullFile)) {
      return { task_id: task.id, status: 'INVALID', invalid_reasons: ['missing arm output file'] }
    }
    const baseline = JSON.parse(readFileSync(baseFile, 'utf8')) as TrialArm
    const intelligence = JSON.parse(readFileSync(fullFile, 'utf8')) as TrialArm
    return evaluateHoldoutTrial(task, baseline, intelligence)
  })

  const valid = results.filter(result => result.status === 'VALID')
  const invalid = results.filter(result => result.status === 'INVALID')
  const summary = {
    tasks: results.length,
    valid: valid.length,
    invalid: invalid.length,
    invalidReasons: [...new Set(invalid.flatMap(result => result.invalid_reasons))],
    verdicts: Object.fromEntries(
      ['intelligence_better', 'baseline_better', 'tie'].map(v => [v, valid.filter(r => r.comparison?.verdict === v).length]),
    ),
    primary: {
      meanBlockingFindingsDelta: mean(valid.map(r => r.comparison?.blocking_findings_delta ?? 0)),
      meanUnsupportedInventionDelta: mean(valid.map(r => r.comparison?.unsupported_invention_delta ?? 0)),
      meanHallucinatedSymbolDelta: mean(valid.map(r => r.comparison?.hallucinated_symbol_delta ?? 0)),
      meanEvidenceGroundingDelta: mean(valid.map(r => r.comparison?.evidence_grounding_delta ?? 0)),
    },
  }

  const comparisonFile = join(runDir, 'comparison.json')
  writeFileSync(comparisonFile, `${JSON.stringify({ results, summary }, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ suite: 'private-holdout', summary, comparison: comparisonFile }, null, 2))
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function main(): void {
  const args = process.argv.slice(2)
  const runDir = argValue(args, '--run-dir')
  const tasksDirArg = argValue(args, '--tasks-dir')

  if (runDir && tasksDirArg) {
    runPrivateHoldout(resolve(ROOT, runDir), resolve(ROOT, tasksDirArg))
    return
  }

  const baselineFile = argValue(args, '--baseline')
  const fullFile = argValue(args, '--full')
  const tasks = loadTasks(tasksDirArg ? resolve(ROOT, tasksDirArg) : undefined)

  if (baselineFile && fullFile) {
    try {
      const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as TrialGroup[]
      const full = JSON.parse(readFileSync(fullFile, 'utf8')) as TrialGroup[]
      const trial = runPairedTrial(baseline, full)
      console.log(JSON.stringify({ visibleTaskDefinitions: tasks.length, ...trial }, null, 2))
      process.exit(trial.pass ? 0 : 1)
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(2)
    }
  }

  const metrics = tasks.map(task => ({ task: task.id, ...computeMetrics([]) }))
  console.log(JSON.stringify({ suite: 'visible-regression', tasks: metrics.length, metrics }, null, 2))
}

const isMain = process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])
if (isMain) main()
