import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SessionStore from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import Llm, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import LocalPlanning from '../../../planning/planning-local/src/index.ts'
import LocalAssessment from '../../requirement-assessment-local/src/index.ts'
import Review from '../src/index.ts'
import Remote from '../../requirement-assessment-remote/src/index.ts'
import { assessmentDimensionKeys } from '../../requirement-assessment/src/index.ts'

const evaluation = {
  dimensions: assessmentDimensionKeys.map(dimension => ({ dimension, level: 'unknown', confidence: 'low', claim: 'Evidence is insufficient', grounds: ['User statement only'], counterArguments: [], unknowns: ['Observed frequency'] })),
  stressTests: [
    { kind: 'model_x2', declines: ['Heuristics'], remains: ['State'], increases: ['Execution contracts'], durableCore: 'State contracts' },
    { kind: 'upstream_substitution', deletable: ['Thin UI'], retained: ['Evidence'], avoidOverbuilding: 'Avoid a second reasoning engine' },
    { kind: 'no_build', workaround: 'Manual review', actualLoss: 'Unknown', investmentEvidence: 'Unverified', smallestExperiment: 'Measure one case' },
  ],
  allocation: Object.fromEntries(['SYSTEM_OWNED', 'MODEL_OWNED', 'EXPERIMENT'].map(key => [key, [{ component: 'Minimal slice', rationale: 'Needs evidence' }]])),
  route: 'EXPERIMENT', routeRationale: 'Measure first', uncertainties: [],
}
let root: string | undefined
let ctx: Context | undefined
let calls = 0
let mode: 'valid' | 'tool' | 'malformed' | 'oversize' | 'refusal' = 'valid'
let onCall: (() => Promise<void>) | undefined
class Adapter extends LlmAdapter {
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    calls++
    expect(options.tools).toEqual([])
    await onCall?.()
    if (mode === 'tool') { yield { type: 'block-start', index: 0, blockType: 'tool-call' }; return }
    const text = mode === 'malformed' ? '{' : mode === 'oversize' ? 'x'.repeat(400000) : mode === 'refusal' ? '{"refusal":"No"}' : JSON.stringify(evaluation)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
const fakeLlm = { name: 'test-review-model', inject: ['llm'], apply(context: Context) { context.llm.registerAdapter(['fixture'], new Adapter()) } }
async function boot() {
  ctx = new Context()
  ctx.baseUrl = pathToFileURL(root!).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['storage', Storage], ['json', JsonStorage], ['domain', StorageDomain], ['sessions', SessionStore], ['persistence', JsonlPersistence], ['query', SessionQuery], ['workspace', WorkspaceRegistry],
    ['planning', LocalPlanning], ['assessment', LocalAssessment], ['llm', Llm], ['fixture', fakeLlm], ['review', Review], ['remote', Remote],
    ['@changanhua/dsh-requirement-assessment-local', LocalAssessment],
    ['@changanhua/dsh-requirement-assessment-review', Review],
    ['@changanhua/dsh-requirement-assessment-remote', Remote],
    ['@changanhua/dsh-client-ui-requirement-assessment', await import(new URL('../../../client/ui-requirement-assessment/src/index.ts', import.meta.url).href)],
  ])
  ctx.loader.internal = { version: 'v2', async import(specifier: string) { if (!modules.has(specifier)) throw new Error(specifier); return modules.get(specifier) } } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(root!, 'cordis.yml')).href } })
  await ctx.loader.await()
  return ctx
}
afterEach(async () => { await ctx?.fiber.dispose(); ctx = undefined; if (root) await rm(root, { recursive: true, force: true }); root = undefined; calls = 0; mode = 'valid'; onCall = undefined })
it('REAL Loader composes fixed Manual/Plan/Focus reviews, negative tool paths, drift and reload without Planning writes', async () => {
  root = await mkdtemp(join(tmpdir(), 'rir-loader-'))
  await mkdir(join(root, 'project'))
  const rows = [
    { name: 'storage' }, { name: 'json', config: { root: join(root, 'storage') } }, { name: 'domain', config: { backend: 'json' } },
    { name: 'sessions' }, { name: 'persistence', config: { root: join(root, 'sessions'), compression: 'none' } },
    { name: 'query', config: { path: ':memory:', openAt: 'never' } }, { name: 'workspace' },
    { name: 'planning', config: { ownershipRoot: join(root, 'planning-owner') } }, { name: 'assessment', config: { ownershipRoot: join(root, 'assessment-owner') } },
    { name: 'llm' }, { name: 'fixture' }, { name: 'review', config: { provider: 'fixture', model: 'fixture', maxInputBytes: 200000, maxOutputBytes: 300000, maxOutputTokens: 12000, timeoutMs: 10000, dshBaseline: 'test' } }, { name: 'remote' },
  ]
  // JSON is a valid YAML document; the real Include/Loader owns plugin activation.
  await writeFile(join(root, 'cordis.yml'), JSON.stringify(rows))
  const app = await boot()
  const workspace = await app.workspaceRegistry.create(join(root, 'project'))
  const access = { workspaceId: workspace.id, actorId: 'human', kind: 'human' as const, authorize() {} }
  const signal = new AbortController().signal
  const manual = { requestId: 'manual', subject: { kind: 'manual' as const, id: 'manual', title: 'Small experiment' }, text: 'A user assumption', evidence: [{ source: 'User', excerpt: 'Unverified claim' }] }
  const [first, duplicate] = await Promise.all([
    app.requirementAssessmentReview.review(access, manual, signal), app.requirementAssessmentReview.review(access, manual, signal),
  ])
  expect(first.id).toBe(duplicate.id); expect(calls).toBe(1)
  expect(first.actualInput.evidence[0]?.verification).toBe('unverified')
  expect(first.actualInput.requestPrompt).toBeTruthy()
  await app.planning.execute(access, { kind: 'create', requestId: 'plan-create', expectedBoardVersion: 0, itemId: 'plan', lane: 'inbox', title: 'Plan', intent: 'Test', scope: [], acceptance: [], sources: [{ kind: 'manual', text: 'Evidence' }], estimate: { value: 1, urgency: 1, reuse: 1, compounding: 1, timeCost: 1, tokenCost: 1, risk: 1, cognitiveCost: 1, rationale: 'Fixture' }, reviewAt: null }, signal)
  let board = await app.planning.snapshot(access, signal)
  await app.planning.execute(access, { kind: 'workspace-change', requestId: 'focus-create', expectedBoardVersion: board.version, subject: { kind: 'plan', id: 'plan' }, baseRevision: board.items[0]!.headRevisionId, operations: [{ kind: 'create-focus', id: 'focus', title: 'Original focus', objective: 'Original objective' }] }, signal)
  board = await app.planning.snapshot(access, signal)
  await app.requirementAssessmentReview.review(access, { requestId: 'plan-review', subject: { kind: 'plan', id: 'plan' } }, signal)
  const focus = await app.requirementAssessmentReview.review(access, { requestId: 'focus-review', subject: { kind: 'focus', id: 'focus', planId: 'plan' } }, signal)
  expect(await app.planning.snapshot(access, signal)).toEqual(board)
  expect(focus.actualInput.focus?.title).toBe('Original focus')
  expect((await app.requirementAssessmentRemote.get({ workspaceId: workspace.id, id: focus.id }, signal)).drift).toBe('fresh')
  onCall = async () => {
    await app.planning.execute(access, { kind: 'workspace-change', requestId: 'focus-update', expectedBoardVersion: board.version, subject: { kind: 'plan', id: 'plan' }, baseRevision: board.items[0]!.headRevisionId, operations: [{ kind: 'update-focus', id: 'focus', expectedVersion: 1, title: 'Changed during review' }] }, signal)
  }
  const reassessed = await app.requirementAssessmentRemote.review({ workspaceId: workspace.id, requestId: 'focus-rerun', subject: { kind: 'focus', id: 'focus', planId: 'plan' }, supersedes: focus.id }, signal)
  onCall = undefined
  expect(reassessed.drift).toBe('stale')
  expect(reassessed.assessment.actualInput.focus?.title).toBe('Original focus')
  board = await app.planning.snapshot(access, signal)
  const manualAgain = await app.requirementAssessmentReview.review(access, { ...manual, requestId: 'manual-rerun', text: 'Changed assumption', supersedes: first.id }, signal)
  expect(manualAgain.actualInput.text).toBe('Changed assumption')
  expect((await app.requirementAssessment.get(access, first.id, signal)).actualInput.text).toBe('A user assumption')
  const beforeSpoof = calls
  await expect(app.requirementAssessmentRemote.review({ ...manual, workspaceId: workspace.id, requestId: 'spoof', actorId: 'attacker' } as never, signal)).rejects.toThrow()
  await expect(app.requirementAssessmentRemote.get({ workspaceId: 'foreign', id: first.id }, signal)).rejects.toThrow()
  expect(calls).toBe(beforeSpoof)
  for (const bad of ['tool', 'malformed', 'oversize', 'refusal'] as const) {
    mode = bad
    await expect(app.requirementAssessmentReview.review(access, { ...manual, requestId: bad }, signal)).rejects.toThrow()
    const count = calls
    await expect(app.requirementAssessmentReview.review(access, { ...manual, requestId: bad }, signal)).rejects.toThrow()
    expect(calls).toBe(count)
  }
  mode = 'valid'
  const cancelled = new AbortController()
  onCall = async () => { cancelled.abort(new Error('user cancelled')) }
  await expect(app.requirementAssessmentReview.review(access, { ...manual, requestId: 'cancelled' }, cancelled.signal)).rejects.toThrow()
  onCall = undefined
  expect((await app.requirementAssessment.snapshot(access, signal)).assessments).toHaveLength(5)
  expect(await app.planning.snapshot(access, signal)).toEqual(board)
  await app.fiber.dispose(); ctx = undefined
  const reloaded = await boot()
  expect((await reloaded.requirementAssessmentReview.review(access, manual, signal)).id).toBe(first.id)
  expect((await reloaded.requirementAssessment.snapshot(access, signal)).assessments).toHaveLength(5)
  const beforeReplay = calls
  for (const requestId of ['tool', 'malformed', 'oversize', 'refusal', 'cancelled']) await expect(reloaded.requirementAssessmentReview.review(access, { ...manual, requestId }, signal)).rejects.toThrow()
  expect(calls).toBe(beforeReplay)
})

