/** Browser-safe Personal Delivery Typert Remote. @module @changanhua/dsh-delivery-remote */

import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { DeliveryError, type AcceptanceEvidenceResolver } from '@changanhua/dsh-delivery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { DeliveryEvidenceError } from '@changanhua/dsh-delivery-evidence'
import { importGitHubIssue } from '@changanhua/dsh-delivery-github-intake'
import {
  publishGitHubIssue,
  resolveGitHubIssuePublication,
  type GitHubPublicationTarget,
} from '@changanhua/dsh-delivery-github-publisher'
import {
  ContractRevisionId,
  DeliveryCaseId,
  DispatchBindingId,
  EvidenceId,
  ExecutorId,
  IssuePublicationId,
  RepositoryId,
  WorkPacketId,
  canonicalDigest,
  isGitHubRepositoryName,
  isGitHubRepositoryOwner,
  type DispatchBinding,
  type QueueWorkIdRef,
} from '@changanhua/dsh-delivery-protocol'
import {
  startCodeChange,
  startVerification,
  type DeliveryQueueBridgeDependencies,
} from '@changanhua/dsh-delivery-task-queue'
import {
  createVerifiedOperatorAuthority,
  type OperatorWorkQueue,
} from '@changanhua/dsh-task-queue'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  DeliveryAcceptanceDecisionView,
  DeliveryCaseMutationView,
  DeliveryContractRevisionView,
  DeliveryCreateCaseInput,
  DeliveryCreatePacketInput,
  DeliveryDispatchBindingView,
  DeliveryEvidenceView,
  DeliveryImportIssueInput,
  DeliveryIssuePublicationView,
  DeliveryPublishIssueInput,
  DeliveryReadEvidenceInput,
  DeliveryResolvePublicationInput,
  DeliveryRecordDecisionInput,
  DeliveryRecordRequirementDecisionInput,
  DeliveryReviseCaseInput,
  DeliverySnapshotView,
  DeliveryStartChangeInput,
  DeliveryStartVerificationInput,
  DeliveryWorkPacketView,
} from './types.ts'
import {
  projectAcceptanceDecision,
  projectContractRevision,
  projectDeliverySnapshot,
  projectDispatchBinding,
  projectIssuePublication,
  projectRequirementDecision,
} from './projection.ts'
import {
  DeliveryAcceptanceCandidateError,
  resolveAcceptanceCandidate,
} from './acceptance.ts'
import { remoteFailure, requireActive } from './failures.ts'

export type { DeliveryRemoteErrorCode } from './failures.ts'
export type { DeliveryAttentionReason } from './types.ts'

export type {
  DeliveryAcceptanceDecisionView,
  DeliveryContractRevisionView,
  DeliveryCreateCaseInput,
  DeliveryCreatePacketInput,
  DeliveryDispatchBindingView,
  DeliveryEvidenceView,
  DeliveryImportIssueInput,
  DeliveryIssuePublicationView,
  DeliveryLane,
  DeliveryRecordDecisionInput,
  DeliverySnapshotView,
  DeliveryReadEvidenceInput,
  DeliveryPublishIssueInput,
  DeliveryRecordRequirementDecisionInput,
  DeliveryReviseCaseInput,
  DeliveryResolvePublicationInput,
  DeliveryStartChangeInput,
  DeliveryStartVerificationInput,
  DeliveryWorkPacketView,
  DeliveryWorkbenchCard,
  DeliveryWorkbenchDispatch,
} from './types.ts'

/** Trusted single-operator identity configured on the Host, never supplied by browser input. */
export interface Config {
  /** Non-blank human operator identity minted by trusted Host configuration. */
  readonly operatorId?: string
  /** Single local repository bound to newly shaped human-origin Cases. */
  readonly repositoryId?: string
  /** Host-only map from Delivery repository ids to GitHub targets and credential references. */
  readonly githubTargets?: Readonly<Record<string, {
    /** GitHub repository owner used by the Host publisher. */
    readonly owner: string
    /** GitHub repository name paired with the configured owner. */
    readonly name: string
    /** Credential reference resolved by the Host for each publication operation. */
    readonly credentialRef: string
    /** Optional labels applied by the Host during Issue creation. */
    readonly labels?: string[]
  }>>
}

