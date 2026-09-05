/** Generate a read-only latest-upstream compatibility report for the personal fork. */

import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { matchesCorePatchPath } from './check-core-patch-budget.ts'

interface Baseline {
  readonly observedUpstreamHeadSha: string
  readonly recordedPersonalHeadSha: string
  readonly supportedUpstreamBase: { readonly sha: string }
}

interface RegisteredPatch {
  readonly id: string
  readonly status: 'active' | 'retired'
  readonly kind: string
  readonly title: string
  readonly affectedFiles: readonly string[]
  readonly risk: { readonly level: string; readonly points: number }
  readonly heatmap: { readonly architectureCentrality: number; readonly dataMigrationRisk: number }
}

interface Registry {
  readonly patches: readonly RegisteredPatch[]
}

export interface CompatibilityHotspot {
  readonly patchId: string
  readonly title: string
  readonly kind: string
  readonly riskLevel: string
  readonly privatePathCount: number
  readonly upstreamPathCount: number
  readonly upstreamCommitCount: number
  readonly conflictPathCount: number
  readonly architectureCentrality: number
  readonly dataMigrationRisk: number
  readonly score: number
  readonly upstreamPaths: readonly string[]
  readonly conflictPaths: readonly string[]
}

export interface UpstreamCompatibilityReport {
  readonly schemaVersion: 1
  readonly generatedAt: string
  readonly personalHeadSha: string
  readonly supportedUpstreamBaseSha: string
  readonly recordedUpstreamHeadSha: string
  readonly targetUpstreamHeadSha: string
  readonly upstreamChanged: boolean
  readonly heavyChecksRequired: boolean
  readonly mergeStatus: 'clean' | 'conflicts' | 'not-run'
  readonly conflictPaths: readonly string[]
  readonly upstreamChangedPaths: readonly string[]
  readonly changedPackages: readonly string[]
  readonly hotspots: readonly CompatibilityHotspot[]
}

function git(root: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
}

function changedPaths(root: string, from: string, to: string): string[] {
  const output = git(root, [
    'diff', '--name-only', '--find-renames', `${from}..${to}`, '--', '.', ':(exclude)vendor/**',
  ])
  return output === '' ? [] : output.split(/\r?\n/u).sort()
}

function changedPackages(paths: readonly string[]): string[] {
  return [...new Set(paths.flatMap((path) => {
    const segments = path.split('/')
    if (segments[0] === 'packages' && segments.length >= 4) {
      return [segments.slice(0, 3).join('/')]
    }
    if (segments[0] === 'apps' && segments.length >= 3) {
      return [segments.slice(0, 2).join('/')]
    }
    return []
  }))].sort()
}

