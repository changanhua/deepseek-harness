import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { load } from './harness.ts'
import { fixture } from './fixture.ts'
import type { FcSbcPlanArtifact, FcSbcRealitySnapshot } from '../src/index.ts'
const roots: string[] = []; const contexts: Context[] = []
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function setup(config = {}, maxOutputBytes = 8192) { const root = await mkdtemp(join(tmpdir(), 'fc-domain-')); roots.push(root)
  const ctx = await load(root, config, maxOutputBytes); contexts.push(ctx); return { ctx, root } }
const signal = new AbortController().signal

describe('FC Reality → Plan real Loader composition', () => {
  it('persists immutable exact lineage, idempotency and payloads across a full owner/Loader restart', async () => {
    const { ctx, root } = await setup()
    const input = fixture(); const ref = await ctx.fcSbcDomain.captureReality(input)
    input.read!.inventory.cards[0]!.rating = 99
    const reality = await ctx.domainArtifacts.readArtifact(ref)
    expect((reality!.payload as FcSbcRealitySnapshot).inventory).toMatchObject({ status: 'complete', cards: [{ rating: 76 }, {}, {}] })
    expect(reality!.header.coverage?.status).toBe('partial')
    expect(reality!.header.coverage?.reasons).toContain('group-coverage-unproven')
    const refs = await Promise.all(['plan-one', 'plan-two'].map(requestId => ctx.fcSbcDomain.buildPlan({ requestId, realityRef: ref,
      searchLimit: 1 })))
    expect(refs[0]).toEqual(refs[1])
    const plan = await ctx.domainArtifacts.readArtifact(refs[0]!)
    expect(plan!.header.derivedFrom).toEqual([ref])
    expect(plan!.payload).toMatchObject({ realityRef: ref, solver: { searchComplete: false }, quoteStatus: { status: 'missing' },
      readiness: { status: 'candidate' } })
    expect((plan!.payload as FcSbcPlanArtifact).solver.incompleteReasons).toContain('candidate-search-limit-reached')
    expect((plan!.payload as FcSbcPlanArtifact).readiness.blockers).toContain('quote-provider-unavailable')
    expect(await ctx.domainArtifacts.readArtifact(ref)).toEqual(reality)
    const onDisk = await readFile(join(root, 'storage', 'fc_sbc_artifacts.json'), 'utf8')
    expect(onDisk).toContain(ref.id); expect(onDisk).toContain(refs[0]!.id)
    await ctx.fiber.dispose(); contexts.splice(contexts.indexOf(ctx), 1)
    const restarted = await load(root); contexts.push(restarted)
    expect(await restarted.domainArtifacts.readArtifact(ref)).toEqual(reality)
    expect(await restarted.domainArtifacts.readArtifact(refs[0]!)).toEqual(plan)
    expect(await restarted.fcSbcDomain.captureReality(fixture())).toEqual(ref)
    expect(await restarted.fcSbcDomain.buildPlan({ requestId: 'plan-after-restart', realityRef: ref, searchLimit: 1 })).toEqual(refs[0])
  })
  it('does not overstate partial, missing-id, duplicate, unknown-source or incomplete traversal evidence', async () => {
    const { ctx } = await setup()
    const cases = ['partial', 'missing-id', 'duplicate', 'unknown-source', 'end-missing', 'protection-missing', 'visible-source']
    for (const kind of cases) {
      const input = fixture(); input.requestId = kind
      if (kind === 'partial') input.read!.inventory.coverage = 'partial'
      if (kind === 'missing-id') delete input.read!.inventory.cards[0]!.instanceId
      if (kind === 'duplicate') input.read!.inventory.cards.push(input.read!.inventory.cards[0]!)
      if (kind === 'unknown-source') input.read!.inventory.cards[0]!.source = 'unknown'
      if (kind === 'end-missing') input.read!.inventory.club!.retrievedAll = false
      if (kind === 'protection-missing') delete input.read!.inventory.cards[0]!.locked
      if (kind === 'visible-source') input.read!.inventory.cards[0]!.source = 'visible'
      const ref = await ctx.fcSbcDomain.captureReality(input)
      const artifact = await ctx.fcSbcDomain.readArtifact(ref)
      expect((artifact!.payload as FcSbcRealitySnapshot).inventory.status, kind).not.toBe('complete')
    }
  })
  it('strips undeclared sensitive/DOM/query data and preserves stable observed instance identities', async () => {
    const { ctx } = await setup(); const input = fixture()
    input.page.url += '?token=secret-value#secret-fragment'; input.read!.url = input.page.url; input.probe!.url = input.page.url
    Object.assign(input.read!, { token: 'secret-value', rawDOM: 'private DOM' })
    Object.assign(input.read!.inventory.cards[0]!, { accessToken: 'secret-value', textSample: 'private DOM' })
    const ref = await ctx.fcSbcDomain.captureReality(input)
    const artifact = await ctx.fcSbcDomain.readArtifact(ref)
    expect(JSON.stringify(artifact)).not.toMatch(/secret-value|secret-fragment|private DOM|accessToken|rawDOM/u)
    expect((artifact!.payload as FcSbcRealitySnapshot).inventory.cards.map(row => row.instanceId)).toEqual(['one', 'two', 'three'])
    ;(artifact!.payload as FcSbcRealitySnapshot).inventory.cards[0]!.rating = 88
    expect(((await ctx.fcSbcDomain.readArtifact(ref))!.payload as FcSbcRealitySnapshot).inventory.cards[0]!.rating).toBe(76)
  })
  it('rejects changed requests and inexact Reality refs without changing existing artifacts', async () => {
    const { ctx } = await setup(); const ref = await ctx.fcSbcDomain.captureReality(fixture())
    const changed = fixture(); changed.read!.inventory.cards[0]!.rating = 88
    await expect(ctx.fcSbcDomain.captureReality(changed)).rejects.toThrow('request-id-conflict')
    const { digest: _digest, ...inexact } = ref
    await expect(ctx.fcSbcDomain.buildPlan({ requestId: 'bad-ref', realityRef: inexact })).rejects.toThrow('exact-reality-required')
    await expect(ctx.fcSbcDomain.captureReality(fixture(), AbortSignal.abort())).rejects.toThrow()
  })
  it('keeps unknown freshness without expiry and does not rewrite a Plan when Reality expires', async () => {
    const { ctx } = await setup(); const input = fixture(); delete input.expiresAt
    const unknown = await ctx.fcSbcDomain.captureReality(input)
    expect((await ctx.fcSbcDomain.getStatus(unknown))!.freshness).toBe('unknown')
    const fresh = fixture(); fresh.requestId = 'with-expiry'
    const ref = await ctx.fcSbcDomain.captureReality(fresh)
    const planRef = await ctx.fcSbcDomain.buildPlan({ requestId: 'fixed-plan', realityRef: ref })
    const plan = await ctx.fcSbcDomain.readArtifact(planRef)
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T00:00:00.000Z'))
    expect((await ctx.fcSbcDomain.getStatus(ref))!.freshness).toBe('stale')
    expect(await ctx.fcSbcDomain.readArtifact(planRef)).toEqual(plan)
    expect(await ctx.fcSbcDomain.buildPlan({ requestId: 'same-input-later', realityRef: ref })).toEqual(planRef)
  })
  it('retains provisional candidates with partial inventory and missing native chemistry', async () => {
    const { ctx } = await setup(); const input = fixture(); input.read!.inventory.coverage = 'partial'
    input.read!.group.sets[0]!.challenges[0]!.requirements.constraints.push({ type: 'chemistry', model: 'verified-evaluator', minimum: 5 })
    const realityRef = await ctx.fcSbcDomain.captureReality(input)
    const ref = await ctx.fcSbcDomain.buildPlan({ requestId: 'provisional', realityRef })
    const plan = (await ctx.fcSbcDomain.readArtifact(ref))!.payload as FcSbcPlanArtifact
    expect(plan.challengeCandidates[0]!.candidates.length).toBeGreaterThan(0)
    expect(plan.challengeCandidates[0]!.provisional).toBe(true)
    expect(plan.readiness.blockers).toContain('chemistry-evaluator-missing')
    expect(plan.readiness.status).not.toBe('ready-for-approval')
  })
  it('runs typed inspect/plan/status through the real tools registry and no external-write service', async () => {
    const { ctx } = await setup()
    expect(ctx.tools.schemas().map(row => row.name)).toEqual(['fc_sbc_inspect', 'fc_sbc_plan', 'fc_sbc_status'])
    const inspect = await ctx.tools.execute({ signal, callId: ToolCallId('inspect'), name: 'fc_sbc_inspect', arguments: fixture() })
    expect(inspect.isError).toBeFalsy()
    const inspected = JSON.parse(String(inspect.value))
    const planned = await ctx.tools.execute({ signal, callId: ToolCallId('plan'), name: 'fc_sbc_plan',
      arguments: { requestId: 'tool-plan', realityRef: inspected.ref } })
    expect(planned.isError).toBeFalsy()
    const summary = JSON.parse(String(planned.value))
    expect(summary.ref.kind).toBe('sbc-plan'); expect(summary.quoteStatus.status).toBe('missing')
    const status = await ctx.tools.execute({ signal, callId: ToolCallId('status'), name: 'fc_sbc_status', arguments: { ref: summary.ref } })
    expect(status.isError).toBeFalsy(); expect(Buffer.byteLength(String(status.value))).toBeLessThanOrEqual(8192)
    for (const key of ['browser', 'planning', 'safety', 'executor']) expect(ctx.get(key as never)).toBeUndefined()
    expect(inspected.ref.kind).toBe('sbc-reality')
  })
  it('rejects owner capacity before publishing an artifact', async () => {
    const { ctx } = await setup({ maxArtifacts: 1 })
    const ref = await ctx.fcSbcDomain.captureReality(fixture())
    await expect(ctx.fcSbcDomain.buildPlan({ requestId: 'over-capacity', realityRef: ref })).rejects.toThrow('artifact-capacity')
    expect(await ctx.fcSbcDomain.readArtifact(ref)).toBeDefined()
  })
  it('retains bounded empty search as incomplete, never mathematical no-solution', async () => {
    const { ctx } = await setup(); const input = fixture()
    input.read!.group.sets[0]!.challenges[0]!.requirements.constraints = [{ type: 'quality-count', quality: 'silver', minimum: 2 }]
    const realityRef = await ctx.fcSbcDomain.captureReality(input)
    const ref = await ctx.fcSbcDomain.buildPlan({ requestId: 'bounded-empty', realityRef, searchLimit: 1 })
    const plan = (await ctx.fcSbcDomain.readArtifact(ref))!.payload as FcSbcPlanArtifact
    expect(plan.candidates).toEqual([])
    expect(plan.solver.searchComplete).toBe(false)
    expect(plan.solver.incompleteReasons).toContain('candidate-search-limit-reached')
    expect(JSON.stringify(plan)).not.toContain('mathematical')
  })
  it('rejects corrupted persisted content during a cold restart', async () => {
    const { ctx, root } = await setup()
    await ctx.fcSbcDomain.captureReality(fixture())
    await ctx.fiber.dispose(); contexts.splice(contexts.indexOf(ctx), 1)
    const path = join(root, 'storage', 'fc_sbc_artifacts.json')
    const bytes = await readFile(path, 'utf8')
    await writeFile(path, bytes.replace('Fixture group', 'Changed group'))
    await expect(load(root)).rejects.toThrow()
  })

  it('compares mixed-offset observation times chronologically and never treats future facts as fresh', async () => {
    const { ctx } = await setup(); const input = fixture()
    input.read!.capturedAt = '2026-09-30T10:00:00+10:00'
    input.probe!.capturedAt = '2026-09-30T01:00:00Z'
    const ref = await ctx.fcSbcDomain.captureReality(input)
    expect((await ctx.fcSbcDomain.readArtifact(ref))!.header.observedAt).toBe('2026-09-30T10:00:00+10:00')
    const future = fixture(); future.requestId = 'future'
    future.read!.capturedAt = '2030-01-01T00:00:00Z'; future.probe!.capturedAt = future.read!.capturedAt
    future.expiresAt = '2030-01-02T00:00:00Z'
    const futureRef = await ctx.fcSbcDomain.captureReality(future)
    expect((await ctx.fcSbcDomain.readArtifact(futureRef))!.header.freshness?.status).toBe('unknown')
    expect((await ctx.fcSbcDomain.getStatus(futureRef))!.freshness).toBe('unknown')
  })

  it('bounds the whole model result at a small configured byte cap while retaining the exact ref', async () => {
    const { ctx } = await setup({}, 1024); const input = fixture()
    input.read!.inventory.coverage = 'partial'
    input.read!.inventory.cards.forEach((card) => { delete card.reserveValue })
    input.read!.group.sets[0]!.challenges[0]!.requirements.constraints.push({ type: 'squad-rating', model: 'verified-evaluator', minimum: 80 })
    input.read!.group.sets[0]!.challenges[0]!.requirements.constraints.push({ type: 'chemistry', model: 'verified-evaluator', minimum: 7 })
    delete input.expiresAt
    const realityRef = await ctx.fcSbcDomain.captureReality(input)
    const planRef = await ctx.fcSbcDomain.buildPlan({ requestId: 'small-output', realityRef })
    const result = await ctx.tools.execute({ signal, callId: ToolCallId('small-output'), name: 'fc_sbc_status', arguments: { ref: planRef } })
    expect(result.isError).toBeFalsy()
    expect(Buffer.byteLength(String(result.value))).toBeLessThanOrEqual(1024)
    expect(JSON.parse(String(result.value))).toMatchObject({ ref: planRef, truncated: true, quoteStatus: 'missing' })
  })

})
