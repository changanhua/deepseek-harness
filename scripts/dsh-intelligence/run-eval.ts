/**
 * run-eval.ts — Paired eval 度量器（V0）
 *
 * visible-tasks/ 是公开 regression suite，不是 holdout。正式 holdout 放在忽略目录
 * `.dsh-intelligence/private-evals/`，由外部 adapter 生成 baseline/full findings。
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as loadYaml } from 'js-yaml'
import { validateSchema } from './validate-adp.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EVALS_DIR = join(ROOT, '.agents', 'dsh-intelligence', 'evals')

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

const SHA256_RE = /^sha256:[0-9a-f]{64}$/
const EVIDENCE_GROUNDED = 'evidence.grounded'
const MANIFEST_TASK_RE = /^holdout-\d{3}$/

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

export interface SuiteManifest {
  suite_id: string
  tasks: string[]
}

export interface TrialIdentity {
  prompt_hash: string
  model: string
  temperature: number
  max_tokens: number
  seed: number | null
}

export interface EvaluatorProvenance {
  evaluator_type: 'deterministic' | 'llm'
  evaluator_model?: string
  evaluator_prompt_hash: string
  rubric_hash: string
  source_output_hash: string
  evaluator_version: string
  normalized_findings_hash: string
}

export interface TrialArm {
  system: 'baseline-no-intelligence' | 'full-intelligence'
  identity: TrialIdentity
  raw_output_ref: string
  raw_output_hash: string
  execution_status: 'success' | 'failed' | 'missing'
  normalized_findings: FindingInput[]
  metrics: Record<string, unknown>
  evaluator: EvaluatorProvenance
}

export interface HoldoutTrialResult {
  task_id: string
  status: 'VALID' | 'INVALID'
  invalid_reasons: string[]
  identity?: TrialIdentity
  arms?: { baseline: TrialArm; intelligence: TrialArm }
  comparison?: Comparison | null
}

export interface PrimaryMetrics {
  architectureBlockingFindings: number
  unsupportedInventions: number
  hallucinatedSymbols: number
  groundedRequiredClaims: number
  requiredClaims: number
  evidenceGroundingRate: number
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

export interface TaskLoadResult {
  manifest: SuiteManifest
  tasks: HoldoutTask[]
  /** manifest 任务缺文件 / schema 失败 / id 不一致 —— 判 INVALID，绝不静默跳过。 */
  fatalErrors: string[]
  /** manifest 之外的多余任务 —— 仅提示。 */
  warnings: string[]
}

export interface EvalContext {
  /** 读取 arm 引用的 raw output 文件内容；文件缺失返回 null。 */
  readRawFile?: (arm: TrialArm) => string | null
  /** 该任务 rubric 文件原文（校验 evaluator.rubric_hash 与当前任务文件一致）。 */
  rubricContent?: string | undefined
}

