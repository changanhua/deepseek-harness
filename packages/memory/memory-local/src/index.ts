/** Local durable project-memory Provider. @module @changanhua/dsh-memory-local */
import { Context, Service } from '@deepseek-ai/cordis'
import assert from 'node:assert/strict'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-session-persistence'
import ProjectMemory, { MemoryError, memoryProposalSchema, memoryTimestampSchema } from '@changanhua/dsh-memory'
import type { MemoryDecisionRequest, MemoryInspectionRequest, MemoryInspectedRecord, MemoryMutation, MemoryProposal, MemoryReadResult, MemorySearchRequest, MemorySearchResult } from '@changanhua/dsh-memory'
import { MemoryStore } from './store.ts'
import { acquireMemoryOwnership } from './ownership.ts'
import type { MemoryOwnership } from './ownership.ts'
import { memoryCommand, memoryInspectionCommand, resolveMemoryScope } from './scope.ts'
import { captureMemorySources, checkMemorySources } from './sources.ts'
import type { MemorySourceAccess } from './sources.ts'
import { conflictingMemoryIds, rankMemories } from './search.ts'

/** Local storage ownership and bounded read/write policies. */
export interface Config {
  /** Absolute lock directory shared by every composition targeting this memory store. */
  ownershipRoot: string
  /** Default interval from human acceptance to the next required review. */
  reviewAfterDays?: number
  /** Maximum stored memories per Workspace; full stores reject rather than evict. */
  maxRecordsPerWorkspace?: number
  /** Maximum immutable content versions per memory. */
  maxRevisions?: number
  /** Maximum committed mutations per memory. */
  maxReceipts?: number
  /** Maximum bytes read from one file or retained source event text. */
  maxSourceBytes?: number
  /** Maximum UTF-8 bytes of a complete model-facing service result. */
  maxOutputBytes?: number
  /** Maximum checked, usable results returned by a lexical search. */
  maxSearchResults?: number
}

/** Deployment schema; none of these limits are model-controlled. */
export const Config: z<Config> = z.object({
  ownershipRoot: z.string().required(),
  reviewAfterDays: z.number().step(1).min(1).max(3650).default(30),
  maxRecordsPerWorkspace: z.number().step(1).min(1).max(500).default(500),
  maxRevisions: z.number().step(1).min(1).max(50).default(50),
  maxReceipts: z.number().step(1).min(1).max(200).default(200),
  maxSourceBytes: z.number().step(1).min(1).max(1024 * 1024).default(1024 * 1024),
  maxOutputBytes: z.number().step(1).min(1).max(16 * 1024).default(16 * 1024),
  maxSearchResults: z.number().step(1).min(1).max(100).default(5),
})

interface Runtime {
  readonly store: MemoryStore
  readonly ownership: MemoryOwnership
  readonly pending: Set<Promise<unknown>>
  closing: boolean
}

