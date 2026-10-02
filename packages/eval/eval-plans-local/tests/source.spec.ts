import { afterEach, expect, test } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evalContractDigest, parseEvalPlan, parseEvalSuite } from '../../eval/src/index.ts'
import { readPinnedPlanSource } from '../src/source.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-eval-plan-source-'))
  roots.push(root)
  const commit = 'b'.repeat(40)
  const artifactDigest = 'a'.repeat(64)
  const routes = ['a', 'b'].map(id => ({ id, provider: `provider-${id}`, model: 'model', preset: 'standard' }))
  const suite = parseEvalSuite({
    schemaVersion: 1, id: 'suite', version: '1', sourceRevision: commit, title: 'Plan source fixture',
    defaultRouteIds: ['a', 'b'], routes,
    cases: [{ id: 'case', title: 'Case', prompt: 'A test', workspace: { kind: 'empty' },
      successCriteria: [{ kind: 'session-snapshot' }], evaluator: { kind: 'deterministic' },
      replayFixtures: routes.map(route => ({ routeId: route.id, binding: 'first-call-order', sessionFile: `${route.id}.jsonl` })) }],
  })
  const plan = parseEvalPlan({
    kind: 'eval-plan', schemaVersion: 1, id: 'plan', version: '1',
    suiteRef: { id: suite.id, version: suite.version, digest: evalContractDigest(suite) },
    repository: { requestedRevision: 'main', expectedCommit: commit },
    routes: routes.map(route => ({ ...route, parameters: {}, preset: { id: route.preset, source: 'package:standard', digest: artifactDigest } })),
    repeatPolicy: { count: 1, seed: null, order: 'route-case-repeat' }, baselineRef: null,
    workspacePolicy: 'per-cell', allowedEntrypoints: ['cli', 'web'], credentialAuthorizationRef: null,
    budget: { required: false, authorizationRef: null },
    verifierPlanRef: { id: 'verifier', version: '1', digest: artifactDigest },
  })
  await writeFile(join(root, 'plan.json'), JSON.stringify(plan))
  await writeFile(join(root, 'suite.json'), JSON.stringify(suite))
  const source = { root, planFile: 'plan.json', suiteFile: 'suite.json',
    approvedPlan: { id: plan.id, version: plan.version, digest: evalContractDigest(plan) }, maxFileBytes: 65536, maxCells: 20 }
  return { root, plan, suite, source }
}

test('loads the Host-pinned Plan and exact Suite without exposing local paths', async () => {
  const { source, plan, suite, root } = await fixture()
  const result = await readPinnedPlanSource(source)
  expect(result).toEqual({ plan, suite, cellCount: 2 })
  expect(JSON.stringify(result)).not.toContain(root)
})

test('rejects Plan mutation including a changed budget exemption before publication', async () => {
  const { source, root, plan } = await fixture()
  await writeFile(join(root, 'plan.json'), JSON.stringify({ ...plan, allowedEntrypoints: ['ci'] }))
  await expect(readPinnedPlanSource(source)).rejects.toThrow(/approved/u)
})

test('rejects Suite content drift and revision mismatch even with a newly pinned Plan', async () => {
  const { source, root, plan, suite } = await fixture()
  const changedSuite = { ...suite, title: 'Changed title' }
  await writeFile(join(root, 'suite.json'), JSON.stringify(changedSuite))
  await expect(readPinnedPlanSource(source)).rejects.toThrow(/Suite/u)
  const changedPlan = { ...plan, repository: { ...plan.repository, expectedCommit: 'c'.repeat(40) } }
  await writeFile(join(root, 'suite.json'), JSON.stringify(suite))
  await writeFile(join(root, 'plan.json'), JSON.stringify(changedPlan))
  await expect(readPinnedPlanSource({ ...source, approvedPlan: { ...source.approvedPlan, digest: evalContractDigest(changedPlan) } }))
    .rejects.toThrow(/revision/u)
})

test('rejects path traversal, absolute paths and symlinks escaping the trusted root', async () => {
  const { source } = await fixture()
  await expect(readPinnedPlanSource({ ...source, planFile: '../plan.json' })).rejects.toThrow(/path/u)
  await expect(readPinnedPlanSource({ ...source, planFile: 'C:\\outside\\plan.json' })).rejects.toThrow(/path/u)
  const outside = await fixture()
  await symlink(outside.root, join(source.root, 'outside'), 'junction')
  await expect(readPinnedPlanSource({ ...source, planFile: 'outside/plan.json' })).rejects.toThrow(/root/u)
})

test('rejects malformed, oversized, non-file and over-budget matrices before creating a run', async () => {
  const { source, root } = await fixture()
  await expect(readPinnedPlanSource({ ...source, maxCells: 1 })).rejects.toThrow(/cell/u)
  await expect(readPinnedPlanSource({ ...source, maxFileBytes: 10 })).rejects.toThrow(/bytes/u)
  await mkdir(join(root, 'directory'))
  await expect(readPinnedPlanSource({ ...source, planFile: 'directory' })).rejects.toThrow(/file/u)
  await writeFile(join(root, 'plan.json'), '{broken')
  await expect(readPinnedPlanSource(source)).rejects.toThrow(/JSON/u)
})

test('honors cancellation before reading any Plan file', async () => {
  const { source } = await fixture()
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await expect(readPinnedPlanSource(source, controller.signal)).rejects.toThrow('cancelled')
})

test('rejects execution escapes hidden in route parameters and replay fixture paths', async () => {
  const { source, root, plan, suite } = await fixture()
  const changed = { ...plan, routes: plan.routes.map(route => ({ ...route, parameters: { apiKey: 'not-a-real-secret', cwd: 'C:/outside' } })) }
  await writeFile(join(root, 'plan.json'), JSON.stringify(changed))
  await expect(readPinnedPlanSource({ ...source, approvedPlan: { ...source.approvedPlan,
    digest: evalContractDigest(changed) } })).rejects.toThrow()
  const changedSuite = structuredClone(suite)
  changedSuite.cases[0]!.replayFixtures[0]!.sessionFile = '../outside.jsonl'
  const pinned = { ...plan, suiteRef: { ...plan.suiteRef, digest: evalContractDigest(changedSuite) } }
  await writeFile(join(root, 'plan.json'), JSON.stringify(pinned))
  await writeFile(join(root, 'suite.json'), JSON.stringify(changedSuite))
  await expect(readPinnedPlanSource({ ...source, approvedPlan: { ...source.approvedPlan,
    digest: evalContractDigest(pinned) } })).rejects.toThrow(/relative path/u)
})
