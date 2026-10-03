import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import Sessions from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { evalContractDigest, parseEvalPlan, parseEvalSuite } from '@changanhua/dsh-eval'
import { createVerifiedOperatorAuthority } from '@changanhua/dsh-task-queue'
import { expect, test, vi } from 'vitest'
import LocalEvalPlans from '../../eval-plans-local/src/index.ts'
import LocalQueue from '../../../task-queue/task-queue-local/src/index.ts'
import { GitLocalRepositoryWorkspace } from '../../../delivery/repo-workspace-git-local/src/index.ts'
import { TestSubprocessRuntime, fixtureGit } from '../../../delivery/repo-workspace-git-local/tests/harness.ts'
import LocalBudget from '../../../budget/budget-local/src/index.ts'
import * as BudgetBridge from '../../../budget/budget-llm/src/index.ts'
import * as SqliteStorage from '../../../storage/storage-sqlite/src/index.ts'
import { stageProfileFixture } from '../../eval-isolated/tests/runtime-fixture.ts'
import { observeRuntimeTree } from '../../eval-isolated/src/build.ts'

import LocalEvalRuns from '../src/index.ts'
import type { EvalRunView } from '@changanhua/dsh-eval-runs'
import type { BudgetReference } from '@changanhua/dsh-budget'

