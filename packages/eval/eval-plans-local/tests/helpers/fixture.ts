import { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { evalContractDigest, parseEvalPlan, parseEvalSuite } from '@changanhua/dsh-eval'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { realpathNormalize } from '@deepseek-ai/dsh-workspace'
import type { EvalPlanAccess } from '@changanhua/dsh-eval-plans'
import LocalEvalPlans from '../../src/index.ts'
import type { Config } from '../../src/config.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../../storage/storage-domain/tests/helpers/memory-backend.ts'

export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-eval-plans-'))
  const content = 'name: test-preset\nplugins: []\n'
  const routes = ['a', 'b'].map(id => ({ id, provider: 'fixture', model: 'fixture', preset: 'test' }))
  const suite = parseEvalSuite({ schemaVersion: 1, id: 'suite', version: '1', title: 'Two routes', sourceRevision: 'b'.repeat(40),
    routes, defaultRouteIds: ['a', 'b'], cases: [{ id: 'case', title: 'Case', prompt: 'Hi', workspace: { kind: 'empty' },
      successCriteria: [{ kind: 'output-equals', text: 'Hi' }], evaluator: { kind: 'deterministic' },
      replayFixtures: routes.map(route => ({ routeId: route.id, binding: 'first-call-order', sessionFile: `${route.id}.jsonl` })) }] })
  const plan = parseEvalPlan({ kind: 'eval-plan', schemaVersion: 1, id: 'plan', version: '1',
    suiteRef: { id: suite.id, version: suite.version, digest: evalContractDigest(suite) },
    repository: { requestedRevision: 'main', expectedCommit: suite.sourceRevision },
    routes: routes.map(route => ({ ...route, parameters: {}, preset: { id: 'test', source: 'preset:system', digest: createHash('sha256').update(content).digest('hex') } })),
    repeatPolicy: { count: 1, seed: null, order: 'route-case-repeat' }, baselineRef: null, workspacePolicy: 'per-cell',
    allowedEntrypoints: ['cli', 'web'], credentialAuthorizationRef: null, budget: { required: false, authorizationRef: null },
    verifierPlanRef: { id: 'verifier', version: '1', digest: 'a'.repeat(64) } })
  await writeFile(join(root, 'plan.json'), JSON.stringify(plan))
  await writeFile(join(root, 'suite.json'), JSON.stringify(suite))
  const workspace = { id: 'workspace', path: await realpathNormalize(root) } as Workspace
  const config: Config = { maxAdmissions: 10, maxLedgerBytes: 32768, sources: [{ workspaceId: workspace.id, root, mode: 'keyless' as const,
    planFile: 'plan.json', suiteFile: 'suite.json', approvedPlan: { id: plan.id, version: plan.version, digest: evalContractDigest(plan) },
    maxFileBytes: 65536, maxCells: 20, credentialGrant: null, requiredTools: [], requiredSkills: [] }] }
  const pool = new MemoryMediaPool()
  const boot = async (withRoute = true, prepare?: (ctx: Context) => Promise<void>) => {
    const ctx = new Context()
    const backend = new MemoryStorageBackend(pool)
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', { guarantees: ['single-writer', 'commit-sync', 'private-root'], kv: backend.kv, close: () => backend.close() })
    ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
    ctx.provide('workspaceRegistry', { get: (id: string) => id === workspace.id ? workspace : undefined } as unknown as Context['workspaceRegistry'])
    ctx.provide('agentPresets', { resolve: async () => ({ id: 'test', trust: 'system' }),
      readDocument: async () => ({ agentPreset: 'test', trust: 'system', content }) } as unknown as Context['agentPresets'])
    if (withRoute) {
      await ctx.plugin(LlmRuntime)
      class Adapter extends LlmAdapter { async * stream(): AsyncIterable<StreamChunk> { throw new Error('preflight must not dispatch'); yield { type: 'finish', reason: { kind: 'stop' } } } }
      ctx.llm.registerAdapter(['fixture'], new Adapter())
    }
    await prepare?.(ctx)
    await ctx.plugin(LocalEvalPlans, config)
    return { ctx, close: async () => { await ctx.fiber.dispose(); await backend.close() } }
  }
  const access: EvalPlanAccess = { workspace, entrypoint: 'cli', authorize: () => {} }
  return { root, plan, config, access, pool, boot, clean: () => rm(root, { recursive: true, force: true }) }
}
