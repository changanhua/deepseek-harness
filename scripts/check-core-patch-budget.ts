/** Validate the supported upstream baseline and every active private core patch. */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const SHA_PATTERN = /^[0-9a-f]{40}$/u
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const FORBIDDEN_PATTERNS = new Set(['**', 'apps/**', 'native/**', 'packages/**', 'scripts/**'])

interface UpstreamBase {
  readonly schemaVersion: 1
  readonly officialRepository: string
  readonly officialDefaultBranch: string
  readonly forkRepository: string
  readonly forkDefaultBranch: string
  readonly supportedUpstreamBase: { readonly sha: string; readonly tag: string | null }
  readonly recordedPersonalHeadSha: string
  readonly observedUpstreamHeadSha: string
  readonly mergeBaseSha: string
  readonly divergence: { readonly personalAhead: number; readonly personalBehind: number }
  readonly lastRevalidatedAt: string
  readonly revalidationScope: string
  readonly runtimeEvidence: readonly string[]
}

interface CorePatch {
  readonly id: string
  readonly status: 'active' | 'retired'
  readonly kind: 'compatibility-adapter' | 'unavoidable-core-patch' | 'upstream-candidate'
  readonly title: string
  readonly owner: string
  readonly introducedAt: string
  readonly upstreamBaseSha: string
  readonly commits: readonly string[]
  readonly affectedUpstreamPackages: readonly string[]
  readonly affectedFiles: readonly string[]
  readonly reason: string
  readonly whyPluginIsInsufficient: string
  readonly whyCompatibilityAdapterIsInsufficient: string
  readonly factOwnershipEffect: string
  readonly dataFormatEffect: string
  readonly securityEffect: string
  readonly tests: readonly string[]
  readonly upstreamCanaryTests: readonly string[]
  readonly migrationPlan: string
  readonly rollbackPlan: string
  readonly replacementCondition: string
  readonly upstreamIssueOrPr: string | null
  readonly expiryReviewDate: string
  readonly knownMergeConflicts: readonly string[]
  readonly lastRevalidatedUpstreamSha: string
  readonly risk: { readonly level: 'low' | 'medium' | 'high' | 'critical'; readonly points: number }
}

interface CorePatchRegistry {
  readonly schemaVersion: 1
  readonly supportedUpstreamBaseSha: string
  readonly budget: {
    readonly maxActivePatches: number
    readonly maxRiskPoints: number
    readonly maxCriticalPatches: number
  }
  readonly downstreamOwnedAdditions: readonly string[]
  readonly patches: readonly CorePatch[]
}

