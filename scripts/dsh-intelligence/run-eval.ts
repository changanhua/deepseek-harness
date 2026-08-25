/**
 * run-eval.ts — Paired eval 度量器（V0）
 *
 * visible-tasks/ 是公开 regression suite，不是 holdout。正式 holdout 放在忽略目录
 * `.dsh-intelligence/private-evals/`，由外部 adapter 生成 baseline/full findings。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
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

  const results = tasks.map(task => {
    const baselineMetrics = computeMetrics(baselineMap.get(task)!.findings)
    const fullMetrics = computeMetrics(fullMap.get(task)!.findings)
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

function main(): void {
  const args = process.argv.slice(2)
  const baselineFile = argValue(args, '--baseline')
  const fullFile = argValue(args, '--full')
  const tasksDir = argValue(args, '--tasks-dir')
  const tasks = loadTasks(tasksDir ? resolve(ROOT, tasksDir) : undefined)

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
