import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import ts from 'typescript'
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
import { runConfig } from '../../eval-runs-local/tests/helpers/config.ts'
import { RunLedger } from '../../eval-runs-local/src/ledger.ts'
import type { GuardedModelResult } from '../../eval-isolated/src/broker.ts'
import Agents from '../../../core/agent/src/index.ts'
import AgentLoop from '../../../core/agent-loop/src/index.ts'
import Tools from '../../../core/tools/src/index.ts'
import SystemPrompt from '../../../core/system-prompt/src/index.ts'
import Llm from '../../../llm/llm/src/index.ts'
import Goals from '../../../goal/goal/src/index.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { EvalGateView } from '@changanhua/dsh-eval-gates'
import type { EvalActivationView } from '@changanhua/dsh-eval-activation'

const execFileAsync = promisify(execFile)
const checkout = resolve(import.meta.dirname, '../../../..')

for (const live of [false, true]) {
  test.skipIf(process.platform !== 'win32' || process.arch !== 'x64' || (live && !process.env.DEEPSEEK_API_KEY))(
    `built CLI ${live ? 'with real DeepSeek Flash/Pro' : 'with deterministic model'} verifies and continues a cold Goal exactly once`,
    { timeout: 300000, retry: 0 }, async () => {
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
        const staged = await stageProfileFixture(core, join(root, 'staging'), '', ['@deepseek-ai/dsh-agent-loop', '@deepseek-ai/dsh-agent-presets',
          '@deepseek-ai/dsh-skill', '@deepseek-ai/dsh-session-persistence-jsonl', '@changanhua/dsh-eval', '@changanhua/dsh-eval-verifier'], join(import.meta.dirname, '../package.json'))
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
        await seed.plugin(Llm); await seed.plugin(Tools); await seed.plugin(SystemPrompt); await seed.plugin(Agents)
        await seed.plugin(Goals); await seed.plugin(AgentLoop, { agents: [] })
        const provider = live ? 'deepseek-official' : 'fixture'
        const models = live ? ['deepseek-v4-flash', 'deepseek-v4-pro'] : ['fixture', 'fixture']
        const target = await seed.agents.create({ sessionId: SessionId('target'), meta: { cwd: repository },
          agentOptions: { provider, model: models[0]!, maxTokens: 64 } })
        const goal = seed.goals.create(target.agent, { objective: 'consume the approved Eval result once', maxGoalRounds: 2 })
        seed.goals.disarm(target.agent)
        await seed.sessions.flush(target.agent.session)
        await seed.plugin(LocalBudget, { maxScopes: 8, maxReservations: 32, maxLedgerBytes: 128 * 1024 })
        const budget = await seed.budget.createScope({ id: 'profile-budget', kind: 'session', subjectId: 'target', parentId: null,
          limits: { requests: 8, inputTokens: 20000, outputTokens: 1000, totalTokens: 21000, wallTimeMs: 300000 }, onExhausted: 'deny' }, () => {})
        await seed.fiber.dispose(); seed = undefined
        const routes = ['a', 'b'].map((id, index) => ({ id, provider, model: models[index]!, preset: 'minimal' }))
        const credentialGrant = live ? { reference: { id: 'live-acceptance', version: '1',
          digest: evalContractDigest({ provider, credentialRefs: ['DEEPSEEK_API_KEY'] }) }, credentialRefs: ['DEEPSEEK_API_KEY'] } : null
        const suite = parseEvalSuite({ schemaVersion: 1, id: 'suite', version: '1', title: 'Full loop', sourceRevision: commit,
          defaultRouteIds: ['a', 'b'], routes, cases: [{ id: 'case', title: 'Ready',
            prompt: 'Reply with exactly the five uppercase letters READY. Do not add punctuation, quotes, whitespace, or explanation.',
            workspace: { kind: 'empty' },
            successCriteria: [{ kind: 'output-equals', text: 'READY' }], evaluator: { kind: 'model-grader', provider, model: models[1]!, promptVersion: '1' },
            replayFixtures: routes.map(route => ({ routeId: route.id, binding: 'first-call-order', sessionFile: `${route.id}.jsonl` })) }] })
        const plan = parseEvalPlan({ kind: 'eval-plan', schemaVersion: 1, id: 'plan', version: '1',
          suiteRef: { id: suite.id, version: suite.version, digest: evalContractDigest(suite) }, repository: { requestedRevision: 'main', expectedCommit: commit },
          routes: routes.map(route => ({ ...route, parameters: { maxTokens: 64, reasoningEffort: 'off' },
            preset: { id: 'minimal', source: 'preset:system',
              digest: createHash('sha256').update('[]\n').digest('hex') } })),
          repeatPolicy: { count: 1, seed: null, order: 'route-case-repeat' }, baselineRef: null, workspacePolicy: 'per-cell', allowedEntrypoints: ['cli'],
          credentialAuthorizationRef: credentialGrant?.reference ?? null, budget: { required: true, authorizationRef: budget.reference },
          verifierPlanRef: { id: 'verifier', version: '1', digest: 'f'.repeat(64) } })
        await writeFile(join(repository, 'plan.json'), JSON.stringify(plan)); await writeFile(join(repository, 'suite.json'), JSON.stringify(suite))
        const config = Object.assign({}, runConfig({ root, access: { workspace } }), { retentionMs: 15 * 60 * 1000,
          maxLedgerBytes: 16 * 1024 * 1024 })
        const policy = config.policies[0]!
        config.policies[0] = { ...policy, execution: { ...policy.execution,
          evidenceLimits: { ...policy.execution.evidenceLimits, maxBytes: 4 * 1024 * 1024 },
          grader: { routeId: 'b', promptVersion: '1',
            prompt: 'Grade the subject. Return PASS if its output is exactly READY, without punctuation or other text. Otherwise return FAIL.',
            tools: [], skills: [] }, runtime: { ...policy.execution.runtime,
            core: { subject: { directory: core, digest: image.digest, plugins: [] },
              grader: { directory: core, digest: image.digest, plugins: [] } },
            imageBounds: bounds, executionMs: 60000, stopMs: 10000 } } }
        const profile = join(home, 'profiles/eval-recovery')
        await mkdir(profile, { recursive: true })
        await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'eval-recovery-test', private: true,
          dsh: { profile: { bundles: [], patchReload: 'startup' } } }))
        const fixtureFile = join(import.meta.dirname, 'fixtures/full-loop-profile.ts')
        const resolver = createRequire(fixtureFile)
        const fixtureSource = await readFile(fixtureFile, 'utf8')
        const emitted = ts.transpileModule(fixtureSource, { compilerOptions: {
          target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
        } }).outputText.replace(/from ['"]([^'"]+)['"]/gu, (_text, specifier: string) => {
          if (specifier.startsWith('node:')) return `from '${specifier}'`
          const target = specifier.startsWith('.')
            ? resolve(import.meta.dirname, 'fixtures', specifier).replace(/[\\/]src[\\/]index\.ts$/u, '/lib/index.js')
            : resolver.resolve(specifier)
          return `from '${pathToFileURL(target).href}'`
        })
        const fixtureModule = join(root, 'host-fixture.mjs')
        await writeFile(fixtureModule, emitted)
        const row = (id: string, path: string, config?: unknown) => ({ id, name: pathToFileURL(id === 'fixture'
          ? fixtureModule : join(checkout, path.replace('/src/index.ts', '/lib/index.js'))).href,
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
          ...(live ? [row('credentials', 'packages/credentials/credentials-local/src/index.ts', { watch: false }),
            row('deepseek', 'packages/llm/llm-deepseek/src/index.ts', { thinking: 'disabled', maxTokens: 64,
              streamIdleTimeoutMs: 30000, retryPolicy: { mode: 'normal', maxRetries: 0 } })] : []),
          row('agents', 'packages/core/agent/src/index.ts'), row('tools', 'packages/core/tools/src/index.ts'),
          row('system-prompt', 'packages/core/system-prompt/src/index.ts'), row('goals', 'packages/goal/goal/src/index.ts'),
          row('agent-loop', 'packages/core/agent-loop/src/index.ts', { agents: [] }),
          row('budget-agent', 'packages/budget/budget-agent/src/index.ts'),
          row('budget', 'packages/budget/budget-local/src/index.ts', { maxScopes: 8, maxReservations: 32, maxLedgerBytes: 128 * 1024 }),
          row('budget-llm', 'packages/budget/budget-llm/src/index.ts'),
          row('subprocess', 'packages/subprocess/subprocess-local/src/index.ts'),
          row('repo', 'packages/delivery/repo-workspace-git-local/src/index.ts', { repositories: { fixture: repository }, worktreeRoot: join(root, 'leases') }),
          row('plans', 'packages/eval/eval-plans-local/src/index.ts', { maxAdmissions: 8, maxLedgerBytes: 65536,
            sources: [{ workspaceId: workspace.id, root: repository, mode: live ? 'live' : 'keyless', planFile: 'plan.json', suiteFile: 'suite.json',
              approvedPlan: { id: plan.id, version: plan.version, digest: evalContractDigest(plan) }, maxFileBytes: 65536, maxCells: 10,
              credentialGrant, requiredTools: [], requiredSkills: [] }] }),
          row('queue', 'packages/task-queue/task-queue-local/src/index.ts', { queueRoot: join(root, 'queue'), resourceCapacity: { 'eval-cell': 1 } }),
          row('runs', 'packages/eval/eval-runs-local/src/index.ts', config),
          row('fixture', 'packages/eval/eval-app/tests/fixtures/full-loop-profile.ts', {
            workspaceId: workspace.id, repository, live, gatePolicy: { id: 'release', verifierPlan: plan.verifierPlanRef,
              coreDigest: image.digest, launch: { executable: staged.executable, entrypoint: staged.entrypoint, profile: 'eval-verifier',
                homeRoot: join(root, 'verifiers'), core: { directory: core, digest: image.digest, sourceCommit: staged.sourceCommit, imageBounds: bounds }, timeoutMs: 60000, graceMs: 5000 },
              maxInputBytes: 1024 * 1024, maxOutputBytes: 1024 * 1024 },
            continuation: { grantId: 'accept-eval', sessionId: 'target', goal, budgetRef: budget.reference,
              expiresAt: Date.now() + 15 * 60 * 1000, followup: 'Use the approved Eval result to continue.' },
          }),
        ] }]))
        const launch = async <T>(args: string[]): Promise<T> => {
          const result = await execFileAsync(process.execPath, [
            join(checkout, 'apps/cli/lib/bin.js'), '--profile', 'eval-recovery', ...args], { cwd: repository, windowsHide: true,
            timeout: 150000, maxBuffer: 1024 * 1024, env: { ...scrubbedParentEnv(), DSH_HOME: home,
              DSH_TELEMETRY_DISABLED: '1', ...(live ? { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY } : {}) } })
          return (JSON.parse(result.stdout) as { result: T }).result
        }
        const run = await launch<EvalRunView>(['start', '--request', 'full-loop', '--plan', 'plan', '--version', '1', '--policy', 'fixture', '--wait'])
        expect(run.phase, JSON.stringify(run)).toBe('settled')
        if (run.outcome !== 'passed') {
          seed = new Context()
          await seed.plugin(Storage); await seed.plugin(SqliteStorage, storageConfig)
          seed.provide('storageDomain', new DomainFacility(seed, { backend: 'eval_db' }))
          const ledger = await RunLedger.open(seed, config)
          try {
            const failures = ledger.read().bundles.flatMap(bundle => bundle.bundle.materials.filter(material => material.kind === 'execution')
              .map((material) => {
                const value = JSON.parse(material.content) as { status?: string
                  reason?: string
                  protocol?: { accounting?: GuardedModelResult[]; rawReports?: { complete?: { output?: string } } } }
                return { role: material.role, status: value.status, reason: value.reason,
                  output: value.protocol?.rawReports?.complete?.output,
                  accounting: value.protocol?.accounting?.map(call => ({ status: call.status, reason: call.reason,
                    dispatches: call.evidence.map(fact => ({ provider: fact.provider, model: fact.model, parameters: fact.parameters,
                      dispatched: fact.dispatched, phase: fact.reservation?.phase, usage: fact.reservation?.usage })) })) }
              }))
            expect(run.outcome, JSON.stringify(failures)).toBe('passed')
          } finally { await ledger.close() }
        }
        expect(run.outcome, JSON.stringify(run)).toBe('passed')
        const gate = await launch<EvalGateView>(['gate', 'evaluate', run.id!, '--policy', 'release'])
        expect(gate.decision.decision, JSON.stringify(gate)).toBe('pass')
        const activation = await launch<EvalActivationView>(['continue', gate.id, '--grant', 'approved', '--request', 'once'])
        expect(activation.phase).toBe('consumed')
        expect(await launch<EvalActivationView>(['continue', gate.id, '--grant', 'approved', '--request', 'once'])).toEqual(activation)
        expect(await launch<EvalActivationView>(['activation', 'show', activation.id])).toEqual(activation)
        expect(await launch<EvalGateView>(['gate', 'show', gate.id])).toEqual(gate)
        expect((await launch<EvalRunView>(['show', run.id!])).outcome).toBe('passed')
        if (!live) expect((await readFile(join(repository, 'dispatches.txt'), 'utf8')).trim().split('\n')).toHaveLength(5)
        seed = new Context()
        await seed.plugin(Storage); await seed.plugin(SqliteStorage, storageConfig)
        seed.provide('storageDomain', new DomainFacility(seed, { backend: 'eval_db' }))
        await seed.plugin(Sessions)
        await seed.plugin(JsonlPersistence, { root: sessionRoot, compression: 'none' })
        const stored = await seed.sessionPersistence.open(SessionId('target'), 'read')
        try {
          const persisted = await stored.read(0)
          const rounds = persisted.events.filter(event => event.type === 'user/message' && event.data.source.kind === 'goal')
          expect(rounds).toHaveLength(1)
          expect(rounds[0]).toMatchObject({ data: { id: activation.messageId, source: { goalId: goal.id, round: 1 } } })
        } finally { await stored.close() }
        await seed.plugin(LocalBudget, { maxScopes: 8, maxReservations: 32, maxLedgerBytes: 128 * 1024 })
        const accounting = seed.budget.inspect(budget.reference)
        expect(accounting.consumed.requests).toBe(5)
        expect(accounting.unknownRequests).toBe(0)
        expect(accounting.reserved.requests).toBe(0)
        expect(accounting.consumed.inputTokens).toBeGreaterThan(0)
        expect(accounting.consumed.outputTokens).toBeGreaterThan(0)
        await seed.budget.revoke('profile-budget', () => {})
        await seed.fiber.dispose(); seed = undefined
        const patchFile = join(profile, 'cordis.patch.yml')
        await writeFile(patchFile, (await readFile(patchFile, 'utf8')).replace('"grantId":"accept-eval"', '"grantId":"revoked-budget"'))
        const denied = await launch<EvalActivationView>(['continue', gate.id, '--grant', 'approved', '--request', 'denied'])
        expect(denied.phase).toBe('blocked')
        seed = new Context()
        await seed.plugin(Storage); await seed.plugin(SqliteStorage, storageConfig)
        seed.provide('storageDomain', new DomainFacility(seed, { backend: 'eval_db' }))
        await seed.plugin(LocalBudget, { maxScopes: 8, maxReservations: 32, maxLedgerBytes: 128 * 1024 })
        expect(seed.budget.inspect(budget.reference).consumed).toEqual(accounting.consumed)
        if (!live) expect((await readFile(join(repository, 'dispatches.txt'), 'utf8')).trim().split('\n')).toHaveLength(5)
      } finally { await seed?.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
    })
}
