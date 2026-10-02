import { randomUUID, createHash } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import EvalPlans, { EvalPlanError } from '@changanhua/dsh-eval-plans'
import type { EvalPlanAccess, EvalPlanAdmission, EvalPlanSelection, EvalPreflightCheck, ResolvedEvalPlan } from '@changanhua/dsh-eval-plans'
import { evalContractDigest } from '@changanhua/dsh-eval'
import { realpathNormalize } from '@deepseek-ai/dsh-workspace'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@changanhua/dsh-budget'
import { configSchema, Config } from './config.ts'
import { readPinnedPlanSource } from './source.ts'
import type { PlanSourceSnapshot } from './source.ts'

const receiptSchema = z.object({ requestId: z.string(), runId: z.string(), workspaceId: z.string(), planId: z.string(),
  planVersion: z.string(), planDigest: z.string(), resolvedDigest: z.string(), admittedAt: z.number().int().nonnegative() }).strict()
const domainSpec = defineDomain({ name: 'eval_plan_admissions', version: 1, layout: 'single',
  requires: ['single-writer', 'commit-sync', 'private-root'] as const,
  global: { schema: z.object({ version: z.literal(1), receipts: z.array(receiptSchema) }).strict(),
    initial: { version: 1 as const, receipts: [] } }, tables: {} })
type Entry = { source: Config['sources'][number]; snapshot: PlanSourceSnapshot }

