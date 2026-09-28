import { createHash, randomUUID } from 'node:crypto'
import type { Domain, DomainFacility, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { PlanningError, planningBoardSchema, planningCommandSchema } from '@changanhua/dsh-planning'
import type {
  LinkDeliveryHandoffInput,
  PlanningActor,
  PlanningBoardRecord,
  PlanningBoardSnapshot,
  PlanningCommand,
  PlanningHandoff,
  PlanningMutationResult,
  PrepareDeliveryHandoffInput,
} from '@changanhua/dsh-planning/types'
import { planningLocalDomain } from './spec.ts'

export interface PlanningLimits {
  readonly maxItems: number
  readonly maxRevisions: number
  readonly maxReceipts: number
  readonly maxBytes: number
}
const defaults: PlanningLimits = { maxItems: 500, maxRevisions: 100, maxReceipts: 500, maxBytes: 2 * 1024 * 1024 }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const empty = (workspaceId: string): PlanningBoardRecord => ({
  workspaceId,
  version: 0,
  items: [],
  lanes: { inbox: [], now: [], next: [], later: [], parking: [] },
  dependencies: {},
  reviews: [],
  proposals: [],
  receipts: [],
  handoffs: [],
  events: [],
})
/** One Board record is the sole atomic mutation unit for a workspace. */
export class PlanningStore {
  private readonly boards: KvTable<string, PlanningBoardRecord>
  private closing?: Promise<void>
  private tail: Promise<void> = Promise.resolve()
  private constructor(
    private readonly domain: Domain<typeof planningLocalDomain>,
    private readonly limits: PlanningLimits,
  ) {
    this.boards = domain.table('boards')
  }
  static async open(facility: DomainFacility, limits: Partial<PlanningLimits> = {}): Promise<PlanningStore> {
    const resolved = { ...defaults, ...limits }
    for (const value of Object.values(resolved))
      if (!Number.isSafeInteger(value) || value < 1)
        throw new PlanningError('capacity-exceeded', 'planning limits must be positive safe integers')
    return new PlanningStore(await facility.open(planningLocalDomain), resolved)
  }
  snapshot(workspaceId: string): PlanningBoardSnapshot {
    const { receipts: _receipts, ...snapshot } = this.boards.get(workspaceId) ?? empty(workspaceId)
    return structuredClone(snapshot)
  }
  replay(workspaceId: string, command: PlanningCommand): PlanningMutationResult | undefined {
    const parsed = planningCommandSchema.parse(command)
    const receipt = this.boards.get(workspaceId)?.receipts.find(value => value.requestId === parsed.requestId)
    if (receipt === undefined) return undefined
    if (receipt.digest !== digest(parsed))
      throw new PlanningError('idempotency-conflict', 'request id already names different input')
    return structuredClone(receipt.result)
  }
  async prepareHandoff(
    workspaceId: string,
    actor: PlanningActor,
    input: PrepareDeliveryHandoffInput,
    authorize: () => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<PlanningHandoff> {
    return this.enqueue(async () => {
      await authorize()
      signal?.throwIfAborted()
      const current = this.boards.get(workspaceId) ?? empty(workspaceId)
      const existing = current.handoffs.find(value => value.key === input.key)
      if (existing !== undefined) {
        if (
          existing.itemId !== input.itemId ||
          existing.revisionId !== input.expectedRevisionId ||
          existing.repositoryId !== input.repositoryId ||
          existing.operatorId !== input.operatorId ||
          existing.deliveryRequestDigest !== input.deliveryRequestDigest
        ) {
          throw new PlanningError('idempotency-conflict', 'handoff key already names different input')
        }
        return structuredClone(existing)
      }
      if (
        current.handoffs.some(
          value =>
            value.itemId === input.itemId &&
            value.revisionId === input.expectedRevisionId &&
            value.repositoryId === input.repositoryId,
        )
      ) {
        throw new PlanningError('conflict', 'revision already has a handoff')
      }
      const item = current.items.find(value => value.id === input.itemId)
      if (item === undefined || item.headRevisionId !== input.expectedRevisionId) {
        throw new PlanningError('conflict', 'handoff needs the current exact revision')
      }
      if (item.disposition !== 'active')
        throw new PlanningError('conflict', 'archived plans cannot begin an execution handoff')
      const revision = item.revisions.find(value => value.id === input.expectedRevisionId)
      if (revision === undefined) throw new PlanningError('conflict', 'handoff needs the current exact revision')
      const at = new Date().toISOString()
      const source = {
        title: revision.title,
        intent: revision.intent,
        scope: revision.scope,
        acceptance: revision.acceptance,
        sources: revision.sources,
      }
      const handoff: PlanningHandoff = {
        itemId: item.id,
        revisionId: revision.id,
        repositoryId: input.repositoryId,
        key: input.key,
        mapperVersion: input.mapperVersion,
        operatorId: input.operatorId,

        source,
        sourceDigest: digest(source),
        deliveryRequestDigest: input.deliveryRequestDigest,

        phase: 'prepared',
        preparedAt: at,
      }
      const next = structuredClone(current)
      next.version++
      next.handoffs.push(handoff)
      next.events.push({
        id: `plan-event-${randomUUID()}`,
        kind: 'handoff-prepared',
        itemId: item.id,
        revisionId: revision.id,
        at,
        actorId: actor.id,
        actor,
      })
      await this.commitHandoffBoard(workspaceId, next, signal)
      return structuredClone(handoff)
    })
  }

  async linkHandoff(
    workspaceId: string,
    actor: PlanningActor,
    input: LinkDeliveryHandoffInput,
    authorize: () => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<PlanningHandoff> {
    return this.enqueue(async () => {
      await authorize()
      signal?.throwIfAborted()
      const current = this.boards.get(workspaceId)
      const handoff = current?.handoffs.find(value => value.key === input.key)
      if (current === undefined || handoff === undefined) {
        throw new PlanningError('not-found', 'prepared handoff is unavailable')
      }
      if (handoff.phase === 'linked') {
        if (handoff.caseId !== input.caseId || handoff.contractRevisionId !== input.contractRevisionId) {
          throw new PlanningError('idempotency-conflict', 'handoff already links different delivery targets')
        }
        return structuredClone(handoff)
      }
      const at = new Date().toISOString()
      const linked: PlanningHandoff = {
        ...handoff,
        phase: 'linked',
        caseId: input.caseId,
        contractRevisionId: input.contractRevisionId,
        linkedAt: at,
      }
      const next = structuredClone(current)
      next.version++
      next.handoffs[next.handoffs.findIndex(value => value.key === input.key)] = linked
      next.events.push({
        id: `plan-event-${randomUUID()}`,
        kind: 'handoff-linked',
        itemId: linked.itemId,
        revisionId: linked.revisionId,
        at,
        actorId: actor.id,
        actor,
      })
      await this.commitHandoffBoard(workspaceId, next, signal)
      return structuredClone(linked)
    })
  }

  /** Called only inside the Store write queue, after authorization and exact handoff checks. */
  private async commitHandoffBoard(
    workspaceId: string,
    next: PlanningBoardRecord,
    signal?: AbortSignal,
  ): Promise<void> {
    if (Buffer.byteLength(JSON.stringify(next), 'utf8') > this.limits.maxBytes) {
      throw new PlanningError('capacity-exceeded', 'planning board capacity reached')
    }
    const parsed = planningBoardSchema.parse(next)
    signal?.throwIfAborted()
    if (this.boards.get(workspaceId) === undefined) await this.boards.put(workspaceId, parsed)
    else
      await this.boards.update(workspaceId, () => {
        signal?.throwIfAborted()
        return parsed
      })
  }
  async execute(
    workspaceId: string,
    actor: PlanningActor | string,
    command: PlanningCommand,
    sources: PlanningBoardRecord['items'][number]['revisions'][number]['sources'],
    authorize: () => void | Promise<void> = () => {},
    signal?: AbortSignal,
  ): Promise<PlanningMutationResult> {
    return this.enqueue(async () =>
      this.executeNow(
        workspaceId,
        typeof actor === 'string' ? { kind: 'human', id: actor } : actor,
        command,
        sources,
        authorize,
        signal,
      ),
    )
  }
  private async executeNow(
    workspaceId: string,
    actor: PlanningActor,
    command: PlanningCommand,
    sources: PlanningBoardRecord['items'][number]['revisions'][number]['sources'],
    authorize: () => void | Promise<void>,
    signal?: AbortSignal,
  ): Promise<PlanningMutationResult> {
    const parsed = planningCommandSchema.parse(command)
    signal?.throwIfAborted()
    const mutate = (current: PlanningBoardRecord): PlanningBoardRecord => {
      const inputDigest = digest(parsed)
      const receipt = current.receipts.find(value => value.requestId === parsed.requestId)
      if (receipt !== undefined) {
        if (receipt.digest !== inputDigest)
          throw new PlanningError('idempotency-conflict', 'request id already names different input')
        return current
      }
      if (current.version !== parsed.expectedBoardVersion)
        throw new PlanningError('conflict', 'board version changed; read again')
      if (current.receipts.length >= this.limits.maxReceipts)
        throw new PlanningError('capacity-exceeded', 'planning receipt limit reached')
      const next = structuredClone(current)
      const at = new Date().toISOString()
      let result: PlanningMutationResult = { boardVersion: current.version + 1 }
      const item = (itemId: string) => {
        const found = next.items.find((value: PlanningBoardRecord['items'][number]) => value.id === itemId)
        if (!found) throw new PlanningError('not-found', 'planning item is not in this Board')
        return found
      }
      const remove = (itemId: string) => {
        for (const lane of Object.values(next.lanes)) {
          const index = lane.indexOf(itemId)
          if (index >= 0) lane.splice(index, 1)
        }
      }
      if (parsed.kind === 'create') {
        if (next.items.length >= this.limits.maxItems)
          throw new PlanningError('capacity-exceeded', 'planning item limit reached')
        const itemId = parsed.itemId ?? `plan-${randomUUID()}`
        if (next.items.some(value => value.id === itemId))
          throw new PlanningError('invalid-reference', 'new planning item id already exists')
        const revisionId = `plan-revision-${randomUUID()}`
        next.items.push({
          id: itemId,
          headRevisionId: revisionId,
          disposition: 'active',
          createdAt: at,
          revisions: [
            {
              id: revisionId,
              previousRevisionId: null,
              title: parsed.title,
              intent: parsed.intent,
              scope: parsed.scope,
              acceptance: parsed.acceptance,
              sources,
              estimate: parsed.estimate,
              reviewAt: parsed.reviewAt,
              actorId: actor.id,
              actor,
              createdAt: at,
            },
          ],
        })
        if (parsed.fromReviewId !== undefined) {
          const review = next.reviews.find(value => value.id === parsed.fromReviewId)
          if (!review) throw new PlanningError('not-found', 'review is not in this Board')
          if (!review.followUpItemIds.includes(itemId)) review.followUpItemIds.push(itemId)
          result = { boardVersion: next.version + 1, itemId, revisionId, reviewId: review.id }
        }
        next.lanes[parsed.lane].push(itemId)
        if (parsed.fromReviewId === undefined) result = { boardVersion: next.version + 1, itemId, revisionId }
      } else if (parsed.kind === 'revise') {
        const found = item(parsed.itemId)
        if (found.headRevisionId !== parsed.expectedRevisionId)
          throw new PlanningError('conflict', 'planning revision changed; read again')
        if (found.revisions.length >= this.limits.maxRevisions)
          throw new PlanningError('capacity-exceeded', 'planning revision limit reached')
        const revisionId = `plan-revision-${randomUUID()}`
        found.revisions.push({
          id: revisionId,
          previousRevisionId: found.headRevisionId,
          title: parsed.title,
          intent: parsed.intent,
          scope: parsed.scope,
          acceptance: parsed.acceptance,
          sources,
          estimate: parsed.estimate,
          reviewAt: parsed.reviewAt,
          actorId: actor.id,
          actor,
          createdAt: at,
        })
        found.headRevisionId = revisionId
        result = { boardVersion: next.version + 1, itemId: found.id, revisionId }
      } else if (parsed.kind === 'move') {
        item(parsed.itemId)
        if (parsed.beforeItemId !== null && !next.lanes[parsed.lane].includes(parsed.beforeItemId))
          throw new PlanningError('invalid-reference', 'before item is not in target lane')
        remove(parsed.itemId)
        const lane = next.lanes[parsed.lane]
        const index = parsed.beforeItemId === null ? lane.length : lane.indexOf(parsed.beforeItemId)
        lane.splice(index, 0, parsed.itemId)
        result = { boardVersion: next.version + 1, itemId: parsed.itemId }
      } else if (parsed.kind === 'dependencies') {
        item(parsed.itemId)
        for (const dep of parsed.dependsOnItemIds) {
          item(dep)
          if (dep === parsed.itemId)
            throw new PlanningError('invalid-reference', 'a planning item cannot depend on itself')
        }
        next.dependencies[parsed.itemId] = [...new Set(parsed.dependsOnItemIds)]
        if (hasCycle(next.dependencies))
          throw new PlanningError('invalid-reference', 'planning dependencies cannot contain a cycle')
        result = { boardVersion: next.version + 1, itemId: parsed.itemId }
      } else if (parsed.kind === 'archive') {
        item(parsed.itemId).disposition = 'archived'
        remove(parsed.itemId)
        result = { boardVersion: next.version + 1, itemId: parsed.itemId }
      } else if (parsed.kind === 'review') {
        const found = item(parsed.itemId)
        if (!found.revisions.some(revision => revision.id === parsed.expectedRevisionId))
          throw new PlanningError('not-found', 'planning revision is not in this item')
        const followUpItemIds = [...new Set(parsed.followUpItemIds)]
        for (const followUpItemId of followUpItemIds) {
          item(followUpItemId)
          if (followUpItemId === found.id)
            throw new PlanningError('invalid-reference', 'a review cannot follow up its own item')
        }
        const reviewId = `plan-review-${randomUUID()}`
        next.reviews.push({
          id: reviewId,
          itemId: found.id,
          revisionId: parsed.expectedRevisionId,
          outcome: parsed.outcome,
          summary: parsed.summary,
          lessons: parsed.lessons,
          followUpItemIds,
          acceptanceRef: parsed.acceptanceRef,
          createdAt: at,
        })
        result = { boardVersion: next.version + 1, itemId: found.id, revisionId: parsed.expectedRevisionId, reviewId }
      } else if (parsed.kind === 'propose') {
        const existingProposal = next.proposals.find(value => value.id === parsed.proposalId)
        if (existingProposal === undefined) {
          if (
            parsed.expectedProposalVersion !== null ||
            (parsed.targetItemId === null) !== (parsed.baseRevisionId === null)
          )
            throw new PlanningError('conflict', 'proposal creation has an invalid base')
          if (parsed.targetItemId !== null && item(parsed.targetItemId).headRevisionId !== parsed.baseRevisionId)
            throw new PlanningError('conflict', 'proposal base revision changed')
          if (next.proposals.length >= this.limits.maxItems)
            throw new PlanningError('capacity-exceeded', 'planning proposal limit reached')
          if (parsed.fromReviewId !== undefined && parsed.targetItemId !== null)
            throw new PlanningError('invalid-reference', 'review follow-up proposals must create new items')
          if (parsed.fromReviewId !== undefined && !next.reviews.some(value => value.id === parsed.fromReviewId))
            throw new PlanningError('not-found', 'review is not in this Board')
          next.proposals.push({
            id: parsed.proposalId,
            targetItemId: parsed.targetItemId,
            ...(parsed.fromReviewId === undefined ? {} : { fromReviewId: parsed.fromReviewId }),
            status: 'pending',
            headVersion: 1,
            createdAt: at,
            generations: [
              {
                version: 1,
                previousVersion: null,
                baseRevisionId: parsed.baseRevisionId,
                draft: { ...parsed.draft, sources },
                suggestedLane: parsed.suggestedLane,
                assumptions: parsed.assumptions,
                actor,
                createdAt: at,
              },
            ],
          })
          result = { boardVersion: next.version + 1, proposalId: parsed.proposalId, proposalVersion: 1 }
        } else {
          if (
            existingProposal.status !== 'pending' ||
            parsed.expectedProposalVersion !== existingProposal.headVersion ||
            existingProposal.targetItemId !== parsed.targetItemId ||
            existingProposal.fromReviewId !== parsed.fromReviewId ||
            (parsed.targetItemId === null) !== (parsed.baseRevisionId === null) ||
            (parsed.targetItemId !== null && item(parsed.targetItemId).headRevisionId !== parsed.baseRevisionId)
          )
            throw new PlanningError('conflict', 'proposal changed; read again')
          if (existingProposal.generations.length >= this.limits.maxRevisions)
            throw new PlanningError('capacity-exceeded', 'planning proposal generation limit reached')
          const version = existingProposal.headVersion + 1
          existingProposal.generations.push({
            version,
            previousVersion: existingProposal.headVersion,
            baseRevisionId: parsed.baseRevisionId,
            draft: { ...parsed.draft, sources },
            suggestedLane: parsed.suggestedLane,
            assumptions: parsed.assumptions,
            actor,
            createdAt: at,
          })
          existingProposal.headVersion = version
          result = { boardVersion: next.version + 1, proposalId: existingProposal.id, proposalVersion: version }
        }
      } else if (parsed.kind === 'dismiss-proposal') {
        const proposal = next.proposals.find(value => value.id === parsed.proposalId)
        if (!proposal || proposal.status !== 'pending' || proposal.headVersion !== parsed.expectedProposalVersion)
          throw new PlanningError('conflict', 'proposal changed; read again')
        proposal.status = 'dismissed'
        proposal.settlement = { actor, at }
        result = { boardVersion: next.version + 1, proposalId: proposal.id, proposalVersion: proposal.headVersion }
      } else if (parsed.kind === 'accept-proposal') {
        const proposal = next.proposals.find(value => value.id === parsed.proposalId)
        if (!proposal || proposal.status !== 'pending' || proposal.headVersion !== parsed.expectedProposalVersion)
          throw new PlanningError('conflict', 'proposal changed; read again')
        const generation = proposal.generations.at(-1)
        if (generation === undefined) throw new PlanningError('conflict', 'proposal has no generation')
        if (proposal.targetItemId !== null) {
          const found = item(proposal.targetItemId)
          if (found.headRevisionId !== generation.baseRevisionId)
            throw new PlanningError('conflict', 'proposal base revision changed')
          if (found.revisions.length >= this.limits.maxRevisions)
            throw new PlanningError('capacity-exceeded', 'planning revision limit reached')
          const revisionId = `plan-revision-${randomUUID()}`
          found.revisions.push({
            id: revisionId,
            previousRevisionId: found.headRevisionId,
            ...generation.draft,
            actorId: actor.id,
            actor,
            createdAt: at,
          })
          found.headRevisionId = revisionId
          proposal.status = 'accepted'
          proposal.settlement = { actor, at, itemId: found.id, revisionId }
          result = {
            boardVersion: next.version + 1,
            itemId: found.id,
            revisionId,
            proposalId: proposal.id,
            proposalVersion: proposal.headVersion,
          }
        } else {
          if (next.items.length >= this.limits.maxItems)
            throw new PlanningError('capacity-exceeded', 'planning item limit reached')
          const itemId = `plan-${randomUUID()}`
          const revisionId = `plan-revision-${randomUUID()}`
          next.items.push({
            id: itemId,
            headRevisionId: revisionId,
            disposition: 'active',
            createdAt: at,
            revisions: [
              {
                id: revisionId,
                previousRevisionId: null,
                ...generation.draft,
                actorId: actor.id,
                actor,
                createdAt: at,
              },
            ],
          })
          const review =
            proposal.fromReviewId === undefined
              ? undefined
              : next.reviews.find(value => value.id === proposal.fromReviewId)
          if (proposal.fromReviewId !== undefined && review === undefined)
            throw new PlanningError('not-found', 'review is not in this Board')
          if (review !== undefined && !review.followUpItemIds.includes(itemId)) review.followUpItemIds.push(itemId)
          next.lanes[generation.suggestedLane].push(itemId)
          proposal.status = 'accepted'
          proposal.settlement = { actor, at, itemId, revisionId }
          result = {
            boardVersion: next.version + 1,
            itemId,
            revisionId,
            proposalId: proposal.id,
            proposalVersion: proposal.headVersion,
            ...(review === undefined ? {} : { reviewId: review.id }),
          }
        }
      } else {
        const review = next.reviews.find(
          (value: PlanningBoardRecord['reviews'][number]) => value.id === parsed.reviewId,
        )
        if (!review) throw new PlanningError('not-found', 'planning review is not in this Board')
        item(parsed.itemId)
        if (review.itemId === parsed.itemId)
          throw new PlanningError('invalid-reference', 'a review cannot follow up its own item')
        if (!review.followUpItemIds.includes(parsed.itemId)) review.followUpItemIds.push(parsed.itemId)
        result = { boardVersion: next.version + 1, itemId: parsed.itemId, reviewId: review.id }
      }
      const eventKind =
        parsed.kind === 'create'
          ? 'created'
          : parsed.kind === 'revise'
            ? 'revised'
            : parsed.kind === 'move'
              ? 'moved'
              : parsed.kind === 'dependencies'
                ? 'dependencies-changed'
                : parsed.kind === 'archive'
                  ? 'archived'
                  : parsed.kind === 'review'
                    ? 'reviewed'
                    : parsed.kind === 'propose'
                      ? 'proposed'
                      : parsed.kind === 'accept-proposal'
                        ? 'proposal-accepted'
                        : parsed.kind === 'dismiss-proposal'
                          ? 'proposal-dismissed'
                          : 'follow-up-linked'
      next.events.push({
        id: `plan-event-${randomUUID()}`,
        kind: eventKind,
        at,
        actorId: actor.id,
        actor,
        ...(result.itemId === undefined ? {} : { itemId: result.itemId }),
        ...(result.revisionId === undefined ? {} : { revisionId: result.revisionId }),
        ...(result.reviewId === undefined ? {} : { reviewId: result.reviewId }),
        ...(result.proposalId === undefined ? {} : { proposalId: result.proposalId }),
      })
      next.version++
      next.receipts.push({ requestId: parsed.requestId, digest: inputDigest, result, at })
      if (Buffer.byteLength(JSON.stringify(next), 'utf8') > this.limits.maxBytes)
        throw new PlanningError('capacity-exceeded', 'planning board capacity reached')
      return planningBoardSchema.parse(next)
    }
    const existing = this.boards.get(workspaceId)
    let committed: PlanningBoardRecord
    await authorize()
    signal?.throwIfAborted()
    if (existing === undefined) {
      const candidate = mutate(empty(workspaceId))
      await this.boards.put(workspaceId, candidate)
      committed = candidate
    } else
      committed = await this.boards.update(workspaceId, (value) => {
        signal?.throwIfAborted()
        return mutate(value)
      })
    const receipt = committed.receipts.find(
      (value: PlanningBoardRecord['receipts'][number]) => value.requestId === parsed.requestId,
    )
    if (receipt === undefined) throw new PlanningError('conflict', 'committed receipt is unavailable')
    return structuredClone(receipt.result)
  }
  close(): Promise<void> {
    return (this.closing ??= this.tail.then(() => this.domain.close()))
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing !== undefined) return Promise.reject(new PlanningError('closed', 'planning Board is closing'))
    const pending = this.tail.then(operation)
    this.tail = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
  }
}
function hasCycle(dependencies: Record<string, readonly string[]>): boolean {
  const active = new Set<string>()
  const done = new Set<string>()
  const visit = (id: string): boolean => {
    if (active.has(id)) return true
    if (done.has(id)) return false
    active.add(id)
    for (const next of dependencies[id] ?? []) if (visit(next)) return true
    active.delete(id)
    done.add(id)
    return false
  }
  return Object.keys(dependencies).some(visit)
}
