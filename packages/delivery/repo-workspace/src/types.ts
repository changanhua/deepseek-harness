/** Public lifecycle types for isolated Delivery Git workspaces. @module @deepseek-ai/dsh-repo-workspace/types */

import type {
  BaseSelectionRule,
  GitBlobId,
  GitCommitId,
  QueueAttemptIdRef,
  RepositoryId,
  RepositoryRelativePath,
} from '@deepseek-ai/dsh-delivery-protocol'

declare const verifiedRepositoryRevisionBrand: unique symbol
declare const verifiedRepositoryBaseBrand: unique symbol
declare const verifiedRepositoryBlobBrand: unique symbol

/** Existing full commit resolved through one configured repository identity. */
export interface VerifiedRepositoryRevision {
  readonly repositoryId: RepositoryId
  readonly commit: GitCommitId
  /** Compile-time proof minted only by a RepositoryWorkspace provider. */
  readonly [verifiedRepositoryRevisionBrand]: true
}

/** Contract-selected base resolved to one immutable full commit by a repository provider. */
export interface VerifiedRepositoryBase extends VerifiedRepositoryRevision {
  /** Exact Contract rule whose point-in-time resolution produced {@link commit}. */
  readonly selectionRule: BaseSelectionRule
  /** Compile-time proof minted only by a RepositoryWorkspace provider. */
  readonly [verifiedRepositoryBaseBrand]: true
}

/** Resolve one Contract base-selection rule without creating a checkout. */
export interface ResolveRepositoryBaseRequest {
  readonly repositoryId: RepositoryId
  readonly selectionRule: BaseSelectionRule
  readonly signal?: AbortSignal
}

/** Resolve and verify one full commit without creating a checkout. */
export interface InspectRepositoryRevisionRequest {
  readonly repositoryId: RepositoryId
  readonly commit: GitCommitId
  readonly signal?: AbortSignal
}

/** Read one bounded blob from the exact tree selected as a Contract base. */
export interface ReadRepositoryBlobRequest {
  readonly base: VerifiedRepositoryBase
  readonly path: RepositoryRelativePath
  /** Positive safe-integer complete blob limit checked before any bytes are returned. */
  readonly maxBytes: number
  readonly signal?: AbortSignal
}

/**
 * Git-derived blob proof pinned to one verified base commit and path.
 * Metadata is frozen. `bytes` is a fresh detached copy on every read, so
 * caller mutation cannot alter repository authority or a later result.
 */
export interface VerifiedRepositoryBlob {
  readonly repositoryId: RepositoryId
  readonly commit: GitCommitId
  readonly path: RepositoryRelativePath
  readonly blobId: GitBlobId
  readonly bytes: Uint8Array
  /** Compile-time proof minted only after the provider reads the named Git blob. */
  readonly [verifiedRepositoryBlobBrand]: true
}

/** Compare two already verified commits from the same configured repository. */
export interface InspectRepositoryRangeRequest {
  readonly base: VerifiedRepositoryRevision
  readonly target: VerifiedRepositoryRevision
  readonly signal?: AbortSignal
}

/** Immutable Git facts for one base-to-target comparison. */
export interface RepositoryRangeFacts {
  readonly repositoryId: RepositoryId
  readonly baseCommit: GitCommitId
  readonly targetCommit: GitCommitId
  readonly descendsFromBase: boolean
  readonly changedPaths: readonly RepositoryRelativePath[]
}

/** Create or recover the change checkout owned by one Queue Attempt. */
export interface OpenChangeWorkspaceRequest {
  readonly ownerAttemptId: QueueAttemptIdRef
  readonly base: VerifiedRepositoryRevision
  readonly signal?: AbortSignal
}

/** Create or recover an isolated verifier checkout at one exact target commit. */
export interface OpenVerificationWorkspaceRequest {
  readonly ownerAttemptId: QueueAttemptIdRef
  readonly base: VerifiedRepositoryRevision
  readonly target: VerifiedRepositoryRevision
  readonly signal?: AbortSignal
}

/** Whether closing a lease removes its checkout or retains it for operator recovery. */
export type RepositoryWorkspaceDisposition = 'remove' | 'preserve'

/** Operation-owned isolated checkout. The absolute cwd is never durable authority. */
export interface RepositoryWorkspaceLease {
  readonly ownerAttemptId: QueueAttemptIdRef
  readonly repositoryId: RepositoryId
  readonly cwd: string
  /**
   * Finish ownership after all child processes quiesce.
   * @param disposition - Remove a settled checkout or preserve uncertain work.
   * @returns after provider cleanup or preservation is complete.
   */
  close(disposition: RepositoryWorkspaceDisposition): Promise<void>
}

/** Request to create a governed checkpoint after the executor is quiescent. */
export interface CreateCheckpointRequest {
  readonly message: string
  readonly signal?: AbortSignal
}

/** Git-derived checkpoint facts; caller prose cannot supply these values. */
export interface RepositoryCheckpoint {
  readonly repositoryId: RepositoryId
  readonly baseCommit: GitCommitId
  readonly checkpointCommit: GitCommitId
  readonly changedPaths: readonly RepositoryRelativePath[]
  readonly clean: true
  readonly descendsFromBase: true
}

/** Writable Attempt checkout whose only Git mutation is governed checkpoint creation. */
export interface ChangeWorkspaceLease extends RepositoryWorkspaceLease {
  readonly baseCommit: GitCommitId
  /**
   * Commit the complete checkout state and return independently derived Git facts.
   * @param request - Non-blank commit message and optional cancellation.
   * @returns the clean checkpoint and complete changed-path set.
   */
  checkpoint(request: CreateCheckpointRequest): Promise<RepositoryCheckpoint>
}

/** Read/execute-only isolated checkout pinned to one verification target. */
export interface VerificationWorkspaceLease extends RepositoryWorkspaceLease {
  readonly baseCommit: GitCommitId
  readonly targetCommit: GitCommitId
}

/** Provider-independent repository workspace failures. */
export type RepositoryWorkspaceErrorCode =
  | 'unavailable'
  | 'repository-not-found'
  | 'revision-not-found'
  | 'reference-not-found'
  | 'blob-not-found'
  | 'blob-too-large'
  | 'repository-mismatch'
  | 'owner-conflict'
  | 'checkpoint-failed'
  | 'cleanup-failed'
