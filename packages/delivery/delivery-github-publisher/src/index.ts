/** Host-only GitHub Issue publication for Personal Delivery. */

import type Delivery from '@deepseek-ai/dsh-delivery'
import type { CredentialProvider, CredentialRef } from '@deepseek-ai/dsh-credentials'
import {
  canonicalGitHubIssueUrl,
  type ContractRevisionId,
  type DeliveryCaseId,
  type GitHubIssueRef,
  type GitHubRepositoryRef,
  type IssuePublication,
  type IssuePublicationId,
  type PublicationFailure,
  type RepositoryId,
} from '@deepseek-ai/dsh-delivery-protocol'
import { DeliveryGitHubPublisherError } from './failures.ts'
import { renderGitHubIssue } from './render.ts'

export * from './failures.ts'
export * from './render.ts'

/** Configured Host target for one Delivery repository identity. */
export interface GitHubPublicationTarget {
  readonly repository: GitHubRepositoryRef
  readonly credentialRef: CredentialRef
  /** Optional Host-owned labels included in the single Issue creation request. */
  readonly labels?: readonly string[]
}

/** Explicit Host-only boundaries needed for one Issue publication. */
export interface GitHubPublisherDependencies {
  readonly delivery: Pick<Delivery,
    | 'getCase'
    | 'getContractRevision'
    | 'getIssuePublication'
    | 'prepareIssuePublication'
    | 'markIssuePublicationStarted'
    | 'completeIssuePublication'
    | 'failIssuePublication'
    | 'resolveIssuePublication'>
  readonly credentials: Pick<CredentialProvider, 'resolve'>
  readonly fetch: typeof globalThis.fetch
  readonly targetForRepository: (repositoryId: RepositoryId) => GitHubPublicationTarget | undefined
  readonly now: () => string
}

/** Browser-independent request naming one exact Case revision. */
export interface PublishGitHubIssueRequest {
  readonly caseId: DeliveryCaseId
  readonly revisionId: ContractRevisionId
  readonly signal?: AbortSignal
}

/** Human-authorized reconciliation of one exact externally visible Issue. */
export interface ConfirmPublishedGitHubIssueRequest {
  readonly resolution: 'confirm-published'
  readonly publicationId: IssuePublicationId
  readonly issueNumber: number
  readonly signal?: AbortSignal
}

/**
 * Publish one approved ready Case revision, or return its existing binding.
 * @param dependencies - Delivery, credential, target-map, clock, and HTTP boundaries.
 * @param request - Exact Case revision and operation-local cancellation.
 * @returns the durable published binding.
 */