export interface CorePatchGovernanceReport {
  readonly activePatchCount: number
  readonly criticalPatchCount: number
  readonly coveredUpstreamPathCount: number
  readonly observedUpstreamVerified: boolean
  readonly riskPoints: number
  readonly unregisteredUpstreamPaths: readonly string[]
  readonly errors: readonly string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(record: Record<string, unknown>, field: string, label: string, errors: string[]): string | undefined {
  const value = record[field]
  if (typeof value === 'string' && value.trim() !== '') return value
  errors.push(`${label}.${field} must be a non-empty string`)
  return undefined
}

function stringArray(record: Record<string, unknown>, field: string, label: string, errors: string[]): string[] {
  const value = record[field]
  if (Array.isArray(value) && value.length > 0) {
    const strings: string[] = []
    for (const item of value) {
      if (typeof item !== 'string' || item === '') {
        errors.push(`${label}.${field} must be a non-empty string array`)
        return []
      }
      strings.push(item)
    }
    return strings
  }
  errors.push(`${label}.${field} must be a non-empty string array`)
  return []
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0
}

function tooBroadPathPattern(pattern: string): boolean {
  if (!pattern.includes('*')) return false
  if (!pattern.endsWith('/**')) return true
  const prefix = pattern.slice(0, -3)
  if (prefix.includes('*') || prefix === '.github/workflows') return true
  const segments = prefix.split('/')
  if (segments[0] === 'packages') return segments.length < 3
  return segments.length < 2
}

function isRepositoryRelativePosixPath(path: string): boolean {
  return !isAbsolute(path)
    && !path.includes('\\')
    && !path.split('/').some(segment => segment === '..' || segment === '.')
}

/** Validate the two committed governance documents without consulting Git. */
export function validateCorePatchDocuments(baseline: unknown, registry: unknown): string[] {
  const errors: string[] = []
  if (!isRecord(baseline)) return ['upstream-base.json must be a JSON object']
  if (!isRecord(registry)) return ['core-patches.json must be a JSON object']
  if (baseline.schemaVersion !== 1) errors.push('upstream-base.json schemaVersion must be 1')
  if (registry.schemaVersion !== 1) errors.push('core-patches.json schemaVersion must be 1')
  const officialRepository = requiredString(baseline, 'officialRepository', 'baseline', errors)
  const forkRepository = requiredString(baseline, 'forkRepository', 'baseline', errors)
  requiredString(baseline, 'officialDefaultBranch', 'baseline', errors)
  requiredString(baseline, 'forkDefaultBranch', 'baseline', errors)
  requiredString(baseline, 'revalidationScope', 'baseline', errors)
  if (officialRepository === forkRepository) errors.push('officialRepository and forkRepository must differ')

  const supported = baseline.supportedUpstreamBase
  const supportedSha = isRecord(supported)
    ? requiredString(supported, 'sha', 'baseline.supportedUpstreamBase', errors)
    : undefined
  if (!isRecord(supported)) errors.push('baseline.supportedUpstreamBase must be an object')
  for (const [field, value] of [
    ['recordedPersonalHeadSha', baseline.recordedPersonalHeadSha],
    ['observedUpstreamHeadSha', baseline.observedUpstreamHeadSha],
    ['mergeBaseSha', baseline.mergeBaseSha],
    ['supportedUpstreamBaseSha', registry.supportedUpstreamBaseSha],
  ] as const) {
    if (typeof value !== 'string' || !SHA_PATTERN.test(value)) errors.push(`${field} must be a lowercase 40-character commit SHA`)
  }
  if (supportedSha !== undefined && !SHA_PATTERN.test(supportedSha)) {
    errors.push('baseline.supportedUpstreamBase.sha must be a lowercase 40-character commit SHA')
  }
  if (supportedSha !== registry.supportedUpstreamBaseSha) {
    errors.push('core-patches.json supportedUpstreamBaseSha must match upstream-base.json')
  }
  if (baseline.mergeBaseSha !== supportedSha) {
    errors.push('mergeBaseSha must equal the supported upstream base until a new base is admitted')
  }
  const divergence = baseline.divergence
  if (!isRecord(divergence)
    || !nonNegativeInteger(divergence.personalAhead)
    || !nonNegativeInteger(divergence.personalBehind)) {
    errors.push('baseline.divergence counts must be non-negative integers')
  }
  if (typeof baseline.lastRevalidatedAt !== 'string' || Number.isNaN(Date.parse(baseline.lastRevalidatedAt))) {
    errors.push('baseline.lastRevalidatedAt must be an ISO timestamp')
  }
  if (!Array.isArray(baseline.runtimeEvidence)
    || baseline.runtimeEvidence.some(item => typeof item !== 'string' || item === '')) {
    errors.push('baseline.runtimeEvidence must be an array of non-empty strings')
  }

  const budget = registry.budget
  if (!isRecord(budget)
    || !nonNegativeInteger(budget.maxActivePatches)
    || !nonNegativeInteger(budget.maxRiskPoints)
    || !nonNegativeInteger(budget.maxCriticalPatches)) {
    errors.push('registry.budget values must be non-negative integers')
  }
  const downstreamOwnedAdditions = registry.downstreamOwnedAdditions
  if (!Array.isArray(downstreamOwnedAdditions)) {
    errors.push('registry.downstreamOwnedAdditions must be a string array')
  } else {
    const patterns: string[] = []
    for (const candidate of downstreamOwnedAdditions) {
      if (typeof candidate !== 'string' || candidate === '') {
        errors.push('registry.downstreamOwnedAdditions must be a string array')
        continue
      }
      patterns.push(candidate)
    }
    for (const pattern of patterns) {
      if (FORBIDDEN_PATTERNS.has(pattern) || tooBroadPathPattern(pattern)) {
        errors.push(`downstream-owned addition pattern is too broad: ${pattern}`)
      }
      if (pattern.includes('..') || pattern.startsWith('/') || pattern.includes('\\')) {
        errors.push(`downstream-owned additions must use repository-relative POSIX paths: ${pattern}`)
      }
    }
  }
  if (!Array.isArray(registry.patches)) return [...errors, 'registry.patches must be an array']

  const ids = new Set<string>()
  for (const [index, candidate] of registry.patches.entries()) {
    const label = `patches[${String(index)}]`
    if (!isRecord(candidate)) {
      errors.push(`${label} must be an object`)
      continue
    }
    const id = requiredString(candidate, 'id', label, errors)
    if (id !== undefined) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) errors.push(`${label}.id must be kebab-case`)
      if (ids.has(id)) errors.push(`duplicate core patch id: ${id}`)
      ids.add(id)
    }
    const status = candidate.status
    if (status !== 'active' && status !== 'retired') errors.push(`${label}.status must be active or retired`)
    const kind = candidate.kind
    if (kind !== 'compatibility-adapter' && kind !== 'unavoidable-core-patch' && kind !== 'upstream-candidate') {
      errors.push(`${label}.kind is invalid`)
    }
    for (const field of [
      'title',
      'owner',
      'reason',
      'whyPluginIsInsufficient',
      'whyCompatibilityAdapterIsInsufficient',
      'factOwnershipEffect',
      'dataFormatEffect',
      'securityEffect',
      'migrationPlan',
      'rollbackPlan',
      'replacementCondition',
    ]) requiredString(candidate, field, label, errors)
    if (kind === 'compatibility-adapter' && candidate.factOwnershipEffect !== 'none') {
      errors.push(`${label}: compatibility-adapter must not own business facts; factOwnershipEffect must be none`)
    }
    if (typeof candidate.introducedAt !== 'string' || !DATE_PATTERN.test(candidate.introducedAt)) {
      errors.push(`${label}.introducedAt must use YYYY-MM-DD`)
    }
    if (typeof candidate.expiryReviewDate !== 'string' || !DATE_PATTERN.test(candidate.expiryReviewDate)) {
      errors.push(`${label}.expiryReviewDate must use YYYY-MM-DD`)
    }
    for (const field of ['upstreamBaseSha', 'lastRevalidatedUpstreamSha']) {
      if (typeof candidate[field] !== 'string' || !SHA_PATTERN.test(candidate[field])) {
        errors.push(`${label}.${field} must be a lowercase 40-character commit SHA`)
      }
    }
    if (candidate.upstreamBaseSha !== registry.supportedUpstreamBaseSha) {
      errors.push(`${label}.upstreamBaseSha must match the registry supported base`)
    }
    const commits = stringArray(candidate, 'commits', label, errors)
    if (commits.some(commit => !SHA_PATTERN.test(commit))) errors.push(`${label}.commits must contain full lowercase SHAs`)
    const affectedFiles = stringArray(candidate, 'affectedFiles', label, errors)
    for (const pattern of affectedFiles) {
      if (FORBIDDEN_PATTERNS.has(pattern) || tooBroadPathPattern(pattern)) {
        errors.push(`${label}.affectedFiles pattern is too broad: ${pattern}`)
      }
      if (pattern.includes('..') || pattern.startsWith('/') || pattern.includes('\\')) {
        errors.push(`${label}.affectedFiles must use repository-relative POSIX paths: ${pattern}`)
      }
    }
    for (const field of ['affectedUpstreamPackages', 'knownMergeConflicts']) {
      const value = candidate[field]
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item === '')) {
        errors.push(`${label}.${field} must be a string array`)
      }
    }
    const tests = stringArray(candidate, 'tests', label, errors)
    for (const test of tests) {
      if (!isRepositoryRelativePosixPath(test)) {
        errors.push(`${label}.tests must contain repository-relative POSIX file paths: ${test}`)
      }
    }
    stringArray(candidate, 'upstreamCanaryTests', label, errors)
    if (candidate.upstreamIssueOrPr !== null
      && (typeof candidate.upstreamIssueOrPr !== 'string' || candidate.upstreamIssueOrPr === '')) {
      errors.push(`${label}.upstreamIssueOrPr must be null or a non-empty string`)
    }
    const risk = candidate.risk
    if (!isRecord(risk)
      || !['low', 'medium', 'high', 'critical'].includes(String(risk.level))
      || !Number.isInteger(risk.points)
      || Number(risk.points) < 1
      || Number(risk.points) > 10) {
      errors.push(`${label}.risk must contain level and 1-10 points`)
    }
  }
  return errors
}

