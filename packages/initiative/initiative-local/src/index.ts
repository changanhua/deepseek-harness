import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createHash, randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import Initiative, { CandidateId, InitiativeError, initiativeCommandSchema, initiativeQuerySchema } from '@changanhua/dsh-initiative'
import type { InitiativeCandidate, InitiativeCommand, InitiativeInvocation, InitiativePage, InitiativeQuery, InitiativeReceipt, InitiativeView } from '@changanhua/dsh-initiative'
import { initiativeScope } from './scope.ts'
import { initiativeDomain, workspaceCandidatesSchema } from './spec.ts'
import { acquireInitiativeOwnership } from './ownership.ts'
import { promoteCandidate } from './promotion.ts'
import type {} from '@changanhua/dsh-planning'

/** Local single-Host Candidate provider configuration. */
export interface Config {
  /** Absolute local ownership directory, shared by all Hosts using this Candidate storage root. */
  ownershipRoot: string
  /** Stable Host-configured human operator identity; never accepted from command JSON. */
  operatorId: string
  /** Maximum complete serialized Workspace record, including receipts and history. */
  maxWorkspaceBytes?: number
  /** Maximum complete single-revision read view; keep consumer output limits above this bound. */
  maxCandidateViewBytes?: number
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const receipt = (candidate: InitiativeCandidate): InitiativeReceipt => ({
  id: candidate.id, recordVersion: candidate.recordVersion, headVersion: candidate.headVersion, status: candidate.status,
  ...(candidate.promotion?.phase === 'linked' ? { proposalId: candidate.promotion.proposalId } : {}),
})

/** Durable Candidate owner; investigations only record facts and never execute work. */
export class LocalInitiative extends Initiative {
  static inject = ['storageDomain', 'workspaceRegistry', 'agents', 'sessions']
  static Config: z<Config, Required<Config>> = z.object({
    ownershipRoot: z.string().required(), operatorId: z.string().required(),
    maxCandidateViewBytes: z.number().step(1).min(512).max(1024 * 1024).default(48 * 1024),
    maxWorkspaceBytes: z.number().step(1).min(1024).max(64 * 1024 * 1024).default(2 * 1024 * 1024),
  })
  private readonly config: Required<Config>
  private domain?: Domain<typeof initiativeDomain>
  private tail: Promise<unknown> = Promise.resolve()
  private closing = false
  constructor(ctx: Context, config: Config) { super(ctx); this.config = LocalInitiative.Config(config) }
  protected async [Service.init](): Promise<void> {
    const ownership = await acquireInitiativeOwnership(this.config.ownershipRoot)
    try { this.domain = await this.ctx.storageDomain.open(initiativeDomain) }
    catch (error) { await ownership.release(); throw error }
    this.ctx.effect(() => async () => {
      this.closing = true
      await this.tail.catch(() => {}) // Failed operations have already rejected their callers; teardown still drains.
      await this.domain?.close()
      await ownership.release()
    })
  }
  private enqueue<T>(operation: (domain: Domain<typeof initiativeDomain>) => Promise<T>): Promise<T> {
    const domain = this.domain
    if (this.closing || domain === undefined) return Promise.reject(new InitiativeError('unavailable', 'Initiative is closed'))
    const pending = this.tail.then(() => operation(domain), () => operation(domain))
    this.tail = pending
    return pending
  }
  async read(agent: Agent, query: InitiativeQuery, invocation: InitiativeInvocation = {}, signal?: AbortSignal): Promise<InitiativePage> {
    const parsed = initiativeQuerySchema.safeParse(query)
    if (!parsed.success) throw new InitiativeError('invalid-input', 'Invalid Candidate query')
    return this.enqueue(async (domain) => {
      const scope = await initiativeScope(this.ctx, agent, parsed.data, invocation, this.config.operatorId, signal)
      const all = domain.table('workspaces').get(scope.workspaceId)?.candidates ?? []
      const matches = all.filter(value => (parsed.data.id === undefined || value.id === parsed.data.id)
        && (parsed.data.status === undefined || value.status === parsed.data.status)
        && (parsed.data.proposer === undefined || value.proposer.kind === parsed.data.proposer))
      if (parsed.data.id !== undefined && matches.length === 0) throw new InitiativeError('not-found', 'Candidate is unavailable in this Workspace')
      const entries = matches.slice(parsed.data.offset, parsed.data.offset + parsed.data.limit)
        .map(candidate => this.view(candidate, parsed.data.version ?? candidate.headVersion))
      await scope.authorize()
      return structuredClone({ entries, total: matches.length,
        nextOffset: parsed.data.offset + entries.length < matches.length ? parsed.data.offset + entries.length : null })
    })
  }
  private view(candidate: InitiativeCandidate, selected: number): InitiativeView {
    const revision = candidate.revisions.find(value => value.version === selected)
    if (revision === undefined) throw new InitiativeError('not-found', 'Candidate revision is unavailable')
    const { revisions, investigations, dispositions, ...summary } = candidate
    const latestDisposition = dispositions.at(-1)
    return { candidate: summary, revision, revisionCount: revisions.length,
      investigations: investigations.filter(value => value.resultVersion === selected),
      ...(latestDisposition === undefined ? {} : { latestDisposition }),
      drift: selected !== candidate.headVersion, rir: { availability: 'unavailable', assessments: [] } }
  }
  async execute(
    agent: Agent, input: InitiativeCommand, invocation: InitiativeInvocation = {}, signal?: AbortSignal,
  ): Promise<InitiativeReceipt> {
    const parsed = initiativeCommandSchema.safeParse(input)
    if (!parsed.success) throw new InitiativeError('invalid-input', 'Invalid Candidate command; identity and authority cannot be supplied')
    return this.enqueue(async (domain) => {
      const command = parsed.data
      const scope = await initiativeScope(this.ctx, agent, command, invocation, this.config.operatorId, signal)
      if (scope.actor.kind !== 'human' && (command.action === 'promote' || command.action === 'disposition'))
        throw new InitiativeError('unauthorized', 'Only an explicit Human command can settle or promote a Candidate')
      const table = domain.table('workspaces')
      const state = structuredClone(table.get(scope.workspaceId) ?? { candidates: [], receipts: [] })
      const inputDigest = digest({ actor: { kind: scope.actor.kind, id: scope.actor.id }, command })
      const reserved = state.candidates.find(value => value.promotion?.key === command.key)
      if (reserved !== undefined && (command.action !== 'promote' || command.id !== reserved.id || reserved.promotion?.digest !== inputDigest))
        throw new InitiativeError('idempotency-conflict', 'Candidate key is reserved by a prepared promotion')
      const previous = state.receipts.find(value => value.key === command.key)
      if (previous !== undefined) {
        if (previous.digest !== inputDigest) throw new InitiativeError('idempotency-conflict', 'Candidate key already names a different payload or actor')
        return structuredClone(previous.result)
      }
      const save = async () => {
        await scope.authorize()
        const validated = workspaceCandidatesSchema.parse(state)
        const reserved = structuredClone(validated)
        for (const value of reserved.candidates) {
          if (value.promotion?.phase !== 'prepared') continue
          value.promotion.phase = 'linked'
          value.promotion.linkedAt = new Date().toISOString()
          value.status = 'PROMOTED'
          value.recordVersion++
          reserved.receipts.push({ key: value.promotion.key, digest: value.promotion.digest, result: receipt(value) })
        }
        if (Math.max(Buffer.byteLength(JSON.stringify(validated), 'utf8'), Buffer.byteLength(JSON.stringify(reserved), 'utf8')) > this.config.maxWorkspaceBytes)
          throw new InitiativeError('capacity-exceeded', 'Candidate Workspace capacity reached')
        for (const value of reserved.candidates) {
          for (const revision of value.revisions) {
            if (Buffer.byteLength(JSON.stringify(this.view(value, revision.version)), 'utf8') > this.config.maxCandidateViewBytes)
              throw new InitiativeError('capacity-exceeded', 'Candidate revision exceeds the readable view limit; narrow facts or source excerpts')
          }
        }
        await table.put(scope.workspaceId, validated)
      }
      // Retain explicit uncertainty if the Session has no durability listener. Never fabricate durable verification.
      await this.ctx.sessions.flush(agent.session)
      await scope.authorize()
      const at = new Date().toISOString()
      let candidate: InitiativeCandidate
      if (command.action === 'propose') {
        for (const parent of command.parents) if (!state.candidates.some(value => value.id === parent))
          throw new InitiativeError('not-found', 'Parent Candidate is unavailable in this Workspace')
        candidate = {
          id: CandidateId(randomUUID()), workspaceId: scope.workspaceId, kind: command.kind, trigger: command.trigger,
          proposer: scope.actor, createdAt: at, parents: [...new Set(command.parents)], recordVersion: 1, headVersion: 1, status: 'PROPOSED',
          origin: [{ owner: 'session', kind: 'session-event', id: scope.actor.sessionId, revision: String(scope.actor.eventSeq), verification: 'unverified' }, ...command.sourceRefs],
          revisions: [{ version: 1, facts: command.facts, createdBy: scope.actor, createdAt: at }], investigations: [], dispositions: [],
        }
        state.candidates.push(candidate)
      } else {
        const found = state.candidates.find(value => value.id === command.id)
        if (found === undefined) throw new InitiativeError('not-found', 'Candidate is unavailable in this Workspace')
        candidate = found
        const recovering = command.action === 'promote' && candidate.promotion?.key === command.key
        if (recovering) {
          if (candidate.promotion?.digest !== inputDigest) throw new InitiativeError('idempotency-conflict', 'Promotion key already names different input')
        } else {
          if (candidate.promotion !== undefined) throw new InitiativeError('conflict', 'Candidate has an existing promotion; recover its original key')
          if (candidate.recordVersion !== command.expectedRecordVersion || candidate.headVersion !== command.expectedVersion)
            throw new InitiativeError('conflict', 'Candidate changed; read its exact versions before retrying')
        }
        if (command.action === 'investigate') {
          if (!['PROPOSED', 'INVESTIGATING', 'ASSESSABLE'].includes(candidate.status))
            throw new InitiativeError('invalid-transition', 'This Candidate is not open for investigation')
          if (command.completion === 'blocked' && command.blockedReason === undefined)
            throw new InitiativeError('invalid-input', 'Blocked investigation requires its owner-policy reason')
          if (command.completion !== 'blocked' && command.blockedReason !== undefined)
            throw new InitiativeError('invalid-input', 'Blocked reason requires blocked completion')
          const baseVersion = candidate.headVersion
          candidate.headVersion++
          candidate.recordVersion++
          candidate.revisions.push({ version: candidate.headVersion, facts: command.facts, createdBy: scope.actor, createdAt: at })
          candidate.investigations.push({ baseVersion, resultVersion: candidate.headVersion, actor: scope.actor, at,
            completion: command.completion, ...(command.blockedReason === undefined ? {} : { blockedReason: command.blockedReason }),
            ...(command.recommendation === undefined ? {} : { recommendation: command.recommendation }) })
          candidate.status = command.completion === 'complete' ? 'ASSESSABLE' : 'INVESTIGATING'
        } else if (command.action === 'disposition') {
          const legal = command.status === 'INVESTIGATING' ? candidate.status === 'DEFERRED'
            : ['PROPOSED', 'INVESTIGATING', 'ASSESSABLE'].includes(candidate.status)
          if (!legal) throw new InitiativeError('invalid-transition', 'Illegal Human Candidate transition')
          candidate.status = command.status
          candidate.recordVersion++
          candidate.dispositions.push({ status: command.status, rationale: command.rationale, actor: scope.actor, at })
        } else {
          await promoteCandidate(this.ctx, scope, command, inputDigest, candidate, save, signal)
        }
      }
      const result = receipt(candidate)
      state.receipts.push({ key: command.key, digest: inputDigest, result })
      await save()
      return structuredClone(result)
    })
  }
}
export default LocalInitiative
