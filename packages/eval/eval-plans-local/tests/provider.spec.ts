import { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { evalContractDigest, parseEvalPlan, parseEvalSuite } from '@changanhua/dsh-eval'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { realpathNormalize } from '@deepseek-ai/dsh-workspace'
import type { EvalPlanAccess } from '@changanhua/dsh-eval-plans'
import LocalEvalPlans from '../src/index.ts'
import LocalBudget from '../../../budget/budget-local/src/index.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

async function fixture() {
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
  const config = { maxAdmissions: 10, maxLedgerBytes: 32768, sources: [{ workspaceId: workspace.id, root, mode: 'keyless' as const,
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
  return { root, plan, config, access, boot, clean: () => rm(root, { recursive: true, force: true }) }
}

test('discovery agrees across entrypoints and admission recovers one run across reopen', async () => {
  const f = await fixture()
  const h = await f.boot()
  try {
    const cli = await h.ctx.evalPlans.discover(f.access)
    expect(cli).toEqual(await h.ctx.evalPlans.discover({ ...f.access, entrypoint: 'web' }))
    expect(JSON.stringify(cli)).not.toContain(f.root)
    const resolved = await h.ctx.evalPlans.resolve(f.access, { id: 'plan', version: '1' })
    expect(resolved.checks).toEqual(expect.arrayContaining([{ subject: 'a', code: 'provider-model-available', ok: true }]))
    expect(resolved.ready).toBe(true)
    const receipt = await h.ctx.evalPlans.admit(f.access, resolved, 'request')
    expect(await h.ctx.evalPlans.admit(f.access, resolved, 'request')).toEqual(receipt)
    await h.close()
    const reopened = await f.boot()
    try {
      const fresh = await reopened.ctx.evalPlans.resolve(f.access, { id: 'plan', version: '1' })
      expect(await reopened.ctx.evalPlans.admit(f.access, fresh, 'request')).toEqual(receipt)
    } finally { await reopened.close() }
  } finally { await h.close(); await f.clean() }
})

test('rejects caller JSON, source drift, stale generation and unapproved entrypoints', async () => {
  const f = await fixture()
  const h = await f.boot()
  try {
    const resolved = await h.ctx.evalPlans.resolve(f.access, { id: 'plan', version: '1' })
    await expect(h.ctx.evalPlans.admit(f.access, structuredClone(resolved), 'forged')).rejects.toMatchObject({ code: 'unauthorized' })
    await expect(h.ctx.evalPlans.discover({ ...f.access, workspace: { ...f.access.workspace } })).rejects.toMatchObject({ code: 'unauthorized' })
    const ci = await h.ctx.evalPlans.resolve({ ...f.access, entrypoint: 'ci' }, { id: 'plan', version: '1' })
    expect(ci.ready).toBe(false)
    await h.ctx.evalPlans.reload(() => {})
    await expect(h.ctx.evalPlans.admit(f.access, resolved, 'stale')).rejects.toMatchObject({ code: 'unauthorized' })
    await writeFile(join(f.root, 'plan.json'), JSON.stringify({ ...f.plan, budget: { required: false, authorizationRef: null }, allowedEntrypoints: ['ci'] }))
    await expect(h.ctx.evalPlans.reload(() => {})).rejects.toMatchObject({ code: 'invalid-source' })
    const changed = await h.ctx.evalPlans.resolve(f.access, { id: 'plan', version: '1' })
    expect(changed.ready).toBe(false)
    await expect(h.ctx.evalPlans.admit(f.access, changed, 'changed')).rejects.toMatchObject({ code: 'preflight-blocked' })
  } finally { await h.close(); await f.clean() }
})

test('missing Provider blocks admission without creating a run or calling a model', async () => {
  const f = await fixture()
  const h = await f.boot(false)
  try {
    const result = await h.ctx.evalPlans.resolve(f.access, { id: 'plan', version: '1' })
    expect(result.ready).toBe(false)
    expect(result.checks.filter(check => check.code === 'provider-model-available').every(check => !check.ok)).toBe(true)
    await expect(h.ctx.evalPlans.admit(f.access, result, 'blocked')).rejects.toMatchObject({ code: 'preflight-blocked' })
  } finally { await h.close(); await f.clean() }
})


test.each(['revoke', 'exhaust'] as const)('preflight rechecks parent budget after %s', async (action) => {
  const f = await fixture()
  const h = await f.boot(true, async (ctx) => {
    await ctx.plugin(LocalBudget, { maxScopes: 8, maxReservations: 8, maxLedgerBytes: 65536 })
    const limits = { requests: 1, inputTokens: 100, outputTokens: 100, totalTokens: 200, wallTimeMs: null }
    await ctx.budget.createScope({ id: 'parent', kind: 'session', subjectId: 'session', parentId: null,
      limits, onExhausted: 'deny' }, () => {})
    const child = await ctx.budget.createScope({ id: 'child', kind: 'goal', subjectId: 'goal', parentId: 'parent',
      limits: { ...limits, requests: 5 }, onExhausted: 'deny' }, () => {})
    const plan = parseEvalPlan({ ...f.plan, budget: { required: true, authorizationRef: child.reference } })
    await writeFile(join(f.root, 'plan.json'), JSON.stringify(plan))
    const source = f.config.sources[0]
    if (!source) throw new Error('fixture source missing')
    source.approvedPlan.digest = evalContractDigest(plan)
  })
  try {
    const before = await h.ctx.evalPlans.resolve(f.access, { id: 'plan', version: '1' })
    expect(before.ready).toBe(true)
    if (action === 'revoke') await h.ctx.budget.revoke('parent', () => {})
    else {
      await h.ctx.budget.withScope(h.ctx.budget.inspect('parent').reference, async () => {
        for await (const _chunk of h.ctx.budget.streamModel({ requestId: 'spent', attemptId: '1',
          inputDigest: 'a'.repeat(64), inputTokens: 1, outputTokens: 1 },
        async function* () { yield { terminal: true, usage: { inputTokens: 1, outputTokens: 1 } } },
        chunk => chunk)) { /* consume settlement */ }
      })
    }
    expect(h.ctx.budget.inspect('child').scope.revoked).toBe(false)
    expect(h.ctx.budget.inspect('child').consumed.requests).toBe(0)
    const after = await h.ctx.evalPlans.resolve(f.access, { id: 'plan', version: '1' })
    expect(after.ready).toBe(false)
    expect(after.checks).toContainEqual({ subject: 'plan', code: 'budget-authority', ok: false })
    await expect(h.ctx.evalPlans.admit(f.access, before, 'stale-budget')).rejects.toMatchObject({ code: 'conflict' })
  } finally { await h.close(); await f.clean() }
})
