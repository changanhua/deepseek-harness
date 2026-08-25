/**
 * run-eval.ts — Paired eval 骨架（V0 验证切片）
 *
 * 读取 evals/visible-tasks/*.yaml 的 holdout 定义，计算领先/滞后指标：
 *  - weighted blocking finding score（P0=8, P1=3, P2=1）
 *  - placement.* blocker 数、hallucinated symbol 数、invention 被驳回率
 * 模型执行与 Reviewer 盲评由外部 adapter 提供 findings（--findings <json>），
 * 本脚本只负责度量与对照，不采信“模型说自己检查过”。
 *
 * 本脚本是 repo-tool（见 .agents/dsh-intelligence/self-adp.yaml）。
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
  const weightedBlockingScore = findings.reduce((sum, f) => sum + (WEIGHTS[f.severity] ?? 0), 0)
  const placementBlockers = findings.filter(f => f.rule_id?.startsWith('placement.') && f.severity === 'P0').length
  const hallucinatedSymbols = findings.filter(f => f.rule_id === 'hallucinated-symbol').length
  const inventionRejected = findings.filter(f => f.rule_id === 'invention.rejected').length
  return { weightedBlockingScore, placementBlockers, hallucinatedSymbols, inventionRejected }
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
  medianDurationRatio: number
  pass: boolean
}

/** baseline 与 full 两组对比；通过条件：≥3/4 降低 weighted blocking finding score 且耗时 ≤1.5×。 */
export function runPairedTrial(baseline: TrialGroup[], full: TrialGroup[]): PairedTrial {
  const byTask = (groups: TrialGroup[]) => new Map(groups.map(g => [g.task, g]))
  const baseMap = byTask(baseline)
  const fullMap = byTask(full)
  const tasks = Array.from(new Set([...baseMap.keys(), ...fullMap.keys()]))
  const results: PairedResult[] = tasks.map((task) => {
    const b = computeMetrics(baseMap.get(task)?.findings ?? [])
    const f = computeMetrics(fullMap.get(task)?.findings ?? [])
    return { task, baseline: b, full: f, improved: f.weightedBlockingScore < b.weightedBlockingScore }
  })
  const improvedCount = results.filter(r => r.improved).length
  const improvedRatio = results.length === 0 ? 0 : improvedCount / results.length

  const baseDurations = baseline.map(g => g.durationMs ?? 0).filter(d => d > 0)
  const fullDurations = full.map(g => g.durationMs ?? 0).filter(d => d > 0)
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }
  const medianDurationRatio = baseDurations.length && fullDurations.length ? median(fullDurations) / median(baseDurations) : 0

  const pass = improvedRatio >= 0.75 && medianDurationRatio <= 1.5
  return { results, improvedCount, improvedRatio, medianDurationRatio, pass }
}

export interface TaskDef {
  id?: string
  title?: string
  [key: string]: unknown
}

export function loadTasks(dir = join(ROOT, '.agents', 'dsh-intelligence', 'evals', 'visible-tasks')): TaskDef[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith('.yaml')).map(f =>
    loadYaml(readFileSync(join(dir, f), 'utf8')) as TaskDef)
}

function argValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag)
  if (idx >= 0) return args[idx + 1]
  const eq = args.find(a => a.startsWith(`${flag}=`))
  return eq ? eq.slice(flag.length + 1) : undefined
}

function main(): void {
  const args = process.argv.slice(2)
  const baseArg = argValue(args, '--baseline')
  const fullArg = argValue(args, '--full')
  const tasks = loadTasks()
  if (baseArg && fullArg) {
    const baseline: TrialGroup[] = JSON.parse(readFileSync(baseArg, 'utf8'))
    const full: TrialGroup[] = JSON.parse(readFileSync(fullArg, 'utf8'))
    const trial = runPairedTrial(baseline, full)
    console.log(JSON.stringify({ tasks: tasks.length, ...trial }, null, 2))
    return
  }
  const single: TrialGroup[] = tasks.map(t => ({ task: t.id, findings: [] }))
  const metrics = single.map(g => ({ task: g.task, ...computeMetrics(g.findings) }))
  console.log(JSON.stringify({ tasks: metrics.length, metrics }, null, 2))
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])

if (isMain) {
  main()
}
