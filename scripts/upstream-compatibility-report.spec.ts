import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateUpstreamCompatibilityReport } from './generate-divergence-report.ts'

const root = resolve(import.meta.dirname, '..')
const temporaryRoots: string[] = []

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function createDivergedRepository(): { personal: string; root: string; target: string } {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'dsh-upstream-report-'))
  temporaryRoots.push(fixtureRoot)
  git(fixtureRoot, 'init', '--quiet', '--initial-branch=master')
  git(fixtureRoot, 'config', 'user.email', 'test@example.com')
  git(fixtureRoot, 'config', 'user.name', 'Test')
  mkdirSync(join(fixtureRoot, 'packages/core/example/src'), { recursive: true })
  mkdirSync(join(fixtureRoot, 'packages/client/example/src'), { recursive: true })
  mkdirSync(join(fixtureRoot, 'apps/cli/src'), { recursive: true })
  writeFileSync(join(fixtureRoot, 'packages/core/example/src/index.ts'), 'export const value = "base"\n')
  writeFileSync(join(fixtureRoot, 'packages/client/example/src/index.ts'), 'export const client = "base"\n')
  writeFileSync(join(fixtureRoot, 'apps/cli/src/index.ts'), 'export const cli = "base"\n')
  writeFileSync(join(fixtureRoot, 'packages/client/README.md'), '# Client packages\n')
  writeFileSync(join(fixtureRoot, 'apps/README.md'), '# Applications\n')
  git(fixtureRoot, 'add', '.')
  git(fixtureRoot, 'commit', '--quiet', '-m', 'supported base')
  const base = git(fixtureRoot, 'rev-parse', 'HEAD')

  git(fixtureRoot, 'switch', '--quiet', '-c', 'personal')
  writeFileSync(join(fixtureRoot, 'packages/core/example/src/index.ts'), 'export const value = "personal"\n')
  git(fixtureRoot, 'add', '.')
  git(fixtureRoot, 'commit', '--quiet', '-m', 'personal patch')
  const personal = git(fixtureRoot, 'rev-parse', 'HEAD')

  git(fixtureRoot, 'switch', '--quiet', '-c', 'upstream', base)
  writeFileSync(join(fixtureRoot, 'packages/core/example/src/index.ts'), 'export const value = "upstream"\n')
  writeFileSync(join(fixtureRoot, 'packages/client/example/src/index.ts'), 'export const client = "upstream"\n')
  writeFileSync(join(fixtureRoot, 'packages/client/README.md'), '# Changed client packages\n')
  git(fixtureRoot, 'add', '.')
  git(fixtureRoot, 'commit', '--quiet', '-m', 'upstream change')
  writeFileSync(join(fixtureRoot, 'packages/core/example/src/index.ts'), 'export const value = "upstream again"\n')
  writeFileSync(join(fixtureRoot, 'apps/cli/src/index.ts'), 'export const cli = "upstream"\n')
  writeFileSync(join(fixtureRoot, 'apps/README.md'), '# Changed applications\n')
  git(fixtureRoot, 'add', '.')
  git(fixtureRoot, 'commit', '--quiet', '-m', 'upstream changes the same package again')
  const target = git(fixtureRoot, 'rev-parse', 'HEAD')
  git(fixtureRoot, 'switch', '--quiet', 'personal')

  writeJson(join(fixtureRoot, 'upstream-base.json'), {
    schemaVersion: 1,
    supportedUpstreamBase: { sha: base },
    recordedPersonalHeadSha: personal,
    observedUpstreamHeadSha: base,
  })
  writeJson(join(fixtureRoot, 'core-patches.json'), {
    schemaVersion: 1,
    patches: [{
      id: 'example-runtime-patch',
      status: 'active',
      kind: 'unavoidable-core-patch',
      title: 'Example runtime patch',
      affectedFiles: ['packages/core/example/**'],
      dataFormatEffect: 'changes persisted example bytes',
      heatmap: { architectureCentrality: 3, dataMigrationRisk: 2 },
      risk: { level: 'high', points: 7 },
    }],
  })
  return { personal, root: fixtureRoot, target }
}

afterEach(() => {
  for (const temporaryRoot of temporaryRoots.splice(0)) rmSync(temporaryRoot, { force: true, recursive: true })
})

describe('upstream compatibility report', () => {
  it('skips synthetic merge and heatmap work when the fetched upstream head is unchanged', () => {
    const result = spawnSync(process.execPath, [
      '--import',
      'tsx/esm',
      resolve(root, 'scripts/generate-divergence-report.ts'),
      '--root',
      root,
      '--upstream-ref',
      'upstream/master',
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
    expect(report.upstreamChanged).toBe(false)
    expect(report.heavyChecksRequired).toBe(false)
    expect(report.mergeStatus).toBe('not-run')
    expect(report.hotspots).toEqual([])
  })

  it('reports conflicting upstream changes against their registered patch and computes the heatmap score', () => {
    const fixture = createDivergedRepository()

    const report = generateUpstreamCompatibilityReport(
      fixture.root,
      fixture.target,
      new Date('2026-09-05T00:00:00.000Z'),
    )

    expect(report).toMatchObject({
      generatedAt: '2026-09-05T00:00:00.000Z',
      personalHeadSha: fixture.personal,
      targetUpstreamHeadSha: fixture.target,
      upstreamChanged: true,
      heavyChecksRequired: true,
      mergeStatus: 'conflicts',
      conflictPaths: ['packages/core/example/src/index.ts'],
      upstreamChangedPaths: [
        'apps/README.md',
        'apps/cli/src/index.ts',
        'packages/client/README.md',
        'packages/client/example/src/index.ts',
        'packages/core/example/src/index.ts',
      ],
      changedPackages: ['apps/cli', 'packages/client/example', 'packages/core/example'],
      hotspots: [{
        patchId: 'example-runtime-patch',
        privatePathCount: 1,
        upstreamPathCount: 1,
        upstreamCommitCount: 2,
        conflictPathCount: 1,
        architectureCentrality: 3,
        dataMigrationRisk: 2,
        score: 12,
      }],
    })
  })

  it('renders an actionable GitHub summary for a changed upstream head', () => {
    const fixture = createDivergedRepository()
    const jsonOutput = join(fixture.root, 'upstream-compatibility.json')

    const result = spawnSync(process.execPath, [
      '--import',
      'tsx/esm',
      resolve(root, 'scripts/generate-divergence-report.ts'),
      '--root',
      fixture.root,
      '--upstream-ref',
      fixture.target,
      '--format',
      'markdown',
      '--json-output',
      jsonOutput,
    ], {
      cwd: root,
      encoding: 'utf8',
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('# Upstream compatibility report')
    expect(result.stdout).toContain('- Synthetic merge: **conflicts**')
    expect(result.stdout).toContain('## Changed packages')
    expect(result.stdout).toContain('- `apps/cli`')
    expect(result.stdout).toContain('- `packages/client/example`')
    expect(result.stdout).toContain('- `packages/core/example`')
    expect(result.stdout).toContain('## Conflict paths')
    expect(result.stdout).toContain('- `packages/core/example/src/index.ts`')
    expect(result.stdout).toContain('| example-runtime-patch | 12 | high | 1 | 2 | 1 | 1 |')
    expect(JSON.parse(readFileSync(jsonOutput, 'utf8'))).toMatchObject({
      targetUpstreamHeadSha: fixture.target,
      mergeStatus: 'conflicts',
      changedPackages: ['apps/cli', 'packages/client/example', 'packages/core/example'],
    })
  })
})
