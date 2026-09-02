/** Deterministic in-memory provider for the Personal Delivery domain. */

/* oxlint-disable typescript/require-await -- keep fake failures on the asynchronous Service contract without artificial I/O */

import { Service, type Context } from '@deepseek-ai/cordis'
import Delivery, {
  DeliveryError,
  DELIVERY_VERIFICATION_SOURCE_MAX_BYTES,
  type AcceptanceCandidateResolver,
  type AcceptanceEvidenceResolver,
  type BeginDispatchRequest,
  type BindDispatchRequest,
  type CompleteIssuePublicationRequest,
  type CreateDeliveryCaseRequest,
  type CreateWorkPacketRequest,
  type DeliverySnapshot,
  type FailIssuePublicationRequest,
  type PrepareIssuePublicationRequest,
  type RecordAcceptanceDecisionRequest,
  type RecordRequirementDecisionRequest,
  type ResolveIssuePublicationRequest,
  type ReviseDeliveryCaseRequest,
  type VerificationSourceResolver,
} from '@deepseek-ai/dsh-delivery'
import {
  AcceptanceDecisionId,
  ContractRevisionId,
  DELIVERY_SCHEMA_VERSION,
  DeliveryCaseId,
  DispatchBindingId,
  IssuePublicationId,
  RequirementDecisionId,
  WorkPacketId,
  acceptanceDecisionFindings,
  acceptanceDecisionSchema,
  canonicalDigest,
  canonicalJson,
  codeVerifyIntentSchema,
  completionClaimEvidenceFindings,
  completionClaimSchema,
  contractReadiness,
  contractRevisionSchema,
  deliveryCaseSchema,
  dispatchBindingSchema,
  evidenceRefSchema,
  gitHubIssueRefSchema,
  issuePublicationSchema,
  issuePublicationIdForRevision,
  nonStartedPublicationFailureSchema,
  parseVerificationPlanDocument,
  requirementDecisionSchema,
  requirementOriginSchema,
  resolveVerificationPlan,
  unknownPublicationFailureSchema,
  verificationVerdictPlanFindings,
  verificationVerdictSchema,
  workPacketDigest,
  workPacketSchema,
  type AcceptanceDecision,
  type CompletionClaim,
  type ContractRevision,
  type DeliveryCase,
  type DispatchBinding,
  type EvidenceRef,
  type IssuePublication,
  type QueueAttemptIdRef,
  type QueueWorkIdRef,
  type RequirementDecision,
  type RequirementOrigin,
  type VerificationPlan,
  type VerificationVerdict,
  type WorkPacket,
} from '@deepseek-ai/dsh-delivery-protocol'

/** Deterministic clock and id hooks for one fake provider. */
export interface FakeDeliveryOptions {
  /** RFC 3339 UTC time used for the next committed record. */
  readonly now?: () => string
  /** Stable raw id allocator keyed by object family and one-based ordinal. */
  readonly allocateId?: (family: string, ordinal: number) => string
}

interface IdempotentRecord {
  readonly operation: string
  readonly digest: string
  readonly resultId: string
  /** Secondary record id for composite results such as a Case and its root revision. */
  readonly relatedId?: string
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

/**
 * In-memory Delivery Service Provider with the same idempotency, reference,
 * readiness, approval, Case-head CAS, publication-state-machine, binding-CAS,
 * and acceptance checks required of durable providers.
 */
export class FakeDelivery extends Delivery {
  private readonly revisions = new Map<string, ContractRevision>()
  private readonly packets = new Map<string, WorkPacket>()
  private readonly bindings = new Map<string, DispatchBinding>()
  private readonly decisions = new Map<string, AcceptanceDecision>()
  private readonly cases = new Map<string, DeliveryCase>()
  private readonly requirementDecisions = new Map<string, RequirementDecision>()
  private readonly publications = new Map<string, IssuePublication>()
  private readonly idempotency = new Map<string, IdempotentRecord>()
  private readonly idempotencyTails = new Map<string, Promise<void>>()
  private readonly counters = new Map<string, number>()
  private readonly now: () => string
  private readonly allocate: (family: string, ordinal: number) => string

  constructor(ctx: Context, options: FakeDeliveryOptions = {}) {
    super(ctx)
    // Test controls intentionally expose the registered concrete fake rather than a per-read trace proxy.
    Object.defineProperty(this, Service.tracker, { value: undefined })
    this.now = options.now ?? (() => '2026-08-29T00:00:00.000Z')
    this.allocate = options.allocateId ?? ((family, ordinal) => `${family}-${String(ordinal)}`)
  }

  async createCase(request: CreateDeliveryCaseRequest): Promise<{ case: DeliveryCase; revision: ContractRevision }> {
    return this.serializeIdempotentWrite(
      request.idempotencyKey,
      () => this.createCaseUnderLock(request),
    )
  }