/** Loader schema for the trusted Personal Delivery operator identity. */
export const Config: z<Config> = z.object({
  operatorId: z.string().min(1).pattern(/\S/u).default('local-operator'),
  repositoryId: z.string().min(1).pattern(/\S/u).default('workspace'),
  githubTargets: z.dict(z.object({
    owner: z.string().min(1),
    name: z.string().min(1),
    credentialRef: z.string().min(1).pattern(/^[A-Za-z_][A-Za-z0-9_]*$/u),
    labels: z.array(z.string().min(1)).default([]),
  })).default({}),
})

/** Replaceable boundaries used by focused tests; production keeps the real C0 Consumers. */
export interface DeliveryRemoteInternals {
  readonly fetch: typeof globalThis.fetch
  readonly importIssue: typeof importGitHubIssue
  readonly startCodeChange: typeof startCodeChange
  readonly startVerification: typeof startVerification
  readonly publishGitHubIssue: typeof publishGitHubIssue
  readonly resolveGitHubIssuePublication: typeof resolveGitHubIssuePublication
}

const DEFAULT_INTERNALS: DeliveryRemoteInternals = {
  fetch: globalThis.fetch.bind(globalThis),
  importIssue: importGitHubIssue,
  startCodeChange,
  startVerification,
  publishGitHubIssue,
  resolveGitHubIssuePublication,
}

const MAX_BROWSER_EVIDENCE_BYTES = 256 * 1024

interface GuardedAdmission {
  readonly dependencies: DeliveryQueueBridgeDependencies
  readonly failureSignal: () => AbortSignal | undefined
}

function guardedAdmission(
  dependencies: DeliveryQueueBridgeDependencies,
  signal: AbortSignal,
  operation: 'startChange' | 'startVerification',
): GuardedAdmission {
  let queueCommitted = false
  const active = (): void => {
    if (!queueCommitted) requireActive(signal, operation)
  }
  const guarded: DeliveryQueueBridgeDependencies = {
    delivery: {
      getWorkPacket(packetId) {
        active()
        return dependencies.delivery.getWorkPacket(packetId)
      },
      getDispatchBinding(bindingId) {
        active()
        return dependencies.delivery.getDispatchBinding(bindingId)
      },
      async beginDispatch(request) {
        active()
        const binding = await dependencies.delivery.beginDispatch(request)
        active()
        return binding
      },
      async bindDispatch(request) {
        active()
        const binding = await dependencies.delivery.bindDispatch(request)
        active()
        return binding
      },
    },
    queue: {
      get(workId) {
        active()
        return dependencies.queue.get(workId)
      },
      async enqueue(request) {
        active()
        const workId = await dependencies.queue.enqueue(request)
        queueCommitted = true
        return workId
      },
    },
    repoWorkspace: {
      async inspectRevision(request) {
        active()
        const revision = await dependencies.repoWorkspace.inspectRevision({
          ...request,
          signal,
        })
        active()
        return revision
      },
      async inspectRange(request) {
        active()
        const range = await dependencies.repoWorkspace.inspectRange({
          ...request,
          signal,
        })
        active()
        return range
      },
    },
  }
  return {
    dependencies: guarded,
    failureSignal: () => queueCommitted ? undefined : signal,
  }
}

function requireBound(
  binding: DispatchBinding | undefined,
  bindingId: DispatchBindingId,
  packetId: WorkPacketId,
  kind: DispatchBinding['kind'],
): Extract<DispatchBinding, { readonly phase: 'bound' }> {
  if (
    binding?.id !== bindingId
    || binding.packetId !== packetId
    || binding.kind !== kind
    || binding.phase !== 'bound'
  ) {
    throw new DeliveryAcceptanceCandidateError(
      `Selected ${kind} binding is not bound to the selected Packet`,
    )
  }
  return binding
}

/** Host service contributing the reserved `delivery` Remote namespace. */
export class DeliveryRemoteService extends TypertRemoteService {
  /** Domain, repository proof, and trusted Queue admission are required by the final methods. */
  static inject = ['credentials', 'delivery', 'deliveryEvidence', 'repoWorkspace', 'taskQueue']
  static Config = Config
  private readonly queue: OperatorWorkQueue
  private readonly operatorId: string
  private readonly repositoryId: RepositoryId
  private readonly internals: DeliveryRemoteInternals
  private readonly githubTargets = new Map<string, GitHubPublicationTarget>()