test.skipIf(process.platform !== 'win32' || process.arch !== 'x64').each([true, false])(
  'reopens real Queue and SQLite evidence after isolated execution; complete usage=%s', async (hasUsage) => {
    const root = await mkdtemp(join(tmpdir(), 'eval-run-recovery-')), repository = join(root, 'repository'), core = join(root, 'core')
    // Windows TEMP can grant other sandbox principals write access; SQLite creates its own private root.
    const privateRoot = join(homedir(), `.dsh-eval-recovery-${randomUUID()}`)
    let ctx: Context | undefined, budgetReference: BudgetReference | undefined, original: EvalRunView | undefined
    let requests = 0
    const bounds = { maxFiles: 30000, maxBytes: 1024 * 1024 * 1024 }, signal = AbortSignal.timeout(170000)
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
      const coreImage = await observeRuntimeTree(core, bounds, signal)
      for (let generation = 0; generation < 2; generation++) {
        ctx = new Context()
        await ctx.plugin(Storage)
        await ctx.plugin(SqliteStorage, { backendName: 'eval_db', path: join(privateRoot, 'account.sqlite'),
          ownership: 'exclusive', journalMode: 'delete', synchronous: 'full', privateDirectory: true })
        ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'eval_db' }))
        await ctx.plugin(Sessions); await ctx.plugin(SessionProjections)
        await ctx.plugin(JsonlPersistence, { root: join(root, 'host-sessions'), compression: 'none' })
        await ctx.plugin(WorkspaceRegistry)
        ctx.baseUrl = pathToFileURL(`${repository}/`).href
        await ctx.plugin(Loader)
        await ctx.plugin(AgentPresets, { default: 'minimal', includeShippedRoot: false, includeUserRoot: false,
          roots: [{ path: join(core, 'presets'), trust: 'system' }] })
        await ctx.plugin(LlmRuntime)
        class Adapter extends LlmAdapter {
          async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
            requests++
            const text = JSON.stringify(options.messages).includes('Grade the subject') ? 'PASS' : 'READY'
            yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text }
            yield { type: 'block-end', index: 0, block: { type: 'text', text } }
            if (hasUsage) yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 } }
            yield { type: 'finish', reason: { kind: 'stop' } }
          }
        }
        if (generation === 0) ctx.llm.registerAdapter(['fixture'], new Adapter())
        await ctx.plugin(LocalBudget, { maxScopes: 8, maxReservations: 32, maxLedgerBytes: 128 * 1024 })
        await ctx.plugin(BudgetBridge)
        if (generation === 0) budgetReference = (await ctx.budget.createScope({ id: 'run', kind: 'session', subjectId: 'eval', parentId: null,
          limits: { requests: 8, inputTokens: 20000, outputTokens: 1000, totalTokens: 21000, wallTimeMs: 180000 }, onExhausted: 'deny' }, () => {})).reference
        if (!budgetReference) throw new Error('missing budget fixture')
        const routes = ['subject', 'grader'].map(id => ({ id, provider: 'fixture', model: 'fixture', preset: 'minimal' }))
        const suite = parseEvalSuite({ schemaVersion: 1, id: 'suite', version: '1', title: 'Isolated', sourceRevision: commit,
          defaultRouteIds: ['subject', 'grader'], routes, cases: [{ id: 'case', title: 'Ready', prompt: 'Reply READY.', workspace: { kind: 'empty' },
            successCriteria: [{ kind: 'output-equals', text: 'READY' }], evaluator: { kind: 'model-grader', provider: 'fixture', model: 'fixture', promptVersion: '1' },
            replayFixtures: routes.map(route => ({ routeId: route.id, binding: 'first-call-order', sessionFile: `${route.id}.jsonl` })) }] })
        const plan = parseEvalPlan({ kind: 'eval-plan', schemaVersion: 1, id: 'plan', version: '1',
          suiteRef: { id: suite.id, version: suite.version, digest: evalContractDigest(suite) }, repository: { requestedRevision: 'main', expectedCommit: commit },
          routes: routes.map(route => ({ ...route, parameters: { maxTokens: 64 }, preset: { id: 'minimal', source: 'preset:system', digest: createHash('sha256').update('[]\n').digest('hex') } })),
          repeatPolicy: { count: 1, seed: null, order: 'route-case-repeat' }, baselineRef: null, workspacePolicy: 'per-cell', allowedEntrypoints: ['cli'],
          credentialAuthorizationRef: null, budget: { required: true, authorizationRef: budgetReference }, verifierPlanRef: { id: 'verifier', version: '1', digest: 'f'.repeat(64) } })
        await writeFile(join(repository, 'plan.json'), JSON.stringify(plan)); await writeFile(join(repository, 'suite.json'), JSON.stringify(suite))
        const workspace = await ctx.workspaceRegistry.create(repository)
        await ctx.plugin(LocalEvalPlans, { maxAdmissions: 8, maxLedgerBytes: 65536, sources: [{ root: repository, workspaceId: workspace.id,
          mode: 'keyless', planFile: 'plan.json', suiteFile: 'suite.json', approvedPlan: { id: plan.id, version: plan.version, digest: evalContractDigest(plan) },
          maxFileBytes: 65536, maxCells: 10, credentialGrant: null, requiredTools: [], requiredSkills: [] }] })
        const subprocess = new TestSubprocessRuntime(ctx)
        vi.spyOn(subprocess, 'resolveExecutable').mockResolvedValue('git.exe')
        await ctx.plugin(GitLocalRepositoryWorkspace, { repositories: { fixture: repository }, worktreeRoot: join(root, 'leases') })
        await ctx.plugin(LocalQueue, { queueRoot: join(root, 'queue'), maxConcurrent: 1, resourceCapacity: { 'eval-cell': 1 } })
        const corePin = { directory: core, digest: coreImage.digest, plugins: [] }
        await ctx.plugin(LocalEvalRuns, { maxRuns: 8, maxLedgerBytes: 8 * 1024 * 1024, maxBundles: 32, maxControls: 16,
          maxCells: 10, maxParallel: 1, maxResponseBytes: 65536, retentionMs: 300000, resource: 'eval-cell',
          policies: [{ id: 'fixture', workspaceId: workspace.id, execution: { repositoryId: 'fixture',
            runtime: { root: join(root, 'runs'), core: { subject: corePin, grader: corePin }, imageBounds: bounds,
              maxFrameBytes: 1024 * 1024, maxRequests: 8, executionMs: 20000,
              graceMs: 5000, stopMs: 10000, maxResponseBytes: 8192, maxModelAttempts: 4,
              diskLimits: { maxBytes: 512 * 1024 * 1024, maxEntries: 50000, sampleMs: 250 } },
            workspaceLimits: { maxFixtureFiles: 10, maxFixtureBytes: 65536 },
            evidenceLimits: { maxBytes: 4 * 1024 * 1024, maxMaterials: 16 },
            grader: { routeId: 'grader', promptVersion: '1', prompt: 'Grade the subject. Return PASS or FAIL.', tools: [], skills: [] } } }] })
        const access = { workspace, entrypoint: 'cli' as const, actorId: 'operator', authorize: () => {} }
        const run = await ctx.evalRuns.start(access, { requestId: 'stable-run', plan: { id: 'plan', version: '1' }, policyId: 'fixture' })
        expect(run.id).toBeTruthy()
        let settled = run
        await vi.waitFor(async () => {
          settled = await ctx!.evalRuns.get(access, run.id!)
          expect(settled.phase).toBe(hasUsage ? 'settled' : 'needs-attention')
          expect(settled.cells.every(cell => !['queued', 'starting', 'running'].includes(cell.status))).toBe(true)
        }, { timeout: 120000, interval: 100 })
        expect(settled.outcome).toBe(hasUsage ? 'passed' : null)
        expect(settled.cells.some(cell => cell.evidence === 'intact')).toBe(true)
        const observed = settled.cells.find(cell => cell.evidence === 'intact')!
        const report = await ctx.evalRuns.evidence(access, run.id!, observed.id, observed.attempts.at(-1)!.id)
        expect(report.availability).toBe('intact')
        expect(report.roles[0]?.sessionId).toBeTruthy()
        expect(report.roles[0]?.verifiedCommit).toBe(commit)
        expect(report.roles[0]?.calls[0]?.phase).toBe(hasUsage ? 'settled' : 'unknown')
        expect(report.roles[0]?.calls[0]?.usage).toEqual(hasUsage ? { inputTokens: 8, outputTokens: 2 } : null)
        expect(JSON.stringify(report)).not.toContain(root)
        expect(JSON.stringify(report)).not.toContain('Grade the subject')
        await expect(ctx.evalRuns.evidence(access, run.id!, observed.id, 'another-attempt')).rejects.toMatchObject({ code: 'not-found' })
        expect(JSON.stringify(settled)).not.toContain(root)
        if (generation === 0) original = settled
        else expect(settled).toEqual(original)
        expect(requests).toBe(hasUsage ? 4 : 1)
        expect(ctx.taskQueue.forOperator(createVerifiedOperatorAuthority()).list()).toHaveLength(2)
        await ctx.fiber.dispose(); ctx = undefined
      }
    } finally {
      await ctx?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
      await rm(privateRoot, { recursive: true, force: true })
    }
  }, 180000)
