/** Personal Delivery domain Service Definition (`ctx.delivery`). @module @deepseek-ai/dsh-delivery */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  AcceptanceDecision,
  ContractRevision,
  ContractRevisionId,
  DeliveryCase,
  DeliveryCaseId,
  DispatchBinding,
  DispatchBindingId,
  IssuePublication,
  IssuePublicationId,
  RequirementDecision,
  RequirementDecisionId,
  WorkPacket,
  WorkPacketId,
} from '@deepseek-ai/dsh-delivery-protocol'
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
} from './types.ts'

export type {
  AcceptanceCandidateFacts,
  AcceptanceCandidateResolver,
  AcceptanceEvidenceResolver,
  BeginDispatchRequest,
  BindDispatchRequest,
  CompleteIssuePublicationRequest,
  ContractRevisionDraft,
  CreateDeliveryCaseRequest,
  CreateWorkPacketRequest,
  DeliveryErrorCode,
  DeliverySnapshot,
  FailIssuePublicationRequest,
  PrepareIssuePublicationRequest,
  RecordAcceptanceDecisionRequest,
  RecordRequirementDecisionRequest,
  ResolveIssuePublicationRequest,
  ResolveVerificationSourceRequest,
  ReviseDeliveryCaseRequest,
  WorkPacketDraft,
  VerificationSourceResolver,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    delivery: Delivery
  }
}

/** Maximum trusted verification-plan blob size selected by every Delivery provider. */
export const DELIVERY_VERIFICATION_SOURCE_MAX_BYTES = 64 * 1024

/** Error with a stable classification shared by Delivery providers and host Consumers. */
export class DeliveryError extends Error {
  /**
   * @param code - Stable provider-independent failure classification.
   * @param message - Human-readable diagnostic.
   * @param options - Optional underlying failure.
   */
  constructor(readonly code: DeliveryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DeliveryError'
  }
}

/**
 * Durable Personal Delivery records and their idempotent write operations.
 * Providers allocate ids and timestamps, validate protocol objects at the
 * storage boundary, and serialize writes. The service does not persist Queue
 * lifecycle, executor handles, verification bytes, or UI lanes.
 *
 * Authority boundaries fixed by the version-2 contract: model-facing callers
 * may create and revise Cases and propose Packets, but only human actors
 * record requirement decisions, resolve uncertain publications, and accept
 * delivery outcomes. Every revision must be ready and explicitly approved
 * before Packet creation or Issue publication.
 */
export abstract class Delivery extends Service {
  constructor(ctx: Context) {
    super(ctx, 'delivery')
  }

  /**
   * Atomically create one Delivery Case and its root requirement revision.
   * The root revision carries a `null` `previousRevisionId`, the request's
   * origin and title, and the Case's repository binding.
   * @param request - Repository, origin, title, requirement content, and deterministic idempotency key.
   * @returns the existing pair for a repeated identical request, or the newly committed pair.
   */
  abstract createCase(request: CreateDeliveryCaseRequest): Promise<{ case: DeliveryCase; revision: ContractRevision }>

  /**
   * Create one child revision and move the Case head atomically under an
   * expected-head compare-and-set. The write fails with `conflict` when the
   * Case head no longer equals `expectedHeadRevisionId`, so concurrent
   * revisions cannot silently branch one Case. A `github-import` child origin
   * must name the same repository and Issue number as its `github-import`
   * parent; `human` origins carry no lineage constraint.
   * @param request - Case, observed head, origin, title, requirement content, and idempotency key.
   * @returns the Case with its advanced head plus the newly committed child revision.
   */
  abstract reviseCase(request: ReviseDeliveryCaseRequest): Promise<{ case: DeliveryCase; revision: ContractRevision }>

  /**
   * Record the one human requirement decision for an exact Case revision.
   * Repeating identical decision content returns the existing record;
   * different content under the same revision fails closed with
   * `idempotency-conflict`.
   * @param request - Case and revision references, human decision fields, and idempotency key.
   * @returns the existing or newly committed decision.
   */
  abstract recordRequirementDecision(request: RecordRequirementDecisionRequest): Promise<RequirementDecision>

  /**
   * Create one immutable Packet after the repository provider resolved the Contract base.
   * The revision must belong to a Case, be ready, and carry an `approved`
   * requirement decision; missing approval fails with `approval-required`.
   * @param request - Approved ready revision id, verified base, caller-selected Packet fields, and idempotency key.
   * @param resolveVerificationSource - Host-only Git blob resolver used when the Contract names a blob source.
   * @returns the existing or newly committed Packet.
   */
  abstract createWorkPacket(
    request: CreateWorkPacketRequest,
    resolveVerificationSource?: VerificationSourceResolver,
  ): Promise<WorkPacket>

  /**
   * Commit the submitting side of one Delivery-to-Queue admission handshake.
   * @param request - Packet, WorkKind, canonical Queue input digest, and idempotency identity.
   * @returns the existing or newly committed submitting binding.
   */
  abstract beginDispatch(request: BeginDispatchRequest): Promise<DispatchBinding>