/** Authorizes every operation and joins source observations to durable memory state. */
export class LocalProjectMemory extends ProjectMemory {
  static inject = ['storageDomain', 'workspaceRegistry', 'sessions', 'sessionPersistence', 'sessionQuery', 'fs']
  static Config = Config
  private readonly config: Required<Config>
  private runtime?: Runtime

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.config = Config(config) as Required<Config>
  }

  protected async [Service.init](): Promise<void> {
    const ownership = await acquireMemoryOwnership(this.config.ownershipRoot)
    let store: MemoryStore
    try {
      store = await MemoryStore.open(this.ctx.storageDomain, this.config)
    } catch (error) {
      try { await ownership.release() }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'memory startup and owner cleanup failed') }
      throw error
    }
    const runtime: Runtime = { store, ownership, pending: new Set(), closing: false }
    this.runtime = runtime
    this.ctx.effect(() => async () => {
      runtime.closing = true
      await Promise.allSettled([...runtime.pending])
      await runtime.store.close()
      await runtime.ownership.release()
    }, 'project memory storage ownership')
  }

  override propose(agent: Agent, input: MemoryProposal, signal?: AbortSignal): Promise<MemoryMutation> {
    return this.use(async (runtime) => {
      const workspace = await resolveMemoryScope(this.ctx, agent, signal)
      const parsed = memoryProposalSchema.safeParse(input)
      if (!parsed.success) throw new MemoryError('invalid-input', 'memory candidate has invalid fields')
      const replay = runtime.store.replayProposal(workspace.id, parsed.data)
      if (replay !== undefined) return replay
      const sources = await captureMemorySources(this.access(agent, workspace), parsed.data.sources, this.config.maxSourceBytes, signal)
      await this.reauthorize(agent, workspace, signal)
      return runtime.store.propose(workspace.id, agent.session.id, parsed.data, sources, new Date().toISOString(), signal)
    })
  }

  override decide(agent: Agent, request: MemoryDecisionRequest, signal?: AbortSignal): Promise<MemoryMutation> {
    return this.use(async (runtime) => {
      const workspace = await resolveMemoryScope(this.ctx, agent, signal)
      const args = `${request.action} ${request.id}@${request.revision}${request.reviewAfter === undefined ? '' : ` --review-after ${request.reviewAfter}`}`
      const command = memoryCommand(agent, request.commandId, args)
      const current = runtime.store.get(workspace.id, request.id)
      if (current === undefined) throw new MemoryError('not-found', 'memory is not available in this Workspace')
      let resolved = request
      if (request.action === 'accept') {
        const revision = current.revisions[request.revision - 1]
        if (revision === undefined) throw new MemoryError('invalid-transition', 'memory revision is not available')
        const checks = await checkMemorySources(this.access(agent, workspace), revision.sources, this.config.maxSourceBytes, signal)
        if (checks.some(value => value.status === 'unavailable')) throw new MemoryError('source-unavailable', 'review the unavailable memory source before accepting')
        if (checks.some(value => value.status === 'changed')) throw new MemoryError('source-changed', 'propose a fresh revision for the changed source')
        const reviewAfter = request.reviewAfter ?? new Date(command.time + this.config.reviewAfterDays * 86_400_000).toISOString()
        if (!memoryTimestampSchema.safeParse(reviewAfter).success || Date.parse(reviewAfter) <= Date.now()) {
          throw new MemoryError('invalid-input', 'review deadline must be a future UTC ISO timestamp')
        }
        resolved = { ...request, reviewAfter }
      }
      if (!await this.ctx.sessions.flush(agent.session)) throw new MemoryError('unauthorized', 'memory decisions require durable command evidence')
      await this.reauthorize(agent, workspace, signal)
      memoryCommand(agent, request.commandId, args)
      return runtime.store.decide(workspace.id, agent.session.id, resolved, new Date(command.time).toISOString(), signal)
    })
  }

  override inspect(agent: Agent, request: MemoryInspectionRequest, signal?: AbortSignal): Promise<readonly MemoryInspectedRecord[]> {
    return this.use(async (runtime) => {
      const workspace = await resolveMemoryScope(this.ctx, agent, signal)
      const command = memoryInspectionCommand(agent, request.commandId, request.id, request.revision)
      const commandArgs = command.data.args
      assert(request.id === undefined || commandArgs !== undefined, 'an authorized memory target requires command arguments')
      const records = request.id === undefined ? runtime.store.list(workspace.id) : [runtime.store.get(workspace.id, request.id)]
      const results: MemoryInspectedRecord[] = []
      for (const record of records) {
        if (record === undefined) throw new MemoryError('not-found', 'memory is not available in this Workspace')
        const sourceChecks: Array<MemoryInspectedRecord['sourceChecks'][number]> = []
        if (commandArgs !== undefined && /^show\s/u.test(commandArgs.trim())) {
          const selected = request.revision === undefined
            ? new Set([record.activeRevision, record.candidateRevision]) : new Set([request.revision])
          const revisions = record.revisions.filter(value => selected.has(value.revision))
          if (request.revision !== undefined && revisions.length === 0) throw new MemoryError('not-found', 'memory revision is not available')
          for (const revision of revisions) {
            const observations = await checkMemorySources(
              this.access(agent, workspace), revision.sources, this.config.maxSourceBytes, signal,
            )
            sourceChecks.push({ revision: revision.revision, checkedAt: new Date().toISOString(), observations })
          }
        }
        await this.reauthorize(agent, workspace, signal)
        if (runtime.store.get(workspace.id, record.id)?.recordVersion !== record.recordVersion) {
          throw new MemoryError('version-conflict', 'memory changed during inspection; show it again')
        }
        results.push({ ...record, sourceChecks })
      }
      return results
    })
  }

  override read(agent: Agent, id: string, signal?: AbortSignal): Promise<MemoryReadResult> {
    return this.use(async runtime => this.bounded(await this.checkedRead(runtime, agent, id, signal)))
  }

  override search(agent: Agent, request: MemorySearchRequest, signal?: AbortSignal): Promise<MemorySearchResult> {
    return this.use(async (runtime) => {
      if (typeof request.query !== 'string' || request.query.trim().length === 0 || request.query.length > 1000
        || request.limit !== undefined && (!Number.isSafeInteger(request.limit) || request.limit < 1)
        || request.tags !== undefined && (!Array.isArray(request.tags) || request.tags.length > 20 || request.tags.some(tag => typeof tag !== 'string'))
        || Object.keys(request).some(key => !['query', 'tags', 'limit'].includes(key))) throw new MemoryError('invalid-input', 'memory search requires a bounded project query')
      const workspace = await resolveMemoryScope(this.ctx, agent, signal)
      for (let attempt = 0; attempt < 2; attempt++) {
        const snapshot = runtime.store.list(workspace.id)
        const versions = new Map(snapshot.map(record => [record.id, record.recordVersion]))
        const ranked = rankMemories(snapshot, request)
        const items: MemoryReadResult[] = []
        const excluded: Partial<Record<MemoryReadResult['eligibility'], number>> = {}
        for (const record of ranked) {
          const result = await this.checkedRead(runtime, agent, record.id, signal)
          if (result.eligibility !== 'usable') {
            excluded[result.eligibility] = (excluded[result.eligibility] ?? 0) + 1
            continue
          }
          if (Buffer.byteLength(JSON.stringify({ items: [...items, result], excluded }), 'utf8') > this.config.maxOutputBytes) {
            if (items.length === 0) throw new MemoryError('capacity-exceeded', 'one memory exceeds the complete output byte limit')
            break
          }
          items.push(result)
          if (items.length >= Math.min(request.limit ?? this.config.maxSearchResults, this.config.maxSearchResults)) break
        }
        await this.reauthorize(agent, workspace, signal)
        const current = runtime.store.list(workspace.id)
        // A later source check can overlap a change to an earlier hit, or the
        // admission of a conflicting record absent from the initial ranking.
        if (current.length !== versions.size || current.some(record => versions.get(record.id) !== record.recordVersion)) continue
        if (items.some(item => item.reviewAfter !== undefined && Date.parse(item.reviewAfter) <= Date.now())) continue
        return this.bounded({ items, excluded })
      }
      throw new MemoryError('concurrent-change', 'project memory kept changing during search; retry the query')
    })
  }

  private async checkedRead(runtime: Runtime, agent: Agent, id: string, signal?: AbortSignal): Promise<MemoryReadResult> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const workspace = await resolveMemoryScope(this.ctx, agent, signal)
      const record = runtime.store.get(workspace.id, id)
      if (record === undefined) throw new MemoryError('not-found', 'memory is not available in this Workspace')
      const revision = record.activeRevision === null ? undefined : record.revisions[record.activeRevision - 1]
      const acceptance = record.decisions.findLast(value => value.action === 'accept' && value.revision === record.activeRevision)
      let eligibility: MemoryReadResult['eligibility'] = 'withdrawn'
      let sources: MemoryReadResult['sources'] = revision?.sources.map(source => ({ source, status: 'not-checked' as const })) ?? []
      if (revision !== undefined) {
        if (acceptance?.reviewAfter === undefined || Date.parse(acceptance.reviewAfter) <= Date.now()) eligibility = 'review-due'
        else if (conflictingMemoryIds(runtime.store.list(workspace.id)).has(id)) eligibility = 'conflicted'
        else {
          sources = await checkMemorySources(this.access(agent, workspace), revision.sources, this.config.maxSourceBytes, signal)
          eligibility = sources.some(value => value.status === 'unavailable') ? 'source-unavailable' : sources.some(value => value.status === 'changed') ? 'source-changed' : 'usable'
        }
      }
      await this.reauthorize(agent, workspace, signal)
      if (runtime.store.get(workspace.id, id)?.recordVersion !== record.recordVersion) continue
      if (revision !== undefined && acceptance?.reviewAfter !== undefined && Date.parse(acceptance.reviewAfter) <= Date.now()) {
        eligibility = 'review-due'
      }
      if (eligibility === 'usable' && conflictingMemoryIds(runtime.store.list(workspace.id)).has(id)) eligibility = 'conflicted'
      if (eligibility !== 'usable') sources = sources.map(({ source, status }) => ({ source, status }))
      return {
        id, recordVersion: record.recordVersion, revision: record.activeRevision, eligibility,
        checkedAt: new Date().toISOString(), sources,
        ...acceptance?.reviewAfter === undefined ? {} : { reviewAfter: acceptance.reviewAfter },
        ...eligibility === 'usable' && revision !== undefined ? { memory: revision } : {},
      }
    }
    throw new MemoryError('concurrent-change', 'memory kept changing during inspection; retry the read')
  }

  private access(agent: Agent, workspace: Workspace): MemorySourceAccess {
    const fs = agent.ctx.get('fs')
    if (fs === undefined) throw new MemoryError('source-unavailable', 'this Agent has no file source capability')
    return { fs, cwd: workspace.path, query: this.ctx.sessionQuery, persistence: this.ctx.sessionPersistence }
  }

  private async reauthorize(agent: Agent, before: Workspace, signal?: AbortSignal): Promise<void> {
    const current = await resolveMemoryScope(this.ctx, agent, signal)
    if (current.id !== before.id || current.path !== before.path) throw new MemoryError('workspace-unavailable', 'memory Workspace changed during the operation')
  }

  private bounded<T>(value: T): T {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > this.config.maxOutputBytes) throw new MemoryError('capacity-exceeded', 'memory result exceeds the complete output byte limit')
    return value
  }

  private use<T>(operation: (runtime: Runtime) => Promise<T>): Promise<T> {
    const runtime = this.runtime
    if (runtime === undefined || runtime.closing) return Promise.reject(new MemoryError('closed', 'project memory is not available'))
    const pending = Promise.resolve().then(() => operation(runtime))
    runtime.pending.add(pending)
    void pending.then(() => runtime.pending.delete(pending), () => runtime.pending.delete(pending))
    return pending
  }
}

export default LocalProjectMemory
