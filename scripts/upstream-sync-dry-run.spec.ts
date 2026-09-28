import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { removeFixtureSafely } from './test-fixture-cleanup.ts'
import { classifyConflict, runUpstreamSyncDryRun } from './upstream-sync-dry-run.ts'

const temporaryRoots: string[] = []

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function createRepository(conflict: boolean): { personalHead: string; root: string; targetHead: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-upstream-sync-fixture-'))
  temporaryRoots.push(root)
  git(root, 'init', '--quiet', '--initial-branch=master')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'config', 'user.name', 'Test')
  mkdirSync(join(root, 'packages/core/example/src'), { recursive: true })
  writeFileSync(join(root, 'packages/core/example/src/index.ts'), 'export const value = "base"\n')
  git(root, 'add', '.')
  git(root, 'commit', '--quiet', '-m', 'supported base')
  const supportedBase = git(root, 'rev-parse', 'HEAD')

  git(root, 'switch', '--quiet', '-c', 'official')
  if (conflict) {
    writeFileSync(join(root, 'packages/core/example/src/index.ts'), 'export const value = "official"\n')
  } else {
    writeFileSync(join(root, 'packages/core/example/src/official.ts'), 'export const official = true\n')
  }
  git(root, 'add', '.')
  git(root, 'commit', '--quiet', '-m', 'official change')
  const targetHead = git(root, 'rev-parse', 'HEAD')

  git(root, 'switch', '--quiet', '-c', 'personal', supportedBase)
  if (conflict) {
    writeFileSync(join(root, 'packages/core/example/src/index.ts'), 'export const value = "personal"\n')
  } else {
    writeFileSync(join(root, 'packages/core/example/src/personal.ts'), 'export const personal = true\n')
  }
  writeJson(join(root, 'upstream-base.json'), {
    schemaVersion: 1,
    officialRepository: root,
    officialDefaultBranch: 'official',
    supportedUpstreamBase: { sha: supportedBase },
    observedUpstreamHeadSha: supportedBase,
  })
  writeJson(join(root, 'core-patches.json'), {
    schemaVersion: 1,
    patches: [{
      id: 'example-core-patch',
      title: 'Example core patch',
      status: 'active',
      affectedFiles: ['packages/core/example/**'],
      upstreamCanaryTests: ['pnpm exec vitest run packages/core/example/tests'],
    }],
  })
  writeJson(join(root, 'downstream-package-identities.json'), {
    schemaVersion: 1,
    personalPackages: [],
  })
  git(root, 'add', '.')
  git(root, 'commit', '--quiet', '-m', 'personal governance and change')
  const personalHead = git(root, 'rev-parse', 'HEAD')
  git(root, 'remote', 'add', 'upstream', root)
  return { personalHead, root, targetHead }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) removeFixtureSafely(root)
})

