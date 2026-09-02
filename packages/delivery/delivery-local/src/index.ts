/** Local durable Personal Delivery provider. @module @deepseek-ai/dsh-delivery-local */

import { randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'

import {
  DELIVERY_SCHEMA_VERSION,
  AcceptanceDecisionId,
  ContractRevisionId,
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
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  AcceptanceDecision,
  CompletionClaim,
  ContractRevision,
  DeliveryCase,
  DispatchBinding,
  EvidenceId,
  EvidenceRef,
  IssuePublication,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RequirementDecision,
  RequirementOrigin,
  VerificationVerdict,
  WorkPacket,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  DELIVERY_VERIFICATION_SOURCE_MAX_BYTES,
  Delivery,
  DeliveryError,
} from '@deepseek-ai/dsh-delivery'
import type {
  AcceptanceCandidateResolver,
  AcceptanceEvidenceResolver,
  BeginDispatchRequest,
  BindDispatchRequest,
  CompleteIssuePublicationRequest,
  CreateDeliveryCaseRequest,
  CreateWorkPacketRequest,
  DeliveryErrorCode,
  DeliverySnapshot,
  FailIssuePublicationRequest,
  PrepareIssuePublicationRequest,
  RecordAcceptanceDecisionRequest,
  RecordRequirementDecisionRequest,
  ResolveIssuePublicationRequest,
  ReviseDeliveryCaseRequest,
  VerificationSourceResolver,
} from '@deepseek-ai/dsh-delivery'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { deliveryLocalDomainSpec } from './spec.ts'

/** Storage-domain-backed provider selected for the local MVP deployment. */
export class LocalDelivery extends Delivery {
  /** The provider opens its private durable domain only after Storage Domain is present. */
  static inject = ['storageDomain']

  private revisions!: KvTable<string, ContractRevision>
  private packets!: KvTable<string, WorkPacket>
  private bindings!: KvTable<string, DispatchBinding>
  private decisions!: KvTable<string, AcceptanceDecision>
  private cases!: KvTable<string, DeliveryCase>
  private requirementDecisions!: KvTable<string, RequirementDecision>
  private publications!: KvTable<string, IssuePublication>
  private readonly idempotencyTails = new Map<string, Promise<void>>()

  /** Open the private durable domain before the Service becomes available. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(deliveryLocalDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'deliveryLocal.domainClose')
    this.revisions = domain.table('contract_revisions')
    this.packets = domain.table('work_packets')
    this.bindings = domain.table('dispatch_bindings')
    this.decisions = domain.table('acceptance_decisions')
    this.cases = domain.table('delivery_cases')
    this.requirementDecisions = domain.table('requirement_decisions')
    this.publications = domain.table('issue_publications')
  }

  override createCase(
    request: CreateDeliveryCaseRequest,
  ): Promise<{ case: DeliveryCase; revision: ContractRevision }> {
    return this.serializeIdempotentWrite(
      request.idempotencyKey,
      () => this.createCaseNow(request),
    )
  }

  private async createCaseNow(
    request: CreateDeliveryCaseRequest,
  ): Promise<{ case: DeliveryCase; revision: ContractRevision }> {
    const recordKey = this.idempotentRecordKey('create-delivery-case', request.idempotencyKey, request)
    const storedCase = this.cases.get(recordKey)
    if (storedCase !== undefined) {
      const storedRevision = this.revisions.get(recordKey)
      if (storedRevision === undefined) {
        throw new DeliveryError('unavailable', `durable Case '${storedCase.id}' lost its root revision`)
      }
      return { case: structuredClone(storedCase), revision: structuredClone(storedRevision) }
    }
    // A previous attempt may have durable the root revision and crashed before
    // the Case write; reuse that exact revision so the replay stays atomic.
    const recovered = this.revisions.get(recordKey)
    let revision: ContractRevision
    if (recovered !== undefined) {
      revision = recovered
    } else {
      revision = contractRevisionSchema.parse({
        schemaVersion: DELIVERY_SCHEMA_VERSION,
        id: ContractRevisionId(`contract-revision-${randomUUID()}`),
        previousRevisionId: null,
        origin: requirementOriginSchema.parse(structuredClone(request.origin)),
        title: request.title,
        repositoryId: request.repositoryId,
        ...structuredClone(request.revision),
        createdAt: new Date().toISOString(),
      })
      await this.revisions.put(recordKey, revision)
    }
    const at = new Date().toISOString()
    const kase = deliveryCaseSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id: DeliveryCaseId(`delivery-case-${randomUUID()}`),
      repositoryId: request.repositoryId,
      headRevisionId: revision.id,
      createdAt: at,
      updatedAt: at,
    })
    await this.cases.put(recordKey, kase)
    return { case: structuredClone(kase), revision: structuredClone(revision) }
  }

  override reviseCase(
    request: ReviseDeliveryCaseRequest,
  ): Promise<{ case: DeliveryCase; revision: ContractRevision }> {
    return this.serializeIdempotentWrite(
      request.idempotencyKey,
      () => this.reviseCaseNow(request),
    )
  }

  private async reviseCaseNow(
    request: ReviseDeliveryCaseRequest,
  ): Promise<{ case: DeliveryCase; revision: ContractRevision }> {
    const recordKey = this.idempotentRecordKey('revise-delivery-case', request.idempotencyKey, request)
    const pending = this.revisions.get(recordKey)
    if (pending !== undefined) {
      return await this.settleReviseCase(request, pending)
    }
    const located = this.requireCase(request.caseId)
    // The slot-local head equality is the compare-and-set: an expected head
    // that is absent, stale, or already superseded is the same CAS failure.
    requireDelivery(
      located.headRevisionId === request.expectedHeadRevisionId,
      'conflict',
      `Delivery Case '${request.caseId}' head is not the expected '${request.expectedHeadRevisionId}'`,
    )
    const parent = this.getContractRevision(request.expectedHeadRevisionId)
    requireDelivery(
      parent !== undefined,
      'not-found',
      `head Contract revision '${request.expectedHeadRevisionId}' is absent`,
    )
    requireOriginLineage(parent.origin, request.origin)
    const revision = contractRevisionSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id: ContractRevisionId(`contract-revision-${randomUUID()}`),
      previousRevisionId: request.expectedHeadRevisionId,
      origin: requirementOriginSchema.parse(structuredClone(request.origin)),
      title: request.title,
      repositoryId: located.repositoryId,
      ...structuredClone(request.revision),
      createdAt: new Date().toISOString(),
    })
    await this.revisions.put(recordKey, revision)
    const updatedCase = await this.moveCaseHead(located, request.expectedHeadRevisionId, revision)
    return { case: updatedCase, revision: structuredClone(revision) }
  }

  /**
   * Finish a replayed revision whose child revision is already durable: no-op
   * when the head already points at it, re-run the head move when a crash
   * interrupted it, and fail closed when the head moved elsewhere meanwhile.
   */
  private async settleReviseCase(
    request: ReviseDeliveryCaseRequest,
    pending: ContractRevision,
  ): Promise<{ case: DeliveryCase; revision: ContractRevision }> {
    const located = this.requireCase(request.caseId)
    if (located.headRevisionId === pending.id) {
      return { case: structuredClone(located), revision: structuredClone(pending) }
    }
    requireDelivery(
      located.headRevisionId === request.expectedHeadRevisionId,
      'conflict',
      `Delivery Case '${request.caseId}' head moved past '${request.expectedHeadRevisionId}' before the replayed child revision could attach`,
    )
    const updatedCase = await this.moveCaseHead(located, request.expectedHeadRevisionId, pending)
    return { case: updatedCase, revision: structuredClone(pending) }
  }

  /**
   * Compare-and-set the Case head inside the domain write chain: the slot-local
   * head check is the authoritative concurrency boundary, so a head that moved
   * after the caller observed it fails closed with `conflict` and no branch.
   */
  private async moveCaseHead(
    current: DeliveryCase,
    expectedHeadRevisionId: ContractRevisionId,
    child: ContractRevision,
  ): Promise<DeliveryCase> {
    return await this.cases.update(this.requireCaseRecordKey(current.id), (stored) => {
      if (stored.headRevisionId !== expectedHeadRevisionId) {
        throw new DeliveryError(
          'conflict',
          `Delivery Case '${current.id}' head moved past '${expectedHeadRevisionId}' before the child revision could attach`,
        )
      }
      return deliveryCaseSchema.parse({
        ...stored,
        headRevisionId: child.id,
        updatedAt: new Date().toISOString(),
      })
    })
  }

  override recordRequirementDecision(request: RecordRequirementDecisionRequest): Promise<RequirementDecision> {
    return this.serializeIdempotentWrite(
      request.idempotencyKey,
      () => this.recordRequirementDecisionNow(request),
    )
  }

  private async recordRequirementDecisionNow(request: RecordRequirementDecisionRequest): Promise<RequirementDecision> {
    const recordKey = this.idempotentRecordKey('record-requirement-decision', request.idempotencyKey, request)
    const existing = this.requirementDecisions.get(recordKey)
    if (existing !== undefined) return structuredClone(existing)
    const revision = this.getContractRevision(request.revisionId)
    requireDelivery(revision !== undefined, 'not-found', `Contract revision '${request.revisionId}' is absent`)
    const kase = this.requireCase(request.caseId)
    requireDelivery(
      this.revisionInCase(kase, request.revisionId),
      'invalid-reference',
      `Contract revision '${request.revisionId}' does not belong to Delivery Case '${request.caseId}'`,
    )
    const prior = this.findDecisionForRevision(request.revisionId)
    if (prior !== undefined) {
      const sameContent = prior.decision === request.decision
        && prior.reason === request.reason
        && prior.actor.actorId === request.actorId
        && prior.decisionNonce === request.decisionNonce
      requireDelivery(
        sameContent,
        'idempotency-conflict',
        `Contract revision '${request.revisionId}' already carries a different requirement decision`,
      )
      return structuredClone(prior)
    }
    const decision = requirementDecisionSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id: RequirementDecisionId(`requirement-decision-${randomUUID()}`),
      caseId: request.caseId,
      revisionId: request.revisionId,
      decision: request.decision,
      reason: request.reason,
      actor: { kind: 'human', actorId: request.actorId },
      decisionNonce: request.decisionNonce,
      decidedAt: new Date().toISOString(),
    })
    await this.requirementDecisions.put(recordKey, decision)
    return structuredClone(decision)
  }

  override createWorkPacket(
    request: CreateWorkPacketRequest,
    resolveVerificationSource?: VerificationSourceResolver,
  ): Promise<WorkPacket> {
    return this.serializeIdempotentWrite(
      request.idempotencyKey,
      () => this.createWorkPacketNow(request, resolveVerificationSource),
    )
  }

  private async createWorkPacketNow(
    request: CreateWorkPacketRequest,
    resolveVerificationSource?: VerificationSourceResolver,
  ): Promise<WorkPacket> {
    const packets = this.packets
    const recordKey = this.idempotentRecordKey('create-work-packet', request.idempotencyKey, request)
    const existing = packets.get(recordKey)
    if (existing !== undefined) return structuredClone(existing)
    const revision = this.requireApprovedReadyRevision(request.contractRevisionId)
    requireDelivery(
      revision.repositoryId === request.repository.repositoryId,
      'invalid-reference',
      'verified repository does not match the Contract revision',
    )
    requireDelivery(
      canonicalJson(revision.baseSelectionRule) === canonicalJson(request.repository.selectionRule),
      'invalid-reference',
      'verified base does not match the Contract base-selection rule',
    )
    const clauses = new Set(revision.acceptanceClauses.map(clause => clause.id))
    requireDelivery(
      request.packet.acceptanceClauseIds.every(id => clauses.has(id)),
      'invalid-reference',
      'Packet references an acceptance clause outside its Contract revision',
    )
    const verificationSource = revision.verificationSource as NonNullable<ContractRevision['verificationSource']>
    const verificationPlan = await this.resolvePacketPlan(
      verificationSource,
      request,
      resolveVerificationSource,
    )
    const digestInput = {
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      contractRevisionId: revision.id,
      repositoryId: request.repository.repositoryId,
      baseCommit: request.repository.commit,
      ...structuredClone(request.packet),
      verificationPlan,
    }
    const packet = workPacketSchema.parse({
      ...digestInput,
      id: WorkPacketId(`work-packet-${randomUUID()}`),
      packetDigest: workPacketDigest(digestInput),
      createdAt: new Date().toISOString(),
    })
    await packets.put(recordKey, packet)
    return structuredClone(packet)
  }

  private async resolvePacketPlan(
    source: NonNullable<ContractRevision['verificationSource']>,
    request: CreateWorkPacketRequest,
    resolveSource?: VerificationSourceResolver,
  ) {
    if (source.kind === 'contract-field') {
      return resolveVerificationPlan(structuredClone(source.checks), {
        kind: 'contract-field',
        contractRevisionId: request.contractRevisionId,
        field: 'verificationSource',
      })
    }
    requireDelivery(
      resolveSource !== undefined,
      'invalid-reference',
      'Contract Git verification source requires a repository blob resolver',
    )
    const blob = await resolveSource({
      repository: request.repository,
      path: source.path,
      maxBytes: DELIVERY_VERIFICATION_SOURCE_MAX_BYTES,
    })
    const blobMatches = blob.repositoryId === request.repository.repositoryId
      && blob.commit === request.repository.commit
      && blob.path === source.path
    requireDelivery(
      blobMatches,
      'invalid-reference',
      'resolved verification blob does not match the Contract repository, base, and path',
    )
    requireDelivery(
      blob.bytes.byteLength <= DELIVERY_VERIFICATION_SOURCE_MAX_BYTES,
      'invalid-reference',
      'resolved verification blob exceeds the Delivery byte limit',
    )
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
    return resolveVerificationPlan(document.checks, {
      kind: 'git-blob',
      baseCommit: request.repository.commit,
      path: source.path,
      blobId: blob.blobId,
    })
  }

  override prepareIssuePublication(request: PrepareIssuePublicationRequest): Promise<IssuePublication> {
    return this.serializeIdempotentWrite(
      request.idempotencyKey,
      () => this.prepareIssuePublicationNow(request),
    )
  }

  private async prepareIssuePublicationNow(request: PrepareIssuePublicationRequest): Promise<IssuePublication> {
    const recordKey = this.idempotentRecordKey('prepare-issue-publication', request.idempotencyKey, request)
    const existing = this.publications.get(recordKey)
    if (existing !== undefined) return structuredClone(existing)
    const revision = this.requireApprovedReadyRevision(request.revisionId)
    const kase = this.requireCase(request.caseId)
    requireDelivery(
      this.revisionInCase(kase, request.revisionId),
      'invalid-reference',
      `Contract revision '${request.revisionId}' does not belong to Delivery Case '${request.caseId}'`,
    )
    const prior = this.findPublicationForRevision(request.revisionId)
    if (prior !== undefined) {
      if (prior.publication.phase === 'failed') {
        return await this.resetFailedPublication(prior.recordKey, request)
      }
      requireDelivery(
        prior.publication.phase !== 'unknown',
        'invalid-transition',
        `Issue publication '${prior.publication.id}' requires human resolution before another attempt`,
      )
      return structuredClone(prior.publication)
    }
    const at = new Date().toISOString()
    const publication = issuePublicationSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id: issuePublicationIdForRevision(kase.id, revision.id),
      caseId: kase.id,
      revisionId: revision.id,
      repository: structuredClone(request.repository),
      renderedDigest: request.renderedDigest,
      marker: request.marker,
      phase: 'prepared',
      issue: null,
      failure: null,
      createdAt: at,
      updatedAt: at,
    })
    await this.publications.put(recordKey, publication)
    return structuredClone(publication)
  }

  /**
   * Return a failed publication to `prepared` under its existing id for a new
   * attempt. A concurrent prepare that already reset the record returns the
   * current record unchanged, so one revision never yields a second attempt
   * record.
   */
  private async resetFailedPublication(
    recordKey: string,
    request: PrepareIssuePublicationRequest,
  ): Promise<IssuePublication> {
    const reset = await this.publications.update(recordKey, (current) => {
      if (current.phase !== 'failed') return current
      return issuePublicationSchema.parse({
        ...current,
        repository: structuredClone(request.repository),
        renderedDigest: request.renderedDigest,
        marker: request.marker,
        phase: 'prepared',
        issue: null,
        failure: null,
        updatedAt: new Date().toISOString(),
      })
    })
    requireDelivery(
      reset.phase !== 'unknown',
      'invalid-transition',
      `Issue publication '${reset.id}' requires human resolution before another attempt`,
    )
    return structuredClone(reset)
  }

  override markIssuePublicationStarted(publicationId: IssuePublicationId): Promise<IssuePublication & { phase: 'publishing' }> {
    return this.transitionPublication(publicationId, (current) => {
      requireDelivery(
        current.phase === 'prepared',
        'invalid-transition',
        `Issue publication '${publicationId}' cannot start from phase '${current.phase}'`,
      )
      return issuePublicationSchema.parse({
        ...current,
        phase: 'publishing',
        issue: null,
        failure: null,
        updatedAt: new Date().toISOString(),
      }) as IssuePublication & { phase: 'publishing' }
    })
  }

  override completeIssuePublication(
    request: CompleteIssuePublicationRequest,
  ): Promise<IssuePublication & { phase: 'published' }> {
    return this.transitionPublication(request.publicationId, (current) => {
      requirePublicationPhase(current, request.expectedPhase)
      const issue = gitHubIssueRefSchema.parse(structuredClone(request.issue))
      return issuePublicationSchema.parse({
        ...current,
        phase: 'published',
        issue,
        failure: null,
        updatedAt: new Date().toISOString(),
      }) as IssuePublication & { phase: 'published' }
    })
  }

  override failIssuePublication(
    request: FailIssuePublicationRequest,
  ): Promise<IssuePublication & { phase: 'failed' | 'unknown' }> {
    return this.transitionPublication(request.publicationId, (current) => {
      requirePublicationPhase(current, request.expectedPhase)
      const failure = request.failure.sideEffect === 'not-started'
        ? nonStartedPublicationFailureSchema.parse(structuredClone(request.failure))
        : unknownPublicationFailureSchema.parse(structuredClone(request.failure))
      return issuePublicationSchema.parse({
        ...current,
        phase: failure.sideEffect === 'not-started' ? 'failed' : 'unknown',
        issue: null,
        failure,
        updatedAt: new Date().toISOString(),
      }) as IssuePublication & { phase: 'failed' | 'unknown' }
    })
  }

  override async resolveIssuePublication(request: ResolveIssuePublicationRequest): Promise<IssuePublication> {
    requireDelivery(
      request.verificationBasis.trim().length > 0,
      'invalid-reference',
      'a publication resolution requires an explicit verification basis',
    )
    if (request.resolution === 'confirm-published') {
      return this.transitionPublication(request.publicationId, (current) => {
        requireResolvablePublication(current, request.publicationId)
        const issue = gitHubIssueRefSchema.parse(structuredClone(request.issue))
        return issuePublicationSchema.parse({
          ...current,
          phase: 'published',
          issue,
          failure: null,
          updatedAt: new Date().toISOString(),
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
        updatedAt: new Date().toISOString(),
      })
    })
  }

  /**
   * Run one publication transition inside the domain write chain: the slot-local
   * phase check is the authoritative concurrency boundary, so a transition
   * racing another settled transition fails closed instead of skipping states.
   */
  private async transitionPublication<P extends IssuePublication>(
    publicationId: IssuePublicationId,
    transition: (current: IssuePublication) => P,
  ): Promise<P> {
    const located = this.findPublication(publicationId)
    requireDelivery(
      located !== undefined,
      'not-found',
      `Issue publication '${publicationId}' is absent`,
    )
    const next = await this.publications.update(located.recordKey, current => transition(current))
    return structuredClone(next) as P
  }

  override beginDispatch(request: BeginDispatchRequest): Promise<DispatchBinding> {
    return this.serializeIdempotentWrite(
      request.idempotencyKey,
      () => this.beginDispatchNow(request),
    )
  }

  private async beginDispatchNow(request: BeginDispatchRequest): Promise<DispatchBinding> {
    const bindings = this.bindings
    const recordKey = this.idempotentRecordKey('begin-dispatch', request.idempotencyKey, request)
    const existing = bindings.get(recordKey)
    if (existing !== undefined) return structuredClone(existing)
    if (this.getWorkPacket(request.packetId) === undefined) {
      throw new DeliveryError('not-found', `Work Packet '${request.packetId}' is absent`)
    }
    const at = new Date().toISOString()
    const binding = dispatchBindingSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id: DispatchBindingId(`dispatch-binding-${randomUUID()}`),
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
    await bindings.put(recordKey, binding)
    return structuredClone(binding)
  }

  override async bindDispatch(request: BindDispatchRequest): Promise<DispatchBinding & { readonly phase: 'bound' }> {
    const located = this.findBinding(request.bindingId)
    if (located === undefined) {
      throw new DeliveryError('not-found', `Dispatch binding '${request.bindingId}' is absent`)
    }
    if (located.binding.phase === 'bound') {
      if (located.binding.queueWorkId !== request.queueWorkId) {
        throw new DeliveryError('invalid-transition', 'a bound Dispatch binding cannot change Queue Work identity')
      }
      return structuredClone(located.binding)
    }
    const bound = await this.bindings.update(located.recordKey, (current) => {
      if (current.phase === 'bound') {
        if (current.queueWorkId !== request.queueWorkId) {
          throw new DeliveryError('invalid-transition', 'a bound Dispatch binding cannot change Queue Work identity')
        }
        return current
      }
      return dispatchBindingSchema.parse({
        ...current,
        phase: 'bound',
        queueWorkId: request.queueWorkId,
        updatedAt: new Date().toISOString(),
      })
    })
    return structuredClone(bound) as DispatchBinding & { readonly phase: 'bound' }
  }

  override recordAcceptanceDecision(
    request: RecordAcceptanceDecisionRequest,
    resolveCandidate: AcceptanceCandidateResolver,
    resolveEvidence: AcceptanceEvidenceResolver,
  ): Promise<AcceptanceDecision> {
    return this.serializeIdempotentWrite(
      request.idempotencyKey,
      () => this.recordAcceptanceDecisionNow(request, resolveCandidate, resolveEvidence),
    )
  }

  private async recordAcceptanceDecisionNow(
    request: RecordAcceptanceDecisionRequest,
    resolveCandidate: AcceptanceCandidateResolver,
    resolveEvidence: AcceptanceEvidenceResolver,
  ): Promise<AcceptanceDecision> {
    const decisions = this.decisions
    const recordKey = this.idempotentRecordKey('record-acceptance-decision', request.idempotencyKey, request)
    const existing = decisions.get(recordKey)
    if (existing !== undefined) return structuredClone(existing)
    const packet = this.getWorkPacket(request.packetId)
    requireDelivery(packet !== undefined, 'not-found', `Work Packet '${request.packetId}' is absent`)
    const changeBinding = this.requireAcceptanceBinding(request.changeBindingId, packet.id, 'code.change@1')
    const verificationBinding = this.requireAcceptanceBinding(
      request.verificationBindingId,
      packet.id,
      'code.verify@1',
    )
    requireDelivery(
      changeBinding.inputDigest === canonicalDigest({ packetId: packet.id }),
      'invalid-reference',
      'change dispatch input does not match the Packet',
    )
    const candidate = await resolveCandidate(changeBinding.queueWorkId, verificationBinding.queueWorkId)
    const claim = completionClaimSchema.parse(candidate.completionClaim)
    const verificationIntent = codeVerifyIntentSchema.parse(candidate.verificationIntent)
    const verdict = verificationVerdictSchema.parse(candidate.verificationVerdict)
    requireDelivery(
      claim.packetId === packet.id && claim.queueWorkId === changeBinding.queueWorkId,
      'invalid-reference',
      'completion claim does not belong to the bound change dispatch',
    )
    requireDelivery(
      claim.queueAttemptId === candidate.changeQueueAttemptId,
      'invalid-reference',
      'completion claim does not belong to the resolved successful change Attempt',
    )
    requireDelivery(
      claim.disposition === 'completed',
      'acceptance-denied',
      'acceptance requires a completed change claim',
    )
    requireDelivery(
      verificationBinding.inputDigest === canonicalDigest(verificationIntent),
      'invalid-reference',
      'verification intent does not match the bound verification dispatch',
    )
    const intentMatches = verificationIntent.packetId === packet.id
      && verificationIntent.targetCommit === claim.checkpointCommit
      && verificationIntent.verificationPlanDigest === packet.verificationPlan.digest
    requireDelivery(
      intentMatches,
      'invalid-reference',
      'verification intent does not match the Packet checkpoint and trusted plan',
    )
    const verdictMatches = verdict.packetId === packet.id
      && verdict.baseCommit === packet.baseCommit
      && verdict.targetCommit === claim.checkpointCommit
      && verdict.targetCommit === verificationIntent.targetCommit
      && verdict.verificationPlanDigest === packet.verificationPlan.digest
    requireDelivery(
      verdictMatches,
      'invalid-reference',
      'verification verdict does not match the Packet, base, checkpoint, and plan',
    )
    const verdictFindings = verificationVerdictPlanFindings(verdict, packet.verificationPlan)
    requireDelivery(
      verdictFindings.length === 0,
      'invalid-reference',
      `verification verdict is inconsistent with the trusted plan: ${verdictFindings.join('; ')}`,
    )
    if (request.decision === 'accepted') {
      requireDelivery(
        verdict.status === 'passed',
        'acceptance-denied',
        'ordinary acceptance requires a matching passed verdict',
      )
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
    const decision = acceptanceDecisionSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id: AcceptanceDecisionId(`acceptance-decision-${randomUUID()}`),
      packetId: packet.id,
      targetCommit: verdict.targetCommit,
      verdictId: verdict.id,
      decision: request.decision,
      reason: request.reason,
      actor: { kind: 'human', actorId: request.actorId },
      decisionNonce: request.decisionNonce,
      decidedAt: new Date().toISOString(),
    })
    const decisionFindings = acceptanceDecisionFindings(decision, verdict)
    /* v8 ignore next -- identities are copied from the parsed verdict and accepted/non-passed was rejected above. */
    if (decisionFindings.length !== 0) {
      throw new DeliveryError('acceptance-denied', decisionFindings.join('; '))
    }
    await decisions.put(recordKey, decision)
    return structuredClone(decision)
  }

  override getCase(id: DeliveryCaseId): DeliveryCase | undefined {
    const located = this.findCase(id)
    return located === undefined ? undefined : structuredClone(located.case)
  }

  override getRequirementDecision(id: RequirementDecisionId): RequirementDecision | undefined {
    for (const value of this.requirementDecisions.entries()) {
      if (value[1].id === id) return structuredClone(value[1])
    }
    return undefined
  }

  override getIssuePublication(id: IssuePublicationId): IssuePublication | undefined {
    const located = this.findPublication(id)
    return located === undefined ? undefined : structuredClone(located.publication)
  }

  override getContractRevision(_id: ContractRevisionId): ContractRevision | undefined {
    for (const revision of this.revisions.entries()) {
      if (revision[1].id === _id) return structuredClone(revision[1])
    }
    return undefined
  }

  override getWorkPacket(_id: WorkPacketId): WorkPacket | undefined {
    for (const packet of this.packets.entries()) {
      if (packet[1].id === _id) return structuredClone(packet[1])
    }
    return undefined
  }

  override getDispatchBinding(_id: DispatchBindingId): DispatchBinding | undefined {
    const located = this.findBinding(_id)
    return located === undefined ? undefined : structuredClone(located.binding)
  }

  override snapshot(): DeliverySnapshot {
    return structuredClone({
      contractRevisions: [...this.revisions.entries()].map(([, value]) => value),
      workPackets: [...this.packets.entries()].map(([, value]) => value),
      dispatchBindings: [...this.bindings.entries()].map(([, value]) => value),
      acceptanceDecisions: [...this.decisions.entries()].map(([, value]) => value),
      deliveryCases: [...this.cases.entries()].map(([, value]) => value),
      requirementDecisions: [...this.requirementDecisions.entries()].map(([, value]) => value),
      issuePublications: [...this.publications.entries()].map(([, value]) => value),
    })
  }

  private findCase(id: DeliveryCaseId): { recordKey: string; case: DeliveryCase } | undefined {
    for (const [recordKey, value] of this.cases.entries()) {
      if (value.id === id) return { recordKey, case: value }
    }
    return undefined
  }

  private requireCase(id: DeliveryCaseId): DeliveryCase {
    const located = this.findCase(id)
    requireDelivery(located !== undefined, 'not-found', `Delivery Case '${id}' is absent`)
    return located.case
  }

  private requireCaseRecordKey(id: DeliveryCaseId): string {
    const located = this.findCase(id)
    requireDelivery(located !== undefined, 'not-found', `Delivery Case '${id}' is absent`)
    return located.recordKey
  }

  private findPublication(id: IssuePublicationId): { recordKey: string; publication: IssuePublication } | undefined {
    for (const [recordKey, value] of this.publications.entries()) {
      if (value.id === id) return { recordKey, publication: value }
    }
    return undefined
  }

  private findPublicationForRevision(revisionId: ContractRevisionId): { recordKey: string; publication: IssuePublication } | undefined {
    for (const [recordKey, value] of this.publications.entries()) {
      if (value.revisionId === revisionId) return { recordKey, publication: value }
    }
    return undefined
  }

  private findDecisionForRevision(revisionId: ContractRevisionId): RequirementDecision | undefined {
    for (const value of this.requirementDecisions.entries()) {
      if (value[1].revisionId === revisionId) return value[1]
    }
    return undefined
  }

  private findBinding(id: DispatchBindingId): { recordKey: string; binding: DispatchBinding } | undefined {
    for (const [recordKey, binding] of this.bindings.entries()) {
      if (binding.id === id) return { recordKey, binding }
    }
    return undefined
  }

  /**
   * Validate the full approval boundary shared by Packet creation and
   * publication preparation: the revision must exist, belong to a Case, be
   * ready, and carry the one `approved` requirement decision.
   */
  private requireApprovedReadyRevision(revisionId: ContractRevisionId): ContractRevision {
    const revision = this.getContractRevision(revisionId)
    requireDelivery(revision !== undefined, 'not-found', `Contract revision '${revisionId}' is absent`)
    requireDelivery(
      this.findCaseForRevision(revisionId) !== undefined,
      'invalid-reference',
      `Contract revision '${revisionId}' does not belong to any Delivery Case`,
    )
    const readiness = contractReadiness(revision)
    requireDelivery(
      readiness.ready,
      'invalid-reference',
      `Contract revision is not ready: ${readiness.reasons.join(', ')}`,
    )
    const decision = this.findDecisionForRevision(revisionId)
    requireDelivery(
      decision !== undefined && decision.decision === 'approved',
      'approval-required',
      `Contract revision '${revisionId}' requires an approved requirement decision`,
    )
    return revision
  }

  /** Walk the Case head lineage to its root; a broken link fails closed. */
  private revisionInCase(kase: DeliveryCase, revisionId: ContractRevisionId): boolean {
    let cursor: ContractRevisionId | null = kase.headRevisionId
    const limit = this.revisions.size + 1
    for (let step = 0; cursor !== null && step < limit; step += 1) {
      if (cursor === revisionId) return true
      const revision = this.getContractRevision(cursor)
      if (revision === undefined) return false
      cursor = revision.previousRevisionId
    }
    return false
  }

  private findCaseForRevision(revisionId: ContractRevisionId): DeliveryCase | undefined {
    for (const value of this.cases.entries()) {
      if (this.revisionInCase(value[1], revisionId)) return value[1]
    }
    return undefined
  }

  private requireAcceptanceBinding(
    id: DispatchBindingId,
    packetId: WorkPacketId,
    kind: DispatchBinding['kind'],
  ): DispatchBinding & { readonly phase: 'bound' } {
    const binding = this.getDispatchBinding(id)
    requireDelivery(binding !== undefined, 'not-found', `Dispatch binding '${id}' is absent`)
    requireDelivery(
      binding.phase === 'bound' && binding.packetId === packetId && binding.kind === kind,
      'invalid-reference',
      `Dispatch binding '${id}' is not a bound ${kind} Work for Packet '${packetId}'`,
    )
    return binding
  }

  private async resolveAcceptanceEvidence(
    claim: Extract<CompletionClaim, { readonly disposition: 'completed' }>,
    verdict: VerificationVerdict,
    resolveEvidence: AcceptanceEvidenceResolver,
  ): Promise<readonly EvidenceRef[]> {
    return await Promise.all(acceptanceEvidenceIds(claim, verdict).map(async (evidenceId): Promise<EvidenceRef> => {
      const reference = await resolveEvidence(evidenceId)
      requireDelivery(
        reference !== undefined,
        'acceptance-denied',
        `acceptance evidence '${evidenceId}' is missing`,
      )
      requireDelivery(
        reference.id === evidenceId,
        'acceptance-denied',
        `evidence resolver returned the wrong ref for '${evidenceId}'`,
      )
      return evidenceRefSchema.parse(reference)
    }))
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
    requireDelivery(claimFindings.length === 0, 'acceptance-denied', claimFindings.join('; '))
    const byId = new Map(evidenceRefs.map(reference => [reference.id, reference]))
    const claimEvidenceIds = new Set([
      ...claim.evidenceIds,
      ...claim.resumeCapsuleEvidenceId === null ? [] : [claim.resumeCapsuleEvidenceId],
    ])
    requireDelivery(
      claim.evidenceIds.every(id => verdict.evidenceIds.includes(id)),
      'acceptance-denied',
      'passed verdict does not cover every completed-claim evidence id',
    )
    const referencedIds = new Set([
      ...claim.evidenceIds,
      ...verdict.evidenceIds,
      ...verdict.checkResults.flatMap(result => result.evidenceIds),
    ])
    const unrelatedClaim = claim.evidenceIds.find((id) => {
      const reference = byId.get(id)
      return reference?.provenance.kind !== 'change-attempt'
        || reference.provenance.packetId !== packet.id
        || reference.provenance.queueWorkId !== changeQueueWorkId
        || reference.provenance.queueAttemptId !== claim.queueAttemptId
    })
    requireDelivery(
      unrelatedClaim === undefined,
      'acceptance-denied',
      `claim evidence '${String(unrelatedClaim)}' has unrelated provenance`,
    )
    if (claim.resumeCapsuleEvidenceId !== null) {
      const resumeCapsule = byId.get(claim.resumeCapsuleEvidenceId)
      requireDelivery(
        resumeCapsule?.kind === 'resume-capsule'
          && resumeCapsule.provenance.kind === 'change-attempt'
          && resumeCapsule.provenance.packetId === packet.id
          && resumeCapsule.provenance.queueWorkId === changeQueueWorkId
          && resumeCapsule.provenance.queueAttemptId === claim.queueAttemptId,
        'acceptance-denied',
        `resume capsule evidence '${claim.resumeCapsuleEvidenceId}' has unrelated provenance`,
      )
    }
    const verificationEvidence = verdict.checkResults.flatMap(result =>
      result.evidenceIds.map(evidenceId => ({ evidenceId, result })))
    const unrelatedCheck = verificationEvidence.find(({ evidenceId, result }) => {
      const reference = byId.get(evidenceId)
      return reference?.provenance.kind !== 'verification-check'
        || reference.provenance.packetId !== packet.id
        || reference.provenance.queueWorkId !== verificationQueueWorkId
        || reference.provenance.queueAttemptId !== verificationQueueAttemptId
        || reference.provenance.checkId !== result.checkId
    })
    requireDelivery(
      unrelatedCheck === undefined,
      'acceptance-denied',
      `verification evidence '${String(unrelatedCheck?.evidenceId)}' has unrelated provenance`,
    )
    const unrelatedVerdict = verdict.evidenceIds.find((id) => {
      if (claimEvidenceIds.has(id)) return false
      const reference = byId.get(id)
      return reference?.provenance.kind !== 'verification-check'
        || reference.provenance.packetId !== packet.id
        || reference.provenance.queueWorkId !== verificationQueueWorkId
        || reference.provenance.queueAttemptId !== verificationQueueAttemptId
    })
    requireDelivery(
      unrelatedVerdict === undefined,
      'acceptance-denied',
      `verdict evidence '${String(unrelatedVerdict)}' has unrelated provenance`,
    )
    const findings = new Map(verdict.evidenceIntegrityFindings.map(finding => [finding.evidenceId, finding]))
    const unverified = [...referencedIds].find((id) => {
      const finding = findings.get(id)
      return finding === undefined || finding.status !== 'verified'
    })
    requireDelivery(
      unverified === undefined,
      'acceptance-denied',
      `acceptance evidence lacks verified integrity: ${String(unverified)}`,
    )
  }

  private async serializeIdempotentWrite<T>(key: string, write: () => Promise<T>): Promise<T> {
    const predecessor = this.idempotencyTails.get(key) ?? Promise.resolve()
    const result = predecessor.then(write, write)
    const settled = result.then(() => undefined, () => undefined)
    this.idempotencyTails.set(key, settled)
    return await result.finally(() => {
      if (this.idempotencyTails.get(key) === settled) this.idempotencyTails.delete(key)
    })
  }

  private idempotentRecordKey(operation: string, key: string, input: unknown): string {
    if (key.trim().length === 0) {
      throw new DeliveryError('idempotency-conflict', 'idempotency key must be non-blank')
    }
    const prefix = `${canonicalDigest({ idempotencyKey: key })}|`
    const expected = `${prefix}${operation}|${canonicalDigest({ input, operation })}`
    for (const stored of [
      ...this.revisions.keys(),
      ...this.packets.keys(),
      ...this.bindings.keys(),
      ...this.decisions.keys(),
      ...this.cases.keys(),
      ...this.requirementDecisions.keys(),
      ...this.publications.keys(),
    ]) {
      if (!stored.startsWith(prefix)) continue
      if (stored !== expected) {
        throw new DeliveryError('idempotency-conflict', `idempotency key '${key}' was already used with different input`)
      }
      return stored
    }
    return expected
  }
}

