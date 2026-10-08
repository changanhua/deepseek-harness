import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
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
import { evalContractDigest, parseEvalPlan, parseEvalSuite, parseResolvedExecutionManifest } from '@changanhua/dsh-eval'
import { createVerifiedOperatorAuthority } from '@changanhua/dsh-task-queue'
import type { WorkKindDefinition } from '@changanhua/dsh-task-queue'
import { expect, test, vi } from 'vitest'
import LocalEvalPlans from '../../eval-plans-local/src/index.ts'
import LocalQueue from '../../../task-queue/task-queue-local/src/index.ts'
import { GitLocalRepositoryWorkspace } from '../../../delivery/repo-workspace-git-local/src/index.ts'
import { TestSubprocessRuntime, fixtureGit } from '../../../delivery/repo-workspace-git-local/tests/harness.ts'
import LocalBudget from '../../../budget/budget-local/src/index.ts'
import * as BudgetBridge from '../../../budget/budget-llm/src/index.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { stageProfileFixture } from './runtime-fixture.ts'
import { observeRuntimeTree } from '../src/build.ts'
import { admitIsolatedEval } from '../src/index.ts'
import type { IsolatedCellBinding, PreparedIsolatedCell, IsolatedCellResult } from '../src/index.ts'
import type { ExecutionEvidenceBundle } from '../src/evidence.ts'

declare module '@changanhua/dsh-task-queue' {
  interface WorkKindMap {
    'isolated-eval-integration@1': WorkKindDefinition<{ repeatIndex: number }, { eval: IsolatedCellBinding }, PreparedIsolatedCell, IsolatedCellResult>
  }
}