  /**
   * Bind a submitting handshake to the one Queue Work id returned for it.
   * @param request - Binding id and returned Queue Work identity.
   * @returns the bound record; repeating the same work id is idempotent.
   */
  abstract bindDispatch(request: BindDispatchRequest): Promise<DispatchBinding & { readonly phase: 'bound' }>

  /**
   * Record a human decision after resolving Queue facts for two bound dispatches.
   * @param request - Human fields and Delivery-owned change/verification binding ids.
   * @param resolveCandidate - Host-only resolver invoked with the two validated Queue Work ids.
   * @param resolveEvidence - Host-only resolve-and-integrity-read capability invoked for exact evidence ids.
   * @returns the existing or newly committed decision.
   */
  abstract recordAcceptanceDecision(
    request: RecordAcceptanceDecisionRequest,
    resolveCandidate: AcceptanceCandidateResolver,
    resolveEvidence: AcceptanceEvidenceResolver,
  ): Promise<AcceptanceDecision>

  /**
   * Commit the first durable publication intent for an approved ready Case
   * revision. A revision owns at most one publication: repeated preparation
   * returns the existing record, a `failed` record is reset to `prepared`
   * under its existing id for a new attempt, and an `unknown` record refuses
   * preparation until human resolution.
   * @param request - Case and revision references, target repository, rendered digest, marker, and idempotency key.
   * @returns the existing, reset, or newly committed publication in phase `prepared`.
   */
  abstract prepareIssuePublication(request: PrepareIssuePublicationRequest): Promise<IssuePublication>

  /**
   * Move a `prepared` publication to `publishing` before any external
   * request crosses the side-effect boundary. Any other current phase fails
   * closed with `invalid-transition`, so a repeated start can never mask a
   * concurrent attempt.
   * @param publicationId - Durable publication identity.
   * @returns the publication in phase `publishing`.
   */
  abstract markIssuePublicationStarted(publicationId: IssuePublicationId): Promise<IssuePublication & { phase: 'publishing' }>

  /**
   * Commit the verified GitHub Issue onto a `publishing` record. The
   * transition fails closed unless the record is still `publishing`.
   * @param request - Publication id, expected `publishing` phase, and the validated exact Issue reference.
   * @returns the publication in phase `published` with its Issue binding.
   */
  abstract completeIssuePublication(request: CompleteIssuePublicationRequest): Promise<IssuePublication & { phase: 'published' }>

  /**
   * Record a truthful failure for a `publishing` record. A `not-started`
   * side effect lands in phase `failed`; an `unknown` side effect lands in
   * phase `unknown` for human resolution and is never retried automatically.
   * @param request - Publication id, expected `publishing` phase, and the classified failure.
   * @returns the publication in phase `failed` or `unknown`.
   */
  abstract failIssuePublication(request: FailIssuePublicationRequest): Promise<IssuePublication & { phase: 'failed' | 'unknown' }>

  /**
   * Apply a human-authorized resolution to an unresolved publication.
   * `confirm-published` requires the verified exact Issue reference and
   * moves `unknown` or stalled `publishing` records to `published`;
   * `confirm-not-created` requires an explicit verification basis and returns
   * such records to `prepared`. Any other current phase fails closed.
   * @param request - Resolution kind, publication id, and resolution evidence.
   * @returns the resolved publication.
   */
  abstract resolveIssuePublication(request: ResolveIssuePublicationRequest): Promise<IssuePublication>

  /**
   * Read one durable Delivery Case.
   * @param id - Durable Case identity.
   * @returns the Case or `undefined` when absent.
   */
  abstract getCase(id: DeliveryCaseId): DeliveryCase | undefined

  /**
   * Read one human requirement decision.
   * @param id - Durable decision identity.
   * @returns the decision or `undefined` when absent.
   */
  abstract getRequirementDecision(id: RequirementDecisionId): RequirementDecision | undefined

  /**
   * Read one Issue publication.
   * @param id - Durable publication identity.
   * @returns the current publication projection or `undefined` when absent.
   */
  abstract getIssuePublication(id: IssuePublicationId): IssuePublication | undefined

  /**
   * Read one adopted Contract revision.
   * @param id - Durable revision identity.
   * @returns the revision or `undefined` when absent.
   */
  abstract getContractRevision(id: ContractRevisionId): ContractRevision | undefined

  /**
   * Read one immutable Packet.
   * @param id - Durable Packet identity.
   * @returns the Packet or `undefined` when absent.
   */
  abstract getWorkPacket(id: WorkPacketId): WorkPacket | undefined

  /**
   * Read one dispatch handshake.
   * @param id - Durable binding identity.
   * @returns the current binding projection or `undefined` when absent.
   */
  abstract getDispatchBinding(id: DispatchBindingId): DispatchBinding | undefined

  /**
   * Read a stable fresh snapshot of every Delivery-owned record.
   * @returns committed records in provider-defined stable order.
   */
  abstract snapshot(): DeliverySnapshot
}

export default Delivery