function patternMatches(pattern: string, path: string): boolean {
  const expression = pattern
    .split('/')
    .map(segment => segment === '**'
      ? '.*'
      : segment.split('*').map(part => part.replace(/[|\\{}()[\]^$+?.]/gu, '\\$&')).join('[^/]*'))
    .join('/')
  return new RegExp(`^${expression}$`, 'u').test(path)
}

function isTrackedUpstreamCorePath(path: string): boolean {
  if (path.startsWith('vendor/') || path.startsWith('docs/') || path.startsWith('.agents/')) return false
  if (/(?:^|\/)(?:README|CHANGELOG|LICENSE)(?:\.|$)/u.test(path) || path.endsWith('.i18n.yaml')) return false
  const prefixes = ['apps/', 'packages/', 'scripts/', 'native/', '.github/workflows/', 'website/']
  const rootFiles = new Set(['AGENTS.md', 'package.json', 'pnpm-lock.yaml', 'knip.json', 'lefthook.yml'])
  return prefixes.some(prefix => path.startsWith(prefix))
    || rootFiles.has(path)
    || /^tsconfig\.[^/]+\.json$/u.test(path)
}

function git(root: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
}

function personalPackageDirectories(root: string): string[] {
  const parsed: unknown = JSON.parse(readFileSync(resolve(root, 'downstream/package-identities.json'), 'utf8'))
  if (!isRecord(parsed) || !Array.isArray(parsed.personalPackages)) {
    throw new Error('downstream/package-identities.json must expose personalPackages')
  }
  const directories: string[] = []
  for (const candidate of parsed.personalPackages) {
    if (!isRecord(candidate) || typeof candidate.directory !== 'string' || candidate.directory === '') {
      throw new Error('downstream/package-identities.json contains an invalid personal package directory')
    }
    directories.push(candidate.directory)
  }
  return directories
}