test.skipIf(process.platform !== 'win32' || process.arch !== 'x64')('binds real Plan, Queue and Git owners through dual-role Manifest acknowledgement and unknown Attention', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-host-')), repository = join(root, 'repository'), core = join(root, 'core')
  const ctx = new Context(), backend = new MemoryStorageBackend()
  const bounds = { maxFiles: 30000, maxBytes: 1024 * 1024 * 1024 }, signal = AbortSignal.timeout(150_000)
  const bundles: ExecutionEvidenceBundle[] = []
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
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', { guarantees: ['single-writer', 'commit-sync', 'private-root'], kv: backend.kv, close: () => backend.close() })
    ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
    await ctx.plugin(Sessions); await ctx.plugin(SessionProjections)
    await ctx.plugin(JsonlPersistence, { root: join(root, 'host-sessions'), compression: 'none' })
    await ctx.plugin(WorkspaceRegistry)
    ctx.baseUrl = pathToFileURL(`${repository}/`).href
    await ctx.plugin(Loader)
    await ctx.plugin(AgentPresets, { default: 'minimal', includeShippedRoot: false, includeUserRoot: false, roots: [{ path: join(core, 'presets'), trust: 'system' }] })
    await ctx.plugin(LlmRuntime)
    class Adapter extends LlmAdapter {
      async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        const text = JSON.stringify(options.messages).includes('Grade the subject') ? 'PASS' : 'READY'
        yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 } }; yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    ctx.llm.registerAdapter(['fixture'], new Adapter())
    await ctx.plugin(LocalBudget, { maxScopes: 8, maxReservations: 32, maxLedgerBytes: 128 * 1024 }); await ctx.plugin(BudgetBridge)
    const budget = await ctx.budget.createScope({ id: 'run', kind: 'session', subjectId: 'eval', parentId: null,
      limits: { requests: 8, inputTokens: 20000, outputTokens: 1000, totalTokens: 21000, wallTimeMs: 180000 }, onExhausted: 'deny' }, () => {})
    const routes = ['subject', 'grader'].map(id => ({ id, provider: 'fixture', model: 'fixture', preset: 'minimal' }))
    const suite = parseEvalSuite({ schemaVersion: 1, id: 'suite', version: '1', title: 'Isolated', sourceRevision: commit,
      defaultRouteIds: ['subject', 'grader'], routes, cases: [{ id: 'case', title: 'Ready', prompt: 'Reply READY.', workspace: { kind: 'empty' },
        successCriteria: [{ kind: 'output-equals', text: 'READY' }], evaluator: { kind: 'model-grader', provider: 'fixture', model: 'fixture', promptVersion: '1' },
        replayFixtures: routes.map(route => ({ routeId: route.id, binding: 'first-call-order', sessionFile: `${route.id}.jsonl` })) }] })
    const plan = parseEvalPlan({ kind: 'eval-plan', schemaVersion: 1, id: 'plan', version: '1',
      suiteRef: { id: suite.id, version: suite.version, digest: evalContractDigest(suite) }, repository: { requestedRevision: 'main', expectedCommit: commit },
      routes: routes.map(route => ({ ...route, parameters: { maxTokens: 64 }, preset: { id: 'minimal', source: 'preset:system', digest: createHash('sha256').update('[]\n').digest('hex') } })),
      repeatPolicy: { count: 2, seed: null, order: 'route-case-repeat' }, baselineRef: null, workspacePolicy: 'per-cell', allowedEntrypoints: ['cli'],
      credentialAuthorizationRef: null, budget: { required: true, authorizationRef: budget.reference }, verifierPlanRef: { id: 'verifier', version: '1', digest: 'f'.repeat(64) } })
    await writeFile(join(repository, 'plan.json'), JSON.stringify(plan)); await writeFile(join(repository, 'suite.json'), JSON.stringify(suite))
    const workspace = await ctx.workspaceRegistry.create(repository)
    await ctx.plugin(LocalEvalPlans, { maxAdmissions: 8, maxLedgerBytes: 32768, sources: [{ root: repository, workspaceId: workspace.id,
      mode: 'keyless', planFile: 'plan.json', suiteFile: 'suite.json', approvedPlan: { id: plan.id, version: plan.version, digest: evalContractDigest(plan) },
      maxFileBytes: 65536, maxCells: 10, credentialGrant: null, requiredTools: [], requiredSkills: [] }] })
    const subprocess = new TestSubprocessRuntime(ctx)
    vi.spyOn(subprocess, 'resolveExecutable').mockResolvedValue(process.platform === 'win32' ? 'git.exe' : 'git')
    await ctx.plugin(GitLocalRepositoryWorkspace, { repositories: { fixture: repository }, worktreeRoot: join(root, 'leases') })
    await ctx.plugin(LocalQueue, { queueRoot: join(root, 'queue'), maxConcurrent: 1 })
    const access = { workspace, entrypoint: 'cli' as const, authorize: () => {} }
    const resolved = await ctx.evalPlans.resolve(access, { id: 'plan', version: '1' })
    expect(resolved.ready, JSON.stringify(resolved.checks)).toBe(true)
    const corePin = { directory: core, digest: coreImage.digest, plugins: [] }
    const config = { repositoryId: 'fixture', runtime: { root: join(root, 'runs'), core: { subject: corePin, grader: corePin },
      imageBounds: bounds, maxFrameBytes: 1024 * 1024, maxRequests: 8, executionMs: 20000, graceMs: 5000,
      stopMs: 10000, maxResponseBytes: 8192, maxModelAttempts: 4 },
    workspaceLimits: { maxFixtureFiles: 10, maxFixtureBytes: 65536 }, evidenceLimits: { maxBytes: 4 * 1024 * 1024, maxMaterials: 16 },
    grader: { routeId: 'grader', promptVersion: '1', prompt: 'Grade the subject. Return PASS or FAIL.', tools: [], skills: [] },
    receive: async (bundle: ExecutionEvidenceBundle) => {
      bundles.push(bundle)
      if (bundles.length > 1) throw new Error('receiver unavailable')
      expect((await readdir(join(root, 'leases'))).length).toBeGreaterThan(0)
      await writeFile(join(root, 'accepted-evidence.json'), JSON.stringify(bundle))
      expect(JSON.parse(await readFile(join(root, 'accepted-evidence.json'), 'utf8')) as unknown).toMatchObject({ digest: bundle.digest })
      return { acceptedDigest: bundle.digest }
    } }
    await expect(admitIsolatedEval(ctx, access, structuredClone(resolved), 'forged', config, signal)).rejects.toMatchObject({ code: 'unauthorized' })
    const run = await admitIsolatedEval(ctx, access, resolved, 'run', config, signal)
    ctx.taskQueue.registerHandler({ kind: 'isolated-eval-integration@1',
      resolveAdmission: async input => ({ eval: run.bind({ caseId: 'case', routeId: 'subject', repeatIndex: input.repeatIndex }) }),
      resources: () => [], policy: () => ({ maxAttempts: 1 }),
      prepare: (resolved, context) => run.prepare(resolved.eval, context.signal),
      start: (prepared, context) => prepared.start<'isolated-eval-integration@1'>(context, value => value),
    })
    const operator = ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
    const first = await operator.enqueue({ kind: 'isolated-eval-integration@1', title: 'First', input: { repeatIndex: 0 }, idempotencyKey: 'first' })
    await vi.waitFor(() => { expect(operator.get(first).state.status).toBe('succeeded') }, { timeout: 90000, interval: 100 })
    const firstView = operator.get(first), result = firstView.result!.output as IsolatedCellResult
    expect(result).toMatchObject({ status: 'completed', outcome: 'passed' })
    const manifest = parseResolvedExecutionManifest(result.manifest)
    expect(manifest.subject.executionId).not.toBe(manifest.grader!.executionId)
    expect(manifest.cell.attempt).toBe(firstView.attempts[0]!.ordinal)
    expect(JSON.stringify(result)).not.toContain(root)
    const second = await operator.enqueue({ kind: 'isolated-eval-integration@1', title: 'Second', input: { repeatIndex: 1 }, idempotencyKey: 'second' })
    await vi.waitFor(() => { expect(operator.get(second).state.status).toBe('unknown') }, { timeout: 60000, interval: 100 })
    expect(operator.pendingAttentions()).toEqual(expect.arrayContaining([expect.objectContaining({ workId: second, kind: 'unknown' })]))
    expect(operator.get(second).attempts).toHaveLength(1)
    const retained = bundles[1]!.materials[0]!
    expect(run.resolveEvidence(retained.reference, retained.executionId, retained.role)).toEqual(retained)
  } finally { await ctx.fiber.dispose(); await backend.close(); await rm(root, { recursive: true, force: true }) }
}, 180_000)