it('activates the shipped optional patch with web-host isolation through real Loader/Include', async () => {
  root = await mkdtemp(join(tmpdir(), 'rir-shipped-patch-'))
  await mkdir(join(root, 'project'))
  const prefix = [
    { name: 'storage' }, { name: 'json', config: { root: join(root, 'storage') } },
    { name: 'domain', isolate: { storageDomain: 'web-host' }, config: { backend: 'json' } },
    { name: 'sessions' }, { name: 'persistence', config: { root: join(root, 'sessions'), compression: 'none' } },
    { name: 'query', config: { path: ':memory:', openAt: 'never' } },
    { id: 'workspace', name: 'workspace', isolate: { storageDomain: 'web-host', workspaceRegistry: 'web-host' } },
    { name: 'planning', isolate: { storageDomain: 'web-host', workspaceRegistry: 'web-host' }, config: { ownershipRoot: join(root, 'planning-owner') } },
    { name: 'llm' }, { name: 'fixture' },
  ]
  // Only nondeterministic deployment expressions are replaced; shipped plugin identities,
  // isolation, resource bounds and activation order remain unchanged.
  const patch = (await readFile(new URL('../../../bundle/personal-planning/investment-review.patch.yml', import.meta.url), 'utf8'))
    .replace("!!js dshHomePath('storages', 'requirement-assessment-ownership')", JSON.stringify(join(root, 'assessment-owner')))
    .replace('!!js process.env.DSH_RIR_PROVIDER', 'fixture')
    .replace('!!js process.env.DSH_RIR_MODEL', 'fixture')
    .replace("!!js process.env.DSH_RIR_BASELINE || 'unknown'", 'shipped-patch-fixture')
    .replace(/^- insert:\r?\n/mu, '').replace(/^    /gmu, '')
  await writeFile(join(root, 'cordis.yml'), prefix.map(row => `- ${JSON.stringify(row)}`).join('\n') + '\n' + patch)
  const app = await boot()
  const entry = [...app.loader.entries()].find(value => value.options.id === 'workspace')
  const registry = entry?.ctx?.get('workspaceRegistry')
  expect(registry !== undefined).toBe(true)
  expect(app.get('workspaceRegistry')).toBeUndefined()
  const workspace = await registry!.create(join(root, 'project'))
  const remoteEntry = [...app.loader.entries()].find(value => value.options.id === 'requirement-assessment-remote')
  expect(remoteEntry?.ctx?.get('workspaceRegistry')?.get(workspace.id)?.id).toBe(workspace.id)
  const remote = remoteEntry?.ctx?.get('requirementAssessmentRemote')
  expect(remote !== undefined).toBe(true)
  const signal = new AbortController().signal
  const result = await remote!.review({ workspaceId: workspace.id, requestId: 'shipped-manual', subject: { kind: 'manual', id: 'manual', title: 'Optional patch' }, text: 'User supplied evidence' }, signal)
  expect(result.assessment.baseline.dsh).toBe('shipped-patch-fixture')
  expect(result.assessment.evaluation.route).toBe('EXPERIMENT')
  expect(result.assessment.createdBy).toEqual({ kind: 'human', id: 'local-operator' })
  expect(calls).toBe(1)
  expect((await remote!.list({ workspaceId: workspace.id }, signal))[0]?.assessment.id).toBe(result.assessment.id)
  expect([...app.loader.entries()].some(value => value.options.id === 'ui-requirement-assessment')).toBe(true)
})