export async function publishGitHubIssue(
  dependencies: GitHubPublisherDependencies,
  request: PublishGitHubIssueRequest,
): Promise<IssuePublication & { phase: 'published' }> {
  throwIfAborted(request.signal)
  const deliveryCase = dependencies.delivery.getCase(request.caseId)
  if (deliveryCase === undefined) {
    throw new DeliveryGitHubPublisherError('not-found', `Delivery Case '${request.caseId}' does not exist`)
  }
  const revision = dependencies.delivery.getContractRevision(request.revisionId)
  if (revision === undefined) {
    throw new DeliveryGitHubPublisherError('not-found', `Contract revision '${request.revisionId}' does not exist`)
  }
  const target = dependencies.targetForRepository(deliveryCase.repositoryId)
  if (target === undefined) {
    throw new DeliveryGitHubPublisherError(
      'unmapped-repository',
      `Delivery repository '${deliveryCase.repositoryId}' has no GitHub publication target`,
    )
  }
  const rendered = renderGitHubIssue(deliveryCase.id, revision)
  const publication = await dependencies.delivery.prepareIssuePublication({
    idempotencyKey: `github-issue:${rendered.publicationId}`,
    caseId: deliveryCase.id,
    revisionId: revision.id,
    repository: target.repository,
    renderedDigest: rendered.renderedDigest,
    marker: rendered.marker,
  })
  if (publication.id !== rendered.publicationId) {
    throw new DeliveryGitHubPublisherError(
      'invalid-state',
      `Issue publication '${publication.id}' does not match its deterministic Case revision identity`,
    )
  }
  if (publication.phase === 'published') return publication
  if (publication.phase !== 'prepared') {
    throw new DeliveryGitHubPublisherError(
      'invalid-state',
      `Issue publication '${publication.id}' requires resolution before it can be published`,
    )
  }
  throwIfAborted(request.signal)
  const credential = await dependencies.credentials.resolve(target.credentialRef)
  if (credential === undefined) {
    throw new DeliveryGitHubPublisherError(
      'missing-credential',
      `GitHub credential reference '${target.credentialRef}' is not configured`,
    )
  }
  throwIfAborted(request.signal)
  const publishing = await dependencies.delivery.markIssuePublicationStarted(publication.id)
  if (request.signal?.aborted) {
    await recordFailure(dependencies, publishing.id, {
      sideEffect: 'not-started',
      category: 'canceled',
      detail: 'GitHub Issue publication was canceled before the request started',
      occurredAt: dependencies.now(),
    })
    throw aborted()
  }

  let response: Response
  try {
    response = await dependencies.fetch(gitHubIssuesUrl(target.repository), {
      method: 'POST',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${credential.value}`,
        'content-type': 'application/json',
        'x-github-api-version': '2026-03-10',
      },
      body: JSON.stringify({
        title: rendered.title,
        body: rendered.body,
        ...target.labels === undefined || target.labels.length === 0 ? {} : { labels: [...target.labels] },
      }),
      signal: request.signal ?? null,
    })
  } catch (cause) {
    const canceled = request.signal?.aborted || (cause instanceof Error && cause.name === 'AbortError')
    await recordFailure(dependencies, publishing.id, {
      sideEffect: 'unknown',
      category: canceled ? 'canceled' : 'transport',
      detail: canceled
        ? 'GitHub Issue publication was canceled after the request started'
        : 'GitHub Issue publication transport failed after the request started',
      occurredAt: dependencies.now(),
    })
    throw canceled
      ? aborted(cause)
      : new DeliveryGitHubPublisherError('transport', 'GitHub Issue publication transport failed', { cause })
  }

  if (response.status !== 201) {
    await recordFailure(dependencies, publishing.id, {
      sideEffect: 'not-started',
      category: response.status >= 400 && response.status < 500 ? 'rejected' : 'transport',
      detail: `GitHub rejected Issue publication with HTTP ${String(response.status)}`,
      occurredAt: dependencies.now(),
    })
    throw new DeliveryGitHubPublisherError(
      'http-failure',
      `GitHub Issue publication expected HTTP 201 but received ${String(response.status)}`,
    )
  }

  let value: unknown
  try {
    if (response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw new TypeError('response is not application/json')
    }
    value = await response.json()
  } catch (cause) {
    await recordFailure(dependencies, publishing.id, invalidResponseFailure(dependencies))
    throw new DeliveryGitHubPublisherError('invalid-response', 'GitHub Issue publication response is invalid', { cause })
  }
  const issue = parsePublishedIssue(value, target.repository, rendered.title, rendered.body)
  if (issue === undefined) {
    await recordFailure(dependencies, publishing.id, invalidResponseFailure(dependencies))
    throw new DeliveryGitHubPublisherError(
      'invalid-response',
      'GitHub Issue publication response does not match the requested Issue',
    )
  }
  try {
    return await dependencies.delivery.completeIssuePublication({
      publicationId: publishing.id,
      expectedPhase: 'publishing',
      issue,
    })
  } catch (cause) {
    const current = dependencies.delivery.getIssuePublication(publishing.id)
    if (current?.phase === 'published') return current
    await recordFailure(dependencies, publishing.id, {
      sideEffect: 'unknown',
      category: 'transport',
      detail: 'The published GitHub Issue binding could not be committed',
      occurredAt: dependencies.now(),
    })
    throw new DeliveryGitHubPublisherError(
      'transport',
      'The published GitHub Issue binding could not be committed',
      { cause },
    )
  }
}

/**
 * Confirm an unknown or crash-stalled publication through a fresh GitHub GET.
 * @param dependencies - Delivery, credential, target-map, clock, and HTTP boundaries.
 * @param request - Human-selected publication and exact candidate Issue number.
 * @returns the durable published binding after marker and digest validation.
 */
export async function resolveGitHubIssuePublication(
  dependencies: GitHubPublisherDependencies,
  request: ConfirmPublishedGitHubIssueRequest,
): Promise<IssuePublication & { phase: 'published' }> {
  throwIfAborted(request.signal)
  const publication = dependencies.delivery.getIssuePublication(request.publicationId)
  if (publication === undefined) {
    throw new DeliveryGitHubPublisherError(
      'not-found',
      `Issue publication '${request.publicationId}' does not exist`,
    )
  }
  if (publication.phase === 'published') return publication
  if (publication.phase !== 'unknown' && publication.phase !== 'publishing') {
    throw new DeliveryGitHubPublisherError(
      'invalid-state',
      `Issue publication '${publication.id}' is not awaiting external resolution`,
    )
  }
  const deliveryCase = dependencies.delivery.getCase(publication.caseId)
  const revision = dependencies.delivery.getContractRevision(publication.revisionId)
  if (deliveryCase === undefined || revision === undefined) {
    throw new DeliveryGitHubPublisherError(
      'invalid-state',
      `Issue publication '${publication.id}' has missing Delivery ownership records`,
    )
  }
  const target = dependencies.targetForRepository(deliveryCase.repositoryId)
  if (target === undefined) {
    throw new DeliveryGitHubPublisherError(
      'unmapped-repository',
      `Delivery repository '${deliveryCase.repositoryId}' has no GitHub publication target`,
    )
  }
  if (target.repository.owner !== publication.repository.owner
    || target.repository.name !== publication.repository.name) {
    throw new DeliveryGitHubPublisherError(
      'invalid-state',
      `Issue publication '${publication.id}' no longer matches its configured repository target`,
    )
  }
  const rendered = renderGitHubIssue(deliveryCase.id, revision)
  if (rendered.publicationId !== publication.id
    || rendered.renderedDigest !== publication.renderedDigest
    || rendered.marker !== publication.marker) {
    throw new DeliveryGitHubPublisherError(
      'invalid-state',
      `Issue publication '${publication.id}' render identity does not match its Delivery record`,
    )
  }
  const credential = await dependencies.credentials.resolve(target.credentialRef)
  if (credential === undefined) {
    throw new DeliveryGitHubPublisherError(
      'missing-credential',
      `GitHub credential reference '${target.credentialRef}' is not configured`,
    )
  }
  throwIfAborted(request.signal)
  const issueUrl = `${gitHubIssuesUrl(target.repository)}/${String(request.issueNumber)}`
  let response: Response
  try {
    response = await dependencies.fetch(issueUrl, {
      method: 'GET',
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${credential.value}`,
        'x-github-api-version': '2026-03-10',
      },
      signal: request.signal ?? null,
    })
  } catch (cause) {
    const canceled = request.signal?.aborted || (cause instanceof Error && cause.name === 'AbortError')
    throw canceled
      ? aborted(cause)
      : new DeliveryGitHubPublisherError('transport', 'GitHub Issue reconciliation GET failed', { cause })
  }
  if (response.status !== 200) {
    throw new DeliveryGitHubPublisherError(
      'http-failure',
      `GitHub Issue reconciliation expected HTTP 200 but received ${String(response.status)}`,
    )
  }
  let value: unknown
  try {
    if (response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      throw new TypeError('response is not application/json')
    }
    value = await response.json()
  } catch (cause) {
    throw new DeliveryGitHubPublisherError('invalid-response', 'GitHub Issue reconciliation response is invalid', { cause })
  }
  const issue = parsePublishedIssue(value, target.repository, rendered.title, rendered.body)
  if (issue === undefined || issue.issueNumber !== request.issueNumber) {
    throw new DeliveryGitHubPublisherError(
      'invalid-response',
      'GitHub Issue reconciliation response does not match the Delivery marker and digest',
    )
  }
  return await dependencies.delivery.resolveIssuePublication({
    resolution: 'confirm-published',
    publicationId: publication.id,
    issue,
    verificationBasis: `GitHub GET ${issue.url} returned HTTP 200 with the exact Delivery marker and digest`,
  }) as IssuePublication & { phase: 'published' }
}

