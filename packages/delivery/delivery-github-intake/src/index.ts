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
import {
  DELIVERY_SCHEMA_VERSION,
  SourceRefId,
  parseCanonicalGitHubIssueUrl,
  sourceRefContentDigest,
  sourceRefSchema,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  parseGitHubIssueWorkBrief,
  workBriefContractRevisionDraft,
} from './work-brief.ts'

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
  | 'http-failure'
  | 'invalid-response'
  | 'network-failure'
  | 'aborted'

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
export async function importGitHubIssue(
  dependencies: GitHubIssueIntakeDependencies,
  request: ImportGitHubIssueRequest,
): Promise<ContractRevision> {
  const coordinates = parseCanonicalGitHubIssueUrl(request.issueUrl)
  if (coordinates === undefined) {
    throw new DeliveryGitHubIntakeError(
      'invalid-request',
      'GitHub Issue intake requires a canonical public github.com Issue URL',
    )
  }
  if (request.signal?.aborted) {
    throw new DeliveryGitHubIntakeError('aborted', 'GitHub Issue intake was aborted')
  }
  const apiUrl = `https://api.github.com/repos/${coordinates.repository.owner}/${coordinates.repository.name}/issues/${String(coordinates.issueNumber)}`
  let response: Response
  try {
    response = request.signal === undefined
      ? await dependencies.fetch(apiUrl, { headers: { accept: 'application/vnd.github+json' } })
      : await dependencies.fetch(apiUrl, {
        headers: { accept: 'application/vnd.github+json' },
        signal: request.signal,
      })
  } catch (cause) {
    if (request.signal?.aborted || (cause instanceof Error && cause.name === 'AbortError')) {
      throw new DeliveryGitHubIntakeError('aborted', 'GitHub Issue intake was aborted', { cause })
    }
    throw new DeliveryGitHubIntakeError('network-failure', 'GitHub Issue intake fetch failed', { cause })
  }
  if (response.status !== 200) {
    throw new DeliveryGitHubIntakeError(
      'http-failure',
      `GitHub Issue intake expected HTTP 200 but received ${String(response.status)}`,
    )
  }
  if (response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    throw new DeliveryGitHubIntakeError('invalid-response', 'GitHub Issue intake requires an application/json response')
  }
  let value: unknown
  try {
    value = await response.json()
  } catch (cause) {
    if (request.signal?.aborted || (cause instanceof Error && cause.name === 'AbortError')) {
      throw new DeliveryGitHubIntakeError('aborted', 'GitHub Issue intake was aborted', { cause })
    }
    throw new DeliveryGitHubIntakeError('invalid-response', 'GitHub Issue intake response is not valid JSON', { cause })
  }
  if (request.signal?.aborted) {
    throw new DeliveryGitHubIntakeError('aborted', 'GitHub Issue intake was aborted')
  }
  const source = parseIssueSnapshot(value, request.issueUrl, coordinates)
  const snapshot = dependencies.delivery.snapshot()
  const existing = snapshot.contractRevisions.find((revision: ContractRevision) => sameSourceContent(revision, source))
  if (existing !== undefined) return existing
  const previous = snapshot.contractRevisions
    .filter((revision: ContractRevision) => sameIssue(revision, source))
    .at(-1)
  const brief = parseGitHubIssueWorkBrief(source.body)
  return dependencies.delivery.adoptContractRevision({
    idempotencyKey: `github:${source.repository.owner}/${source.repository.name}:issue:${String(source.issueNumber)}:${source.contentDigest}`,
    source,
    revision: workBriefContractRevisionDraft(
      brief,
      request.repositoryId,
      previous?.id ?? null,
    ),
  })
}

interface GitHubIssueSnapshot {
  readonly number: number
  readonly html_url: string
  readonly repository_url: string
  readonly updated_at: string
  readonly title: string
  readonly body: string
}

function parseIssueSnapshot(
  value: unknown,
  requestedUrl: string,
  coordinates: NonNullable<ReturnType<typeof parseCanonicalGitHubIssueUrl>>,
) {
  if (!isGitHubIssueSnapshot(value)) {
    throw new DeliveryGitHubIntakeError('invalid-response', 'GitHub Issue intake response has an invalid Issue snapshot shape')
  }
  const expectedRepositoryUrl = `https://api.github.com/repos/${coordinates.repository.owner}/${coordinates.repository.name}`
  if (value.number !== coordinates.issueNumber
    || value.html_url !== requestedUrl
    || value.repository_url !== expectedRepositoryUrl) {
    throw new DeliveryGitHubIntakeError('invalid-response', 'GitHub Issue intake response coordinates do not match the requested Issue')
  }
  const contentDigest = sourceRefContentDigest({ title: value.title, body: value.body })
  const candidate = sourceRefSchema.safeParse({
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    id: SourceRefId('source-ref-intake-validation'),
    provider: 'github',
    repository: coordinates.repository,
    issueNumber: coordinates.issueNumber,
    canonicalUrl: requestedUrl,
    updatedAt: value.updated_at,
    title: value.title,
    body: value.body,
    contentDigest,
    createdAt: value.updated_at,
  })
  if (!candidate.success) {
    throw new DeliveryGitHubIntakeError('invalid-response', 'GitHub Issue intake response contains an invalid immutable snapshot')
  }
  const { id: _id, schemaVersion: _schemaVersion, provider: _provider, createdAt: _createdAt, ...source } = candidate.data
  return source
}

function isGitHubIssueSnapshot(value: unknown): value is GitHubIssueSnapshot {
  if (value === null || typeof value !== 'object') return false
  const snapshot = value as Record<string, unknown>
  return Number.isSafeInteger(snapshot.number)
    && typeof snapshot.html_url === 'string'
    && typeof snapshot.repository_url === 'string'
    && typeof snapshot.updated_at === 'string'
    && typeof snapshot.title === 'string'
    && typeof snapshot.body === 'string'
}

function sameIssue(
  revision: ContractRevision,
  source: ReturnType<typeof parseIssueSnapshot>,
): boolean {
  const previous = revision.sourceRef
  return previous.repository.owner === source.repository.owner
    && previous.repository.name === source.repository.name
    && previous.issueNumber === source.issueNumber
}

function sameSourceContent(
  revision: ContractRevision,
  source: ReturnType<typeof parseIssueSnapshot>,
): boolean {
  const previous = revision.sourceRef
  return sameIssue(revision, source)
    && previous.canonicalUrl === source.canonicalUrl
    && previous.title === source.title
    && previous.body === source.body
    && previous.contentDigest === source.contentDigest
}