  private async createCaseUnderLock(
    request: CreateDeliveryCaseRequest,
  ): Promise<{ case: DeliveryCase; revision: ContractRevision }> {
    const prior = this.idempotent('create-delivery-case', request.idempotencyKey, request)
    if (prior !== undefined) {
      return {
        case: this.requireCaseRecord(prior.resultId),
        revision: this.requireRevision(prior.relatedId),
      }
    }
    const revision: ContractRevision = contractRevisionSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id: ContractRevisionId(this.nextId('contract-revision')),
      previousRevisionId: null,
      origin: requirementOriginSchema.parse(clone(request.origin)),
      title: request.title,
      repositoryId: request.repositoryId,
      ...clone(request.revision),
      createdAt: this.now(),
    })
    this.revisions.set(revision.id, revision)
    const at = this.now()
    const kase: DeliveryCase = deliveryCaseSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id: DeliveryCaseId(this.nextId('delivery-case')),
      repositoryId: request.repositoryId,
      headRevisionId: revision.id,
      createdAt: at,
      updatedAt: at,
    })
    this.cases.set(kase.id, kase)
    this.remember('create-delivery-case', request.idempotencyKey, request, kase.id, revision.id)
    return { case: clone(kase), revision: clone(revision) }
  }

  async reviseCase(request: ReviseDeliveryCaseRequest): Promise<{ case: DeliveryCase; revision: ContractRevision }> {
    return this.serializeIdempotentWrite(
      request.idempotencyKey,
      () => this.reviseCaseUnderLock(request),
    )
  }

  private async reviseCaseUnderLock(
    request: ReviseDeliveryCaseRequest,
  ): Promise<{ case: DeliveryCase; revision: ContractRevision }> {
    const prior = this.idempotent('revise-delivery-case', request.idempotencyKey, request)
    if (prior !== undefined) return this.settleReviseCase(request, prior.resultId)
    const located = this.requireCase(request.caseId)
    // The slot-local head equality is the compare-and-set: an expected head
    // that is absent, stale, or already superseded is the same CAS failure.
    if (located.headRevisionId !== request.expectedHeadRevisionId) {
      throw new DeliveryError(
        'conflict',
        `Delivery Case '${request.caseId}' head is not the expected '${request.expectedHeadRevisionId}'`,
      )
    }
    const parent = this.revisions.get(request.expectedHeadRevisionId)
    if (parent === undefined) {
      throw new DeliveryError('not-found', `head Contract revision '${request.expectedHeadRevisionId}' is absent`)
    }
    requireOriginLineage(parent.origin, request.origin)
    const revision: ContractRevision = contractRevisionSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id: ContractRevisionId(this.nextId('contract-revision')),
      previousRevisionId: request.expectedHeadRevisionId,
      origin: requirementOriginSchema.parse(clone(request.origin)),
      title: request.title,
      repositoryId: located.repositoryId,
      ...clone(request.revision),
      createdAt: this.now(),
    })
    this.revisions.set(revision.id, revision)
    this.remember('revise-delivery-case', request.idempotencyKey, request, revision.id)
    const kase = this.moveCaseHead(request.caseId, request.expectedHeadRevisionId, revision.id)
    return { case: clone(kase), revision: clone(revision) }
  }

  /** Finish a replayed revision whose child revision is already committed. */
  private settleReviseCase(
    request: ReviseDeliveryCaseRequest,
    childRevisionId: string,
  ): { case: DeliveryCase; revision: ContractRevision } {
    const located = this.requireCase(request.caseId)
    const child = this.requireRevision(childRevisionId)
    if (located.headRevisionId === childRevisionId) {
      return { case: clone(located), revision: child }
    }
    if (located.headRevisionId !== request.expectedHeadRevisionId) {
      throw new DeliveryError(
        'conflict',
        `Delivery Case '${request.caseId}' head moved past '${request.expectedHeadRevisionId}' before the replayed child revision could attach`,
      )
    }
    const kase = this.moveCaseHead(request.caseId, request.expectedHeadRevisionId, childRevisionId)
    return { case: clone(kase), revision: child }
  }

  /**
   * Compare-and-set the Case head: a head that moved after the caller observed
   * it fails closed with `conflict` and no branch.
   */
  private moveCaseHead(caseId: string, expectedHeadRevisionId: string, childRevisionId: string): DeliveryCase {
    const located = this.requireCase(caseId)
    if (located.headRevisionId !== expectedHeadRevisionId) {
      throw new DeliveryError(
        'conflict',
        `Delivery Case '${caseId}' head moved past '${expectedHeadRevisionId}' before the child revision could attach`,
      )
    }
    const updated: DeliveryCase = deliveryCaseSchema.parse({
      ...located,
      headRevisionId: childRevisionId,
      updatedAt: this.now(),
    })
    this.cases.set(updated.id, updated)
    return updated
  }

  async recordRequirementDecision(request: RecordRequirementDecisionRequest): Promise<RequirementDecision> {
    return this.serializeIdempotentWrite(
      request.idempotencyKey,
      () => this.recordRequirementDecisionUnderLock(request),
    )
  }

  private async recordRequirementDecisionUnderLock(request: RecordRequirementDecisionRequest): Promise<RequirementDecision> {
    const prior = this.idempotent('record-requirement-decision', request.idempotencyKey, request)
    if (prior !== undefined) return this.requireRequirementDecision(prior.resultId)
    const revision = this.revisions.get(request.revisionId)
    if (revision === undefined) {
      throw new DeliveryError('not-found', `Contract revision '${request.revisionId}' is absent`)
    }
    const kase = this.requireCase(request.caseId)
    if (!this.revisionInCase(kase, request.revisionId)) {
      throw new DeliveryError(
        'invalid-reference',
        `Contract revision '${request.revisionId}' does not belong to Delivery Case '${request.caseId}'`,
      )
    }
    const existing = this.findDecisionForRevision(request.revisionId)
    if (existing !== undefined) {
      const sameContent = existing.decision === request.decision
        && existing.reason === request.reason
        && existing.actor.actorId === request.actorId
        && existing.decisionNonce === request.decisionNonce
      if (!sameContent) {
        throw new DeliveryError(
          'idempotency-conflict',
          `Contract revision '${request.revisionId}' already carries a different requirement decision`,
        )
      }
      return clone(existing)
    }
    const decision: RequirementDecision = requirementDecisionSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id: RequirementDecisionId(this.nextId('requirement-decision')),
      caseId: request.caseId,
      revisionId: request.revisionId,
      decision: request.decision,
      reason: request.reason,
      actor: { kind: 'human', actorId: request.actorId },
      decisionNonce: request.decisionNonce,
      decidedAt: this.now(),
    })
    this.requirementDecisions.set(decision.id, decision)
    this.remember('record-requirement-decision', request.idempotencyKey, request, decision.id)
    return clone(decision)
  }

  async createWorkPacket(
    request: CreateWorkPacketRequest,
    resolveVerificationSource?: VerificationSourceResolver,
  ): Promise<WorkPacket> {
    return this.serializeIdempotentWrite(
      request.idempotencyKey,
      () => this.createWorkPacketUnderLock(request, resolveVerificationSource),
    )
  }

  private async createWorkPacketUnderLock(
    request: CreateWorkPacketRequest,
    resolveVerificationSource?: VerificationSourceResolver,
  ): Promise<WorkPacket> {
    const prior = this.idempotent('create-work-packet', request.idempotencyKey, request)
    if (prior !== undefined) return this.requirePacket(prior.resultId)
    const revision = this.requireApprovedReadyRevision(request.contractRevisionId)
    if (revision.repositoryId !== request.repository.repositoryId) {
      throw new DeliveryError('invalid-reference', 'verified repository does not match the Contract revision')
    }
    if (canonicalJson(revision.baseSelectionRule) !== canonicalJson(request.repository.selectionRule)) {
      throw new DeliveryError('invalid-reference', 'verified base does not match the Contract base-selection rule')
    }
    const clauses = new Set(revision.acceptanceClauses.map(clause => clause.id))
    if (request.packet.acceptanceClauseIds.some(id => !clauses.has(id))) {
      throw new DeliveryError('invalid-reference', 'Packet references an acceptance clause outside its Contract revision')
    }
    const verificationSource = revision.verificationSource as NonNullable<ContractRevision['verificationSource']>
    let verificationPlan: VerificationPlan
    if (verificationSource.kind === 'contract-field') {
      verificationPlan = resolveVerificationPlan(clone(verificationSource.checks), {
        kind: 'contract-field',
        contractRevisionId: revision.id,
        field: 'verificationSource',
      })
    } else {
      if (resolveVerificationSource === undefined) {
        throw new DeliveryError('invalid-reference', 'Contract Git verification source requires a repository blob resolver')
      }
      const blob = await resolveVerificationSource({
        repository: request.repository,
        path: verificationSource.path,
        maxBytes: DELIVERY_VERIFICATION_SOURCE_MAX_BYTES,
      })
      if (blob.repositoryId !== request.repository.repositoryId
        || blob.commit !== request.repository.commit
        || blob.path !== verificationSource.path) {
        throw new DeliveryError('invalid-reference', 'resolved verification blob does not match the Contract repository, base, and path')
      }
      if (blob.bytes.byteLength > DELIVERY_VERIFICATION_SOURCE_MAX_BYTES) {
        throw new DeliveryError('invalid-reference', 'resolved verification blob exceeds the Delivery byte limit')
      }
      let document
      try {
        document = parseVerificationPlanDocument(blob.bytes)
      } catch (cause) {
        throw new DeliveryError(
          'invalid-reference',
          'resolved verification blob is not a valid delivery-verification-plan@1 document',
          { cause },
        )
      }
      verificationPlan = resolveVerificationPlan(document.checks, {
        kind: 'git-blob',
        baseCommit: request.repository.commit,
        path: verificationSource.path,
        blobId: blob.blobId,
      })
    }
    const digestInput = {
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      contractRevisionId: revision.id,
      repositoryId: request.repository.repositoryId,
      baseCommit: request.repository.commit,
      ...clone(request.packet),
      verificationPlan,
    }
    const packet: WorkPacket = workPacketSchema.parse({
      ...digestInput,
      id: WorkPacketId(this.nextId('work-packet')),
      packetDigest: workPacketDigest(digestInput),
      createdAt: this.now(),
    })
    this.packets.set(packet.id, packet)
    this.remember('create-work-packet', request.idempotencyKey, request, packet.id)
    return clone(packet)
  }

  async prepareIssuePublication(request: PrepareIssuePublicationRequest): Promise<IssuePublication> {
    return this.serializeIdempotentWrite(
      request.idempotencyKey,
      () => this.prepareIssuePublicationUnderLock(request),
    )
  }

  private async prepareIssuePublicationUnderLock(request: PrepareIssuePublicationRequest): Promise<IssuePublication> {
    const prior = this.idempotent('prepare-issue-publication', request.idempotencyKey, request)
    if (prior !== undefined) return this.requirePublication(prior.resultId)
    const revision = this.requireApprovedReadyRevision(request.revisionId)
    const kase = this.requireCase(request.caseId)
    if (!this.revisionInCase(kase, request.revisionId)) {
      throw new DeliveryError(
        'invalid-reference',
        `Contract revision '${request.revisionId}' does not belong to Delivery Case '${request.caseId}'`,
      )
    }
    const existing = this.findPublicationForRevision(request.revisionId)
    if (existing !== undefined) {
      if (existing.phase === 'failed') {
        return this.resetFailedPublication(existing.id, request)
      }
      if (existing.phase === 'unknown') {
        throw new DeliveryError(
          'invalid-transition',
          `Issue publication '${existing.id}' requires human resolution before another attempt`,
        )
      }
      return clone(existing)
    }
    const at = this.now()
    const publication: IssuePublication = issuePublicationSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id: issuePublicationIdForRevision(kase.id, revision.id),
      caseId: kase.id,
      revisionId: revision.id,
      repository: clone(request.repository),
      renderedDigest: request.renderedDigest,
      marker: request.marker,
      phase: 'prepared',
      issue: null,
      failure: null,
      createdAt: at,
      updatedAt: at,
    })
    this.publications.set(publication.id, publication)
    this.remember('prepare-issue-publication', request.idempotencyKey, request, publication.id)
    return clone(publication)
  }

  /**
   * Return a failed publication to `prepared` under its existing id for a new
   * attempt, so one revision never yields a second attempt record.
   */
  private resetFailedPublication(publicationId: string, request: PrepareIssuePublicationRequest): IssuePublication {
    const current = this.requirePublication(publicationId)
    if (current.phase === 'unknown') {
      throw new DeliveryError(
        'invalid-transition',
        `Issue publication '${current.id}' requires human resolution before another attempt`,
      )
    }
    if (current.phase !== 'failed') return clone(current)
    const reset: IssuePublication = issuePublicationSchema.parse({
      ...current,
      repository: clone(request.repository),
      renderedDigest: request.renderedDigest,
      marker: request.marker,
      phase: 'prepared',
      issue: null,
      failure: null,
      updatedAt: this.now(),
    })
    this.publications.set(reset.id, reset)
    return clone(reset)
  }

  markIssuePublicationStarted(publicationId: IssuePublicationId): Promise<IssuePublication & { phase: 'publishing' }> {
    return this.transitionPublication(publicationId, (current) => {
      if (current.phase !== 'prepared') {
        throw new DeliveryError(
          'invalid-transition',
          `Issue publication '${publicationId}' cannot start from phase '${current.phase}'`,
        )
      }
      return issuePublicationSchema.parse({
        ...current,
        phase: 'publishing',
        issue: null,
        failure: null,
        updatedAt: this.now(),
      }) as IssuePublication & { phase: 'publishing' }
    })
  }

  completeIssuePublication(request: CompleteIssuePublicationRequest): Promise<IssuePublication & { phase: 'published' }> {
    return this.transitionPublication(request.publicationId, (current) => {
      requirePublicationPhase(current, request.expectedPhase)
      const issue = gitHubIssueRefSchema.parse(clone(request.issue))
      return issuePublicationSchema.parse({
        ...current,
        phase: 'published',
        issue,
        failure: null,
        updatedAt: this.now(),
      }) as IssuePublication & { phase: 'published' }
    })
  }

  failIssuePublication(request: FailIssuePublicationRequest): Promise<IssuePublication & { phase: 'failed' | 'unknown' }> {
    return this.transitionPublication(request.publicationId, (current) => {
      requirePublicationPhase(current, request.expectedPhase)
      const failure = request.failure.sideEffect === 'not-started'
        ? nonStartedPublicationFailureSchema.parse(clone(request.failure))
        : unknownPublicationFailureSchema.parse(clone(request.failure))
      return issuePublicationSchema.parse({
        ...current,
        phase: failure.sideEffect === 'not-started' ? 'failed' : 'unknown',
        issue: null,
        failure,
        updatedAt: this.now(),
      }) as IssuePublication & { phase: 'failed' | 'unknown' }
    })
  }

  async resolveIssuePublication(request: ResolveIssuePublicationRequest): Promise<IssuePublication> {
    if (request.verificationBasis.trim().length === 0) {
      throw new DeliveryError('invalid-reference', 'a publication resolution requires an explicit verification basis')
    }
    if (request.resolution === 'confirm-published') {
      return this.transitionPublication(request.publicationId, (current) => {
        requireResolvablePublication(current, request.publicationId)
        const issue = gitHubIssueRefSchema.parse(clone(request.issue))
        return issuePublicationSchema.parse({
          ...current,
          phase: 'published',
          issue,
          failure: null,
          updatedAt: this.now(),
        })
      })
    }
    return this.transitionPublication(request.publicationId, (current) => {
      requireResolvablePublication(current, request.publicationId)
      return issuePublicationSchema.parse({
        ...current,
        phase: 'prepared',
        issue: null,
        failure: null,
        updatedAt: this.now(),
      })
    })
  }

  /** Run one publication transition: a settled or racing phase fails closed. */
  private async transitionPublication<P extends IssuePublication>(
    publicationId: IssuePublicationId,
    transition: (current: IssuePublication) => P,
  ): Promise<P> {
    const current = this.publications.get(publicationId)
    if (current === undefined) {
      throw new DeliveryError('not-found', `Issue publication '${publicationId}' is absent`)
    }
    const next = transition(current)
    this.publications.set(next.id, next)
    return clone(next)
  }

  async beginDispatch(request: BeginDispatchRequest): Promise<DispatchBinding> {
    const prior = this.idempotent('begin-dispatch', request.idempotencyKey, request)
    if (prior !== undefined) return this.requireBinding(prior.resultId)
    if (!this.packets.has(request.packetId)) {
      throw new DeliveryError('not-found', `Work Packet '${request.packetId}' is absent`)
    }
    const at = this.now()
    const binding: DispatchBinding = dispatchBindingSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id: DispatchBindingId(this.nextId('dispatch-binding')),
      packetId: request.packetId,
      kind: request.kind,
      inputDigest: request.inputDigest,
      idempotencyKey: request.idempotencyKey,
      phase: 'submitting',
      queueWorkId: null,
      executorId: request.kind === 'code.change@1' ? request.executorId : null,
      createdAt: at,
      updatedAt: at,
    })
    this.bindings.set(binding.id, binding)
    this.remember('begin-dispatch', request.idempotencyKey, request, binding.id)
    return clone(binding)
  }

  async bindDispatch(request: BindDispatchRequest): Promise<DispatchBinding & { readonly phase: 'bound' }> {
    const current = this.bindings.get(request.bindingId)
    if (current === undefined) {
      throw new DeliveryError('not-found', `Dispatch binding '${request.bindingId}' is absent`)
    }
    if (current.phase === 'bound') {
      if (current.queueWorkId !== request.queueWorkId) {
        throw new DeliveryError('invalid-transition', 'a bound Dispatch binding cannot change Queue Work identity')
      }
      return clone(current)
    }
    const bound = dispatchBindingSchema.parse({
      ...current,
      phase: 'bound',
      queueWorkId: request.queueWorkId,
      updatedAt: this.now(),
    })
    this.bindings.set(bound.id, bound)
    return clone(bound) as DispatchBinding & { readonly phase: 'bound' }
  }

  async recordAcceptanceDecision(
    request: RecordAcceptanceDecisionRequest,
    resolveCandidate: AcceptanceCandidateResolver,
    resolveEvidence: AcceptanceEvidenceResolver,
  ): Promise<AcceptanceDecision> {
    return this.serializeIdempotentWrite(
      request.idempotencyKey,
      () => this.recordAcceptanceDecisionUnderLock(request, resolveCandidate, resolveEvidence),
    )
  }

  private async recordAcceptanceDecisionUnderLock(
    request: RecordAcceptanceDecisionRequest,
    resolveCandidate: AcceptanceCandidateResolver,
    resolveEvidence: AcceptanceEvidenceResolver,
  ): Promise<AcceptanceDecision> {
    const prior = this.idempotent('record-acceptance-decision', request.idempotencyKey, request)
    if (prior !== undefined) return this.requireDecision(prior.resultId)
    const packet = this.packets.get(request.packetId)
    if (packet === undefined) throw new DeliveryError('not-found', `Work Packet '${request.packetId}' is absent`)

    const changeBinding = this.requireAcceptanceBinding(
      request.changeBindingId,
      packet.id,
      'code.change@1',
    )
    const verificationBinding = this.requireAcceptanceBinding(
      request.verificationBindingId,
      packet.id,
      'code.verify@1',
    )
    if (changeBinding.inputDigest !== canonicalDigest({ packetId: packet.id })) {
      throw new DeliveryError('invalid-reference', 'change dispatch input does not match the Packet')
    }

    const candidate = await resolveCandidate(
      changeBinding.queueWorkId,
      verificationBinding.queueWorkId,
    )
    const claim = completionClaimSchema.parse(candidate.completionClaim)
    const verificationIntent = codeVerifyIntentSchema.parse(candidate.verificationIntent)
    const verdict = verificationVerdictSchema.parse(candidate.verificationVerdict)
    if (claim.packetId !== packet.id || claim.queueWorkId !== changeBinding.queueWorkId) {
      throw new DeliveryError('invalid-reference', 'completion claim does not belong to the bound change dispatch')
    }
    if (claim.queueAttemptId !== candidate.changeQueueAttemptId) {
      throw new DeliveryError('invalid-reference', 'completion claim does not belong to the resolved successful change Attempt')
    }
    if (claim.disposition !== 'completed') {
      throw new DeliveryError('acceptance-denied', 'acceptance requires a completed change claim')
    }
    if (verificationBinding.inputDigest !== canonicalDigest(verificationIntent)) {
      throw new DeliveryError('invalid-reference', 'verification intent does not match the bound verification dispatch')
    }
    if (verificationIntent.packetId !== packet.id
      || verificationIntent.targetCommit !== claim.checkpointCommit
      || verificationIntent.verificationPlanDigest !== packet.verificationPlan.digest) {
      throw new DeliveryError('invalid-reference', 'verification intent does not match the Packet checkpoint and trusted plan')
    }
    if (verdict.packetId !== packet.id
      || verdict.baseCommit !== packet.baseCommit
      || verdict.targetCommit !== claim.checkpointCommit
      || verdict.targetCommit !== verificationIntent.targetCommit
      || verdict.verificationPlanDigest !== packet.verificationPlan.digest) {
      throw new DeliveryError('invalid-reference', 'verification verdict does not match the Packet, base, checkpoint, and plan')
    }
    const verdictFindings = verificationVerdictPlanFindings(verdict, packet.verificationPlan)
    if (verdictFindings.length !== 0) {
      throw new DeliveryError('invalid-reference', `verification verdict is inconsistent with the trusted plan: ${verdictFindings.join('; ')}`)
    }
    if (request.decision === 'accepted' && verdict.status !== 'passed') {
      throw new DeliveryError('acceptance-denied', 'ordinary acceptance requires a matching passed verdict')
    }
    if (request.decision === 'accepted') {
      const evidenceRefs = await this.resolveAcceptanceEvidence(claim, verdict, resolveEvidence)
      this.assertAcceptanceEvidence(
        packet,
        claim,
        verdict,
        evidenceRefs,
        changeBinding.queueWorkId,
        verificationBinding.queueWorkId,
        candidate.verificationQueueAttemptId,
      )
    }
    const decision: AcceptanceDecision = acceptanceDecisionSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id: AcceptanceDecisionId(this.nextId('acceptance-decision')),
      packetId: packet.id,
      targetCommit: verdict.targetCommit,
      verdictId: verdict.id,
      decision: request.decision,
      reason: request.reason,
      actor: { kind: 'human', actorId: request.actorId },
      decisionNonce: request.decisionNonce,
      decidedAt: this.now(),
    })
    const decisionFindings = acceptanceDecisionFindings(decision, verdict)
    /* v8 ignore next -- decision identities are copied from the parsed verdict and accepted/non-passed was rejected above. */
    if (decisionFindings.length !== 0) {
      throw new DeliveryError('acceptance-denied', decisionFindings.join('; '))
    }
    this.decisions.set(decision.id, decision)
    this.remember('record-acceptance-decision', request.idempotencyKey, request, decision.id)
    return clone(decision)
  }

  getCase(id: DeliveryCaseId): DeliveryCase | undefined {
    const value = this.cases.get(id)
    return value === undefined ? undefined : clone(value)
  }

  getRequirementDecision(id: RequirementDecisionId): RequirementDecision | undefined {
    const value = this.requirementDecisions.get(id)
    return value === undefined ? undefined : clone(value)
  }

  getIssuePublication(id: IssuePublicationId): IssuePublication | undefined {
    const value = this.publications.get(id)
    return value === undefined ? undefined : clone(value)
  }

  getContractRevision(id: ContractRevisionId): ContractRevision | undefined {
    const value = this.revisions.get(id)
    return value === undefined ? undefined : clone(value)
  }

  getWorkPacket(id: WorkPacketId): WorkPacket | undefined {
    const value = this.packets.get(id)
    return value === undefined ? undefined : clone(value)
  }

  getDispatchBinding(id: DispatchBindingId): DispatchBinding | undefined {
    const value = this.bindings.get(id)
    return value === undefined ? undefined : clone(value)
  }

  snapshot(): DeliverySnapshot {
    return clone({
      contractRevisions: [...this.revisions.values()],
      workPackets: [...this.packets.values()],
      dispatchBindings: [...this.bindings.values()],
      acceptanceDecisions: [...this.decisions.values()],
      deliveryCases: [...this.cases.values()],
      requirementDecisions: [...this.requirementDecisions.values()],
      issuePublications: [...this.publications.values()],
    })
  }

  private nextId(family: string): string {
    const ordinal = (this.counters.get(family) ?? 0) + 1
    this.counters.set(family, ordinal)
    return this.allocate(family, ordinal)
  }

  private async serializeIdempotentWrite<T>(key: string, write: () => Promise<T>): Promise<T> {
    let release!: () => void
    const turn = new Promise<void>((resolve) => {
      release = resolve
    })
    const prior = this.idempotencyTails.get(key)
    this.idempotencyTails.set(key, turn)
    if (prior !== undefined) await prior
    try {
      return await write()
    } finally {
      release()
      if (this.idempotencyTails.get(key) === turn) this.idempotencyTails.delete(key)
    }
  }

  private idempotent(operation: string, key: string, input: unknown): IdempotentRecord | undefined {
    if (key.trim().length === 0) throw new DeliveryError('idempotency-conflict', 'idempotency key must be non-blank')
    const prior = this.idempotency.get(key)
    if (prior === undefined) return undefined
    const digest = canonicalDigest({ input, operation })
    if (prior.operation !== operation || prior.digest !== digest) {
      throw new DeliveryError('idempotency-conflict', `idempotency key '${key}' was already used with different input`)
    }
    return prior
  }

  private remember(operation: string, key: string, input: unknown, resultId: string, relatedId?: string): void {
    const record: IdempotentRecord = { operation, digest: canonicalDigest({ input, operation }), resultId }
    if (relatedId !== undefined) {
      return void this.idempotency.set(key, { ...record, relatedId })
    }
    this.idempotency.set(key, record)
  }

  /**
   * Validate the full approval boundary shared by Packet creation and
   * publication preparation: the revision must exist, belong to a Case, be
   * ready, and carry the one `approved` requirement decision.
   */
  private requireApprovedReadyRevision(revisionId: string): ContractRevision {
    const revision = this.revisions.get(revisionId)
    if (revision === undefined) {
      throw new DeliveryError('not-found', `Contract revision '${revisionId}' is absent`)
    }
    if (this.findCaseForRevision(revisionId) === undefined) {
      throw new DeliveryError('invalid-reference', `Contract revision '${revisionId}' does not belong to any Delivery Case`)
    }
    const readiness = contractReadiness(revision)
    if (!readiness.ready) {
      throw new DeliveryError('invalid-reference', `Contract revision is not ready: ${readiness.reasons.join(', ')}`)
    }
    const decision = this.findDecisionForRevision(revisionId)
    if (decision === undefined || decision.decision !== 'approved') {
      throw new DeliveryError('approval-required', `Contract revision '${revisionId}' requires an approved requirement decision`)
    }
    return revision
  }

  /** Walk the Case head lineage to its root; a broken link ends the walk. */
  private revisionInCase(kase: DeliveryCase, revisionId: string): boolean {
    let cursor: string | null = kase.headRevisionId
    const limit = this.revisions.size + 1
    for (let step = 0; cursor !== null && step < limit; step += 1) {
      if (cursor === revisionId) return true
      const revision = this.revisions.get(cursor)
      if (revision === undefined) return false
      cursor = revision.previousRevisionId
    }
    return false
  }

  private findCaseForRevision(revisionId: string): DeliveryCase | undefined {
    for (const kase of this.cases.values()) {
      if (this.revisionInCase(kase, revisionId)) return kase
    }
    return undefined
  }

  private findDecisionForRevision(revisionId: string): RequirementDecision | undefined {
    for (const decision of this.requirementDecisions.values()) {
      if (decision.revisionId === revisionId) return decision
    }
    return undefined
  }

  private findPublicationForRevision(revisionId: string): IssuePublication | undefined {
    for (const publication of this.publications.values()) {
      if (publication.revisionId === revisionId) return publication
    }
    return undefined
  }

  private requireCase(id: string): DeliveryCase {
    const value = this.cases.get(id)
    if (value === undefined) throw new DeliveryError('not-found', `Delivery Case '${id}' is absent`)
    return value
  }

  private requireCaseRecord(id: string): DeliveryCase {
    const value = this.cases.get(id)
    /* v8 ignore next -- both maps are committed together; only direct private-state mutation can break this invariant. */
    if (value === undefined) throw new Error('delivery-testkit: idempotency record references a missing Delivery Case')
    return clone(value)
  }

  private requireRevision(id: string | undefined): ContractRevision {
    const value = id === undefined ? undefined : this.revisions.get(id)
    /* v8 ignore next -- both maps are committed together; only direct private-state mutation can break this invariant. */
    if (value === undefined) throw new Error('delivery-testkit: idempotency record references a missing Contract revision')
    return clone(value)
  }

  private requirePacket(id: string): WorkPacket {
    const value = this.packets.get(id)
    /* v8 ignore next -- both maps are committed together; only direct private-state mutation can break this invariant. */
    if (value === undefined) throw new Error('delivery-testkit: idempotency record references a missing Work Packet')
    return clone(value)
  }

  private requireBinding(id: string): DispatchBinding {
    const value = this.bindings.get(id)
    /* v8 ignore next -- both maps are committed together; only direct private-state mutation can break this invariant. */
    if (value === undefined) throw new Error('delivery-testkit: idempotency record references a missing Dispatch binding')
    return clone(value)
  }

  private requireRequirementDecision(id: string): RequirementDecision {
    const value = this.requirementDecisions.get(id)
    /* v8 ignore next -- both maps are committed together; only direct private-state mutation can break this invariant. */
    if (value === undefined) throw new Error('delivery-testkit: idempotency record references a missing requirement decision')
    return clone(value)
  }

  private requirePublication(id: string): IssuePublication {
    const value = this.publications.get(id)
    /* v8 ignore next -- both maps are committed together; only direct private-state mutation can break this invariant. */
    if (value === undefined) throw new Error('delivery-testkit: idempotency record references a missing Issue publication')
    return clone(value)
  }

  private requireDecision(id: string): AcceptanceDecision {
    const value = this.decisions.get(id)
    /* v8 ignore next -- both maps are committed together; only direct private-state mutation can break this invariant. */
    if (value === undefined) throw new Error('delivery-testkit: idempotency record references a missing Acceptance decision')
    return clone(value)
  }

  private requireAcceptanceBinding(
    id: DispatchBinding['id'],
    packetId: WorkPacket['id'],
    kind: DispatchBinding['kind'],
  ): DispatchBinding & { readonly phase: 'bound' } {
    const binding = this.bindings.get(id)
    if (binding === undefined) {
      throw new DeliveryError('not-found', `Dispatch binding '${id}' is absent`)
    }
    if (binding.phase !== 'bound' || binding.packetId !== packetId || binding.kind !== kind) {
      throw new DeliveryError(
        'invalid-reference',
        `Dispatch binding '${id}' is not a bound ${kind} Work for Packet '${packetId}'`,
      )
    }
    return binding
  }

  private assertAcceptanceEvidence(
    packet: WorkPacket,
    claim: Extract<CompletionClaim, { readonly disposition: 'completed' }>,
    verdict: VerificationVerdict,
    evidenceRefs: readonly EvidenceRef[],
    changeQueueWorkId: QueueWorkIdRef,
    verificationQueueWorkId: QueueWorkIdRef,
    verificationQueueAttemptId: QueueAttemptIdRef,
  ): void {
    const claimFindings = completionClaimEvidenceFindings(claim, evidenceRefs)
    if (claimFindings.length !== 0) {
      throw new DeliveryError('acceptance-denied', claimFindings.join('; '))
    }
    const byId = new Map(evidenceRefs.map(reference => [reference.id, reference]))
    const claimEvidenceIds = new Set(claim.evidenceIds)
    if (claim.evidenceIds.some(id => !verdict.evidenceIds.includes(id))) {
      throw new DeliveryError('acceptance-denied', 'passed verdict does not cover every completed-claim evidence id')
    }
    const referencedIds = new Set([
      ...claim.evidenceIds,
      ...verdict.evidenceIds,
      ...verdict.checkResults.flatMap(result => result.evidenceIds),
    ])
    const missingIds = [...referencedIds].filter(id => !byId.has(id))
    /* v8 ignore next -- resolveAcceptanceEvidence rejects every absent or wrong-id reference before constructing this complete map. */
    if (missingIds.length !== 0) {
      throw new DeliveryError('acceptance-denied', `acceptance evidence is missing: ${missingIds.join(', ')}`)
    }
    for (const evidenceId of claim.evidenceIds) {
      const reference = byId.get(evidenceId) as EvidenceRef
      if (reference.provenance.kind !== 'change-attempt'
        || reference.provenance.packetId !== packet.id
        || reference.provenance.queueWorkId !== changeQueueWorkId
        || reference.provenance.queueAttemptId !== claim.queueAttemptId) {
        throw new DeliveryError('acceptance-denied', `claim evidence '${evidenceId}' has unrelated provenance`)
      }
    }
    for (const result of verdict.checkResults) {
      for (const evidenceId of result.evidenceIds) {
        const reference = byId.get(evidenceId) as EvidenceRef
        if (reference.provenance.kind !== 'verification-check'
          || reference.provenance.packetId !== packet.id
          || reference.provenance.queueWorkId !== verificationQueueWorkId
          || reference.provenance.queueAttemptId !== verificationQueueAttemptId
          || reference.provenance.checkId !== result.checkId) {
          throw new DeliveryError('acceptance-denied', `verification evidence '${evidenceId}' has unrelated provenance`)
        }
      }
    }
    for (const evidenceId of verdict.evidenceIds) {
      if (claimEvidenceIds.has(evidenceId)) continue
      const reference = byId.get(evidenceId) as EvidenceRef
      if (reference.provenance.kind !== 'verification-check'
        || reference.provenance.packetId !== packet.id
        || reference.provenance.queueWorkId !== verificationQueueWorkId
        || reference.provenance.queueAttemptId !== verificationQueueAttemptId) {
        throw new DeliveryError('acceptance-denied', `verdict evidence '${evidenceId}' has unrelated provenance`)
      }
    }
    const findings = new Map(verdict.evidenceIntegrityFindings.map(finding => [finding.evidenceId, finding]))
    /* v8 ignore next -- verificationVerdictSchema rejects duplicate evidence findings before this cross-object check. */
    if (findings.size !== verdict.evidenceIntegrityFindings.length) {
      throw new DeliveryError('acceptance-denied', 'verification verdict contains duplicate evidence integrity findings')
    }
    const unverifiedIds = [...referencedIds].filter((id) => {
      const finding = findings.get(id)
      return finding === undefined || finding.status !== 'verified'
    })
    if (unverifiedIds.length !== 0) {
      throw new DeliveryError('acceptance-denied', `acceptance evidence lacks verified integrity: ${unverifiedIds.join(', ')}`)
    }
  }

  private async resolveAcceptanceEvidence(
    claim: Extract<CompletionClaim, { readonly disposition: 'completed' }>,
    verdict: VerificationVerdict,
    resolveEvidence: AcceptanceEvidenceResolver,
  ): Promise<readonly EvidenceRef[]> {
    const evidenceIds = new Set([
      ...claim.evidenceIds,
      ...verdict.evidenceIds,
      ...verdict.checkResults.flatMap(result => result.evidenceIds),
    ])
    const references: EvidenceRef[] = []
    for (const evidenceId of evidenceIds) {
      const reference = await resolveEvidence(evidenceId)
      if (reference === undefined) {
        throw new DeliveryError('acceptance-denied', `acceptance evidence '${evidenceId}' is missing`)
      }
      if (reference.id !== evidenceId) {
        throw new DeliveryError('acceptance-denied', `evidence resolver returned the wrong ref for '${evidenceId}'`)
      }
      references.push(evidenceRefSchema.parse(reference))
    }
    return references
  }
}

