/**
 * GitHub Issue snapshot intake Consumer for Personal Delivery.
 *
 * @module @deepseek-ai/dsh-delivery-github-intake
 */

import type Delivery from '@deepseek-ai/dsh-delivery'
import type {
  ContractRevision,
  RepositoryId,
} from '@deepseek-ai/dsh-delivery-protocol'
import { parseCanonicalGitHubIssueUrl } from '@deepseek-ai/dsh-delivery-protocol'

export {
  DELIVERY_WORK_BRIEF_MARKER,
  DELIVERY_WORK_BRIEF_MAX_BYTES,
  GitHubIssueWorkBriefError,
  gitHubIssueWorkBriefSchema,
  parseGitHubIssueWorkBrief,
  workBriefContractRevisionDraft,
} from './work-brief.ts'
export type {
  GitHubIssueWorkBrief,
  GitHubIssueWorkBriefErrorCode,
} from './work-brief.ts'

/** Stable GitHub intake failure classification. */
export type DeliveryGitHubIntakeErrorCode =
  | 'invalid-request'
  | 'unavailable'

/** Typed failure emitted by the GitHub Issue intake boundary. */
export class DeliveryGitHubIntakeError extends Error {
  /**
   * @param code - Stable intake failure classification.
   * @param message - Human-readable diagnostic.
   * @param options - Optional underlying failure.
   */
  constructor(
    readonly code: DeliveryGitHubIntakeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'DeliveryGitHubIntakeError'
  }
}

/** Explicit dependencies for importing and adopting one Issue snapshot. */
export interface GitHubIssueIntakeDependencies {
  readonly delivery: Pick<Delivery, 'adoptContractRevision' | 'snapshot'>
  readonly fetch: typeof globalThis.fetch
}

/** Operator-selected coordinates for one exact GitHub Issue adoption. */
export interface ImportGitHubIssueRequest {
  readonly issueUrl: string
  readonly repositoryId: RepositoryId
  readonly signal?: AbortSignal
}

/**
 * Fetch, parse, and idempotently adopt one exact GitHub Issue snapshot.
 *
 * @param dependencies - Delivery adoption boundary and host-provided fetch.
 * @param request - Canonical Issue URL plus its required configured repository link.
 * @returns the adopted immutable Contract revision.
 */
export function importGitHubIssue(
  dependencies: GitHubIssueIntakeDependencies,
  request: ImportGitHubIssueRequest,
): Promise<ContractRevision> {
  void dependencies
  if (parseCanonicalGitHubIssueUrl(request.issueUrl) === undefined) {
    return Promise.reject(new DeliveryGitHubIntakeError(
      'invalid-request',
      'GitHub Issue intake requires a canonical public github.com Issue URL',
    ))
  }
  return Promise.reject(new DeliveryGitHubIntakeError(
    'unavailable',
    'GitHub Issue intake implementation is not installed; snapshot parsing and adoption remain unavailable',
  ))
}
