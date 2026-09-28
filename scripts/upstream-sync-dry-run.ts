/** Prepare and clean up an exact, non-admitting upstream synchronization rehearsal. */

import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { matchesCorePatchPath } from './check-core-patch-budget.ts'
import { changedPackages } from './generate-divergence-report.ts'
import { requiresSourceLanguageSwitcher } from './translation-pairing.ts'

interface Baseline {
  readonly officialRepository: string
  readonly officialDefaultBranch: string
  readonly supportedUpstreamBase: { readonly sha: string }
  readonly observedUpstreamHeadSha: string
}

interface RegisteredPatch {
  readonly id: string
  readonly title: string
  readonly status: 'active' | 'retired'
  readonly affectedFiles: readonly string[]
  readonly upstreamCanaryTests: readonly string[]
}

interface Registry {
  readonly patches: readonly RegisteredPatch[]
}

interface PackageIdentityRegistry {
  readonly personalPackages: readonly { readonly directory: string }[]
}

export interface UpstreamSyncDryRunOptions {
  readonly root: string
  readonly upstreamRemote?: string
  readonly upstreamBranch?: string
  readonly packageIdentityPath?: string
  readonly now?: Date
}

export interface ConflictClassification {
  readonly path: string
  readonly category: 'registered-core-patch' | 'personal-product' | 'generated-artifact' | 'documentation' | 'test' | 'other-upstream'
  readonly patchIds: readonly string[]
}

export interface UpstreamSyncDryRunReport {
  readonly schemaVersion: 1
  readonly generatedAt: string
  readonly sourceBranch: string
  readonly personalHeadSha: string
  readonly supportedUpstreamBaseSha: string
  readonly observedUpstreamHeadSha: string
  readonly targetUpstreamHeadSha: string
  readonly mergeBaseSha: string
  readonly personalAhead: number
  readonly personalBehind: number
  readonly mergeStatus: 'clean' | 'conflicts'
  readonly conflictPaths: readonly string[]
  readonly conflictClassification: readonly ConflictClassification[]
  readonly pendingUpstreamPaths: readonly string[]
  readonly affectedPackages: readonly string[]
  readonly affectedPatches: readonly {
    readonly id: string
    readonly title: string
    readonly paths: readonly string[]
  }[]
  readonly recommendedChecks: {
    readonly registry: readonly string[]
    readonly patchSpecific: readonly string[]
    readonly windowsBlocking: readonly string[]
    readonly linuxAdvisory: readonly string[]
  }
  readonly temporaryWorktree: { readonly materialized: boolean; readonly cleaned: boolean }
  readonly temporaryRefRemoved: boolean
}

const SHA_PATTERN = /^[0-9a-f]{40,64}$/u
const BRANCH_PATTERN = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]+$/u
const TEMP_PREFIX = 'dsh-upstream-sync-dry-run-'

function git(root: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).trim()
}

function gitStatus(root: string, args: readonly string[]): number | null {
  return spawnSync('git', ['-C', root, ...args], { stdio: 'ignore' }).status
}

function readJson(root: string, path: string): unknown {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as unknown
}

function githubRepository(url: string): string | undefined {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?$/iu.exec(url)
  return match?.[1]?.toLowerCase()
}

function assertExpectedRemote(remoteUrl: string, expectedRepository: string): void {
  const actualGithubRepository = githubRepository(remoteUrl)
  if (actualGithubRepository !== undefined) {
    if (actualGithubRepository !== expectedRepository.toLowerCase()) {
      throw new Error(`upstream remote points to ${actualGithubRepository}, expected ${expectedRepository}`)
    }
    return
  }
  if (resolve(remoteUrl) !== resolve(expectedRepository)) {
    throw new Error(`upstream remote does not match ${expectedRepository}`)
  }
}