export default LocalDelivery

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
  requireDelivery(
    current.phase === expectedPhase,
    'invalid-transition',
    `Issue publication '${current.id}' cannot transition from phase '${current.phase}'`,
  )
}

/** Human resolution applies only to `unknown` or crash-stalled `publishing` records. */
function requireResolvablePublication(current: IssuePublication, publicationId: IssuePublicationId): void {
  requireDelivery(
    current.phase === 'unknown' || current.phase === 'publishing',
    'invalid-transition',
    `Issue publication '${publicationId}' cannot be resolved from phase '${current.phase}'`,
  )
}

function requireDelivery(
  condition: unknown,
  code: DeliveryErrorCode,
  message: string,
): asserts condition {
  if (!condition) throw new DeliveryError(code, message)
}

function acceptanceEvidenceIds(
  claim: Extract<CompletionClaim, { readonly disposition: 'completed' }>,
  verdict: VerificationVerdict,
): readonly EvidenceId[] {
  const ids = new Set<EvidenceId>()
  for (const id of claim.evidenceIds) ids.add(id)
  if (claim.resumeCapsuleEvidenceId !== null) ids.add(claim.resumeCapsuleEvidenceId)
  for (const id of verdict.evidenceIds) ids.add(id)
  for (const result of verdict.checkResults) {
    for (const id of result.evidenceIds) ids.add(id)
  }
  return [...ids]
}
