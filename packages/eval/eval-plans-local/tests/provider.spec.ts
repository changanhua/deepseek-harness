import { Context } from '@deepseek-ai/cordis'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { evalContractDigest, parseEvalPlan } from '@changanhua/dsh-eval'
import LocalBudget from '../../../budget/budget-local/src/index.ts'
import { fixture } from './helpers/fixture.ts'

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

test('recovers original admission facts across restart without requiring current model availability', async () => {
  const f = await fixture()
  const h = await f.boot()
  try {
    const resolved = await h.ctx.evalPlans.resolve(f.access, { id: 'plan', version: '1' })
    const admission = await h.ctx.evalPlans.admit(f.access, resolved, 'recoverable')
    await h.close()
    const reopened = await f.boot(false)
    try {
      const recovered = await reopened.ctx.evalPlans.recover(f.access, 'recoverable')
      expect(recovered).toEqual({ admission, resolved })
      expect(Object.isFrozen(recovered?.resolved.plan)).toBe(true)
      expect(await reopened.ctx.evalPlans.recover(f.access, 'absent')).toBeNull()
      await expect(reopened.ctx.evalPlans.recover({ ...f.access, workspace: { ...f.access.workspace } }, 'recoverable'))
        .rejects.toMatchObject({ code: 'unauthorized' })
      await expect(reopened.ctx.evalPlans.recover({ ...f.access, authorize: () => { throw new Error('revoked') } }, 'recoverable'))
        .rejects.toThrow('revoked')
      // Historical recovery cannot mint permission for a new run with an unavailable Provider.
      await expect(reopened.ctx.evalPlans.admit(f.access, recovered!.resolved, 'another-run'))
        .rejects.toMatchObject({ code: 'unauthorized' })
    } finally { await reopened.close() }
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


test.each(['exemption', 'missing-owner', 'forged-reference', 'missing-output', 'no-expiry', 'no-ceiling', 'valid'] as const)(
  'live admission enforces resource authority: %s', async (scenario) => {
    const f = await fixture()
    const h = await f.boot(true, async (ctx) => {
      const source = f.config.sources[0]
      if (!source) throw new Error('fixture source missing')
      source.mode = 'live'
      const grant = { id: 'credential-grant', version: '1', digest: 'c'.repeat(64) }
      source.credentialGrant = { reference: grant, credentialRefs: ['FIXTURE_KEY'] }
      ctx.provide('credentials', { describe: async () => ({ configured: true }) } as unknown as Context['credentials'])
      let authorizationRef = { id: 'budget', version: '1', digest: 'd'.repeat(64) }
      if (scenario !== 'missing-owner') {
        await ctx.plugin(LocalBudget, { maxScopes: 8, maxReservations: 8, maxLedgerBytes: 65536 })
        const scope = await ctx.budget.createScope({ id: 'budget', kind: 'workflow', subjectId: 'run', parentId: null,
          limits: { requests: scenario === 'no-ceiling' ? null : 5, inputTokens: null, outputTokens: null,
            totalTokens: null, wallTimeMs: scenario === 'no-expiry' ? null : 60000 }, onExhausted: 'deny' }, () => {})
        authorizationRef = scope.reference
        if (scenario === 'forged-reference') authorizationRef = { ...authorizationRef, digest: 'd'.repeat(64) }
      }
      const plan = parseEvalPlan({ ...f.plan, credentialAuthorizationRef: grant,
        routes: f.plan.routes.map((route, index) => ({ ...route,
          parameters: scenario === 'missing-output' && index === 1 ? {} : { maxTokens: 32 } })),
        budget: scenario === 'exemption' ? { required: false, authorizationRef: null } : { required: true, authorizationRef } })
      await writeFile(join(f.root, 'plan.json'), JSON.stringify(plan))
      source.approvedPlan.digest = evalContractDigest(plan)
    })
    try {
      const resolved = await h.ctx.evalPlans.resolve(f.access, { id: 'plan', version: '1' })
      expect(resolved.checks).toContainEqual({ subject: 'plan', code: 'credential-authority', ok: true })
      expect(resolved.ready).toBe(scenario === 'valid')
      if (scenario === 'valid') {
        const receipt = await h.ctx.evalPlans.admit(f.access, resolved, 'live-request')
        expect(receipt.resolvedDigest).toBe(resolved.resolvedDigest)
        expect(h.ctx.budget.inspect('budget').consumed.requests).toBe(0)
      } else {
        expect(resolved.checks).toContainEqual({ subject: scenario === 'missing-output' ? 'b' : 'plan',
          code: scenario === 'missing-output' ? 'output-reservation-bound' : 'budget-authority', ok: false })
        await expect(h.ctx.evalPlans.admit(f.access, resolved, 'live-request')).rejects.toMatchObject({ code: 'preflight-blocked' })
      }
    } finally { await h.close(); await f.clean() }
  },
)

test('retains immutable approved capability expectations and rejects changed observations before admission', async () => {
  const f = await fixture()
  const tool = { name: 'inspect', description: 'Inspect', parameters: { type: 'object' }, output: { schema: { type: 'string' } } }
  const skill = { name: 'review', description: 'Review', content: 'Read evidence', invocation: { kind: 'manual' },
    provider: 'fixture', source: 'workspace', metadata: null }
  const tools = [{ id: tool.name, source: 'tool-contract:global', digest: evalContractDigest({ name: tool.name,
    description: tool.description, parameters: tool.parameters, outputSchema: tool.output.schema }) }]
  const skills = [{ id: skill.name, source: 'skill:fixture:workspace', digest: evalContractDigest({ name: skill.name,
    description: skill.description, content: skill.content, invocation: skill.invocation, metadata: skill.metadata }) }]
  const h = await f.boot(true, async (ctx) => {
    const source = f.config.sources[0]
    if (!source) throw new Error('fixture source missing')
    source.requiredTools = tools
    source.requiredSkills = skills
    ctx.provide('tools', { get: () => tool } as unknown as Context['tools'])
    ctx.provide('skills', { get: async () => skill } as unknown as Context['skills'])
  })
  try {
    const resolved = await h.ctx.evalPlans.resolve(f.access, { id: 'plan', version: '1' })
    expect(resolved.ready).toBe(true)
    expect(resolved.resolvedRequirements).toEqual({ tools, skills })
    expect(Object.isFrozen(resolved.resolvedRequirements)).toBe(true)
    expect(Object.isFrozen(resolved.resolvedRequirements.skills[0])).toBe(true)
    const receipt = await h.ctx.evalPlans.admit(f.access, resolved, 'capabilities')
    expect(receipt.resolvedDigest).toBe(resolved.resolvedDigest)
    await expect(h.ctx.evalPlans.admit(f.access, structuredClone(resolved), 'clone')).rejects.toMatchObject({ code: 'unauthorized' })
    skill.content = 'Changed instructions'
    await expect(h.ctx.evalPlans.admit(f.access, resolved, 'changed')).rejects.toMatchObject({ code: 'conflict' })
    const changed = await h.ctx.evalPlans.resolve(f.access, { id: 'plan', version: '1' })
    expect(changed.ready).toBe(false)
    expect(changed.resolvedRequirements).toEqual(resolved.resolvedRequirements)
    expect(changed.resolvedDigest).not.toBe(resolved.resolvedDigest)
  } finally { await h.close(); await f.clean() }
})