  constructor(
    ctx: Context,
    config: Config = {},
    internals: DeliveryRemoteInternals = DEFAULT_INTERNALS,
  ) {
    super(ctx, 'deliveryRemote', { namespace: 'delivery' })
    this.operatorId = config.operatorId ?? 'local-operator'
    if (this.operatorId.trim() === '') throw new TypeError('delivery Remote operatorId must be non-blank')
    this.repositoryId = RepositoryId(config.repositoryId ?? 'workspace')
    this.internals = internals
    for (const [rawRepositoryId, rawTarget] of Object.entries(config.githubTargets ?? {})) {
      const repositoryId = RepositoryId(rawRepositoryId)
      if (!isGitHubRepositoryOwner(rawTarget.owner) || !isGitHubRepositoryName(rawTarget.name)) {
        throw new TypeError(`delivery Remote GitHub target '${rawRepositoryId}' has invalid repository coordinates`)
      }
      this.githubTargets.set(repositoryId, {
        repository: { owner: rawTarget.owner, name: rawTarget.name },
        credentialRef: credentialRef(rawTarget.credentialRef),
        labels: rawTarget.labels ?? [],
      })
    }
    this.queue = ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
  }

  /**
   * Shape one new human-origin Case in the Host-selected local repository.
   * @param input - Browser-supplied title and initial contract revision.
   * @param signal - Caller lifetime checked before the durable mutation.
   * @returns the created Case and browser-safe head revision.
   */
  @Remote('createCase')
  async createCase(input: DeliveryCreateCaseInput, signal: AbortSignal): Promise<DeliveryCaseMutationView> {
    requireActive(signal, 'createCase')
    try {
      const digest = canonicalDigest({ repositoryId: this.repositoryId, input })
      const created = await this.ctx.delivery.createCase({
        idempotencyKey: `delivery:case:${digest}`,
        repositoryId: this.repositoryId,
        origin: { kind: 'human', actorId: this.operatorId },
        title: input.title,
        revision: input.revision,
      })
      return { case: created.case, revision: projectContractRevision(created.revision) }
    } catch (error) {
      throw remoteFailure('createCase', error, signal)
    }
  }

  /**
   * Revise the exact Case head observed by the browser.
   * @param input - Replacement title/revision bound to the observed head id.
   * @param signal - Caller lifetime checked before the durable mutation.
   * @returns the revised Case and browser-safe head revision.
   */
  @Remote('reviseCase')
  async reviseCase(input: DeliveryReviseCaseInput, signal: AbortSignal): Promise<DeliveryCaseMutationView> {
    requireActive(signal, 'reviseCase')
    try {
      const digest = canonicalDigest(input)
      const revised = await this.ctx.delivery.reviseCase({
        idempotencyKey: `delivery:case-revision:${digest}`,
        caseId: DeliveryCaseId(input.caseId),
        expectedHeadRevisionId: ContractRevisionId(input.expectedHeadRevisionId),
        origin: { kind: 'human', actorId: this.operatorId },
        title: input.title,
        revision: input.revision,
      })
      return { case: revised.case, revision: projectContractRevision(revised.revision) }
    } catch (error) {
      throw remoteFailure('reviseCase', error, signal)
    }
  }

  /**
   * Record human requirement authority without accepting a browser actor id.
   * @param input - Case, revision, decision, and reason selected by the human.
   * @param signal - Caller lifetime checked before the durable mutation.
   * @returns the browser-safe durable requirement decision.
   */
  @Remote('recordRequirementDecision')
  async recordRequirementDecision(
    input: DeliveryRecordRequirementDecisionInput,
    signal: AbortSignal,
  ): Promise<import('./types.ts').DeliveryRequirementDecisionView> {
    requireActive(signal, 'recordRequirementDecision')
    try {
      const decisionNonce = canonicalDigest(input)
      const decision = await this.ctx.delivery.recordRequirementDecision({
        idempotencyKey: `delivery:requirement-decision:${input.caseId}:${input.revisionId}:${decisionNonce}`,
        caseId: DeliveryCaseId(input.caseId),
        revisionId: ContractRevisionId(input.revisionId),
        decision: input.decision,
        reason: input.reason,
        actorId: this.operatorId,
        decisionNonce,
      })
      return projectRequirementDecision(decision)
    } catch (error) {
      throw remoteFailure('recordRequirementDecision', error, signal)
    }
  }