function assertCleanSource(root: string): void {
  const dirty = git(root, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (dirty !== '') throw new Error('upstream synchronization dry run requires a clean source checkout')
  for (const state of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-apply', 'rebase-merge']) {
    if (existsSync(resolve(root, git(root, ['rev-parse', '--git-path', state])))) {
      throw new Error(`upstream synchronization dry run refuses in-progress Git state: ${state}`)
    }
  }
}

function changedPaths(root: string, from: string, to: string): string[] {
  const output = git(root, [
    'diff', '--name-only', '--find-renames', `${from}..${to}`, '--', '.', ':(exclude)vendor/**',
  ])
  return output === '' ? [] : output.split(/\r?\n/u).sort()
}

function mergeTree(
  root: string,
  personalHead: string,
  upstreamHead: string,
): { readonly conflictPaths: readonly string[]; readonly status: 'clean' | 'conflicts'; readonly treeSha?: string } {
  const result = spawnSync('git', [
    '-C', root, 'merge-tree', '--write-tree', '--name-only', '--no-messages', personalHead, upstreamHead,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`git merge-tree failed: ${result.stderr.trim() || result.stdout.trim()}`)
  }
  const lines = result.stdout.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
  const conflictPaths = lines.slice(1).sort()
  const treeSha = lines.find(line => SHA_PATTERN.test(line))
  if (result.status === 0 && treeSha === undefined) throw new Error('git merge-tree did not return a result tree')
  return {
    conflictPaths,
    status: result.status === 0 ? 'clean' : 'conflicts',
    ...(treeSha === undefined ? {} : { treeSha }),
  }
}

function patchRows(registry: Registry, paths: readonly string[]): UpstreamSyncDryRunReport['affectedPatches'] {
  return registry.patches
    .filter(patch => patch.status === 'active')
    .map(patch => ({
      id: patch.id,
      title: patch.title,
      paths: paths.filter(path => patch.affectedFiles.some(pattern => matchesCorePatchPath(pattern, path))),
    }))
    .filter(row => row.paths.length > 0)
    .sort((left, right) => left.id.localeCompare(right.id))
}

function generatedDocumentSource(path: string): string {
  if (path.endsWith('.zh.md')) return path.replace(/\.zh\.md$/u, '.md')
  if (path.endsWith('.i18n.yaml')) return path.replace(/\.i18n\.yaml$/u, '.md')
  return path
}

/** Classify one conflict while retaining every matching private patch id. */
export function classifyConflict(
  path: string,
  registry: Registry,
  personalDirectories: readonly string[],
): ConflictClassification {
  const patchIds = registry.patches
    .filter(patch => patch.status === 'active'
      && patch.affectedFiles.some(pattern => matchesCorePatchPath(pattern, path)))
    .map(patch => patch.id)
    .sort()
  const generatedSource = generatedDocumentSource(path)
  if (path === '.agents/notes/archived/manifest.json'
    || path.endsWith('.generated.ts')
    || path.endsWith('.i18n.yaml')
    || /(?:^|\/)(?:generated|snapshots)(?:\/|$)/u.test(path)
    || (path.startsWith('docs/') && !requiresSourceLanguageSwitcher(generatedSource))) {
    return { path, category: 'generated-artifact', patchIds }
  }
  if (patchIds.length > 0) return { path, category: 'registered-core-patch', patchIds }
  if (personalDirectories.some(directory => path === directory || path.startsWith(`${directory}/`))) {
    return { path, category: 'personal-product', patchIds }
  }
  if (path.startsWith('docs/') || path.startsWith('.agents/notes/') || /README(?:\.zh)?\.md$/u.test(path)) {
    return { path, category: 'documentation', patchIds }
  }
  if (/(?:^|\/)(?:tests?)(?:\/|$)|\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(path)) {
    return { path, category: 'test', patchIds }
  }
  return { path, category: 'other-upstream', patchIds }
}

function verifyTemporaryRoot(path: string): void {
  const resolvedPath = resolve(path)
  const resolvedBase = resolve(tmpdir())
  if (!resolvedPath.startsWith(`${resolvedBase}${sep}`) || !basename(resolvedPath).startsWith(TEMP_PREFIX)) {
    throw new Error(`refusing to clean unexpected temporary root: ${resolvedPath}`)
  }
}

function createSyntheticCommit(root: string, treeSha: string, personalHead: string, upstreamHead: string): string {
  return execFileSync('git', [
    '-C', root, 'commit-tree', treeSha, '-p', personalHead, '-p', upstreamHead,
  ], { encoding: 'utf8', input: 'Upstream synchronization dry-run merge\n' }).trim()
}

/** Run the read-only external and recoverable local rehearsal. */
export function runUpstreamSyncDryRun(options: UpstreamSyncDryRunOptions): UpstreamSyncDryRunReport {
  const root = resolve(options.root)
  assertCleanSource(root)
  const baseline = readJson(root, 'upstream-base.json') as Baseline
  const registry = readJson(root, 'core-patches.json') as Registry
  const identities = readJson(
    root,
    options.packageIdentityPath ?? 'downstream/package-identities.json',
  ) as PackageIdentityRegistry
  const remote = options.upstreamRemote ?? 'upstream'
  const branch = options.upstreamBranch ?? baseline.officialDefaultBranch
  if (!BRANCH_PATTERN.test(branch)) throw new Error(`invalid upstream branch: ${branch}`)
  const remoteUrl = git(root, ['remote', 'get-url', remote])
  assertExpectedRemote(remoteUrl, baseline.officialRepository)

  const resolvedLine = git(root, ['ls-remote', '--exit-code', remote, `refs/heads/${branch}`])
  const targetUpstreamHeadSha = resolvedLine.split(/\s+/u)[0] ?? ''
  if (!SHA_PATTERN.test(targetUpstreamHeadSha)) throw new Error(`unable to resolve upstream branch: ${branch}`)

  const personalHeadSha = git(root, ['rev-parse', 'HEAD^{commit}'])
  const sourceBranch = git(root, ['branch', '--show-current']) || '(detached)'
  const temporaryRef = `refs/dsh/upstream-sync-dry-run/${process.pid.toString(10)}-${randomUUID()}`
  let temporaryRoot: string | undefined
  let temporaryCheckout: string | undefined
  let worktreeMaterialized = false
  let result: Omit<UpstreamSyncDryRunReport, 'temporaryRefRemoved' | 'temporaryWorktree'> | undefined

  try {
    git(root, ['fetch', '--no-tags', '--no-write-fetch-head', remoteUrl, `refs/heads/${branch}:${temporaryRef}`])
    const fetchedSha = git(root, ['rev-parse', `${temporaryRef}^{commit}`])
    if (fetchedSha !== targetUpstreamHeadSha) {
      throw new Error('upstream branch advanced during the dry run; retry against one target SHA')
    }

    const pendingUpstreamPaths = changedPaths(root, baseline.supportedUpstreamBase.sha, fetchedSha)
    const merge = mergeTree(root, personalHeadSha, fetchedSha)
    const affectedPatches = patchRows(registry, pendingUpstreamPaths)
    const patchById = new Map(registry.patches.map(patch => [patch.id, patch]))
    const patchSpecific = [...new Set(affectedPatches.flatMap(
      row => patchById.get(row.id)?.upstreamCanaryTests ?? [],
    ))].sort()
    const [aheadText = '0', behindText = '0'] = git(root, [
      'rev-list', '--left-right', '--count', `${personalHeadSha}...${fetchedSha}`,
    ]).split(/\s+/u)

    if (merge.status === 'clean' && merge.treeSha !== undefined) {
      const syntheticCommit = createSyntheticCommit(root, merge.treeSha, personalHeadSha, fetchedSha)
      temporaryRoot = mkdtempSync(join(tmpdir(), TEMP_PREFIX))
      verifyTemporaryRoot(temporaryRoot)
      temporaryCheckout = join(temporaryRoot, 'checkout')
      git(root, ['worktree', 'add', '--detach', temporaryCheckout, syntheticCommit])
      worktreeMaterialized = true
      if (git(temporaryCheckout, ['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
        throw new Error('materialized synthetic merge worktree is not clean')
      }
    }

    result = {
      schemaVersion: 1,
      generatedAt: (options.now ?? new Date()).toISOString(),
      sourceBranch,
      personalHeadSha,
      supportedUpstreamBaseSha: baseline.supportedUpstreamBase.sha,
      observedUpstreamHeadSha: baseline.observedUpstreamHeadSha,
      targetUpstreamHeadSha: fetchedSha,
      mergeBaseSha: git(root, ['merge-base', personalHeadSha, fetchedSha]),
      personalAhead: Number(aheadText),
      personalBehind: Number(behindText),
      mergeStatus: merge.status,
      conflictPaths: merge.conflictPaths,
      conflictClassification: merge.conflictPaths.map(
        path => classifyConflict(path, registry, identities.personalPackages.map(entry => entry.directory)),
      ),
      pendingUpstreamPaths,
      affectedPackages: changedPackages(pendingUpstreamPaths),
      affectedPatches,
      recommendedChecks: {
        registry: ['pnpm run check:core-patches -- --require-observed-upstream'],
        patchSpecific,
        windowsBlocking: [
          'pnpm run check:package-identities',
          'pnpm run build',
          'pnpm run verify:personal-source',
          'pnpm run typecheck:contracts-ready',
        ],
        linuxAdvisory: [
          'pnpm run check:package-identities',
          'pnpm run build:lib:host',
          'pnpm run typecheck:contracts-ready',
        ],
      },
    }
  } finally {
    if (temporaryCheckout !== undefined && gitStatus(root, ['worktree', 'remove', '--force', temporaryCheckout]) !== 0) {
      throw new Error(`failed to remove temporary worktree: ${temporaryCheckout}`)
    }
    if (temporaryRoot !== undefined) {
      verifyTemporaryRoot(temporaryRoot)
      if (existsSync(temporaryRoot)) rmdirSync(temporaryRoot)
    }
    gitStatus(root, ['update-ref', '-d', temporaryRef])
  }

  const temporaryRefRemoved = gitStatus(root, ['show-ref', '--verify', '--quiet', temporaryRef]) !== 0
  if (!temporaryRefRemoved) throw new Error(`temporary ref was not removed: ${temporaryRef}`)
  return {
    ...result,
    temporaryWorktree: { materialized: worktreeMaterialized, cleaned: true },
    temporaryRefRemoved,
  }
}

/** Render one dry-run report without turning recommendations into automatic admission. */
export function renderUpstreamSyncDryRunMarkdown(report: UpstreamSyncDryRunReport): string {
  const lines = [
    '# Upstream synchronization dry run',
    '',
    `- Source: \`${report.sourceBranch}@${report.personalHeadSha}\``,
    `- Target upstream: \`${report.targetUpstreamHeadSha}\``,
    `- Merge base: \`${report.mergeBaseSha}\``,
    `- Synthetic merge: **${report.mergeStatus}**`,
    `- Temporary worktree materialized: **${report.temporaryWorktree.materialized}**`,
    `- Temporary state cleaned: **${report.temporaryWorktree.cleaned && report.temporaryRefRemoved}**`,
    '',
    '## Conflicts',
    '',
    ...(report.conflictClassification.length === 0
      ? ['- None']
      : report.conflictClassification.map(row => (
        `- \`${row.path}\` — ${row.category}${row.patchIds.length === 0 ? '' : ` (${row.patchIds.join(', ')})`}`
      ))),
    '',
    '## Affected private patches',
    '',
    ...(report.affectedPatches.length === 0
      ? ['- None']
      : report.affectedPatches.map(row => `- \`${row.id}\`: ${row.paths.length.toString()} path(s)`)),
    '',
    '## Required Windows checks after an approved merge',
    '',
    ...report.recommendedChecks.windowsBlocking.map(command => `- \`${command}\``),
  ]
  return `${lines.join('\n')}\n`
}

function cli(): void {
  const allowed = new Set([
    '--root', '--upstream-remote', '--upstream-branch', '--package-identities', '--format',
  ])
  const values = new Map<string, string>()
  const args = process.argv.slice(2)
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index]
    const optionValue = args[index + 1]
    if (option === undefined || !allowed.has(option)) throw new Error(`unexpected option: ${option ?? ''}`)
    if (values.has(option)) throw new Error(`option may be supplied once: ${option}`)
    if (optionValue === undefined || optionValue.startsWith('--')) throw new Error(`${option} requires a value`)
    values.set(option, optionValue)
  }
  const rootArgument = values.get('--root')
  const format = values.get('--format') ?? 'json'
  if (format !== 'json' && format !== 'markdown') throw new Error(`unsupported format: ${format}`)
  const root = rootArgument === undefined ? resolve(import.meta.dirname, '..') : resolve(rootArgument)
  const upstreamRemote = values.get('--upstream-remote')
  const upstreamBranch = values.get('--upstream-branch')
  const packageIdentityPath = values.get('--package-identities')
  const report = runUpstreamSyncDryRun({
    root,
    ...(upstreamRemote === undefined ? {} : { upstreamRemote }),
    ...(upstreamBranch === undefined ? {} : { upstreamBranch }),
    ...(packageIdentityPath === undefined ? {} : { packageIdentityPath }),
  })
  if (format === 'json') console.log(JSON.stringify(report, null, 2))
  else process.stdout.write(renderUpstreamSyncDryRunMarkdown(report))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    cli()
  } catch (error) {
    console.error(`upstream sync dry run: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
