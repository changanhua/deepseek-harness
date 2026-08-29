/** Local durable Personal Delivery provider. @module @deepseek-ai/dsh-delivery-local */

import { randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'

import {
  DELIVERY_SCHEMA_VERSION,
  AcceptanceDecisionId,
  ContractRevisionId,
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
  verificationVerdictPlanFindings,
  verificationVerdictSchema,
  workPacketDigest,
  workPacketSchema,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  AcceptanceDecision,
  CompletionClaim,
  ContractRevision,
  DispatchBinding,
  EvidenceId,
  EvidenceRef,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  VerificationVerdict,
  WorkPacket,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  DELIVERY_VERIFICATION_SOURCE_MAX_BYTES,
  Delivery,
  DeliveryError,
} from '@deepseek-ai/dsh-delivery'
import type {
  AdoptContractRevisionRequest,
  AcceptanceCandidateResolver,
  AcceptanceEvidenceResolver,
  BeginDispatchRequest,
  BindDispatchRequest,
  CreateWorkPacketRequest,
  DeliveryErrorCode,
  DeliverySnapshot,
  RecordAcceptanceDecisionRequest,
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
  private readonly idempotencyTails = new Map<string, Promise<void>>()

  /** Open the private durable domain before the Service becomes available. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(deliveryLocalDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'deliveryLocal.domainClose')
    this.revisions = domain.table('contract_revisions')
    this.packets = domain.table('work_packets')
    this.bindings = domain.table('dispatch_bindings')
    this.decisions = domain.table('acceptance_decisions')
  }

  override adoptContractRevision(request: AdoptContractRevisionRequest): Promise<ContractRevision> {
    return this.serializeIdempotentWrite(
      request.idempotencyKey,
      () => this.adoptContractRevisionNow(request),
    )
  }

  private async adoptContractRevisionNow(request: AdoptContractRevisionRequest): Promise<ContractRevision> {
    const revisions = this.revisions
    const recordKey = this.idempotentRecordKey('adopt-contract-revision', request.idempotencyKey, request)
    const existing = revisions.get(recordKey)
    if (existing !== undefined) return structuredClone(existing)
    if (request.source.contentDigest !== sourceRefContentDigest(request.source)) {
      throw new DeliveryError('invalid-reference', 'source content digest does not match the adopted title and body')
    }
    const createdAt = new Date().toISOString()
    const sourceCandidate = sourceRefSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id: SourceRefId('source-ref-validation-candidate'),
      provider: 'github',
      ...structuredClone(request.source),
      createdAt,
    })
    const previousRevisionId = request.revision.previousRevisionId
    if (previousRevisionId !== null) {
      const previous = this.getContractRevision(previousRevisionId)
      if (previous === undefined) {
        throw new DeliveryError('invalid-reference', `previous Contract revision '${previousRevisionId}' is absent`)
      }
      if (!sameSourceIssue(previous, sourceCandidate)) {
        throw new DeliveryError(
          'invalid-reference',
          `previous Contract revision '${previousRevisionId}' belongs to a different source Issue`,
        )
      }
    }
    const source = {
      ...sourceCandidate,
      id: SourceRefId(`source-ref-${randomUUID()}`),
    }
    const revision = contractRevisionSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id: ContractRevisionId(`contract-revision-${randomUUID()}`),
      ...structuredClone(request.revision),
      sourceRef: source,
      createdAt,
    })
    await revisions.put(recordKey, revision)
    return structuredClone(revision)
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
    const revision = this.getContractRevision(request.contractRevisionId)
    requireDelivery(
      revision !== undefined,
      'not-found',
      `Contract revision '${request.contractRevisionId}' is absent`,
    )
    const readiness = contractReadiness(revision)
    requireDelivery(
      readiness.ready,
      'invalid-reference',
      `Contract revision is not ready: ${readiness.reasons.join(', ')}`,
    )
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
    const bound = await this.bindings.update(located.recordKey, current => dispatchBindingSchema.parse({
      ...current,
      phase: 'bound',
      queueWorkId: request.queueWorkId,
      updatedAt: new Date().toISOString(),
    }))
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
    })
  }

  private findBinding(id: DispatchBindingId): { recordKey: string; binding: DispatchBinding } | undefined {
    for (const [recordKey, binding] of this.bindings.entries()) {
      if (binding.id === id) return { recordKey, binding }
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
    const claimEvidenceIds = new Set(claim.evidenceIds)
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

function sameSourceIssue(left: ContractRevision, right: ContractRevision['sourceRef']): boolean {
  return left.sourceRef.repository.owner === right.repository.owner
    && left.sourceRef.repository.name === right.repository.name
    && left.sourceRef.issueNumber === right.issueNumber
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
  for (const id of verdict.evidenceIds) ids.add(id)
  for (const result of verdict.checkResults) {
    for (const id of result.evidenceIds) ids.add(id)
  }
  return [...ids]
}
