/** Scriptable in-memory provider for repository identity and checkout lifecycles. */

/* oxlint-disable typescript/require-await -- keep fake failures on the asynchronous Service contract without artificial I/O */

import { Service, type Context } from '@deepseek-ai/cordis'
import {
  canonicalJson,
  type BaseSelectionRule,
  type GitBlobId,
  type GitCommitId,
  type QueueAttemptIdRef,
  type RepositoryId,
  type RepositoryRelativePath,
} from '@deepseek-ai/dsh-delivery-protocol'
import RepositoryWorkspace, {
  RepositoryWorkspaceError,
  type ChangeWorkspaceLease,
  type CreateCheckpointRequest,
  type InspectRepositoryRangeRequest,
  type InspectRepositoryRevisionRequest,
  type OpenChangeWorkspaceRequest,
  type OpenVerificationWorkspaceRequest,
  type ReadRepositoryBlobRequest,
  type RepositoryCheckpoint,
  type RepositoryRangeFacts,
  type RepositoryWorkspaceDisposition,
  type ResolveRepositoryBaseRequest,
  type VerificationWorkspaceLease,
  type VerifiedRepositoryBase,
  type VerifiedRepositoryBlob,
  type VerifiedRepositoryRevision,
} from '@deepseek-ai/dsh-repo-workspace'

/** One scripted writable checkout returned by the next distinct change owner. */
export interface FakeChangeWorkspacePlan {
  readonly cwd: string
  readonly checkpoint: RepositoryCheckpoint | Error
  readonly closeError?: Error
}

/** One scripted exact-target checkout returned by the next distinct verifier owner. */
export interface FakeVerificationWorkspacePlan {
  readonly cwd: string
  readonly closeError?: Error
}

/** One immutable blob scripted at an exact repository commit and path. */
export interface FakeRepositoryBlob {
  readonly repositoryId: RepositoryId
  readonly commit: GitCommitId
  readonly path: RepositoryRelativePath
  readonly blobId: GitBlobId
  readonly bytes: Uint8Array
}

/** Common observability exposed by a fake lease without weakening its production face. */
export interface FakeWorkspaceLeaseProbe {
  readonly closeCalls: readonly RepositoryWorkspaceDisposition[]
}

abstract class FakeWorkspaceLeaseLifecycle implements FakeWorkspaceLeaseProbe {
  readonly closeCalls: RepositoryWorkspaceDisposition[] = []
  private closed: RepositoryWorkspaceDisposition | undefined

  constructor(private readonly closeError?: Error) {}

  protected assertOpen(): void {
    if (this.closed !== undefined) {
      throw new RepositoryWorkspaceError('checkpoint-failed', 'cannot use a closed fake workspace')
    }
  }

  async close(disposition: RepositoryWorkspaceDisposition): Promise<void> {
    if (this.closed !== undefined) {
      if (this.closed !== disposition) {
        throw new RepositoryWorkspaceError('owner-conflict', 'fake workspace was already closed with another disposition')
      }
      return
    }
    this.closeCalls.push(disposition)
    if (this.closeError !== undefined) throw this.closeError
    this.closed = disposition
  }
}

/** Writable fake lease with recorded checkpoint and close calls. */
export class FakeChangeWorkspaceLease extends FakeWorkspaceLeaseLifecycle implements ChangeWorkspaceLease {
  /** Fresh snapshots of every accepted checkpoint request in call order. */
  readonly checkpointCalls: CreateCheckpointRequest[] = []

  constructor(
    readonly ownerAttemptId: QueueAttemptIdRef,
    readonly repositoryId: RepositoryId,
    readonly baseCommit: GitCommitId,
    readonly cwd: string,
    private readonly outcome: RepositoryCheckpoint | Error,
    closeError?: Error,
  ) {
    super(closeError)
  }

  async checkpoint(request: CreateCheckpointRequest): Promise<RepositoryCheckpoint> {
    request.signal?.throwIfAborted()
    this.assertOpen()
    if (request.message.trim().length === 0) throw new RepositoryWorkspaceError('checkpoint-failed', 'checkpoint message must be non-blank')
    this.checkpointCalls.push({ ...request })
    if (this.outcome instanceof Error) throw this.outcome
    if (this.outcome.repositoryId !== this.repositoryId || this.outcome.baseCommit !== this.baseCommit) {
      throw new Error('delivery-testkit: scripted checkpoint does not match its lease repository and base')
    }
    return structuredClone(this.outcome)
  }
}