  /**
   * Publish one approved ready Case revision through Host-only GitHub configuration.
   * @param input - Case and revision selected for publication.
   * @param signal - Caller lifetime propagated through GitHub publication.
   * @returns the browser-safe publication record.
   */
  @Remote('publishIssue')
  async publishIssue(
    input: DeliveryPublishIssueInput,
    signal: AbortSignal,
  ): Promise<DeliveryIssuePublicationView> {
    requireActive(signal, 'publishIssue')
    try {
      const publication = await this.internals.publishGitHubIssue({
        delivery: this.ctx.delivery,
        credentials: this.ctx.credentials,
        fetch: this.internals.fetch,
        targetForRepository: repositoryId => this.githubTargets.get(repositoryId),
        now: () => new Date().toISOString(),
      }, {
        caseId: DeliveryCaseId(input.caseId),
        revisionId: ContractRevisionId(input.revisionId),
        signal,
      })
      return projectIssuePublication(publication)
    } catch (error) {
      throw remoteFailure('publishIssue', error, signal)
    }
  }

  /**
   * Resolve one uncertain publication through a fresh Host-side GitHub GET.
   * @param input - Publication identity and the operator-selected resolution action.
   * @param signal - Caller lifetime propagated through GitHub reconciliation.
   * @returns the reconciled browser-safe publication record.
   */
  @Remote('resolvePublication')
  async resolvePublication(
    input: DeliveryResolvePublicationInput,
    signal: AbortSignal,
  ): Promise<DeliveryIssuePublicationView> {
    requireActive(signal, 'resolvePublication')
    try {
      const publication = await this.internals.resolveGitHubIssuePublication({
        delivery: this.ctx.delivery,
        credentials: this.ctx.credentials,
        fetch: this.internals.fetch,
        targetForRepository: repositoryId => this.githubTargets.get(repositoryId),
        now: () => new Date().toISOString(),
      }, {
        resolution: input.resolution,
        publicationId: IssuePublicationId(input.publicationId),
        issueNumber: input.issueNumber,
        signal,
      })
      return projectIssuePublication(publication)
    } catch (error) {
      throw remoteFailure('resolvePublication', error, signal)
    }
  }

  /**
   * Return the complete derived MVP workbench snapshot.
   * @param signal - Caller lifetime checked before the point-in-time reads.
   * @returns the browser-safe projection of current Delivery facts.
   */
  @Remote('snapshot')
  snapshot(signal: AbortSignal): DeliverySnapshotView {
    requireActive(signal, 'snapshot')
    try {
      return projectDeliverySnapshot(
        this.ctx.delivery.snapshot(),
        this.queue.list(),
        this.queue.pendingAttentions(),
        new Map([...this.githubTargets].map(([id, target]) => [id, target.repository])),
      )
    } catch (error) {
      throw remoteFailure('snapshot', error)
    }
  }

  /**
   * Explicitly adopt the current revision of one GitHub Issue URL.
   * @param input - Operator-selected Issue URL; the Host supplies the configured repository.
   * @param signal - Operation-local Remote cancellation.
   * @returns the adopted immutable Contract revision.
   */
  @Remote('importIssue')
  async importIssue(
    input: DeliveryImportIssueInput,
    signal: AbortSignal,
  ): Promise<DeliveryContractRevisionView> {
    requireActive(signal, 'importIssue')
    try {
      return await this.internals.importIssue({
        delivery: this.ctx.delivery,
        fetch: this.internals.fetch,
      }, {
        issueUrl: input.issueUrl,
        repositoryId: this.repositoryId,
        signal,
      })
    } catch (error) {
      throw remoteFailure('importIssue', error, signal)
    }
  }

