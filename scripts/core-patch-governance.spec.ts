import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkCorePatchGovernance,
  validateCorePatchDocuments,
} from './check-core-patch-budget.ts'

const root = resolve(import.meta.dirname, '..')
const temporaryRoots: string[] = []

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asUnknownArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value as readonly unknown[] : undefined
}

function createGitFixture(): { base: string; head: string; root: string } {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'dsh-core-patches-'))
  temporaryRoots.push(fixtureRoot)
  git(fixtureRoot, 'init', '--quiet', '--initial-branch=master')
  git(fixtureRoot, 'config', 'user.email', 'test@example.com')
  git(fixtureRoot, 'config', 'user.name', 'Test')
  mkdirSync(join(fixtureRoot, 'packages/core/example/src'), { recursive: true })
  mkdirSync(join(fixtureRoot, 'packages/core/example/tests'), { recursive: true })
  writeFileSync(join(fixtureRoot, 'packages/core/example/src/index.ts'), 'export const value = 1\n')
  writeFileSync(join(fixtureRoot, 'packages/core/example/tests/core.spec.ts'), 'export {}\n')
  git(fixtureRoot, 'add', '.')
  git(fixtureRoot, 'commit', '--quiet', '-m', 'base')
  const base = git(fixtureRoot, 'rev-parse', 'HEAD')
  writeFileSync(join(fixtureRoot, 'packages/core/example/src/index.ts'), 'export const value = 2\n')
  git(fixtureRoot, 'add', '.')
  git(fixtureRoot, 'commit', '--quiet', '-m', 'personal patch')
  const head = git(fixtureRoot, 'rev-parse', 'HEAD')
  return { base, head, root: fixtureRoot }
}

function fixtureBaseline(base: string): Record<string, unknown> {
  return {
    schemaVersion: 1,
    officialRepository: 'official/repository',
    officialDefaultBranch: 'master',
    forkRepository: 'personal/repository',
    forkDefaultBranch: 'master',
    supportedUpstreamBase: { sha: base, tag: null },
    recordedPersonalHeadSha: base,
    observedUpstreamHeadSha: base,
    mergeBaseSha: base,
    divergence: { personalAhead: 0, personalBehind: 0 },
    lastRevalidatedAt: '2026-09-05T00:00:00.000Z',
    revalidationScope: 'fixture',
    runtimeEvidence: [],
  }
}

function fixturePatch(base: string): Record<string, unknown> {
  return {
    id: 'example-core-patch',
    status: 'active',
    kind: 'unavoidable-core-patch',
    title: 'Example core patch',
    owner: 'example',
    introducedAt: '2026-09-05',
    upstreamBaseSha: base,
    commits: [base],
    affectedUpstreamPackages: ['packages/core/example'],
    affectedFiles: ['packages/core/example/src/index.ts'],
    reason: 'The fixture needs a changed upstream-owned file.',
    whyPluginIsInsufficient: 'The fixture change is inside the owning service.',
    whyCompatibilityAdapterIsInsufficient: 'The fixture operation cannot be intercepted later.',
    factOwnershipEffect: 'none',
    dataFormatEffect: 'none',
    securityEffect: 'none',
    tests: ['packages/core/example/tests/core.spec.ts'],
    upstreamCanaryTests: ['fixture test'],
    migrationPlan: 'Replace the fixture implementation.',
    rollbackPlan: 'Revert the fixture commit.',
    replacementCondition: 'The fixture no longer differs.',
    upstreamIssueOrPr: null,
    expiryReviewDate: '2026-12-05',
    knownMergeConflicts: ['packages/core/example/src/index.ts'],
    lastRevalidatedUpstreamSha: base,
    risk: { level: 'low', points: 1 },
  }
}

function writeFixtureDocuments(
  fixtureRoot: string,
  base: string,
  patches: readonly Record<string, unknown>[],
  budget: Record<string, number> = { maxActivePatches: 5, maxRiskPoints: 10, maxCriticalPatches: 1 },
  downstreamOwnedAdditions: readonly string[] = [],
): void {
  writeJson(join(fixtureRoot, 'upstream-base.json'), fixtureBaseline(base))
  writeJson(join(fixtureRoot, 'core-patches.json'), {
    schemaVersion: 1,
    supportedUpstreamBaseSha: base,
    budget,
    downstreamOwnedAdditions,
    patches,
  })
  mkdirSync(join(fixtureRoot, 'downstream'), { recursive: true })
  writeJson(join(fixtureRoot, 'downstream/package-identities.json'), {
    schemaVersion: 3,
    personalPackages: [],
  })
}

afterEach(() => {
  for (const temporaryRoot of temporaryRoots.splice(0)) rmSync(temporaryRoot, { force: true, recursive: true })
})

