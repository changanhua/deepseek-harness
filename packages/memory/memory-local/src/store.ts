/** Atomic memory records and idempotent mutations; authority is enforced by the Provider. @module @changanhua/dsh-memory-local/store */
import { createHash } from 'node:crypto'
import type { Domain, DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { canonicalMemoryJson, MemoryError, memoryProposalSchema, memoryRecordSchema, memorySourceSchema } from '@changanhua/dsh-memory'
import type { MemoryDecision, MemoryDecisionRequest, MemoryMutation, MemoryProposal, MemoryReceipt, MemoryRecord, MemorySource } from '@changanhua/dsh-memory'
import { projectMemoryDomain } from './spec.ts'

interface StoreLimits {
  readonly maxRecordsPerWorkspace: number
  readonly maxRevisions: number
  readonly maxReceipts: number
}

const DEFAULT_LIMITS: StoreLimits = { maxRecordsPerWorkspace: 500, maxRevisions: 50, maxReceipts: 200 }
const digestOf = (value: unknown): string => createHash('sha256').update(canonicalMemoryJson(value)).digest('hex')

/** One Domain owns the record table; every mutation includes its replay receipt. */
export class MemoryStore {
  private readonly table: KvTable<string, MemoryRecord>
  private tail: Promise<unknown> = Promise.resolve()
  private closing?: Promise<void>

  private constructor(private readonly domain: Domain<typeof projectMemoryDomain>, private readonly limits: StoreLimits) {
    this.table = domain.table('memories')
  }

  /**
   * Open and validate a domain; the caller owns cross-process exclusion.
   * @param facility - Composed Storage Domain facility for the local memory domain.
   * @param limits - Optional reductions to supported record, revision, and receipt capacities.
   * @returns An opened store after validating persisted record identities.
   */
  static async open(facility: DomainFacility, limits: Partial<StoreLimits> = {}): Promise<MemoryStore> {
    const resolved = { ...DEFAULT_LIMITS, ...limits }
    for (const key of Object.keys(DEFAULT_LIMITS) as Array<keyof StoreLimits>) {
      if (!Number.isSafeInteger(resolved[key]) || resolved[key] < 1 || resolved[key] > DEFAULT_LIMITS[key]) {
        throw new MemoryError('invalid-input', `memory ${key} is outside its supported range`)
      }
    }
    const domain = await facility.open(projectMemoryDomain)
    try {
      const store = new MemoryStore(domain, resolved)
      for (const [key, record] of store.table.entries()) {
        if (key !== record.id) throw new MemoryError('invalid-input', 'memory key differs from the stored identity')
      }
      return store
    } catch (error) {
      await domain.close()
      throw error
    }
  }

  /**
   * Return detached project records; consumers cannot mutate persistence through a view.
   * @param workspaceId - Authorized Workspace identity.
   * @returns Detached copies of all records owned by that Workspace.
   */
  list(workspaceId: string): MemoryRecord[] {
    this.assertOpen()
    return [...this.table.entries()].filter(([, record]) => record.workspaceId === workspaceId).map(([, record]) => structuredClone(record))
  }

  /**
   * Foreign and absent identities have the same lookup result.
   * @param workspaceId - Authorized Workspace identity.
   * @param id - Opaque memory identity to look up.
   * @returns A detached owned record, or undefined for absent and foreign identities.
   */
  get(workspaceId: string, id: string): MemoryRecord | undefined {
    this.assertOpen()
    const value = this.owned(workspaceId, id)
    return value === undefined ? undefined : structuredClone(value)
  }

  /**
   * Replay admission before reading mutable sources again.
   * @param workspaceId - Authorized Workspace identity.
   * @param input - Proposal whose idempotency key and complete admitted input must match.
   * @returns The original mutation result, or undefined when no receipt exists; conflicting reuse throws.
   */
  replayProposal(workspaceId: string, input: MemoryProposal): MemoryMutation | undefined {
    this.assertOpen()
    const parsed = memoryProposalSchema.parse(input)
    const id = this.proposalId(workspaceId, parsed)
    const record = this.owned(workspaceId, id)
    return this.replay(record, `propose:${parsed.idempotencyKey}`, digestOf(parsed))
  }

  /**
   * Capture has finished before this operation; the Provider supplies validated source observations.
   * @param workspaceId - Authorized Workspace that owns the candidate.
   * @param sessionId - Live proposing Session identity for immutable provenance.
   * @param input - Validated proposal with a stable idempotency key and optional version fence.
   * @param sources - Provider-captured fingerprints matching the proposal locators.
   * @param at - UTC timestamp stored with the revision and receipt.
   * @param signal - Optional cancellation checked before mutation and within an update.
   * @returns The committed or replayed identity, record version, and content revision.
   */
  async propose(
    workspaceId: string, sessionId: string, input: MemoryProposal,
    sources: readonly MemorySource[], at: string, signal?: AbortSignal,
  ): Promise<MemoryMutation> {
    const parsed = memoryProposalSchema.parse(input)
    const captured = sources.map(source => memorySourceSchema.parse(source))
    const locators = captured.map((source) => {
      if (source.kind === 'session-event') return { kind: source.kind, sessionId: source.sessionId, seq: source.seq }
      return { kind: source.kind, path: source.path, ...source.line === undefined ? {} : { line: source.line } }
    })
    if (canonicalMemoryJson(locators) !== canonicalMemoryJson(parsed.sources)) throw new MemoryError('invalid-input', 'captured sources differ from the proposal')
    return this.enqueue(async () => {
      signal?.throwIfAborted()
      const id = this.proposalId(workspaceId, parsed)
      const current = this.owned(workspaceId, id)
      const key = `propose:${parsed.idempotencyKey}`
      const digest = digestOf(parsed)
      const replay = this.replay(current, key, digest)
      if (replay !== undefined) return replay
      if (parsed.memoryId !== undefined && current === undefined) throw new MemoryError('not-found', 'memory is not available in this workspace')
      if (current !== undefined && parsed.expectedVersion !== current.recordVersion) throw new MemoryError('version-conflict', 'memory changed; read the current version')
      if (current?.topicKey !== undefined && current.topicKey !== parsed.topicKey) throw new MemoryError('invalid-input', 'a revision cannot change its memory topic')
      if (current?.candidateRevision != null) throw new MemoryError('candidate-pending', 'review the existing candidate before proposing another')
      if ((current?.receipts.length ?? 0) >= this.limits.maxReceipts) throw new MemoryError('capacity-exceeded', 'memory receipt limit reached')
      const projectSize = [...this.table.entries()].filter(([, value]) => value.workspaceId === workspaceId).length
      if (current === undefined && projectSize >= this.limits.maxRecordsPerWorkspace) {
        throw new MemoryError('capacity-exceeded', 'project memory record limit reached')
      }
      const revision = (current?.revisions.length ?? 0) + 1
      if (revision > this.limits.maxRevisions) throw new MemoryError('capacity-exceeded', 'memory revision limit reached')
      const result = { id, recordVersion: (current?.recordVersion ?? 0) + 1, revision }
      const receipt: MemoryReceipt = { key, digest, operation: 'propose', result, at }
      const next = memoryRecordSchema.parse({
        id, workspaceId, recordVersion: result.recordVersion, topicKey: parsed.topicKey,
        activeRevision: current?.activeRevision ?? null, candidateRevision: revision,
        revisions: [...current?.revisions ?? [], {
          revision, kind: parsed.kind, title: parsed.title, statement: parsed.statement,
          tags: parsed.tags, conditions: parsed.conditions, sources: captured, createdBy: sessionId, createdAt: at,
        }],
        decisions: current?.decisions ?? [], receipts: [...current?.receipts ?? [], receipt],
      })
      await this.commit(current, next, signal)
      return structuredClone(result)
    })
  }

  /**
   * Persist an already-authorized command decision and its receipt in one write.
   * @param workspaceId - Authorized Workspace that owns the record.
   * @param sessionId - Human command's live Session identity.
   * @param request - Authorized exact-revision decision with command identity and version fence.
   * @param at - UTC decision timestamp; acceptance requires a later review deadline.
   * @param signal - Optional cancellation checked before mutation and within an update.
   * @returns The committed or replayed identity, record version, and content revision.
   */
  async decide(
    workspaceId: string, sessionId: string, request: MemoryDecisionRequest, at: string, signal?: AbortSignal,
  ): Promise<MemoryMutation> {
    return this.enqueue(async () => {
      signal?.throwIfAborted()
      const current = this.owned(workspaceId, request.id)
      if (current === undefined) throw new MemoryError('not-found', 'memory is not available in this workspace')
      const key = `command:${request.commandId}`
      const digest = digestOf({ sessionId, ...request })
      const replay = this.replay(current, key, digest)
      if (replay !== undefined) return replay
      if (request.expectedVersion !== current.recordVersion) throw new MemoryError('version-conflict', 'memory changed; review it again')
      if (current.receipts.length >= this.limits.maxReceipts) throw new MemoryError('capacity-exceeded', 'memory receipt limit reached')
      let activeRevision = current.activeRevision
      let candidateRevision = current.candidateRevision
      switch (request.action) {
        case 'accept':
          if (request.revision !== candidateRevision && request.revision !== activeRevision) throw new MemoryError('invalid-transition', 'acceptance needs a candidate or active revision')
          if (request.reviewAfter === undefined || !Number.isFinite(Date.parse(request.reviewAfter)) || Date.parse(request.reviewAfter) <= Date.parse(at)) throw new MemoryError('invalid-input', 'acceptance requires a future review date')
          activeRevision = request.revision
          if (candidateRevision === request.revision) candidateRevision = null
          break
        case 'reject':
          if (request.revision !== candidateRevision) throw new MemoryError('invalid-transition', 'rejection needs a pending candidate')
          candidateRevision = null
          break
        case 'retire':
          if (request.revision !== activeRevision) throw new MemoryError('invalid-transition', 'retirement needs an active revision')
          activeRevision = null
          break
        default: throw new MemoryError('invalid-input', 'unknown memory decision')
      }
      const result = { id: current.id, recordVersion: current.recordVersion + 1, revision: request.revision }
      const decision: MemoryDecision = {
        action: request.action, revision: request.revision, commandId: request.commandId, sessionId, at,
        ...request.reviewAfter === undefined ? {} : { reviewAfter: request.reviewAfter },
      }
      const next = memoryRecordSchema.parse({
        ...current, recordVersion: result.recordVersion, activeRevision, candidateRevision,
        decisions: [...current.decisions, decision],
        receipts: [...current.receipts, { key, digest, operation: request.action, result, at }],
      })
      await this.commit(current, next, signal)
      return structuredClone(result)
    })
  }

  /** Refuse new operations, then drain admitted writes before closing persistence. */
  close(): Promise<void> {
    return this.closing ??= this.tail.then(() => this.domain.close())
  }

  private assertOpen(): void {
    if (this.closing !== undefined) throw new MemoryError('closed', 'project memory is closing')
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen()
    const pending = this.tail.then(operation)
    this.tail = pending.then(() => undefined, () => undefined)
    return pending
  }

  private owned(workspaceId: string, id: string): MemoryRecord | undefined {
    const value = this.table.get(id)
    return value?.workspaceId === workspaceId ? value : undefined
  }

  private proposalId(workspaceId: string, input: MemoryProposal): string {
    return input.memoryId ?? `mem-${digestOf({ workspaceId, idempotencyKey: input.idempotencyKey })}`
  }

  private replay(record: MemoryRecord | undefined, key: string, digest: string): MemoryMutation | undefined {
    const receipt = record?.receipts.find(item => item.key === key)
    if (receipt === undefined) return undefined
    if (receipt.digest !== digest) throw new MemoryError('idempotency-conflict', 'memory operation key already names different input')
    return structuredClone(receipt.result)
  }

  private async commit(current: MemoryRecord | undefined, next: MemoryRecord, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (current === undefined) {
      await this.table.put(next.id, next)
    } else {
      await this.table.update(next.id, (value) => {
        signal?.throwIfAborted()
        if (value.workspaceId !== next.workspaceId || value.recordVersion !== current.recordVersion) throw new MemoryError('version-conflict', 'memory changed before commit')
        return next
      })
    }
  }
}