function gitHubIssuesUrl(repository: GitHubRepositoryRef): string {
  return `https://api.github.com/repos/${repository.owner}/${repository.name}/issues`
}

function parsePublishedIssue(
  value: unknown,
  repository: GitHubRepositoryRef,
  title: string,
  body: string,
): GitHubIssueRef | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (!Number.isSafeInteger(record.number) || (record.number as number) <= 0) return undefined
  const issueNumber = record.number as number
  const url = canonicalGitHubIssueUrl(repository, issueNumber)
  if (record.html_url !== url
    || record.repository_url !== `https://api.github.com/repos/${repository.owner}/${repository.name}`
    || record.title !== title
    || record.body !== body) {
    return undefined
  }
  return { repository, issueNumber, url }
}

function invalidResponseFailure(dependencies: GitHubPublisherDependencies): PublicationFailure & { sideEffect: 'unknown' } {
  return {
    sideEffect: 'unknown',
    category: 'invalid-response',
    detail: 'GitHub returned an invalid response after the Issue request started',
    occurredAt: dependencies.now(),
  }
}

async function recordFailure(
  dependencies: GitHubPublisherDependencies,
  publicationId: IssuePublication['id'],
  failure: PublicationFailure,
): Promise<void> {
  await dependencies.delivery.failIssuePublication({
    publicationId,
    expectedPhase: 'publishing',
    failure,
  })
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw aborted(signal.reason)
}

function aborted(cause?: unknown): DeliveryGitHubPublisherError {
  return new DeliveryGitHubPublisherError(
    'aborted',
    'GitHub Issue publication was aborted',
    cause === undefined ? undefined : { cause },
  )
}