/** Exact-target fake lease with recorded close calls. */
export class FakeVerificationWorkspaceLease extends FakeWorkspaceLeaseLifecycle implements VerificationWorkspaceLease {
  constructor(
    readonly ownerAttemptId: QueueAttemptIdRef,
    readonly repositoryId: RepositoryId,
    readonly baseCommit: GitCommitId,
    readonly targetCommit: GitCommitId,
    readonly cwd: string,
    closeError?: Error,
  ) {
    super(closeError)
  }
}

type OwnedLease =
  | {
    readonly kind: 'change'
    readonly signature: string
    readonly lease: ChangeWorkspaceLease
  }
  | {
    readonly kind: 'verification'
    readonly signature: string
    readonly lease: VerificationWorkspaceLease
  }

/**
 * Scriptable repository provider. Every revision, ref, blob, and range must
 * be admitted explicitly, and every new owner consumes one queued lease plan.
 * An unstubbed call fails loud instead of inventing Git behavior.
 */
export class FakeRepositoryWorkspace extends RepositoryWorkspace {
  /** Base-resolution requests observed before scripted resolution. */
  readonly resolveBaseCalls: ResolveRepositoryBaseRequest[] = []
  /** Exact-commit inspection requests observed by the fake. */
  readonly revisionCalls: InspectRepositoryRevisionRequest[] = []
  /** Exact-base blob reads observed before scripted lookup. */
  readonly readBlobCalls: ReadRepositoryBlobRequest[] = []
  /** Verified range inspections observed by the fake. */
  readonly rangeCalls: InspectRepositoryRangeRequest[] = []
  /** Writable workspace requests observed before lease recovery or allocation. */
  readonly openChangeCalls: OpenChangeWorkspaceRequest[] = []
  /** Verification workspace requests observed before lease recovery or allocation. */
  readonly openVerificationCalls: OpenVerificationWorkspaceRequest[] = []
  private readonly revisions = new Set<string>()
  private readonly refs = new Map<string, GitCommitId>()
  private readonly verifiedBases = new Set<string>()
  private readonly blobs = new Map<string, Omit<FakeRepositoryBlob, 'repositoryId' | 'commit' | 'path'>>()
  private readonly ranges = new Map<string, RepositoryRangeFacts>()
  private readonly changePlans: FakeChangeWorkspacePlan[] = []
  private readonly verificationPlans: FakeVerificationWorkspacePlan[] = []
  private readonly leases = new Map<QueueAttemptIdRef, OwnedLease>()

  /** @param ctx - test context that owns this fake provider. */
  constructor(ctx: Context) {
    super(ctx)
    // Test controls intentionally expose the registered concrete fake rather than a per-read trace proxy.
    Object.defineProperty(this, Service.tracker, { value: undefined })
  }

  /**
   * Admit one configured repository/full-commit pair for later inspection.
   * @param repositoryId - configured repository identity.
   * @param commit - full commit object id.
   */
  allowRevision(repositoryId: RepositoryId, commit: GitCommitId): void {
    this.revisions.add(this.revisionKey(repositoryId, commit))
  }

  /**
   * Resolve one scripted ref head and admit its resulting full commit.
   * @param repositoryId - configured repository identity.
   * @param ref - exact non-blank Contract ref selector.
   * @param commit - full commit observed when the ref is resolved.
   */
  allowBaseRef(repositoryId: RepositoryId, ref: string, commit: GitCommitId): void {
    if (ref.trim().length === 0) throw new TypeError('delivery-testkit: a base ref must be non-blank')
    this.allowRevision(repositoryId, commit)
    this.refs.set(this.refKey(repositoryId, ref), commit)
  }

  /**
   * Script one blob at an exact commit and retain a detached authoritative copy.
   * @param blob - exact repository, commit, normalized path, object id, and bytes.
   */
  allowBlob(blob: FakeRepositoryBlob): void {
    this.allowRevision(blob.repositoryId, blob.commit)
    this.blobs.set(this.blobKey(blob.repositoryId, blob.commit, blob.path), {
      blobId: blob.blobId,
      bytes: blob.bytes.slice(),
    })
  }

  /**
   * Script one exact range result and admit both revisions.
   * @param facts - ancestry and changed paths to return.
   */
  allowRange(facts: RepositoryRangeFacts): void {
    this.allowRevision(facts.repositoryId, facts.baseCommit)
    this.allowRevision(facts.repositoryId, facts.targetCommit)
    this.ranges.set(this.rangeKey(facts.repositoryId, facts.baseCommit, facts.targetCommit), structuredClone(facts))
  }