  /**
   * Resolve the Contract-owned repository base and create one immutable Packet.
   * @param input - Operator-selected Contract and bounded Packet draft fields.
   * @param signal - Operation-local Remote cancellation.
   * @returns the immutable Packet after host-owned verification and key derivation.
   */
  @Remote('createPacket')
  async createPacket(
    input: DeliveryCreatePacketInput,
    signal: AbortSignal,
  ): Promise<DeliveryWorkPacketView> {
    requireActive(signal, 'createPacket')
    try {
      const contractRevisionId = ContractRevisionId(input.contractRevisionId)
      const contract = this.ctx.delivery.getContractRevision(contractRevisionId)
      if (contract === undefined || contract.repositoryId === null || contract.baseSelectionRule === null) {
        throw new DeliveryError(
          contract === undefined ? 'not-found' : 'invalid-reference',
          contract === undefined
            ? 'The selected Contract revision does not exist'
            : 'The selected Contract revision has no repository base',
        )
      }
      const repository = await this.ctx.repoWorkspace.resolveBase({
        repositoryId: contract.repositoryId,
        selectionRule: contract.baseSelectionRule,
        signal,
      })
      requireActive(signal, 'createPacket')
      const requestDigest = canonicalDigest({
        contractRevisionId,
        repositoryId: repository.repositoryId,
        baseCommit: repository.commit,
        packet: input.packet,
      })
      return await this.ctx.delivery.createWorkPacket({
        idempotencyKey: `delivery:${contractRevisionId}:packet:${requestDigest}`,
        contractRevisionId,
        repository,
        packet: input.packet,
      }, request => this.ctx.repoWorkspace.readBlob({
        base: request.repository,
        path: request.path,
        maxBytes: request.maxBytes,
        signal,
      }))
    } catch (error) {
      throw remoteFailure('createPacket', error, signal)
    }
  }

  /**
   * Start one idempotently bound ownerless change dispatch.
   * @param input - Operator-selected Packet and executor.
   * @param signal - Operation-local Remote cancellation.
   * @returns the Delivery-to-Queue dispatch binding.
   */
  @Remote('startChange')
  async startChange(
    input: DeliveryStartChangeInput,
    signal: AbortSignal,
  ): Promise<DeliveryDispatchBindingView> {
    requireActive(signal, 'startChange')
    const admission = guardedAdmission({
      delivery: this.ctx.delivery,
      queue: this.queue,
      repoWorkspace: this.ctx.repoWorkspace,
    }, signal, 'startChange')
    try {
      const binding = await this.internals.startCodeChange(admission.dependencies, {
        packetId: WorkPacketId(input.packetId),
        executorId: ExecutorId(input.executorId),
      })
      return projectDispatchBinding(binding)
    } catch (error) {
      throw remoteFailure('startChange', error, admission.failureSignal())
    }
  }

  /**
   * Start independent verification from one bound change dispatch.
   * @param input - Operator-selected Packet and bound change dispatch.
   * @param signal - Operation-local Remote cancellation.
   * @returns the Delivery-to-Queue verification dispatch binding.
   */
  @Remote('startVerification')
  async startVerification(
    input: DeliveryStartVerificationInput,
    signal: AbortSignal,
  ): Promise<DeliveryDispatchBindingView> {
    requireActive(signal, 'startVerification')
    const admission = guardedAdmission({
      delivery: this.ctx.delivery,
      queue: this.queue,
      repoWorkspace: this.ctx.repoWorkspace,
    }, signal, 'startVerification')
    try {
      const binding = await this.internals.startVerification(admission.dependencies, {
        packetId: WorkPacketId(input.packetId),
        changeBindingId: DispatchBindingId(input.changeBindingId),
      })
      return projectDispatchBinding(binding)
    } catch (error) {
      throw remoteFailure(
        'startVerification',
        error,
        admission.failureSignal(),
      )
    }
  }