function ownedAddition(path: string, personalDirectories: readonly string[], patterns: readonly string[]): boolean {
  return personalDirectories.some(directory => path === directory || path.startsWith(`${directory}/`))
    || patterns.some(pattern => patternMatches(pattern, path))
}

function upstreamModifiedPaths(
  root: string,
  base: string,
  head: string,
  downstreamOwnedAdditions: readonly string[],
): string[] {
  const output = git(root, [
    'diff',
    '--name-status',
    '--diff-filter=ADMRT',
    '--find-renames',
    `${base}..${head}`,
    '--',
    '.',
    ':(exclude)vendor/**',
  ])
  if (output === '') return []
  const personalDirectories = personalPackageDirectories(root)
  const selected = new Set<string>()
  for (const line of output.split(/\r?\n/u)) {
    const [status = '', ...paths] = line.split('\t')
    for (const path of paths) {
      if (!isTrackedUpstreamCorePath(path)) continue
      if (status.startsWith('A') && ownedAddition(path, personalDirectories, downstreamOwnedAdditions)) continue
      selected.add(path)
    }
  }
  return [...selected].sort()
}

function objectExists(root: string, sha: string): boolean {
  return spawnSync('git', ['-C', root, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' }).status === 0
}

/** Run the full repository-aware baseline, registry, coverage, and budget check. */
export function checkCorePatchGovernance(
  root: string,
  head: string = 'HEAD',
  now: Date = new Date(),
  requireObservedUpstream: boolean = false,
): CorePatchGovernanceReport {
  const baseline = JSON.parse(readFileSync(resolve(root, 'upstream-base.json'), 'utf8')) as unknown
  const registry = JSON.parse(readFileSync(resolve(root, 'core-patches.json'), 'utf8')) as unknown
  const errors = validateCorePatchDocuments(baseline, registry)
  if (!isRecord(baseline) || !isRecord(registry) || errors.length > 0) {
    return {
      activePatchCount: 0,
      criticalPatchCount: 0,
      coveredUpstreamPathCount: 0,
      observedUpstreamVerified: false,
      riskPoints: 0,
      unregisteredUpstreamPaths: [],
      errors,
    }
  }

  const typedBaseline = baseline as unknown as UpstreamBase
  const typedRegistry = registry as unknown as CorePatchRegistry
  const active = typedRegistry.patches.filter(patch => patch.status === 'active')
  const riskPoints = active.reduce((sum, patch) => sum + patch.risk.points, 0)
  const criticalPatchCount = active.filter(patch => patch.risk.level === 'critical').length
  const modifiedPaths = upstreamModifiedPaths(
    root,
    typedRegistry.supportedUpstreamBaseSha,
    head,
    typedRegistry.downstreamOwnedAdditions,
  )
  const registeredPatterns = active.flatMap(patch => patch.affectedFiles)
  const unregisteredUpstreamPaths = modifiedPaths.filter(path => !registeredPatterns.some(pattern => patternMatches(pattern, path)))

  if (!objectExists(root, typedBaseline.recordedPersonalHeadSha)) {
    errors.push(`recorded personal head is absent: ${typedBaseline.recordedPersonalHeadSha}`)
  } else if (spawnSync('git', [
    '-C', root, 'merge-base', '--is-ancestor', typedBaseline.recordedPersonalHeadSha, head,
  ], { stdio: 'ignore' }).status !== 0) {
    errors.push('recorded personal head must be an ancestor of the checked head')
  }
  const observedUpstreamAvailable = objectExists(root, typedBaseline.observedUpstreamHeadSha)
  if (requireObservedUpstream && !observedUpstreamAvailable) {
    errors.push(`observed upstream object is required but absent: ${typedBaseline.observedUpstreamHeadSha}`)
  }
  const mergeBaseTarget = observedUpstreamAvailable
    ? typedBaseline.observedUpstreamHeadSha
    : typedBaseline.supportedUpstreamBase.sha
  const mergeBaseMatches = git(root, [
    'merge-base', typedBaseline.recordedPersonalHeadSha, mergeBaseTarget,
  ]) === typedBaseline.mergeBaseSha
  if (!mergeBaseMatches) {
    errors.push('recorded mergeBaseSha does not match Git history')
  }
  let divergenceMatches = false
  if (observedUpstreamAvailable) {
    const [aheadText, behindText] = git(root, [
      'rev-list', '--left-right', '--count', `${typedBaseline.recordedPersonalHeadSha}...${typedBaseline.observedUpstreamHeadSha}`,
    ]).split(/\s+/u)
    divergenceMatches = Number(aheadText) === typedBaseline.divergence.personalAhead
      && Number(behindText) === typedBaseline.divergence.personalBehind
    if (!divergenceMatches) {
      errors.push('recorded ahead/behind counts do not match Git history')
    }
  }
  for (const patch of active) {
    if (patch.expiryReviewDate < now.toISOString().slice(0, 10)) {
      errors.push(`${patch.id}: expiry review date ${patch.expiryReviewDate} has passed`)
    }
    for (const commit of patch.commits) {
      if (!objectExists(root, commit)) {
        errors.push(`${patch.id}: registered commit is absent: ${commit}`)
      } else if (spawnSync('git', ['-C', root, 'merge-base', '--is-ancestor', commit, head], { stdio: 'ignore' }).status !== 0) {
        errors.push(`${patch.id}: registered commit is not an ancestor of the checked head: ${commit}`)
      }
    }
    for (const test of patch.tests) {
      const testPath = resolve(root, test)
      if (!existsSync(testPath)) {
        errors.push(`${patch.id}: registered test is missing: ${test}`)
        continue
      }
      if (!statSync(testPath).isFile()) {
        errors.push(`${patch.id}: registered test is not a regular file: ${test}`)
        continue
      }
      const rootPath = realpathSync(root)
      const relativeTest = relative(rootPath, realpathSync(testPath))
      if (relativeTest.startsWith(`..${sep}`) || isAbsolute(relativeTest)) {
        errors.push(`${patch.id}: registered test resolves outside the repository: ${test}`)
      }
    }
    if (!patch.affectedFiles.some(pattern => modifiedPaths.some(path => patternMatches(pattern, path)))) {
      errors.push(`${patch.id}: active patch does not cover an upstream-owned modified path`)
    }
  }
  if (active.length > typedRegistry.budget.maxActivePatches) {
    errors.push(`active core patch count ${String(active.length)} exceeds budget ${String(typedRegistry.budget.maxActivePatches)}`)
  }
  if (riskPoints > typedRegistry.budget.maxRiskPoints) {
    errors.push(`core patch risk ${String(riskPoints)} exceeds budget ${String(typedRegistry.budget.maxRiskPoints)}`)
  }
  if (criticalPatchCount > typedRegistry.budget.maxCriticalPatches) {
    errors.push(`critical core patch count ${String(criticalPatchCount)} exceeds budget ${String(typedRegistry.budget.maxCriticalPatches)}`)
  }
  if (unregisteredUpstreamPaths.length > 0) {
    errors.push(`${String(unregisteredUpstreamPaths.length)} upstream-owned modified path(s) are not registered`)
  }

  return {
    activePatchCount: active.length,
    criticalPatchCount,
    coveredUpstreamPathCount: modifiedPaths.length - unregisteredUpstreamPaths.length,
    observedUpstreamVerified: observedUpstreamAvailable && mergeBaseMatches && divergenceMatches,
    riskPoints,
    unregisteredUpstreamPaths,
    errors,
  }
}

function cli(): void {
  const args = process.argv.slice(2)
  const rootIndex = args.indexOf('--root')
  const formatIndex = args.indexOf('--format')
  const requireObservedUpstream = args.includes('--require-observed-upstream')
  const rootArgument = rootIndex >= 0 ? args[rootIndex + 1] : undefined
  const root = rootArgument !== undefined
    ? resolve(rootArgument)
    : resolve(import.meta.dirname, '..')
  const format = formatIndex >= 0 ? args[formatIndex + 1] : 'text'
  try {
    const report = checkCorePatchGovernance(root, 'HEAD', new Date(), requireObservedUpstream)
    if (format === 'json') console.log(JSON.stringify(report, null, 2))
    else {
      console.log(
        `core patches: ${String(report.activePatchCount)} active, ${String(report.riskPoints)} risk points,`
        + ` ${String(report.coveredUpstreamPathCount)} upstream path(s) covered`,
      )
      console.log(`core patches: observed upstream ${report.observedUpstreamVerified ? 'verified' : 'not present'}`)
      for (const error of report.errors) console.error(`core patches: ${error}`)
    }
    if (report.errors.length > 0) process.exitCode = 1
  } catch (error) {
    console.error(`core patches: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) cli()