  /**
   * Queue a writable checkout for the next new owner.
   * @param plan - cwd, checkpoint result, and optional cleanup failure.
   */
  queueChangeWorkspace(plan: FakeChangeWorkspacePlan): void {
    this.changePlans.push(plan)
  }

  /**
   * Queue an exact-target checkout for the next new verifier owner.
   * @param plan - cwd and optional cleanup failure.
   */
  queueVerificationWorkspace(plan: FakeVerificationWorkspacePlan): void {
    this.verificationPlans.push(plan)
  }

  /**
   * Resolve a scripted Contract base rule to its point-in-time commit proof.
   * @param request - configured repository, exact selection rule, and cancellation.
   * @returns a provider-minted frozen base proof.
   */
  async resolveBase(request: ResolveRepositoryBaseRequest): Promise<VerifiedRepositoryBase> {
    request.signal?.throwIfAborted()
    const selectionRule = { ...request.selectionRule } as BaseSelectionRule
    this.resolveBaseCalls.push({ ...request, selectionRule })
    let commit: GitCommitId
    if (selectionRule.kind === 'commit') {
      commit = selectionRule.commit
      if (!this.revisions.has(this.revisionKey(request.repositoryId, commit))) {
        throw new RepositoryWorkspaceError(
          'revision-not-found',
          `fake repository '${request.repositoryId}' has no commit '${commit}'`,
        )
      }
    } else {
      const resolved = this.refs.get(this.refKey(request.repositoryId, selectionRule.ref))
      if (resolved === undefined) {
        throw new RepositoryWorkspaceError(
          'reference-not-found',
          `fake repository '${request.repositoryId}' has no ref '${selectionRule.ref}'`,
        )
      }
      commit = resolved
    }
    request.signal?.throwIfAborted()
    const base = this.verifiedBase(request.repositoryId, selectionRule, commit)
    this.verifiedBases.add(this.baseKey(base))
    return base
  }

  async inspectRevision(request: InspectRepositoryRevisionRequest): Promise<VerifiedRepositoryRevision> {
    request.signal?.throwIfAborted()
    this.revisionCalls.push({ ...request })
    if (!this.revisions.has(this.revisionKey(request.repositoryId, request.commit))) {
      throw new RepositoryWorkspaceError('revision-not-found', `fake repository '${request.repositoryId}' has no commit '${request.commit}'`)
    }
    return this.verifiedRevision(request.repositoryId, request.commit)
  }

  /**
   * Read one scripted blob through the exact verified base and complete byte bound.
   * @param request - provider-minted base, normalized path, byte limit, and cancellation.
   * @returns frozen Git metadata carrying fresh detached bytes.
   */
  async readBlob(request: ReadRepositoryBlobRequest): Promise<VerifiedRepositoryBlob> {
    request.signal?.throwIfAborted()
    this.readBlobCalls.push({ ...request })
    this.assertAllowedBase(request.base)
    if (!Number.isSafeInteger(request.maxBytes) || request.maxBytes <= 0) {
      throw new TypeError('delivery-testkit: maxBytes must be a positive safe integer')
    }
    const key = this.blobKey(request.base.repositoryId, request.base.commit, request.path)
    const blob = this.blobs.get(key)
    if (blob === undefined) {
      throw new RepositoryWorkspaceError(
        'blob-not-found',
        `fake repository has no blob '${request.path}' at '${request.base.commit}'`,
      )
    }
    if (blob.bytes.byteLength > request.maxBytes) {
      throw new RepositoryWorkspaceError(
        'blob-too-large',
        `fake repository blob is ${blob.bytes.byteLength} bytes; limit is ${request.maxBytes}`,
      )
    }
    request.signal?.throwIfAborted()
    return this.verifiedBlob(request.base, request.path, blob.blobId, blob.bytes)
  }

  async inspectRange(request: InspectRepositoryRangeRequest): Promise<RepositoryRangeFacts> {
    request.signal?.throwIfAborted()
    this.rangeCalls.push({ ...request })
    if (request.base.repositoryId !== request.target.repositoryId) {
      throw new RepositoryWorkspaceError('repository-mismatch', 'range revisions belong to different repositories')
    }
    const key = this.rangeKey(request.base.repositoryId, request.base.commit, request.target.commit)
    const facts = this.ranges.get(key)
    if (facts === undefined) throw new Error(`delivery-testkit: no range was scripted for ${key}`)
    return structuredClone(facts)
  }