function syntheticMerge(
  root: string,
  personalHead: string,
  upstreamHead: string,
  upstreamPaths: readonly string[],
): { conflictPaths: string[]; status: 'clean' | 'conflicts' } {
  const result = spawnSync('git', [
    '-C', root, 'merge-tree', '--write-tree', '--name-only', '--no-messages', personalHead, upstreamHead,
  ], { encoding: 'utf8' })
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git merge-tree failed: ${result.stderr.trim() || result.stdout.trim()}`)
  }
  const upstreamSet = new Set(upstreamPaths)
  const conflictPaths = result.stdout
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => upstreamSet.has(line))
    .sort()
  return { conflictPaths, status: result.status === 0 ? 'clean' : 'conflicts' }
}

function upstreamCommitCount(
  root: string,
  from: string,
  to: string,
  paths: readonly string[],
): number {
  if (paths.length === 0) return 0
  const output = git(root, ['log', '--format=%H', `${from}..${to}`, '--', ...paths])
  return output === '' ? 0 : new Set(output.split(/\r?\n/u)).size
}

function hotspots(
  root: string,
  recordedUpstreamHead: string,
  targetUpstreamHead: string,
  registry: Registry,
  personalPaths: readonly string[],
  upstreamPaths: readonly string[],
  conflictPaths: readonly string[],
): CompatibilityHotspot[] {
  const conflictSet = new Set(conflictPaths)
  const rows: CompatibilityHotspot[] = []
  for (const patch of registry.patches) {
    if (patch.status !== 'active') continue
    const personal = personalPaths.filter(path => patch.affectedFiles.some(pattern => matchesCorePatchPath(pattern, path)))
    const upstream = upstreamPaths.filter(path => patch.affectedFiles.some(pattern => matchesCorePatchPath(pattern, path)))
    if (upstream.length === 0) continue
    const conflicts = upstream.filter(path => conflictSet.has(path))
    const commitCount = upstreamCommitCount(root, recordedUpstreamHead, targetUpstreamHead, upstream)
    rows.push({
      patchId: patch.id,
      title: patch.title,
      kind: patch.kind,
      riskLevel: patch.risk.level,
      privatePathCount: personal.length,
      upstreamPathCount: upstream.length,
      upstreamCommitCount: commitCount,
      conflictPathCount: conflicts.length,
      architectureCentrality: patch.heatmap.architectureCentrality,
      dataMigrationRisk: patch.heatmap.dataMigrationRisk,
      score: Math.max(1, personal.length)
        * Math.max(1, commitCount)
        * patch.heatmap.architectureCentrality
        * patch.heatmap.dataMigrationRisk,
      upstreamPaths: upstream,
      conflictPaths: conflicts,
    })
  }
  return rows.sort((left, right) => right.score - left.score || left.patchId.localeCompare(right.patchId))
}

/** Build the report without modifying the checkout or any branch ref. */
export function generateUpstreamCompatibilityReport(
  root: string,
  upstreamRef: string,
  now: Date = new Date(),
): UpstreamCompatibilityReport {
  const baseline = JSON.parse(readFileSync(resolve(root, 'upstream-base.json'), 'utf8')) as Baseline
  const registry = JSON.parse(readFileSync(resolve(root, 'core-patches.json'), 'utf8')) as Registry
  const personalHeadSha = git(root, ['rev-parse', 'HEAD'])
  const targetUpstreamHeadSha = git(root, ['rev-parse', `${upstreamRef}^{commit}`])
  const upstreamChanged = targetUpstreamHeadSha !== baseline.observedUpstreamHeadSha
  if (upstreamChanged) {
    const upstreamChangedPaths = changedPaths(root, baseline.observedUpstreamHeadSha, targetUpstreamHeadSha)
    const personalChangedPaths = changedPaths(root, baseline.supportedUpstreamBase.sha, personalHeadSha)
    const merge = syntheticMerge(root, personalHeadSha, targetUpstreamHeadSha, upstreamChangedPaths)
    return {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      personalHeadSha,
      supportedUpstreamBaseSha: baseline.supportedUpstreamBase.sha,
      recordedUpstreamHeadSha: baseline.observedUpstreamHeadSha,
      targetUpstreamHeadSha,
      upstreamChanged: true,
      heavyChecksRequired: true,
      mergeStatus: merge.status,
      conflictPaths: merge.conflictPaths,
      upstreamChangedPaths,
      changedPackages: changedPackages(upstreamChangedPaths),
      hotspots: hotspots(
        root,
        baseline.observedUpstreamHeadSha,
        targetUpstreamHeadSha,
        registry,
        personalChangedPaths,
        upstreamChangedPaths,
        merge.conflictPaths,
      ),
    }
  }
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    personalHeadSha,
    supportedUpstreamBaseSha: baseline.supportedUpstreamBase.sha,
    recordedUpstreamHeadSha: baseline.observedUpstreamHeadSha,
    targetUpstreamHeadSha,
    upstreamChanged,
    heavyChecksRequired: upstreamChanged,
    mergeStatus: 'not-run',
    conflictPaths: [],
    upstreamChangedPaths: [],
    changedPackages: [],
    hotspots: [],
  }
}

/** Render the structured result for a GitHub Actions step summary. */
export function renderUpstreamCompatibilityMarkdown(report: UpstreamCompatibilityReport): string {
  const lines = [
    '# Upstream compatibility report',
    '',
    `- Personal head: \`${report.personalHeadSha}\``,
    `- Supported upstream base: \`${report.supportedUpstreamBaseSha}\``,
    `- Recorded upstream head: \`${report.recordedUpstreamHeadSha}\``,
    `- Target upstream head: \`${report.targetUpstreamHeadSha}\``,
    `- Upstream changed: **${report.upstreamChanged}**`,
    `- Synthetic merge: **${report.mergeStatus}**`,
    '',
    '## Changed packages',
    '',
    ...(report.changedPackages.length === 0
      ? ['- None']
      : report.changedPackages.map(packagePath => `- \`${packagePath}\``)),
    '',
    '## Conflict paths',
    '',
    ...(report.conflictPaths.length === 0
      ? ['- None']
      : report.conflictPaths.map(path => `- \`${path}\``)),
    '',
    '## Core patch heatmap',
    '',
  ]
  if (report.hotspots.length === 0) {
    lines.push('- No registered core patch is affected.')
  } else {
    lines.push(
      '| Patch | Score | Risk | Private paths | Upstream commits | Upstream paths | Conflicts |',
      '| --- | ---: | --- | ---: | ---: | ---: | ---: |',
      ...report.hotspots.map(row => (
        `| ${row.patchId} | ${row.score} | ${row.riskLevel} | ${row.privatePathCount} | ${row.upstreamCommitCount} | ${row.upstreamPathCount} | ${row.conflictPathCount} |`
      )),
    )
  }
  return `${lines.join('\n')}\n`
}

function cli(): void {
  const args = process.argv.slice(2)
  const rootIndex = args.indexOf('--root')
  const upstreamIndex = args.indexOf('--upstream-ref')
  const formatIndex = args.indexOf('--format')
  const jsonOutputIndex = args.indexOf('--json-output')
  const rootArgument = rootIndex >= 0 ? args[rootIndex + 1] : undefined
  const upstreamRef = upstreamIndex >= 0 ? args[upstreamIndex + 1] : undefined
  const format = formatIndex >= 0 ? args[formatIndex + 1] : 'json'
  const jsonOutput = jsonOutputIndex >= 0 ? args[jsonOutputIndex + 1] : undefined
  if (upstreamRef === undefined) throw new Error('--upstream-ref is required')
  if (jsonOutputIndex >= 0 && jsonOutput === undefined) throw new Error('--json-output requires a path')
  const root = rootArgument === undefined ? resolve(import.meta.dirname, '..') : resolve(rootArgument)
  const report = generateUpstreamCompatibilityReport(root, upstreamRef)
  if (jsonOutput !== undefined) writeFileSync(resolve(jsonOutput), `${JSON.stringify(report, null, 2)}\n`)
  if (format === 'json') console.log(JSON.stringify(report, null, 2))
  else if (format === 'markdown') process.stdout.write(renderUpstreamCompatibilityMarkdown(report))
  else throw new Error(`unsupported format: ${format ?? ''}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    cli()
  } catch (error) {
    console.error(`upstream compatibility: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
