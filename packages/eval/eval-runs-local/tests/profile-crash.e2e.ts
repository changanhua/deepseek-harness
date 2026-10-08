import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import Sessions from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { evalContractDigest, parseEvalPlan, parseEvalSuite } from '@changanhua/dsh-eval'
import type { EvalRunView } from '@changanhua/dsh-eval-runs'
import { expect, test } from 'vitest'
import * as SqliteStorage from '../../../storage/storage-sqlite/src/index.ts'
import LocalBudget from '../../../budget/budget-local/src/index.ts'
import { fixtureGit } from '../../../delivery/repo-workspace-git-local/tests/harness.ts'
import { stageProfileFixture } from '../../eval-isolated/tests/runtime-fixture.ts'
import { observeRuntimeTree } from '../../eval-isolated/src/build.ts'
import { runConfig } from './helpers/config.ts'

const execFileAsync = promisify(execFile)
const checkout = resolve(import.meta.dirname, '../../../..')

test.skipIf(process.platform !== 'win32' || process.arch !== 'x64')('dsh Profile recovers a crashed dispatched Attempt without another model call', async () => {
  const root = await mkdtemp(join(homedir(), '.dsh-eval-profile-'))
  const repository = join(root, 'repository'), core = join(root, 'core'), home = join(root, 'home')
  const database = join(root, 'private/account.sqlite'), sessionRoot = join(root, 'sessions')
  let seed: Context | undefined
  try {
    await mkdir(repository)
    await fixtureGit(repository, 'init', '-b', 'main')
    await fixtureGit(repository, 'config', 'user.name', 'Eval Test')
    await fixtureGit(repository, 'config', 'user.email', 'eval@example.invalid')
    await writeFile(join(repository, 'input.txt'), 'fixed source')
    await fixtureGit(repository, 'add', 'input.txt'); await fixtureGit(repository, 'commit', '-m', 'fixture')
    const commit = await fixtureGit(repository, 'rev-parse', 'HEAD')
    await stageProfileFixture(core, join(root, 'staging'), '', ['@deepseek-ai/dsh-agent-loop', '@deepseek-ai/dsh-agent-presets',
      '@deepseek-ai/dsh-skill', '@deepseek-ai/dsh-session-persistence-jsonl', '@changanhua/dsh-eval'])
    await mkdir(join(core, 'presets/minimal'), { recursive: true })
    await writeFile(join(core, 'presets/minimal/agent.cordis.yml'), '[]\n')
    const bounds = { maxFiles: 30000, maxBytes: 1024 * 1024 * 1024 }
    const image = await observeRuntimeTree(core, bounds, AbortSignal.timeout(30000))
    seed = new Context()
    await seed.plugin(Storage)
    const storageConfig = { backendName: 'eval_db', path: database, ownership: 'exclusive' as const,
      journalMode: 'delete' as const, synchronous: 'full' as const, privateDirectory: true }
    await seed.plugin(SqliteStorage, storageConfig)
    seed.provide('storageDomain', new DomainFacility(seed, { backend: 'eval_db' }))
    await seed.plugin(Sessions); await seed.plugin(SessionProjections)
    await seed.plugin(JsonlPersistence, { root: sessionRoot, compression: 'none' })
    await seed.plugin(WorkspaceRegistry)
    const workspace = await seed.workspaceRegistry.create(repository)
    await seed.plugin(LocalBudget, { maxScopes: 8, maxReservations: 32, maxLedgerBytes: 128 * 1024 })
    const budget = await seed.budget.createScope({ id: 'profile-budget', kind: 'session', subjectId: 'eval', parentId: null,
      limits: { requests: 8, inputTokens: 20000, outputTokens: 1000, totalTokens: 21000, wallTimeMs: 300000 }, onExhausted: 'deny' }, () => {})
    await seed.fiber.dispose(); seed = undefined
    const routes = ['a', 'b'].map(id => ({ id, provider: 'fixture', model: 'fixture', preset: 'minimal' }))
    const suite = parseEvalSuite({ schemaVersion: 1, id: 'suite', version: '1', title: 'Crash', sourceRevision: commit,
      defaultRouteIds: ['a', 'b'], routes, cases: [{ id: 'case', title: 'Ready', prompt: 'Reply READY.', workspace: { kind: 'empty' },
        successCriteria: [{ kind: 'output-equals', text: 'READY' }], evaluator: { kind: 'deterministic' },
        replayFixtures: routes.map(route => ({ routeId: route.id, binding: 'first-call-order', sessionFile: `${route.id}.jsonl` })) }] })
    const plan = parseEvalPlan({ kind: 'eval-plan', schemaVersion: 1, id: 'plan', version: '1',
      suiteRef: { id: suite.id, version: suite.version, digest: evalContractDigest(suite) }, repository: { requestedRevision: 'main', expectedCommit: commit },
      routes: routes.map(route => ({ ...route, parameters: { maxTokens: 64 }, preset: { id: 'minimal', source: 'preset:system',
        digest: createHash('sha256').update('[]\n').digest('hex') } })),
      repeatPolicy: { count: 1, seed: null, order: 'route-case-repeat' }, baselineRef: null, workspacePolicy: 'per-cell', allowedEntrypoints: ['cli'],
      credentialAuthorizationRef: null, budget: { required: true, authorizationRef: budget.reference },
      verifierPlanRef: { id: 'verifier', version: '1', digest: 'f'.repeat(64) } })
    await writeFile(join(repository, 'plan.json'), JSON.stringify(plan)); await writeFile(join(repository, 'suite.json'), JSON.stringify(suite))
    const config = runConfig({ root, access: { workspace } }), policy = config.policies[0]!
    config.policies[0] = { ...policy, execution: { ...policy.execution, runtime: { ...policy.execution.runtime,
      core: { subject: { directory: core, digest: image.digest, plugins: [] },
        grader: { directory: core, digest: image.digest, plugins: [] } },
      imageBounds: bounds, executionMs: 60000, stopMs: 10000 } } }
    const profile = join(home, 'profiles/eval-recovery')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'eval-recovery-test', private: true,
      dsh: { profile: { bundles: [], patchReload: 'startup' } } }))
    const row = (id: string, path: string, config?: unknown) => ({ id, name: pathToFileURL(join(checkout, path)).href,
      ...(config === undefined ? {} : { config }) })
    await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: [
      row('storage', 'packages/storage/storage/src/index.ts'),
      row('sqlite', 'packages/storage/storage-sqlite/src/index.ts', storageConfig),
      row('domain', 'packages/storage/storage-domain/src/index.ts', { backend: 'eval_db' }),
      row('sessions', 'packages/core/session/src/index.ts'), row('projections', 'packages/session/session-projection/src/index.ts'),
      row('persistence', 'packages/session/session-persistence-jsonl/src/index.ts', { root: sessionRoot, compression: 'none' }),
      row('workspaces', 'packages/workspace/workspace/src/index.ts'),
      row('presets', 'packages/preset/agent-presets/src/index.ts', { default: 'minimal', includeShippedRoot: false, includeUserRoot: false,
        roots: [{ path: join(core, 'presets'), trust: 'system' }] }),
      row('llm', 'packages/llm/llm/src/index.ts'),
      row('budget', 'packages/budget/budget-local/src/index.ts', { maxScopes: 8, maxReservations: 32, maxLedgerBytes: 128 * 1024 }),
      row('budget-llm', 'packages/budget/budget-llm/src/index.ts'),
      row('subprocess', 'packages/subprocess/subprocess-local/src/index.ts'),
      row('repo', 'packages/delivery/repo-workspace-git-local/src/index.ts', { repositories: { fixture: repository }, worktreeRoot: join(root, 'leases') }),
      row('plans', 'packages/eval/eval-plans-local/src/index.ts', { maxAdmissions: 8, maxLedgerBytes: 65536,
        sources: [{ workspaceId: workspace.id, root: repository, mode: 'keyless', planFile: 'plan.json', suiteFile: 'suite.json',
          approvedPlan: { id: plan.id, version: plan.version, digest: evalContractDigest(plan) }, maxFileBytes: 65536, maxCells: 10,
          credentialGrant: null, requiredTools: [], requiredSkills: [] }] }),
      row('queue', 'packages/task-queue/task-queue-local/src/index.ts', { queueRoot: join(root, 'queue'), resourceCapacity: { 'eval-cell': 1 } }),
      row('runs', 'packages/eval/eval-runs-local/src/index.ts', config),
      row('fixture', 'packages/eval/eval-runs-local/tests/fixtures/crash-profile.ts'),
    ] }]))
    const launch = (crash: boolean) => execFileAsync(process.execPath, ['--import', import.meta.resolve('tsx'),
      join(checkout, 'apps/cli/src/bin.ts'), '--profile', 'eval-recovery'], { cwd: repository, windowsHide: true,
      timeout: 120000, maxBuffer: 1024 * 1024, env: { ...scrubbedParentEnv(), DSH_HOME: home, DSH_EVAL_CRASH: crash ? '1' : '0',
        TSX_TSCONFIG_PATH: join(checkout, 'tsconfig.json'), DSH_TELEMETRY_DISABLED: '1' } })
    const first = await launch(true).then(value => ({ code: 0, stderr: value.stderr }),
      (error: unknown) => {
        if (!error || typeof error !== 'object' || !('code' in error) || !('stderr' in error)) throw error
        return { code: error.code, stderr: String(error.stderr) }
      })
    expect(first.code, first.stderr).toBe(73)
    await launch(false)
    const after = JSON.parse(await readFile(join(repository, 'after.json'), 'utf8')) as {
      run: EvalRunView
      repeated: EvalRunView
      budget: { unknownRequests: number }
    }
    expect(after.run.phase).toBe('needs-attention')
    expect(after.run.id).toBe(after.repeated.id)
    expect(after.run.cells).toHaveLength(2)
    expect(after.run.cells.filter(cell => cell.status === 'unknown')).toHaveLength(1)
    expect(after.budget.unknownRequests).toBe(1)
    expect(await readFile(join(repository, 'dispatches.txt'), 'utf8')).toBe('dispatched\n')
  } finally { await seed?.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
}, 180000)