  async openChange(request: OpenChangeWorkspaceRequest): Promise<ChangeWorkspaceLease> {
    request.signal?.throwIfAborted()
    this.openChangeCalls.push({ ...request })
    this.assertAllowed(request.base)
    const signature = canonicalJson({ kind: 'change', repositoryId: request.base.repositoryId, baseCommit: request.base.commit })
    const prior = this.leases.get(request.ownerAttemptId)
    if (prior !== undefined) return this.reuseChange(prior, signature)
    const plan = this.changePlans.shift()
    if (plan === undefined) throw new Error('delivery-testkit: no change workspace was scripted')
    const lease = new FakeChangeWorkspaceLease(
      request.ownerAttemptId,
      request.base.repositoryId,
      request.base.commit,
      plan.cwd,
      plan.checkpoint,
      plan.closeError,
    )
    this.leases.set(request.ownerAttemptId, { kind: 'change', signature, lease })
    return lease
  }

  async openVerification(request: OpenVerificationWorkspaceRequest): Promise<VerificationWorkspaceLease> {
    request.signal?.throwIfAborted()
    this.openVerificationCalls.push({ ...request })
    this.assertAllowed(request.base)
    this.assertAllowed(request.target)
    if (request.base.repositoryId !== request.target.repositoryId) {
      throw new RepositoryWorkspaceError('repository-mismatch', 'verification revisions belong to different repositories')
    }
    const signature = canonicalJson({
      kind: 'verification',
      repositoryId: request.base.repositoryId,
      baseCommit: request.base.commit,
      targetCommit: request.target.commit,
    })
    const prior = this.leases.get(request.ownerAttemptId)
    if (prior !== undefined) return this.reuseVerification(prior, signature)
    const plan = this.verificationPlans.shift()
    if (plan === undefined) throw new Error('delivery-testkit: no verification workspace was scripted')
    const lease = new FakeVerificationWorkspaceLease(
      request.ownerAttemptId,
      request.base.repositoryId,
      request.base.commit,
      request.target.commit,
      plan.cwd,
      plan.closeError,
    )
    this.leases.set(request.ownerAttemptId, { kind: 'verification', signature, lease })
    return lease
  }

  private assertAllowed(revision: VerifiedRepositoryRevision): void {
    if (!this.revisions.has(this.revisionKey(revision.repositoryId, revision.commit))) {
      throw new RepositoryWorkspaceError('revision-not-found', 'unverified repository revision was passed to the fake provider')
    }
  }

  private assertAllowedBase(base: VerifiedRepositoryBase): void {
    if (!this.verifiedBases.has(this.baseKey(base))) {
      throw new RepositoryWorkspaceError('revision-not-found', 'unverified repository base was passed to the fake provider')
    }
  }

  private reuseChange(prior: OwnedLease, signature: string): ChangeWorkspaceLease {
    if (prior.kind !== 'change') {
      throw new RepositoryWorkspaceError('owner-conflict', 'one Attempt owner cannot change workspace purpose')
    }
    if (prior.signature !== signature) {
      throw new RepositoryWorkspaceError('owner-conflict', 'one Attempt owner cannot identify different repository workspaces')
    }
    return prior.lease
  }

  private reuseVerification(prior: OwnedLease, signature: string): VerificationWorkspaceLease {
    if (prior.kind !== 'verification') {
      throw new RepositoryWorkspaceError('owner-conflict', 'one Attempt owner cannot change workspace purpose')
    }
    if (prior.signature !== signature) {
      throw new RepositoryWorkspaceError('owner-conflict', 'one Attempt owner cannot identify different repository workspaces')
    }
    return prior.lease
  }

  private revisionKey(repositoryId: RepositoryId, commit: GitCommitId): string {
    return `${repositoryId}\0${commit}`
  }

  private refKey(repositoryId: RepositoryId, ref: string): string {
    return `${repositoryId}\0${ref}`
  }

  private baseKey(base: VerifiedRepositoryBase): string {
    return canonicalJson({
      repositoryId: base.repositoryId,
      commit: base.commit,
      selectionRule: base.selectionRule,
    })
  }

  private blobKey(
    repositoryId: RepositoryId,
    commit: GitCommitId,
    path: RepositoryRelativePath,
  ): string {
    return `${repositoryId}\0${commit}\0${path}`
  }

  private rangeKey(repositoryId: RepositoryId, base: GitCommitId, target: GitCommitId): string {
    return `${repositoryId}\0${base}\0${target}`
  }
}