  /**
   * Resolve and integrity-read one browser-selected evidence id.
   * @param input - Existing evidence identity only; no URI or host path.
   * @param signal - Operation-local Remote cancellation.
   * @returns metadata without provider URI plus base64-encoded immutable bytes.
   */
  @Remote('readEvidence')
  async readEvidence(
    input: DeliveryReadEvidenceInput,
    signal: AbortSignal,
  ): Promise<DeliveryEvidenceView> {
    requireActive(signal, 'readEvidence')
    try {
      const evidenceId = EvidenceId(String(input.evidenceId))
      const reference = await this.ctx.deliveryEvidence.resolve(evidenceId, signal)
      if (reference === undefined) {
        throw new DeliveryEvidenceError('not-found', 'The selected Delivery evidence does not exist')
      }
      if (reference.byteLength > MAX_BROWSER_EVIDENCE_BYTES) {
        throw new DeliveryEvidenceError('length-mismatch', 'The selected evidence exceeds the browser read limit')
      }
      const stored = await this.ctx.deliveryEvidence.read(reference, signal)
      if (stored.ref.id !== evidenceId) {
        throw new DeliveryEvidenceError('reference-mismatch', 'Evidence read returned a different object')
      }
      if (
        stored.ref.byteLength > MAX_BROWSER_EVIDENCE_BYTES
        || stored.data.byteLength !== stored.ref.byteLength
      ) {
        throw new DeliveryEvidenceError('length-mismatch', 'Evidence read returned an invalid byte length')
      }
      return {
        id: stored.ref.id,
        kind: stored.ref.kind,
        mediaType: stored.ref.mediaType,
        byteLength: stored.ref.byteLength,
        digest: stored.ref.digest,
        createdAt: stored.ref.createdAt,
        provenance: stored.ref.provenance,
        contentBase64: Buffer.from(stored.data).toString('base64'),
      }
    } catch (error) {
      throw remoteFailure('readEvidence', error, signal)
    }
  }

  /**
   * Persist one explicit human acceptance, rejection, or waiver.
   * @param input - Human decision and the two bound dispatch selections.
   * @param signal - Operation-local Remote cancellation.
   * @returns the acceptance decision attributed by trusted operator context.
   */
  @Remote('recordDecision')
  async recordDecision(
    input: DeliveryRecordDecisionInput,
    signal: AbortSignal,
  ): Promise<DeliveryAcceptanceDecisionView> {
    requireActive(signal, 'recordDecision')
    try {
      const packetId = WorkPacketId(input.packetId)
      if (this.ctx.delivery.getWorkPacket(packetId)?.id !== packetId) {
        throw new DeliveryError('not-found', 'The selected Work Packet does not exist')
      }
      const changeBindingId = DispatchBindingId(input.changeBindingId)
      const verificationBindingId = DispatchBindingId(input.verificationBindingId)
      const changeBinding = requireBound(
        this.ctx.delivery.getDispatchBinding(changeBindingId),
        changeBindingId,
        packetId,
        'code.change@1',
      )
      const verificationBinding = requireBound(
        this.ctx.delivery.getDispatchBinding(verificationBindingId),
        verificationBindingId,
        packetId,
        'code.verify@1',
      )
      const candidate = resolveAcceptanceCandidate(
        this.queue,
        changeBinding.queueWorkId,
        verificationBinding.queueWorkId,
      )
      const resolveEvidence: AcceptanceEvidenceResolver = async (evidenceId) => {
        requireActive(signal, 'recordDecision')
        const reference = await this.ctx.deliveryEvidence.resolve(evidenceId, signal)
        if (reference === undefined) return undefined
        const stored = await this.ctx.deliveryEvidence.read(reference, signal)
        if (stored.ref.id !== evidenceId) {
          throw new DeliveryEvidenceError('reference-mismatch', 'Evidence read returned a different object')
        }
        return stored.ref
      }
      const decision = await this.ctx.delivery.recordAcceptanceDecision({
        idempotencyKey: `delivery:${packetId}:decision:${candidate.verificationVerdict.targetCommit}:${input.decisionNonce}`,
        packetId,
        changeBindingId,
        verificationBindingId,
        decision: input.decision,
        reason: input.reason,
        actorId: this.operatorId,
        decisionNonce: input.decisionNonce,
      }, (changeQueueWorkId: QueueWorkIdRef, verificationQueueWorkId: QueueWorkIdRef) => {
        if (
          changeQueueWorkId !== changeBinding.queueWorkId
          || verificationQueueWorkId !== verificationBinding.queueWorkId
        ) {
          throw new DeliveryAcceptanceCandidateError('Delivery requested facts for unexpected Queue Work ids')
        }
        return Promise.resolve(candidate)
      }, resolveEvidence)
      return projectAcceptanceDecision(decision)
    } catch (error) {
      throw remoteFailure('recordDecision', error, signal)
    }
  }
}

export default DeliveryRemoteService