/** Host-pinned Plan source with safe discovery, fresh preflight and durable idempotent admission. */
export class LocalEvalPlans extends EvalPlans {
  static inject = ['storageDomain', 'workspaceRegistry']
  static Config = Config
  private readonly config: Config
  private entries: readonly Entry[] = []
  private generation = 0
  private domain?: Domain<typeof domainSpec>
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  private faulted = false
  private readonly resolutions = new WeakMap<ResolvedEvalPlan, { generation: number; workspace: EvalPlanAccess['workspace']; entrypoint: EvalPlanAccess['entrypoint'] }>()

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.config = configSchema.parse(config)
    this.ctx.effect(() => async () => { this.closed = true; await this.tail; await this.domain?.close() }, 'evalPlans.close()')
  }

  protected async [Service.init](): Promise<void> {
    await this.load()
    this.domain = await this.ctx.storageDomain.open(domainSpec)
  }

  private async load(signal?: AbortSignal): Promise<void> {
    const entries: Entry[] = []
    const seen = new Set<string>()
    for (const source of this.config.sources) {
      const root = await realpathNormalize(source.root)
      const key = JSON.stringify([root, source.approvedPlan.id, source.approvedPlan.version])
      if (seen.has(key)) throw new EvalPlanError('invalid-source', 'Duplicate Plan source identity')
      seen.add(key)
      let snapshot: PlanSourceSnapshot
      try { snapshot = await readPinnedPlanSource(source, signal) }
      catch { signal?.throwIfAborted(); throw new EvalPlanError('invalid-source', 'Plan source failed containment, schema, identity or capacity validation') }
      entries.push({ source: { ...source, root }, snapshot })
    }
    signal?.throwIfAborted()
    if (this.closed) throw new EvalPlanError('unavailable', 'Plan owner is closing')
    this.entries = entries
    this.generation++
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      if (this.closed || this.faulted) throw new EvalPlanError('unavailable', 'Plan admission owner is unavailable')
      return operation()
    })
    this.tail = result.then(() => {}, () => {})
    return result
  }

  async reload(authorize: () => void | Promise<void>, signal?: AbortSignal): Promise<void> {
    if (typeof authorize !== 'function') throw new EvalPlanError('unauthorized', 'Reload requires Host authority')
    await this.serial(async () => { await authorize(); await this.load(signal) })
  }

  private async access(access: EvalPlanAccess, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (this.closed || this.faulted || !this.domain) throw new EvalPlanError('unavailable', 'Plan owner is unavailable')
    if (typeof access.authorize !== 'function' || this.ctx.workspaceRegistry.get(access.workspace.id) !== access.workspace) {
      throw new EvalPlanError('unauthorized', 'Plan access requires the exact live Workspace')
    }
    await access.authorize()
    signal?.throwIfAborted()
    if (this.ctx.workspaceRegistry.get(access.workspace.id) !== access.workspace) throw new EvalPlanError('unauthorized', 'Workspace authority changed')
  }

  private summary(entry: Entry) {
    const { plan, suite, cellCount } = entry.snapshot
    return { id: plan.id, version: plan.version, mode: entry.source.mode, digest: evalContractDigest(plan), suiteId: suite.id, cellCount,
      routeIds: plan.routes.map(route => route.id) }
  }

  async discover(access: EvalPlanAccess, signal?: AbortSignal) {
    await this.access(access, signal)
    return this.entries.filter(entry => entry.source.root === access.workspace.path
      && (entry.source.workspaceId === null || entry.source.workspaceId === access.workspace.id)
      && entry.snapshot.plan.allowedEntrypoints.includes(access.entrypoint)).map(entry => this.summary(entry))
  }

  async resolve(access: EvalPlanAccess, selection: EvalPlanSelection, signal?: AbortSignal): Promise<ResolvedEvalPlan> {
    await this.access(access, signal)
    const selected = z.object({ id: z.string().min(1).max(256), version: z.string().min(1).max(256) }).strict().parse(selection)
    const generation = this.generation
    const entry = this.entries.find(row => row.source.root === access.workspace.path
      && (row.source.workspaceId === null || row.source.workspaceId === access.workspace.id)
      && row.snapshot.plan.id === selected.id && row.snapshot.plan.version === selected.version)
    if (!entry) throw new EvalPlanError('not-found', 'Approved Plan is unavailable in this Workspace')
    const { plan, suite } = entry.snapshot
    const checks: EvalPreflightCheck[] = []
    const observed: unknown[] = []
    const check = async (subject: string, code: string, verify: () => unknown) => {
      try { const value = await verify(); if (value === false || value === undefined) throw new Error('not available'); observed.push({ subject, value }); checks.push({ subject, code, ok: true }) }
      catch { signal?.throwIfAborted(); checks.push({ subject, code, ok: false }) }
    }
    await check(plan.id, 'source-identity', async () => evalContractDigest(await readPinnedPlanSource(entry.source, signal)) === evalContractDigest(entry.snapshot))
    await check(plan.id, 'workspace-policy', async () => await realpathNormalize(entry.source.root) === access.workspace.path)
    await check(plan.id, 'entrypoint-authorized', () => plan.allowedEntrypoints.includes(access.entrypoint))
    for (const route of plan.routes) {
      await check(route.id, 'provider-model-available', async () => this.ctx.get('llm')?.resolveModelInfo(route.provider, route.model, signal))
      await check(route.id, 'preset-identity', async () => {
        const presets = this.ctx.get('agentPresets')
        if (!presets) return false
        const row = await presets.resolve(route.preset.id)
        if (row.broken) return false
        const document = await presets.readDocument(route.preset.id)
        const actual = { id: document.agentPreset, source: `preset:${document.trust}`, digest: createHash('sha256').update(document.content.replace(/\r\n/gu, '\n')).digest('hex') }
        return evalContractDigest(actual) === evalContractDigest(route.preset) ? actual : false
      })
    }
    for (const required of entry.source.requiredTools) {
      await check(required.id, 'tool-contract-identity', () => {
        const tool = this.ctx.get('tools')?.get(required.id)
        if (!tool) return false
        const actual = { id: tool.name, source: 'tool-contract:global', digest: evalContractDigest({ name: tool.name,
          description: tool.description, parameters: tool.parameters, outputSchema: tool.output.schema }) }
        return evalContractDigest(actual) === evalContractDigest(required) ? actual : false
      })
    }
    for (const required of entry.source.requiredSkills) {
      await check(required.id, 'skill-identity', async () => {
        const skill = await this.ctx.get('skills')?.get(required.id, { cwd: access.workspace.path, signal })
        if (!skill) return false
        const actual = { id: skill.name, source: `skill:${skill.provider}:${skill.source}`, digest: evalContractDigest({ name: skill.name,
          description: skill.description, content: skill.content, invocation: skill.invocation, metadata: skill.metadata ?? null }) }
        return evalContractDigest(actual) === evalContractDigest(required) ? actual : false
      })
    }
    await check(plan.id, 'credential-authority', async () => {
      const grant = entry.source.credentialGrant
      if (plan.credentialAuthorizationRef === null) return entry.source.mode === 'keyless' && grant === null
      if (!grant || evalContractDigest(grant.reference) !== evalContractDigest(plan.credentialAuthorizationRef)) return false
      const credentials = this.ctx.get('credentials')
      if (!credentials) return false
      for (const ref of grant.credentialRefs) if (!(await credentials.describe(credentialRef(ref))).configured) return false
      return grant.reference
    })
    await check(plan.id, 'budget-authority', () => {
      if (!plan.budget.required) return { exemption: 'host-pinned-plan' }
      const ref = plan.budget.authorizationRef
      if (ref.version !== '1') return false
      const owner = this.ctx.get('budget')
      if (!owner) return false
      let budget = owner.inspect({ ...ref, version: '1' })
      const views = []
      while (true) {
        if (budget.scope.revoked || budget.unknownRequests > 0 || budget.remainingMs === 0) return false
        for (const key of ['requests', 'inputTokens', 'outputTokens', 'totalTokens'] as const) {
          const ceiling = budget.scope.limits[key]
          if (ceiling !== null && budget.consumed[key] + budget.reserved[key] >= ceiling) return false
        }
        const { remainingMs: _remainingMs, ...identity } = budget
        views.push(identity)
        if (budget.scope.parentId === null) break
        budget = owner.inspect(budget.scope.parentId)
      }
      return views
    })
    await this.access(access, signal)
    if (generation !== this.generation) throw new EvalPlanError('conflict', 'Plan generation changed during preflight')
    const data = { mode: entry.source.mode, plan: structuredClone(plan), suite: structuredClone(suite), summary: this.summary(entry),
      checks,
      ready: checks.every(value => value.ok), resolvedDigest: evalContractDigest({ plan, suite, checks, observed,
        sourcePolicy: entry.source }) }
    freeze(data)
    this.resolutions.set(data, { generation, workspace: access.workspace, entrypoint: access.entrypoint })
    return data
  }

  async admit(access: EvalPlanAccess, resolved: ResolvedEvalPlan, requestId: string, signal?: AbortSignal): Promise<EvalPlanAdmission> {
    z.string().min(1).max(256).parse(requestId)
    return this.serial(async () => {
      await this.access(access, signal)
      const proof = this.resolutions.get(resolved)
      if (!proof || proof.generation !== this.generation || proof.workspace !== access.workspace
        || proof.entrypoint !== access.entrypoint) {
        throw new EvalPlanError('unauthorized', 'Admission requires this owner\'s current resolution')
      }
      if (!resolved.ready) throw new EvalPlanError('preflight-blocked', 'Plan has blocking preflight checks')
      const fresh = await this.resolve(access, { id: resolved.summary.id, version: resolved.summary.version }, signal)
      if (fresh.resolvedDigest !== resolved.resolvedDigest) throw new EvalPlanError('conflict', 'Plan or preflight changed before admission')
      if (!fresh.ready) throw new EvalPlanError('preflight-blocked', 'Plan preflight is no longer ready')
      const domain = this.domain
      if (!domain) throw new EvalPlanError('unavailable', 'Plan owner is unavailable')
      const before = domain.global.get()
      const existing = before.receipts.find(row => row.workspaceId === access.workspace.id && row.requestId === requestId)
      if (existing) {
        if (existing.resolvedDigest !== resolved.resolvedDigest) throw new EvalPlanError('conflict', 'Request identity already names another resolution')
        return structuredClone(existing)
      }
      const receipt: EvalPlanAdmission = { requestId, runId: randomUUID(), workspaceId: access.workspace.id,
        planId: resolved.plan.id, planVersion: resolved.plan.version, planDigest: resolved.summary.digest,
        resolvedDigest: resolved.resolvedDigest, admittedAt: Date.now() }
      const next = { version: 1 as const, receipts: [...before.receipts, receipt] }
      if (next.receipts.length > this.config.maxAdmissions || Buffer.byteLength(JSON.stringify(next)) > this.config.maxLedgerBytes) {
        throw new EvalPlanError('capacity', 'Plan admission ledger is full')
      }
      await this.access(access, signal)
      try { await domain.global.set(next) }
      catch { this.faulted = true; throw new EvalPlanError('unavailable', 'Plan admission persistence requires recovery') }
      return structuredClone(receipt)
    })
  }
}

function freeze(value: unknown): void {
  if (!value || typeof value !== 'object') return
  for (const child of Object.values(value)) freeze(child)
  Object.freeze(value)
}
export default LocalEvalPlans
