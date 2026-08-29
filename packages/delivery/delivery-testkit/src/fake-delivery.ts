/** Deterministic in-memory provider for the Personal Delivery domain. */

/* oxlint-disable typescript/require-await -- keep fake failures on the asynchronous Service contract without artificial I/O */

import { Service, type Context } from '@deepseek-ai/cordis'
import Delivery, {
  DeliveryError,
  DELIVERY_VERIFICATION_SOURCE_MAX_BYTES,
  type AcceptanceCandidateResolver,
  type AcceptanceEvidenceResolver,
  type AdoptContractRevisionRequest,
  type BeginDispatchRequest,
  type BindDispatchRequest,
  type CreateWorkPacketRequest,
  type DeliverySnapshot,
  type RecordAcceptanceDecisionRequest,
  type VerificationSourceResolver,
} from '@deepseek-ai/dsh-delivery'
import {
  AcceptanceDecisionId,
  ContractRevisionId,
  DELIVERY_SCHEMA_VERSION,
  DispatchBindingId,
  SourceRefId,
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
  dispatchBindingSchema,
  evidenceRefSchema,
  parseVerificationPlanDocument,
  resolveVerificationPlan,
  sourceRefContentDigest,
  sourceRefSchema,
  workPacketDigest,
  workPacketSchema,
  verificationVerdictPlanFindings,
  verificationVerdictSchema,
  type AcceptanceDecision,
  type ContractRevision,
  type CompletionClaim,
  type DispatchBinding,
  type EvidenceRef,
  type QueueAttemptIdRef,
  type QueueWorkIdRef,
  type SourceRef,
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
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

/**
 * In-memory Delivery Service Provider with the same idempotency, reference,
 * readiness, binding-CAS, and acceptance checks required of durable providers.
 */
export class FakeDelivery extends Delivery {
  private readonly revisions = new Map<string, ContractRevision>()
  private readonly packets = new Map<string, WorkPacket>()
  private readonly bindings = new Map<string, DispatchBinding>()
  private readonly decisions = new Map<string, AcceptanceDecision>()
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

  async adoptContractRevision(request: AdoptContractRevisionRequest): Promise<ContractRevision> {
    const prior = this.idempotent('adopt-contract-revision', request.idempotencyKey, request)
    if (prior !== undefined) return this.requireRevision(prior.resultId)
    if (request.source.contentDigest !== sourceRefContentDigest(request.source)) {
      throw new DeliveryError('invalid-reference', 'source content digest does not match the adopted title and body')
    }
    const createdAt = this.now()
    const sourceCandidate = sourceRefSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id: SourceRefId('source-ref-validation-candidate'),
      provider: 'github',
      ...clone(request.source),
      createdAt,
    })
    const previousRevisionId = request.revision.previousRevisionId
    if (previousRevisionId !== null) {
      const previous = this.revisions.get(previousRevisionId)
      if (previous === undefined) {
        throw new DeliveryError('invalid-reference', `previous Contract revision '${previousRevisionId}' is absent`)
      }
      if (!sameSourceIssue(previous.sourceRef, sourceCandidate)) {
        throw new DeliveryError(
          'invalid-reference',
          `previous Contract revision '${previousRevisionId}' belongs to a different source Issue`,
        )
      }
    }
    const source: SourceRef = {
      ...sourceCandidate,
      id: SourceRefId(this.nextId('source-ref')),
    }
    const revision: ContractRevision = contractRevisionSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id: ContractRevisionId(this.nextId('contract-revision')),
      ...clone(request.revision),
      sourceRef: source,
      createdAt,
    })
    this.revisions.set(revision.id, revision)
    this.remember('adopt-contract-revision', request.idempotencyKey, request, revision.id)
    return clone(revision)
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
    const revision = this.revisions.get(request.contractRevisionId)
    if (revision === undefined) {
      throw new DeliveryError('not-found', `Contract revision '${request.contractRevisionId}' is absent`)
    }
    const readiness = contractReadiness(revision)
    if (!readiness.ready) {
      throw new DeliveryError('invalid-reference', `Contract revision is not ready: ${readiness.reasons.join(', ')}`)
    }
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

  getContractRevision(id: ContractRevision['id']): ContractRevision | undefined {
    const value = this.revisions.get(id)
    return value === undefined ? undefined : clone(value)
  }

  getWorkPacket(id: WorkPacket['id']): WorkPacket | undefined {
    const value = this.packets.get(id)
    return value === undefined ? undefined : clone(value)
  }

  getDispatchBinding(id: DispatchBinding['id']): DispatchBinding | undefined {
    const value = this.bindings.get(id)
    return value === undefined ? undefined : clone(value)
  }

  snapshot(): DeliverySnapshot {
    return clone({
      contractRevisions: [...this.revisions.values()],
      workPackets: [...this.packets.values()],
      dispatchBindings: [...this.bindings.values()],
      acceptanceDecisions: [...this.decisions.values()],
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

  private remember(operation: string, key: string, input: unknown, resultId: string): void {
    this.idempotency.set(key, { operation, digest: canonicalDigest({ input, operation }), resultId })
  }

  private requireRevision(id: string): ContractRevision {
    const value = this.revisions.get(id)
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

  private requireDecision(id: string): AcceptanceDecision {
    const value = this.decisions.get(id)
    /* v8 ignore next -- both maps are committed together; only direct private-state mutation can break this invariant. */
    if (value === undefined) throw new Error('delivery-testkit: idempotency record references a missing Acceptance decision')
    return clone(value)
  }
}

function sameSourceIssue(left: SourceRef, right: SourceRef): boolean {
  return left.repository.owner === right.repository.owner
    && left.repository.name === right.repository.name
    && left.issueNumber === right.issueNumber
}