describe('upstream synchronization dry run', () => {
  it('rejects pending merge state in a source repository outside the process directory', () => {
    const fixture = createRepository(false)
    writeFileSync(resolve(fixture.root, git(fixture.root, 'rev-parse', '--git-path', 'MERGE_HEAD')), fixture.targetHead)
    expect(() => runUpstreamSyncDryRun({
      root: fixture.root,
      packageIdentityPath: 'downstream-package-identities.json',
    })).toThrow(/in-progress Git state: MERGE_HEAD/u)
    expect(git(fixture.root, 'for-each-ref', '--format=%(refname)', 'refs/dsh/upstream-sync-dry-run/')).toBe('')
  })

  it('runs the CLI against a clean repository and preserves its HEAD and working files', () => {
    const fixture = createRepository(false)
    const result = spawnSync(process.execPath, [
      '--import', 'tsx/esm', join(import.meta.dirname, 'upstream-sync-dry-run.ts'),
      '--root', fixture.root, '--package-identities', 'downstream-package-identities.json', '--format', 'json',
    ], { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      targetUpstreamHeadSha: fixture.targetHead,
      temporaryRefRemoved: true,
      temporaryWorktree: { materialized: true, cleaned: true },
    })
    expect(git(fixture.root, 'rev-parse', 'HEAD')).toBe(fixture.personalHead)
    expect(git(fixture.root, 'status', '--porcelain')).toBe('')
  })

  it('uses the repository generated-document owner instead of treating derivatives as authored prose', () => {
    const registry = { patches: [] }

    expect(classifyConflict('docs/config-catalog.md', registry, []).category).toBe('generated-artifact')
    expect(classifyConflict('docs/config-catalog.zh.md', registry, []).category).toBe('generated-artifact')
    expect(classifyConflict('docs/config-catalog.i18n.yaml', registry, []).category).toBe('generated-artifact')
    expect(classifyConflict('.agents/notes/archived/manifest.json', registry, []).category).toBe('generated-artifact')
    expect(classifyConflict('docs/downstream/upstream-sync.md', registry, []).category).toBe('documentation')
  })

  it('pins the official head, materializes a clean synthetic merge, and removes all temporary Git state', () => {
    const fixture = createRepository(false)

    const report = runUpstreamSyncDryRun({
      root: fixture.root,
      upstreamBranch: 'official',
      packageIdentityPath: 'downstream-package-identities.json',
      now: new Date('2026-09-05T02:00:00.000Z'),
    })

    expect(report).toMatchObject({
      generatedAt: '2026-09-05T02:00:00.000Z',
      sourceBranch: 'personal',
      personalHeadSha: fixture.personalHead,
      targetUpstreamHeadSha: fixture.targetHead,
      mergeStatus: 'clean',
      conflictPaths: [],
      pendingUpstreamPaths: ['packages/core/example/src/official.ts'],
      affectedPackages: ['packages/core/example'],
      affectedPatches: [{ id: 'example-core-patch' }],
      temporaryWorktree: { materialized: true, cleaned: true },
      temporaryRefRemoved: true,
    })
    expect(report.recommendedChecks.windowsBlocking).toContain('pnpm run build')
    expect(report.recommendedChecks.patchSpecific).toEqual([
      'pnpm exec vitest run packages/core/example/tests',
    ])
    expect(git(fixture.root, 'for-each-ref', '--format=%(refname)', 'refs/dsh/upstream-sync-dry-run/')).toBe('')
    expect(git(fixture.root, 'for-each-ref', '--format=%(refname)', 'refs/remotes/upstream/')).toBe('')
    expect(existsSync(resolve(fixture.root, git(fixture.root, 'rev-parse', '--git-path', 'FETCH_HEAD')))).toBe(false)
    expect(git(fixture.root, 'worktree', 'list', '--porcelain').match(/^worktree /gmu)).toHaveLength(1)
    expect(git(fixture.root, 'status', '--porcelain')).toBe('')
  })

  it('reports a registered core-patch conflict without changing the personal branch', () => {
    const fixture = createRepository(true)

    const report = runUpstreamSyncDryRun({
      root: fixture.root,
      upstreamBranch: 'official',
      packageIdentityPath: 'downstream-package-identities.json',
    })

    expect(report).toMatchObject({
      personalHeadSha: fixture.personalHead,
      targetUpstreamHeadSha: fixture.targetHead,
      mergeStatus: 'conflicts',
      conflictPaths: ['packages/core/example/src/index.ts'],
      conflictClassification: [{
        path: 'packages/core/example/src/index.ts',
        category: 'registered-core-patch',
        patchIds: ['example-core-patch'],
      }],
      temporaryWorktree: { materialized: false, cleaned: true },
      temporaryRefRemoved: true,
    })
    expect(git(fixture.root, 'branch', '--show-current')).toBe('personal')
    expect(git(fixture.root, 'rev-parse', 'HEAD')).toBe(fixture.personalHead)
    expect(git(fixture.root, 'status', '--porcelain')).toBe('')
    expect(git(fixture.root, 'for-each-ref', '--format=%(refname)', 'refs/remotes/upstream/')).toBe('')
  })

  it('rejects a dirty source checkout before fetching or creating temporary state', () => {
    const fixture = createRepository(false)
    const marker = join(fixture.root, 'user-wip.txt')
    writeFileSync(marker, 'preserve me\n')

    expect(() => runUpstreamSyncDryRun({
      root: fixture.root,
      upstreamBranch: 'official',
      packageIdentityPath: 'downstream-package-identities.json',
    })).toThrow(/clean source checkout/u)
    expect(git(fixture.root, 'status', '--porcelain')).toContain('?? user-wip.txt')
    expect(git(fixture.root, 'for-each-ref', '--format=%(refname)', 'refs/dsh/upstream-sync-dry-run/')).toBe('')
  })

  it('rejects unknown CLI options before starting the rehearsal', () => {
    const fixture = createRepository(false)

    const result = spawnSync(process.execPath, [
      '--import',
      'tsx/esm',
      join(import.meta.dirname, 'upstream-sync-dry-run.ts'),
      '--root',
      fixture.root,
      '--upstream-branch',
      'official',
      '--package-identities',
      'downstream-package-identities.json',
      '--unknown-option',
      'value',
    ], { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8' })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('unexpected option: --unknown-option')
    expect(git(fixture.root, 'for-each-ref', '--format=%(refname)', 'refs/dsh/upstream-sync-dry-run/')).toBe('')
  })

  it('does not create FETCH_HEAD in a linked source worktree', () => {
    const fixture = createRepository(false)
    const linkedRoot = `${fixture.root}-linked`
    git(fixture.root, 'worktree', 'add', '--quiet', '--detach', linkedRoot, fixture.personalHead)

    try {
      runUpstreamSyncDryRun({
        root: linkedRoot,
        upstreamBranch: 'official',
        packageIdentityPath: 'downstream-package-identities.json',
      })

      const fetchHead = git(linkedRoot, 'rev-parse', '--git-path', 'FETCH_HEAD')
      expect(existsSync(fetchHead)).toBe(false)
    } finally {
      git(fixture.root, 'worktree', 'remove', '--force', linkedRoot)
    }
  })
})