/**
 * A `github-import` child revision may only continue its parent's exact
 * repository and Issue number; `human` origins carry no lineage constraint.
 */
function requireOriginLineage(parent: RequirementOrigin, child: RequirementOrigin): void {
  if (parent.kind !== 'github-import' || child.kind !== 'github-import') return
  if (parent.repository.owner !== child.repository.owner
    || parent.repository.name !== child.repository.name
    || parent.issueNumber !== child.issueNumber) {
    throw new DeliveryError(
      'invalid-reference',
      'a github-import revision may only be revised from the same repository and Issue number',
    )
  }
}

/** Publication transitions run only from the caller-declared expected phase. */
function requirePublicationPhase(
  current: IssuePublication,
  expectedPhase: 'publishing',
): asserts current is IssuePublication & { phase: 'publishing' } {
  if (current.phase !== expectedPhase) {
    throw new DeliveryError(
      'invalid-transition',
      `Issue publication '${current.id}' cannot transition from phase '${current.phase}'`,
    )
  }
}

/** Human resolution applies only to `unknown` or crash-stalled `publishing` records. */
function requireResolvablePublication(current: IssuePublication, publicationId: IssuePublicationId): void {
  if (current.phase !== 'unknown' && current.phase !== 'publishing') {
    throw new DeliveryError(
      'invalid-transition',
      `Issue publication '${publicationId}' cannot be resolved from phase '${current.phase}'`,
    )
  }
}
