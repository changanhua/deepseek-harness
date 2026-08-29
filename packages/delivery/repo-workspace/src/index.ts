/** Repository identity and isolated Git workspace Service Definition (`ctx.repoWorkspace`). @module @deepseek-ai/dsh-repo-workspace */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  BaseSelectionRule,
  GitBlobId,
  GitCommitId,
  RepositoryId,
  RepositoryRelativePath,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  ChangeWorkspaceLease,
  InspectRepositoryRangeRequest,
  InspectRepositoryRevisionRequest,
  OpenChangeWorkspaceRequest,
  OpenVerificationWorkspaceRequest,
  ReadRepositoryBlobRequest,
  RepositoryRangeFacts,
  RepositoryWorkspaceErrorCode,
  ResolveRepositoryBaseRequest,
  VerificationWorkspaceLease,
  VerifiedRepositoryBase,
  VerifiedRepositoryBlob,
  VerifiedRepositoryRevision,
} from './types.ts'

export type {
  ChangeWorkspaceLease,
  CreateCheckpointRequest,
  InspectRepositoryRangeRequest,
  InspectRepositoryRevisionRequest,
  OpenChangeWorkspaceRequest,
  OpenVerificationWorkspaceRequest,
  ReadRepositoryBlobRequest,
  RepositoryCheckpoint,
  RepositoryRangeFacts,
  RepositoryWorkspaceDisposition,
  RepositoryWorkspaceErrorCode,
  RepositoryWorkspaceLease,
  ResolveRepositoryBaseRequest,
  VerificationWorkspaceLease,
  VerifiedRepositoryBase,
  VerifiedRepositoryBlob,
  VerifiedRepositoryRevision,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    repoWorkspace: RepositoryWorkspace
  }
}

/** Error with a stable classification shared by repository workspace providers and Consumers. */
export class RepositoryWorkspaceError extends Error {
  /**
   * @param code - Stable provider-independent failure classification.
   * @param message - Human-readable diagnostic.
   * @param options - Optional underlying failure.
   */
  constructor(readonly code: RepositoryWorkspaceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RepositoryWorkspaceError'
  }
}

/**
 * Configured repository resolver and Attempt-owned isolated checkout factory.
 * Inspection performs no checkout or process side effect. Opened leases expose
 * an operation-local absolute cwd and retain ownership until awaited close.
 */
export abstract class RepositoryWorkspace extends Service {
  constructor(ctx: Context) {
    super(ctx, 'repoWorkspace')
  }

  /**
   * Mint a provider proof after repository identity and full commit existence have been checked.
   * @param repositoryId - Configured repository identity.
   * @param commit - Existing full commit object id.
   * @returns the opaque same-process verification proof.
   */
  protected verifiedRevision(repositoryId: RepositoryId, commit: GitCommitId): VerifiedRepositoryRevision {
    return Object.freeze({ repositoryId, commit }) as VerifiedRepositoryRevision
  }

  /**
   * Mint a proof that one exact Contract rule resolved to one full base commit.
   * @param repositoryId - Configured repository identity.
   * @param selectionRule - Exact immutable Contract base-selection rule.
   * @param commit - Full commit object id resolved from that rule.
   * @returns the frozen same-process base proof.
   */
  protected verifiedBase(
    repositoryId: RepositoryId,
    selectionRule: BaseSelectionRule,
    commit: GitCommitId,
  ): VerifiedRepositoryBase {
    const frozenRule = Object.freeze({ ...selectionRule }) as BaseSelectionRule
    return Object.freeze({ repositoryId, commit, selectionRule: frozenRule }) as VerifiedRepositoryBase
  }

  /**
   * Mint exact-commit/path/blob-id metadata with detached bytes.
   * @param base - Provider-minted Contract base proof.
   * @param path - Repository-relative path resolved within the exact base tree.
   * @param blobId - Git object id returned for the path at that base commit.
   * @param bytes - Complete blob bytes read from Git object storage, never a checkout path.
   * @returns frozen metadata carrying a fresh byte copy.
   */
  protected verifiedBlob(
    base: VerifiedRepositoryBase,
    path: RepositoryRelativePath,
    blobId: GitBlobId,
    bytes: Uint8Array,
  ): VerifiedRepositoryBlob {
    return Object.freeze({
      repositoryId: base.repositoryId,
      commit: base.commit,
      path,
      blobId,
      bytes: bytes.slice(),
    }) as VerifiedRepositoryBlob
  }

  /**
   * Resolve a Contract base-selection rule and prove its point-in-time full commit.
   * A `ref-head` result captures the ref value observed by this operation; later
   * ref movement cannot alter the returned proof.
   * @param request - Configured repository, exact Contract rule, and cancellation.
   * @returns a provider-minted immutable base proof.
   */
  abstract resolveBase(request: ResolveRepositoryBaseRequest): Promise<VerifiedRepositoryBase>

  /**
   * Resolve a configured repository and prove that it contains one full commit.
   * @param request - Stable repository id, full commit, and optional cancellation.
   * @returns an opaque proof safe to pass to Delivery and checkout operations.
   */
  abstract inspectRevision(request: InspectRepositoryRevisionRequest): Promise<VerifiedRepositoryRevision>

  /**
   * Read and prove one complete bounded blob from an exact verified base tree.
   * Providers resolve `base.commit:path` through Git object storage; a checkout
   * cwd or ambient filesystem path is never authoritative.
   * @param request - Verified base, normalized path, explicit byte limit, and cancellation.
   * @returns exact Git metadata plus fresh detached bytes.
   */
  abstract readBlob(request: ReadRepositoryBlobRequest): Promise<VerifiedRepositoryBlob>

  /**
   * Derive ancestry and the complete changed-path set for two verified revisions.
   * @param request - Verified base and target in the same repository.
   * @returns ancestry and changed-path facts; non-ancestry resolves as `false`.
   */
  abstract inspectRange(request: InspectRepositoryRangeRequest): Promise<RepositoryRangeFacts>

  /**
   * Open the writable checkout owned by one change Attempt.
   * @param request - Attempt identity and verified base revision.
   * @returns an idempotently recovered or newly created change lease.
   */
  abstract openChange(request: OpenChangeWorkspaceRequest): Promise<ChangeWorkspaceLease>

  /**
   * Open an isolated checkout pinned to one verification target.
   * @param request - Attempt identity plus verified base and target revisions.
   * @returns an idempotently recovered or newly created verification lease.
   */
  abstract openVerification(request: OpenVerificationWorkspaceRequest): Promise<VerificationWorkspaceLease>
}

export default RepositoryWorkspace
