/**
 * GitHub Issue snapshot intake Consumer for Personal Delivery.
 *
 * @module @deepseek-ai/dsh-delivery-github-intake
 */

import type Delivery from '@deepseek-ai/dsh-delivery'
import type { DeliverySnapshot } from '@deepseek-ai/dsh-delivery'
import type {
  ContractRevision,
  DeliveryCase,
  GitHubRepositoryRef,
  RepositoryId,
  Sha256Digest,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  canonicalJson,
  githubIssueContentDigest,
  parseCanonicalGitHubIssueUrl,
  requirementOriginSchema,
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

/**
 * Explicit dependencies for importing one Issue snapshot into a Delivery Case.
 * The narrow `Pick` keeps requirement approval, publication, and acceptance
 * authority out of the importer's reach: an import can only create or revise.
 */
export interface GitHubIssueIntakeDependencies {
  readonly delivery: Pick<Delivery, 'createCase' | 'reviseCase' | 'snapshot'>
  readonly fetch: typeof globalThis.fetch
}

/** Operator-selected coordinates for one exact GitHub Issue import. */
export interface ImportGitHubIssueRequest {
  readonly issueUrl: string
  readonly repositoryId: RepositoryId
  readonly signal?: AbortSignal
}

/** Validated immutable content of one imported Issue snapshot. */
export interface ImportedIssueSnapshot {
  readonly repository: GitHubRepositoryRef
  readonly issueNumber: number
  readonly canonicalUrl: string
  readonly title: string
  readonly body: string
  readonly contentDigest: Sha256Digest
}

const intakeTails = new WeakMap<object, Map<string, Promise<void>>>()

/**
 * Fetch, parse, and idempotently import one exact GitHub Issue snapshot as a
 * Delivery Case creation or revision.
 *
 * The first import of an Issue creates one Case whose root revision carries a
 * `github-import` origin and the Issue title; a later import of changed Issue
 * content revises that Case under an expected-head compare-and-set. An import
 * never records a requirement decision, so an imported revision stays
 * unapproved and cannot create a Work Packet until a human decides.
 *
 * @param dependencies - Delivery Case boundary and host-provided fetch.
 * @param request - Canonical Issue URL plus its required configured repository link.
 * @returns the head Contract revision of the imported Case. Cancellation is
 * observed before the `createCase()`/`reviseCase()` commit point; once that
 * call starts, its committed result or failure is authoritative even if the
 * signal aborts later.
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
    const revisionsById = revisionIndex(snapshot)
    const existing = locateIssueCase(snapshot, revisionsById, source)
    const origin = requirementOriginSchema.parse({
      kind: 'github-import',
      repository: source.repository,
      issueNumber: source.issueNumber,
      contentDigest: source.contentDigest,
    })
    if (existing === null) {
      throwIfAborted(request.signal)
      // This call is the cancellation commit point. Do not inspect the signal after it starts.
      const { revision } = await dependencies.delivery.createCase({
        idempotencyKey: `github:${source.repository.owner}/${source.repository.name}:issue:${String(source.issueNumber)}:root`,
        repositoryId: request.repositoryId,
        origin,
        title: source.title,
        revision: workBriefContractRevisionDraft(brief),
      })
      return revision
    }
    if (existing.repositoryId !== request.repositoryId) {
      throw new DeliveryGitHubIntakeError(
        'invalid-request',
        'GitHub Issue intake snapshot already belongs to another configured repository',
      )
    }
    const head = revisionsById.get(existing.headRevisionId)
    if (head === undefined) {
      throw invalidLineage(`Delivery Case '${existing.id}' head revision is absent from the snapshot`)
    }
    if (head.origin.kind !== 'github-import') {
      throw new DeliveryGitHubIntakeError(
        'invalid-request',
        `The head of Delivery Case '${existing.id}' for this Issue carries a human revision; import cannot override it`,
      )
    }
    if (sameImportContent(head, source, brief)) return head
    throwIfAborted(request.signal)
    // This call is the cancellation commit point. Do not inspect the signal after it starts.
    const { revision } = await dependencies.delivery.reviseCase({
      idempotencyKey: `github:${source.repository.owner}/${source.repository.name}:issue:${String(source.issueNumber)}:previous:${head.id}`,
      caseId: existing.id,
      expectedHeadRevisionId: head.id,
      origin,
      title: source.title,
      revision: workBriefContractRevisionDraft(brief),
    })
    return revision
  })
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DeliveryGitHubIntakeError('aborted', 'GitHub Issue intake was aborted')
  }
}

async function serializeIssueIntake<T>(
  delivery: object,
  source: ImportedIssueSnapshot,
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
): ImportedIssueSnapshot {
  if (!isGitHubIssueSnapshot(value)) {
    throw new DeliveryGitHubIntakeError('invalid-response', 'GitHub Issue intake response has an invalid Issue snapshot shape')
  }
  const expectedRepositoryUrl = `https://api.github.com/repos/${coordinates.repository.owner}/${coordinates.repository.name}`
  if (value.number !== coordinates.issueNumber
    || value.html_url !== requestedUrl
    || value.repository_url !== expectedRepositoryUrl) {
    throw new DeliveryGitHubIntakeError('invalid-response', 'GitHub Issue intake response coordinates do not match the requested Issue')
  }
  if (value.title.trim().length === 0 || value.body.trim().length === 0) {
    throw new DeliveryGitHubIntakeError('invalid-response', 'GitHub Issue intake response must carry a non-blank title and body')
  }
  if (!isUtcInstant(value.updated_at)) {
    throw new DeliveryGitHubIntakeError('invalid-response', 'GitHub Issue intake response contains an invalid immutable timestamp')
  }
  return {
    repository: coordinates.repository,
    issueNumber: coordinates.issueNumber,
    canonicalUrl: requestedUrl,
    title: value.title,
    body: value.body,
    contentDigest: githubIssueContentDigest({ title: value.title, body: value.body }),
  }
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

function isUtcInstant(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/u.exec(value)
  if (match === null) return false
  const parts = [1, 2, 3, 4, 5, 6].map(index => Number(match[index])) as [
    number, number, number, number, number, number,
  ]
  const [y, m, d, h, min, sec] = parts
  if (m < 1 || m > 12 || d < 1 || h > 23 || min > 59 || sec > 59) return false
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Index every snapshot revision by identity; duplicate identities fail closed. */
function revisionIndex(snapshot: DeliverySnapshot): Map<string, ContractRevision> {
  const byId = new Map<string, ContractRevision>()
  for (const revision of snapshot.contractRevisions) {
    if (byId.has(revision.id)) {
      throw invalidLineage('contains a duplicate Contract revision identity')
    }
    byId.set(revision.id, revision)
  }
  return byId
}

/**
 * Locate the one Delivery Case whose root revision imported this Issue.
 * Candidates are matched on the root's `github-import` origin coordinates, so
 * later human revisions inside the Case cannot detach it from the import.
 */
function locateIssueCase(
  snapshot: DeliverySnapshot,
  revisionsById: Map<string, ContractRevision>,
  source: ImportedIssueSnapshot,
): DeliveryCase | null {
  const candidates: DeliveryCase[] = []
  for (const kase of snapshot.deliveryCases) {
    const root = caseRoot(kase, revisionsById)
    if (root === undefined) {
      throw invalidLineage(`Delivery Case '${kase.id}' has a broken revision chain`)
    }
    if (root.origin.kind !== 'github-import') continue
    if (root.origin.repository.owner === source.repository.owner
      && root.origin.repository.name === source.repository.name
      && root.origin.issueNumber === source.issueNumber) {
      candidates.push(kase)
    }
  }
  if (candidates.length > 1) {
    throw invalidLineage('matches more than one Delivery Case for the same Issue')
  }
  return candidates[0] ?? null
}

/**
 * Walk from the Case head to its root revision. A missing predecessor or a
 * cycle means the snapshot cannot be trusted for import decisions.
 */
function caseRoot(
  kase: DeliveryCase,
  revisionsById: Map<string, ContractRevision>,
): ContractRevision | undefined {
  let current = revisionsById.get(kase.headRevisionId)
  if (current === undefined) return undefined
  const visited = new Set<string>([current.id])
  while (current.previousRevisionId !== null) {
    if (visited.has(current.previousRevisionId)) return undefined
    const parent = revisionsById.get(current.previousRevisionId)
    if (parent === undefined) return undefined
    visited.add(parent.id)
    current = parent
  }
  return current
}

/**
 * Decide whether the current head already carries this exact import. The
 * origin digest pins the immutable title/body snapshot; the canonical draft
 * comparison defends against a same-coordinate revision written by another path.
 */
function sameImportContent(
  head: ContractRevision,
  source: ImportedIssueSnapshot,
  brief: ReturnType<typeof parseGitHubIssueWorkBrief>,
): boolean {
  if (head.origin.kind !== 'github-import') return false
  if (head.origin.contentDigest !== source.contentDigest) return false
  return canonicalJson(requirementContent(head)) === canonicalJson(workBriefContractRevisionDraft(brief))
}

/** Requirement content fields an import maps onto a revision draft. */
function requirementContent(revision: ContractRevision) {
  return {
    outcome: revision.outcome,
    context: revision.context,
    allowedScope: revision.allowedScope,
    forbiddenScope: revision.forbiddenScope,
    acceptanceClauses: revision.acceptanceClauses,
    openDecisions: revision.openDecisions,
    baseSelectionRule: revision.baseSelectionRule,
    verificationSource: revision.verificationSource,
    referenceLinks: revision.referenceLinks,
  }
}

function invalidLineage(detail: string): DeliveryGitHubIntakeError {
  return new DeliveryGitHubIntakeError(
    'invalid-request',
    `GitHub Issue intake cannot locate a unique Delivery Case for this Issue because the snapshot ${detail}`,
  )
}