describe('downstream core patch governance', () => {
  it('accepts the checked-in baseline only when every upstream-owned modification is registered and within budget', () => {
    const result = spawnSync(process.execPath, [
      '--import',
      'tsx/esm',
      resolve(root, 'scripts/check-core-patch-budget.ts'),
      '--root',
      root,
      '--format',
      'json',
    ], {
      cwd: root,
      encoding: 'utf8',
    })

    expect(result.status, result.stderr).toBe(0)
    const report: unknown = JSON.parse(result.stdout)
    expect(isRecord(report)).toBe(true)
    if (!isRecord(report)) return
    expect(typeof report.activePatchCount).toBe('number')
    expect(typeof report.coveredUpstreamPathCount).toBe('number')
    expect(typeof report.riskPoints).toBe('number')
    expect(typeof report.observedUpstreamVerified).toBe('boolean')
    expect(report.unregisteredUpstreamPaths).toEqual([])
  })

  it('rejects an upstream-owned code change that no active patch covers', () => {
    const fixture = createGitFixture()
    writeFixtureDocuments(fixture.root, fixture.base, [])

    const report = checkCorePatchGovernance(fixture.root, fixture.head)

    expect(report.unregisteredUpstreamPaths).toEqual(['packages/core/example/src/index.ts'])
    expect(report.errors).toContain('1 upstream-owned modified path(s) are not registered')
  })

  it('rejects a newly added source file inside an upstream-owned package when no patch covers it', () => {
    const fixture = createGitFixture()
    writeFileSync(join(fixture.root, 'packages/core/example/src/added.ts'), 'export const added = true\n')
    git(fixture.root, 'add', '.')
    git(fixture.root, 'commit', '--quiet', '-m', 'add unregistered core source')
    const head = git(fixture.root, 'rev-parse', 'HEAD')
    writeFixtureDocuments(fixture.root, fixture.base, [fixturePatch(fixture.base)])

    const report = checkCorePatchGovernance(fixture.root, head)

    expect(report.unregisteredUpstreamPaths).toContain('packages/core/example/src/added.ts')
  })

  it('does not misclassify an explicitly personal package as an upstream core patch', () => {
    const fixture = createGitFixture()
    mkdirSync(join(fixture.root, 'packages/personal/example/src'), { recursive: true })
    writeFileSync(join(fixture.root, 'packages/personal/example/src/index.ts'), 'export const personal = true\n')
    git(fixture.root, 'add', '.')
    git(fixture.root, 'commit', '--quiet', '-m', 'add personal package')
    const head = git(fixture.root, 'rev-parse', 'HEAD')
    writeFixtureDocuments(fixture.root, fixture.base, [fixturePatch(fixture.base)])
    writeJson(join(fixture.root, 'downstream/package-identities.json'), {
      schemaVersion: 3,
      personalPackages: [{ directory: 'packages/personal/example' }],
    })

    const report = checkCorePatchGovernance(fixture.root, head)

    expect(report.unregisteredUpstreamPaths).not.toContain('packages/personal/example/src/index.ts')
    expect(report.errors).toEqual([])
  })

  it('allows a bounded downstream-owned non-package addition without hiding adjacent scripts', () => {
    const fixture = createGitFixture()
    mkdirSync(join(fixture.root, 'scripts/personal'), { recursive: true })
    writeFileSync(join(fixture.root, 'scripts/personal/report.ts'), 'export {}\n')
    writeFileSync(join(fixture.root, 'scripts/unregistered.ts'), 'export {}\n')
    git(fixture.root, 'add', '.')
    git(fixture.root, 'commit', '--quiet', '-m', 'add downstream scripts')
    const head = git(fixture.root, 'rev-parse', 'HEAD')
    writeFixtureDocuments(
      fixture.root,
      fixture.base,
      [fixturePatch(fixture.base)],
      { maxActivePatches: 5, maxRiskPoints: 10, maxCriticalPatches: 1 },
      ['scripts/personal/**'],
    )

    const report = checkCorePatchGovernance(fixture.root, head)

    expect(report.unregisteredUpstreamPaths).not.toContain('scripts/personal/report.ts')
    expect(report.unregisteredUpstreamPaths).toContain('scripts/unregistered.ts')
  })

  it('rejects a compatibility adapter that claims ownership of business facts', () => {
    const baseline = JSON.parse(readFileSync(resolve(root, 'upstream-base.json'), 'utf8')) as Record<string, unknown>
    const registry = JSON.parse(readFileSync(resolve(root, 'core-patches.json'), 'utf8')) as {
      patches: readonly Record<string, unknown>[]
    }
    const [first, ...rest] = registry.patches
    expect(first).toBeDefined()
    if (first === undefined) return

    const errors = validateCorePatchDocuments(baseline, {
      ...registry,
      patches: [{
        ...first,
        kind: 'compatibility-adapter',
        factOwnershipEffect: 'owns a second Work store',
      }, ...rest],
    })

    expect(errors).toContain('patches[0]: compatibility-adapter must not own business facts; factOwnershipEffect must be none')
  })

  it('rejects cross-package wildcard variants and evidence paths outside the repository', () => {
    const baseline: unknown = JSON.parse(readFileSync(resolve(root, 'upstream-base.json'), 'utf8'))
    const registry: unknown = JSON.parse(readFileSync(resolve(root, 'core-patches.json'), 'utf8'))
    const patches = isRecord(registry) ? asUnknownArray(registry.patches) : undefined
    expect(patches).toBeDefined()
    if (!isRecord(registry) || patches === undefined) return
    const [first, ...rest] = patches
    expect(isRecord(first)).toBe(true)
    if (!isRecord(first)) return

    const errors = validateCorePatchDocuments(baseline, {
      ...registry,
      patches: [{
        ...first,
        affectedFiles: ['packages/*/**', 'packages/**/**', '.github/workflows/**'],
        tests: ['../outside.spec.ts'],
      }, ...rest],
    })

    expect(errors).toEqual(expect.arrayContaining([
      'patches[0].affectedFiles pattern is too broad: packages/*/**',
      'patches[0].affectedFiles pattern is too broad: packages/**/**',
      'patches[0].affectedFiles pattern is too broad: .github/workflows/**',
      'patches[0].tests must contain repository-relative POSIX file paths: ../outside.spec.ts',
    ]))
  })

  it('rejects active patch counts and risk points above their explicit budgets', () => {
    const fixture = createGitFixture()
    const patch = fixturePatch(fixture.base)
    writeFixtureDocuments(fixture.root, fixture.base, [patch], {
      maxActivePatches: 0,
      maxRiskPoints: 0,
      maxCriticalPatches: 0,
    })

    const report = checkCorePatchGovernance(fixture.root, fixture.head)

    expect(report.errors).toEqual(expect.arrayContaining([
      'active core patch count 1 exceeds budget 0',
      'core patch risk 1 exceeds budget 0',
    ]))
  })

  it('rejects expired patches and commits that are not present in the checked history', () => {
    const fixture = createGitFixture()
    writeFixtureDocuments(fixture.root, fixture.base, [{
      ...fixturePatch(fixture.base),
      commits: ['0000000000000000000000000000000000000000'],
      expiryReviewDate: '2026-09-04',
    }])

    const report = checkCorePatchGovernance(fixture.root, fixture.head, new Date('2026-09-05T00:00:00.000Z'))

    expect(report.errors).toEqual(expect.arrayContaining([
      'example-core-patch: expiry review date 2026-09-04 has passed',
      'example-core-patch: registered commit is absent: 0000000000000000000000000000000000000000',
    ]))
  })

  it('rejects divergence counts that do not match the recorded Git objects', () => {
    const fixture = createGitFixture()
    writeFixtureDocuments(fixture.root, fixture.base, [fixturePatch(fixture.base)])
    const baseline = fixtureBaseline(fixture.base)
    baseline.divergence = { personalAhead: 10, personalBehind: 20 }
    writeJson(join(fixture.root, 'upstream-base.json'), baseline)

    const report = checkCorePatchGovernance(fixture.root, fixture.head)

    expect(report.errors).toContain('recorded ahead/behind counts do not match Git history')
    expect(report.observedUpstreamVerified).toBe(false)
  })

  it('checks the supported base without requiring the latest upstream object in an ordinary fork checkout', () => {
    const fixture = createGitFixture()
    writeFixtureDocuments(fixture.root, fixture.base, [fixturePatch(fixture.base)])
    const baseline = fixtureBaseline(fixture.base)
    baseline.observedUpstreamHeadSha = 'ffffffffffffffffffffffffffffffffffffffff'
    writeJson(join(fixture.root, 'upstream-base.json'), baseline)

    const report = checkCorePatchGovernance(fixture.root, fixture.head)

    expect(report.errors).toEqual([])
    expect(report.coveredUpstreamPathCount).toBe(1)
    expect(report.observedUpstreamVerified).toBe(false)
  })

  it('fails closed when an upstream-aware caller requires an unavailable observed object', () => {
    const fixture = createGitFixture()
    writeFixtureDocuments(fixture.root, fixture.base, [fixturePatch(fixture.base)])
    const baseline = fixtureBaseline(fixture.base)
    baseline.observedUpstreamHeadSha = 'ffffffffffffffffffffffffffffffffffffffff'
    writeJson(join(fixture.root, 'upstream-base.json'), baseline)

    const report = checkCorePatchGovernance(
      fixture.root,
      fixture.head,
      new Date('2026-09-05T00:00:00.000Z'),
      true,
    )

    expect(report.observedUpstreamVerified).toBe(false)
    expect(report.errors).toContain(
      'observed upstream object is required but absent: ffffffffffffffffffffffffffffffffffffffff',
    )
  })
})
