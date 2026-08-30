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
  canonicalJson,
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

const intakeTails = new WeakMap<object, Map<string, Promise<void>>>()

/**
 * Fetch, parse, and idempotently adopt one exact GitHub Issue snapshot.
 *
 * @param dependencies - Delivery adoption boundary and host-provided fetch.
 * @param request - Canonical Issue URL plus its required configured repository link.
 * @returns the adopted immutable Contract revision. Cancellation is observed
 * before the `adoptContractRevision()` commit point; once that call starts, its
 * committed result or failure is authoritative even if the signal aborts later.
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
  throwIfAborted(request.signal)
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
  throwIfAborted(request.signal)
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
  throwIfAborted(request.signal)
  const source = parseIssueSnapshot(value, request.issueUrl, coordinates)
  throwIfAborted(request.signal)
  const brief = parseGitHubIssueWorkBrief(source.body)
  throwIfAborted(request.signal)
  return serializeIssueIntake(dependencies.delivery, source, async () => {
    throwIfAborted(request.signal)
    const snapshot = dependencies.delivery.snapshot()
    throwIfAborted(request.signal)
    const previous = deriveSameIssueHead(snapshot.contractRevisions, source)
    if (previous !== null && sameSourceContent(previous, source)) {
      if (sameConfiguredRevision(previous, brief, request.repositoryId)) return previous
      throw new DeliveryGitHubIntakeError(
        'invalid-request',
        'GitHub Issue intake snapshot already belongs to another configured Contract revision',
      )
    }
    if (previous !== null && Date.parse(source.updatedAt) < Date.parse(previous.sourceRef.updatedAt)) {
      return previous
    }
    const revision = workBriefContractRevisionDraft(
      brief,
      request.repositoryId,
      previous?.id ?? null,
    )
    throwIfAborted(request.signal)
    // This call is the cancellation commit point. Do not inspect the signal after it starts.
    return dependencies.delivery.adoptContractRevision({
      idempotencyKey: `github:${source.repository.owner}/${source.repository.name}:issue:${String(source.issueNumber)}:previous:${previous?.id ?? 'root'}:${source.contentDigest}`,
      source,
      revision,
    })
  })
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DeliveryGitHubIntakeError('aborted', 'GitHub Issue intake was aborted')
  }
}

async function serializeIssueIntake<T>(
  delivery: object,
  source: ReturnType<typeof parseIssueSnapshot>,
  operation: () => Promise<T>,
): Promise<T> {
  const key = `${source.repository.owner}/${source.repository.name}#${String(source.issueNumber)}`
  let tails = intakeTails.get(delivery)
  if (tails === undefined) {
    tails = new Map<string, Promise<void>>()
    intakeTails.set(delivery, tails)
  }
  let release!: () => void
  const turn = new Promise<void>((resolve) => {
    release = resolve
  })
  const previous = tails.get(key)
  tails.set(key, turn)
  if (previous !== undefined) await previous
  try {
    return await operation()
  } finally {
    release()
    if (tails.get(key) === turn) {
      tails.delete(key)
      if (tails.size === 0) intakeTails.delete(delivery)
    }
  }
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

function deriveSameIssueHead(
  revisions: readonly ContractRevision[],
  source: ReturnType<typeof parseIssueSnapshot>,
): ContractRevision | null {
  const sameIssueRevisions = revisions.filter(revision => sameIssue(revision, source))
  if (sameIssueRevisions.length === 0) return null
  const byId = new Map<string, ContractRevision>()
  for (const revision of sameIssueRevisions) {
    if (byId.has(revision.id)) {
      throw invalidLineage('contains a duplicate Contract revision identity')
    }
    byId.set(revision.id, revision)
  }
  const predecessors = new Set<string>()
  for (const revision of sameIssueRevisions) {
    if (revision.previousRevisionId === null) continue
    if (!byId.has(revision.previousRevisionId)) {
      throw invalidLineage('references a missing same-Issue predecessor')
    }
    predecessors.add(revision.previousRevisionId)
  }
  const heads = sameIssueRevisions.filter(revision => !predecessors.has(revision.id))
  if (heads.length !== 1) {
    throw invalidLineage('does not have exactly one current head')
  }
  const head = heads[0] as ContractRevision
  const visited = new Set<string>()
  let current = head
  while (true) {
    if (visited.has(current.id)) {
      throw invalidLineage('contains a cycle')
    }
    visited.add(current.id)
    if (current.previousRevisionId === null) break
    current = byId.get(current.previousRevisionId) as ContractRevision
  }
  if (visited.size !== sameIssueRevisions.length) {
    throw invalidLineage('contains a record outside the unique head chain')
  }
  return head
}

function invalidLineage(detail: string): DeliveryGitHubIntakeError {
  return new DeliveryGitHubIntakeError(
    'invalid-request',
    `GitHub Issue intake cannot derive a unique revision lineage because it ${detail}`,
  )
}

function sameConfiguredRevision(
  revision: ContractRevision,
  brief: ReturnType<typeof parseGitHubIssueWorkBrief>,
  repositoryId: RepositoryId,
): boolean {
  const expected = workBriefContractRevisionDraft(brief, repositoryId, revision.previousRevisionId)
  return canonicalJson({
    previousRevisionId: revision.previousRevisionId,
    repositoryId: revision.repositoryId,
    outcome: revision.outcome,
    context: revision.context,
    allowedScope: revision.allowedScope,
    forbiddenScope: revision.forbiddenScope,
    acceptanceClauses: revision.acceptanceClauses,
    openDecisions: revision.openDecisions,
    baseSelectionRule: revision.baseSelectionRule,
    verificationSource: revision.verificationSource,
    referenceLinks: revision.referenceLinks,
  }) === canonicalJson(expected)
}