/** sha256(content) 的 64 位 hex；raw / rubric / findings 的不可变指纹都用它。 */
export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function loadEvalSchema(name: string): unknown {
  return JSON.parse(readFileSync(join(EVALS_DIR, name), 'utf8'))
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

/** 读 suite manifest（tasks 目录锁定任务全集；缺失/非法即套件失败）。 */
export function loadSuiteManifest(tasksDir: string): SuiteManifest {
  const manifestFile = join(tasksDir, 'manifest.yaml')
  if (!existsSync(manifestFile)) throw new Error(`suite manifest missing: ${manifestFile}`)
  const doc = loadYaml(readFileSync(manifestFile, 'utf8')) as Partial<SuiteManifest>
  if (typeof doc.suite_id !== 'string' || doc.suite_id.length === 0) {
    throw new Error(`suite manifest must declare non-empty suite_id: ${manifestFile}`)
  }
  if (!Array.isArray(doc.tasks) || doc.tasks.length === 0) {
    throw new Error(`suite manifest must declare a non-empty tasks list: ${manifestFile}`)
  }
  for (const id of doc.tasks) {
    if (typeof id !== 'string' || !MANIFEST_TASK_RE.test(id)) {
      throw new Error(`suite manifest task id must match ${MANIFEST_TASK_RE}: ${id}`)
    }
  }
  return { suite_id: doc.suite_id, tasks: [...doc.tasks] }
}

/**
 * 按 manifest 驱动加载 private holdout tasks：manifest 是任务全集，目录里多出来 / 少掉的都显式暴露。
 * prompt / rubric 各用独立 schema 真校验（additionalProperties:false 结构上禁止答案混入 prompt）。
 */
export function loadPrivateTasks(tasksDir: string): TaskLoadResult {
  if (!existsSync(tasksDir)) throw new Error(`tasks dir missing: ${tasksDir}`)
  const manifest = loadSuiteManifest(tasksDir)
  const promptSchema = loadEvalSchema('holdout-prompt.schema.json')
  const rubricSchema = loadEvalSchema('holdout-rubric.schema.json')
  const tasks: HoldoutTask[] = []
  const fatalErrors: string[] = []
  const warnings: string[] = []

  const seen = new Set<string>()
  for (const id of manifest.tasks) {
    const promptFile = join(tasksDir, `${id}.prompt.yaml`)
    const rubricFile = join(tasksDir, `${id}.rubric.yaml`)
    seen.add(id)
    const missing: string[] = []
    if (!existsSync(promptFile)) missing.push('prompt')
    if (!existsSync(rubricFile)) missing.push('rubric')
    if (missing.length > 0) {
      fatalErrors.push(`manifest task ${id} missing ${missing.join(' and ')} file`)
      continue
    }
    const promptDoc = loadYaml(readFileSync(promptFile, 'utf8'))
    const rubricDoc = loadYaml(readFileSync(rubricFile, 'utf8'))
    const promptErrors = validateSchema(promptDoc, promptSchema)
    const rubricErrors = validateSchema(rubricDoc, rubricSchema)
    const docIdMismatch: string[] = []
    if ((promptDoc as { id?: unknown }).id !== id) docIdMismatch.push('prompt.id')
    if ((rubricDoc as { id?: unknown }).id !== id) docIdMismatch.push('rubric.id')
    if (promptErrors.length > 0 || rubricErrors.length > 0 || docIdMismatch.length > 0) {
      const parts = [
        ...promptErrors.map(error => `prompt${error.path} ${error.message}`),
        ...rubricErrors.map(error => `rubric${error.path} ${error.message}`),
        ...docIdMismatch.map(field => `${field} != ${id}`),
      ]
      fatalErrors.push(`task ${id} load failed: ${parts.join('; ')}`)
      continue
    }
    tasks.push({
      id,
      category: (promptDoc as HoldoutTask).category,
      prompt: (promptDoc as HoldoutTask).prompt,
      rubric: (rubricDoc as HoldoutTask).rubric,
    })
  }
  for (const file of readdirSync(tasksDir)) {
    const match = /^(.+)\.prompt\.yaml$/.exec(file)
    const extraId = match?.[1]
    if (extraId !== undefined && !seen.has(extraId)) warnings.push(`extra task not in manifest: ${extraId}`)
  }
  return { manifest, tasks, fatalErrors, warnings }
}

/** 主指标：先记原始计数；evidence_grounding_rate = grounded required claims / required claims（required=0 视为全 grounded）。 */
export function computePrimaryMetrics(findings: FindingInput[], rubric?: HoldoutRubric): PrimaryMetrics {
  const requiredClaims = rubric ? rubric.expected_properties.length : 0
  const groundedRequiredClaims = findings.filter(finding => finding.rule_id === EVIDENCE_GROUNDED).length
  return {
    architectureBlockingFindings: findings.filter(finding => finding.severity === 'P0').length,
    unsupportedInventions: findings.filter(finding => /invent|invention/.test(finding.rule_id ?? '')).length,
    hallucinatedSymbols: findings.filter(finding => finding.rule_id === 'hallucinated-symbol').length,
    groundedRequiredClaims,
    requiredClaims,
    evidenceGroundingRate: requiredClaims > 0 ? Math.min(groundedRequiredClaims, requiredClaims) / requiredClaims : 1,
  }
}

function compareArms(baseline: PrimaryMetrics, intelligence: PrimaryMetrics): Comparison {
  const blockingDelta = baseline.architectureBlockingFindings - intelligence.architectureBlockingFindings
  const unsupportedDelta = baseline.unsupportedInventions - intelligence.unsupportedInventions
  const hallucinatedDelta = baseline.hallucinatedSymbols - intelligence.hallucinatedSymbols
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

function rawImmutableReasons(arm: TrialArm, label: string, ctx: EvalContext): string[] {
  const reasons: string[] = []
  if (typeof arm.raw_output_hash !== 'string' || !SHA256_RE.test(arm.raw_output_hash)) {
    reasons.push(`${label} raw output not immutable (expected sha256:64hex, got ${arm.raw_output_hash})`)
    return reasons
  }
  if (typeof arm.raw_output_ref !== 'string' || arm.raw_output_ref.length === 0) {
    reasons.push(`${label} raw_output_ref missing`)
    return reasons
  }
  if (ctx.readRawFile) {
    const content = ctx.readRawFile(arm)
    if (content === null) {
      reasons.push(`${label} raw output file missing: ${arm.raw_output_ref}`)
    } else {
      const actual = sha256Hex(content)
      if (`sha256:${actual}` !== arm.raw_output_hash) {
        reasons.push(`${label} raw output hash mismatch: declared ${arm.raw_output_hash} vs file sha256:${actual}`)
      }
    }
  }
  return reasons
}

function evaluatorReasons(arm: TrialArm, label: string, ctx: EvalContext): string[] {
  const reasons: string[] = []
  const evaluator: unknown = arm.evaluator
  if (!evaluator || typeof evaluator !== 'object') {
    reasons.push(`${label} evaluator provenance missing`)
    return reasons
  }
  const record = evaluator as Record<string, unknown>
  if (record.evaluator_type !== 'deterministic' && record.evaluator_type !== 'llm') {
    reasons.push(`${label} invalid evaluator_type`)
  }
  for (const field of ['evaluator_prompt_hash', 'rubric_hash', 'source_output_hash', 'normalized_findings_hash'] as const) {
    const hash = record[field]
    if (typeof hash !== 'string' || !SHA256_RE.test(hash)) {
      reasons.push(`${label} evaluator ${field} not a sha256:64hex hash`)
    }
  }
  if (typeof record.evaluator_version !== 'string' || record.evaluator_version.length === 0) {
    reasons.push(`${label} evaluator_version missing`)
  }
  if (record.source_output_hash !== arm.raw_output_hash) {
    reasons.push(`${label} evaluator source_output_hash does not match raw_output_hash`)
  }
  const findings = arm.normalized_findings as FindingInput[] | undefined
  const findingsHash = sha256Hex(JSON.stringify(findings ?? []))
  if (record.normalized_findings_hash !== `sha256:${findingsHash}`) {
    reasons.push(`${label} normalized_findings_hash does not match findings content`)
  }
  if (typeof ctx.rubricContent === 'string') {
    const rubricHash = sha256Hex(ctx.rubricContent)
    if (record.rubric_hash !== `sha256:${rubricHash}`) {
      reasons.push(`${label} evaluator rubric_hash does not match task rubric file`)
    }
  }
  return reasons
}

/**
 * 协议 2/3/4/5/7 fail-closed 汇总：任一致命条件 → INVALID，绝不按 0 finding 计分。
 * ctx 提供 raw 文件读取与 rubric 原文复验；不传则跳过文件级校验。
 */
export function evaluateHoldoutTrial(
  task: HoldoutTask,
  baseline: TrialArm,
  intelligence: TrialArm,
  ctx: EvalContext = {},
): HoldoutTrialResult {
  const reasons: string[] = []
  const rubric = task.rubric as HoldoutRubric | undefined
  if (!rubric || !Array.isArray(rubric.blocking_findings) || rubric.blocking_findings.length === 0) {
    reasons.push('evaluator missing rubric')
  }
  if (baseline.execution_status !== 'success') reasons.push('baseline model execution failed')
  if (intelligence.execution_status !== 'success') reasons.push('intelligence model execution failed')
  if (baseline.system !== 'baseline-no-intelligence') reasons.push(`baseline system must be baseline-no-intelligence, got ${baseline.system}`)
  if (intelligence.system !== 'full-intelligence') reasons.push(`intelligence system must be full-intelligence, got ${intelligence.system}`)
  reasons.push(...rawImmutableReasons(baseline, 'baseline', ctx))
  reasons.push(...rawImmutableReasons(intelligence, 'intelligence', ctx))
  reasons.push(...evaluatorReasons(baseline, 'baseline', ctx))
  reasons.push(...evaluatorReasons(intelligence, 'intelligence', ctx))
  const baselineMetricsRecord = baseline.metrics as Record<string, unknown> | undefined
  const intelligenceMetricsRecord = intelligence.metrics as Record<string, unknown> | undefined
  if (typeof baselineMetricsRecord?.architectureBlockingFindings !== 'number') reasons.push('baseline missing required metrics')
  if (typeof intelligenceMetricsRecord?.architectureBlockingFindings !== 'number') reasons.push('intelligence missing required metrics')
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

/** 私有 holdout 模式：按 manifest 枚举任务，产出 comparison.json 与四主指标汇总；无 VALID trial → 抛错（非零退出）。 */
function runPrivateHoldout(runDir: string, tasksDir: string): void {
  const loaded = loadPrivateTasks(tasksDir)
  const { manifest, tasks, fatalErrors, warnings } = loaded

  const rubricContents = new Map<string, string>()
  for (const task of tasks) {
    rubricContents.set(task.id, readFileSync(join(tasksDir, `${task.id}.rubric.yaml`), 'utf8'))
  }

  const results: HoldoutTrialResult[] = []
  for (const id of manifest.tasks) {
    const task = tasks.find(candidate => candidate.id === id)
    if (!task) {
      const taskError = fatalErrors.find(error => error.includes(`task ${id} `) || error.includes(`task ${id}:`))
      results.push({ task_id: id, status: 'INVALID', invalid_reasons: [taskError ?? 'task load failed'] })
      continue
    }
    const baseFile = join(runDir, 'baseline', `${id}.json`)
    const fullFile = join(runDir, 'intelligence', `${id}.json`)
    if (!existsSync(baseFile) || !existsSync(fullFile)) {
      results.push({ task_id: id, status: 'INVALID', invalid_reasons: ['missing arm output file'] })
      continue
    }
    const baseline = JSON.parse(readFileSync(baseFile, 'utf8')) as TrialArm
    const intelligence = JSON.parse(readFileSync(fullFile, 'utf8')) as TrialArm
    const ctx: EvalContext = {
      readRawFile: (arm) => {
        const rawPath = resolve(runDir, arm.raw_output_ref)
        return existsSync(rawPath) ? readFileSync(rawPath, 'utf8') : null
      },
      rubricContent: rubricContents.get(id),
    }
    results.push(evaluateHoldoutTrial(task, baseline, intelligence, ctx))
  }

  const valid = results.filter(result => result.status === 'VALID')
  const invalid = results.filter(result => result.status === 'INVALID')
  const summary = {
    suite_id: manifest.suite_id,
    tasks: results.length,
    valid: valid.length,
    invalid: invalid.length,
    fatalErrors: [...new Set(fatalErrors)],
    warnings: [...new Set(warnings)],
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

  if (valid.length === 0) {
    throw new Error(`private-holdout suite produced no VALID trial (tasks=${results.length}, invalid=${invalid.length})`)
  }
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function main(): void {
  const args = process.argv.slice(2)
  const runDir = argValue(args, '--run-dir')
  const tasksDirArg = argValue(args, '--tasks-dir')

  if (runDir && tasksDirArg) {
    try {
      runPrivateHoldout(resolve(ROOT, runDir), resolve(ROOT, tasksDirArg))
    } catch (error) {
      console.error(`private-holdout suite failed: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
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
