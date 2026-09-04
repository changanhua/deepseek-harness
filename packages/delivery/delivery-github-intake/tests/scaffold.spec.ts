import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CreateDeliveryCaseRequest,
  DeliverySnapshot,
  ReviseDeliveryCaseRequest,
} from '@changanhua/dsh-delivery'
import { DeliveryError } from '@changanhua/dsh-delivery'
import type { ContractRevision, DeliveryCase } from '@changanhua/dsh-delivery-protocol'
import {
  ContractRevisionId,
  DELIVERY_SCHEMA_VERSION,
  DeliveryCaseId,
  RepositoryId,
  canonicalJson,
  githubIssueContentDigest,
} from '@changanhua/dsh-delivery-protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  importGitHubIssue,
  parseGitHubIssueWorkBrief,
  type GitHubIssueIntakeDependencies,
  workBriefContractRevisionDraft,
} from '../src/index.ts'

const repositoryId = RepositoryId('fixture-repository')
const issueUrl = 'https://github.com/example/project/issues/42'
const fixtureRoot = join(import.meta.dirname, '..', 'fixtures')
const validBody = await readFile(join(fixtureRoot, 'work-brief.valid.md'), 'utf8')
const FIXTURE_TIME = '2026-08-30T12:00:00.000Z'

function issueSnapshot(overrides: Partial<{
  readonly number: number
  readonly html_url: string
  readonly repository_url: string
  readonly updated_at: string
  readonly title: string
  readonly body: string
}> = {}) {
  return {
    number: 42,
    html_url: issueUrl,
    repository_url: 'https://api.github.com/repos/example/project',
    updated_at: FIXTURE_TIME,
    title: 'Adopt the exact Issue snapshot',
    body: validBody,
    ...overrides,
  }
}

function importOrigin(title: string, body: string) {
  return {
    kind: 'github-import' as const,
    repository: { owner: 'example', name: 'project' },
    issueNumber: 42,
    contentDigest: githubIssueContentDigest({ title, body }),
  }
}

function importedRevision(
  issue = issueSnapshot(),
  {
    id = 'contract-revision-fixture',
    previousRevisionId = null,
    repositoryId: selectedRepositoryId = repositoryId,
  }: {
    readonly id?: string
    readonly previousRevisionId?: ContractRevision['previousRevisionId']
    readonly repositoryId?: RepositoryId
  } = {},
): ContractRevision {
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    id: ContractRevisionId(id),
    previousRevisionId,
    origin: importOrigin(issue.title, issue.body),
    title: issue.title,
    repositoryId: selectedRepositoryId,
    ...workBriefContractRevisionDraft(parseGitHubIssueWorkBrief(issue.body)),
    createdAt: FIXTURE_TIME,
  }
}

function deliveryCase(
  headRevisionId: string,
  {
    id = 'delivery-case-fixture',
    repositoryId: selectedRepositoryId = repositoryId,
  }: {
    readonly id?: string
    readonly repositoryId?: RepositoryId
  } = {},
): DeliveryCase {
  return {
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    id: DeliveryCaseId(id),
    repositoryId: selectedRepositoryId,
    headRevisionId: ContractRevisionId(headRevisionId),
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
  }
}

function snapshotOf(
  revisions: readonly ContractRevision[],
  cases: readonly DeliveryCase[],
): DeliverySnapshot {
  return {
    contractRevisions: revisions,
    workPackets: [],
    dispatchBindings: [],
    acceptanceDecisions: [],
    deliveryCases: cases,
    requirementDecisions: [],
    issuePublications: [],
  }
}

type CaseProvider = GitHubIssueIntakeDependencies['delivery']

function dependencies(
  revisions: readonly ContractRevision[] = [],
  cases: readonly DeliveryCase[] = [],
  onSnapshot?: () => void,
  committed: ContractRevision = { id: 'contract-revision-adopted' } as ContractRevision,
) {
  const records = {
    revisions: [...revisions],
    cases: [...cases],
  }
  const snapshot = vi.fn<() => DeliverySnapshot>(() => {
    onSnapshot?.()
    return snapshotOf(records.revisions, records.cases)
  })
  const createCase = vi.fn<
    (request: CreateDeliveryCaseRequest) => Promise<{ case: DeliveryCase; revision: ContractRevision }>
  >(async () => {
    const committedCase = deliveryCase(String(committed.id), { id: 'delivery-case-adopted' })
    records.revisions.push(committed)
    records.cases.push(committedCase)
    return { case: committedCase, revision: committed }
  })
  const reviseCase = vi.fn<
    (request: ReviseDeliveryCaseRequest) => Promise<{ case: DeliveryCase; revision: ContractRevision }>
  >(async () => ({
    case: deliveryCase('contract-revision-adopted'),
    revision: committed,
  }))
  const recordRequirementDecision = vi.fn()
  const fetch = vi.fn<typeof globalThis.fetch>()
  const deps: GitHubIssueIntakeDependencies = {
    delivery: { snapshot, createCase, reviseCase, recordRequirementDecision } as unknown as CaseProvider,
    fetch,
  }
  return { deps, snapshot, createCase, reviseCase, recordRequirementDecision, fetch }
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

/**
 * Deterministic in-memory stand-in for a Delivery provider: it serializes
 * writes per idempotency key, replays identical key/input pairs, fails closed
 * on reused keys with different input, and moves Case heads under CAS.
 */
function caseDelivery(firstCommitGate?: Promise<void>) {
  const revisions: ContractRevision[] = []
  const cases: DeliveryCase[] = []
  const idempotency = new Map<string, {
    readonly input: string
    readonly result: { case: DeliveryCase; revision: ContractRevision }
  }>()
  const tails = new Map<string, Promise<void>>()
  const firstCommit = deferred()
  const secondCommit = deferred()
  let commitOrdinal = 0

  const serialize = async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
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
      if (tails.get(key) === turn) tails.delete(key)
    }
  }

  const commitGate = () => {
    commitOrdinal += 1
    if (commitOrdinal === 1) {
      firstCommit.resolve()
      if (firstCommitGate !== undefined) return firstCommitGate
    } else if (commitOrdinal === 2) {
      secondCommit.resolve()
    }
    return Promise.resolve()
  }

  const buildRevision = (
    request: CreateDeliveryCaseRequest | ReviseDeliveryCaseRequest,
    previousRevisionId: ContractRevision['previousRevisionId'],
    selectedRepositoryId: RepositoryId,
  ): ContractRevision => ({
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    id: ContractRevisionId(`contract-revision-provider-${String(revisions.length + 1)}`),
    previousRevisionId,
    origin: request.origin,
    title: request.title,
    repositoryId: selectedRepositoryId,
    ...request.revision,
    createdAt: FIXTURE_TIME,
  })

  const delivery: CaseProvider = {
    snapshot: () => snapshotOf(structuredClone(revisions), structuredClone(cases)),
    createCase: async request => serialize(request.idempotencyKey, async () => {
      const prior = idempotency.get(request.idempotencyKey)
      const input = canonicalJson(request)
      if (prior !== undefined) {
        if (prior.input !== input) {
          throw new DeliveryError('idempotency-conflict', 'case provider received one key with different input')
        }
        return structuredClone(prior.result)
      }
      await commitGate()
      const revision = buildRevision(request, null, request.repositoryId)
      const kase: DeliveryCase = {
        schemaVersion: DELIVERY_SCHEMA_VERSION,
        id: DeliveryCaseId(`delivery-case-provider-${String(cases.length + 1)}`),
        repositoryId: request.repositoryId,
        headRevisionId: revision.id,
        createdAt: FIXTURE_TIME,
        updatedAt: FIXTURE_TIME,
      }
      revisions.push(revision)
      cases.push(kase)
      const result = { case: kase, revision }
      idempotency.set(request.idempotencyKey, { input, result })
      return structuredClone(result)
    }),
    reviseCase: async request => serialize(request.idempotencyKey, async () => {
      const prior = idempotency.get(request.idempotencyKey)
      const input = canonicalJson(request)
      if (prior !== undefined) {
        if (prior.input !== input) {
          throw new DeliveryError('idempotency-conflict', 'case provider received one key with different input')
        }
        return structuredClone(prior.result)
      }
      const caseIndex = cases.findIndex(candidate => candidate.id === request.caseId)
      const located = cases[caseIndex]
      if (located === undefined) {
        throw new DeliveryError('not-found', `case provider does not know Delivery Case '${request.caseId}'`)
      }
      if (located.headRevisionId !== request.expectedHeadRevisionId) {
        throw new DeliveryError('conflict', `case head is not the expected '${request.expectedHeadRevisionId}'`)
      }
      await commitGate()
      const revision = buildRevision(request, request.expectedHeadRevisionId, located.repositoryId)
      revisions.push(revision)
      const revisedCase = { ...located, headRevisionId: revision.id }
      cases[caseIndex] = revisedCase
      const result = { case: structuredClone(revisedCase), revision }
      idempotency.set(request.idempotencyKey, { input, result })
      return structuredClone(result)
    }),
  }
  return {
    delivery,
    firstCommit: firstCommit.promise,
    secondCommit: secondCommit.promise,
  }
}

function jsonResponse(issue = issueSnapshot()): Response {
  return new Response(JSON.stringify(issue), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

describe('GitHub Issue intake', () => {
  it.each([
    'owner/repository/issues/42',
    'http://github.com/example/project/issues/42',
    'https://GitHub.com/example/project/issues/42',
    'https://github.com.evil/example/project/issues/42',
    'https://user:token@github.com/example/project/issues/42',
    'https://github.com:443/example/project/issues/42',
    'https://github.com/example/project/issues/42?view=1',
    'https://github.com/example/project/issues/42#comment',
    'https://github.com/example/project/issues/42/',
    'https://github.com/%65xample/project/issues/42',
    'https://github.com/example/project/issues/0',
    'https://github.com/example/project/issues/01',
    'https://github.com/example/project/issues/9007199254740992',
  ])('rejects an unsafe Issue URL before I/O: %s', async (candidateUrl) => {
    const { deps, fetch, snapshot, createCase, reviseCase } = dependencies()

    await expect(importGitHubIssue(deps, {
      issueUrl: candidateUrl,
      repositoryId,
    })).rejects.toMatchObject({ code: 'invalid-request' })

    expect(fetch).not.toHaveBeenCalled()
    expect(snapshot).not.toHaveBeenCalled()
    expect(createCase).not.toHaveBeenCalled()
    expect(reviseCase).not.toHaveBeenCalled()
  })

  it('uses a deterministic root idempotency key for the first import of an Issue', async () => {
    const { deps, fetch, createCase } = dependencies()
    fetch.mockResolvedValue(jsonResponse())

    await importGitHubIssue(deps, { issueUrl, repositoryId })

    const [request] = createCase.mock.calls[0]!
    expect(request.idempotencyKey).toBe('github:example/project:issue:42:root')
  })

  it('creates one Case with a github-import origin through the host fetch boundary', async () => {
    const { deps, fetch, snapshot, createCase } = dependencies()
    const issue = issueSnapshot()
    const committedRevision = importedRevision(issue, { id: 'contract-revision-adopted' })
    createCase.mockResolvedValue({
      case: deliveryCase('contract-revision-adopted', { id: 'delivery-case-adopted' }),
      revision: committedRevision,
    })
    fetch.mockResolvedValue(jsonResponse(issue))

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).resolves.toBe(committedRevision)

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/example/project/issues/42',
      { headers: { accept: 'application/vnd.github+json' } },
    )
    expect(snapshot).toHaveBeenCalledTimes(1)
    const [request] = createCase.mock.calls[0]!
    expect(request.repositoryId).toBe(repositoryId)
    expect(request.origin).toEqual(importOrigin(issue.title, issue.body))
    expect(request.title).toBe(issue.title)
    expect(request.revision).toEqual(workBriefContractRevisionDraft(parseGitHubIssueWorkBrief(issue.body)))
    expect(request.revision.outcome).toBe('Users can move from Overview to Focus and Leaf views and return.')
  })

  it.each([
    ['non-200 status', new Response('no', { status: 403 }), 'http-failure'],
    ['non-JSON content type', new Response('no', { status: 200 }), 'invalid-response'],
    ['invalid JSON', new Response('{', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }), 'invalid-response'],
    ['mismatched coordinates', jsonResponse(issueSnapshot({ number: 43 })), 'invalid-response'],
    ['invalid immutable timestamp', jsonResponse(issueSnapshot({ updated_at: 'not-a-timestamp' })), 'invalid-response'],
    ['malformed snapshot', jsonResponse(issueSnapshot({ body: null as never })), 'invalid-response'],
    ['non-object snapshot', new Response('42', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }), 'invalid-response'],
  ])('rejects a %s response before Delivery reads or writes', async (_label, response, code) => {
    const { deps, fetch, snapshot, createCase, reviseCase } = dependencies()
    fetch.mockResolvedValue(response)

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).rejects.toMatchObject({ code })

    expect(snapshot).not.toHaveBeenCalled()
    expect(createCase).not.toHaveBeenCalled()
    expect(reviseCase).not.toHaveBeenCalled()
  })

  it('reports a network failure without reading or writing Delivery', async () => {
    const { deps, fetch, snapshot, createCase, reviseCase } = dependencies()
    fetch.mockRejectedValue(new Error('offline'))

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).rejects.toMatchObject({
      code: 'network-failure',
    })

    expect(snapshot).not.toHaveBeenCalled()
    expect(createCase).not.toHaveBeenCalled()
    expect(reviseCase).not.toHaveBeenCalled()
  })

  it('reports an aborted fetch without reading or writing Delivery', async () => {
    const controller = new AbortController()
    const { deps, fetch, snapshot, createCase, reviseCase } = dependencies()
    fetch.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))

    await expect(importGitHubIssue(deps, {
      issueUrl,
      repositoryId,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'aborted' })

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/example/project/issues/42',
      expect.objectContaining({ signal: controller.signal }),
    )
    expect(snapshot).not.toHaveBeenCalled()
    expect(createCase).not.toHaveBeenCalled()
    expect(reviseCase).not.toHaveBeenCalled()
  })

  it('reports an aborted response body read without reading or writing Delivery', async () => {
    const controller = new AbortController()
    const { deps, fetch, snapshot, createCase, reviseCase } = dependencies()
    const response = new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    vi.spyOn(response, 'json').mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    fetch.mockResolvedValue(response)

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId, signal: controller.signal })).rejects.toMatchObject({
      code: 'aborted',
    })

    expect(snapshot).not.toHaveBeenCalled()
    expect(createCase).not.toHaveBeenCalled()
    expect(reviseCase).not.toHaveBeenCalled()
  })

  it('does not import when cancellation arrives while the response body is read', async () => {
    const controller = new AbortController()
    const { deps, fetch, snapshot, createCase, reviseCase } = dependencies()
    const response = new Response(JSON.stringify(issueSnapshot()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    vi.spyOn(response, 'json').mockImplementation(async () => {
      controller.abort()
      return issueSnapshot()
    })
    fetch.mockResolvedValue(response)

    await expect(importGitHubIssue(deps, {
      issueUrl,
      repositoryId,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'aborted' })

    expect(snapshot).not.toHaveBeenCalled()
    expect(createCase).not.toHaveBeenCalled()
    expect(reviseCase).not.toHaveBeenCalled()
  })

  it('does not start intake when the caller already aborted the request', async () => {
    const controller = new AbortController()
    controller.abort()
    const { deps, fetch, snapshot, createCase, reviseCase } = dependencies()
    fetch.mockResolvedValue(jsonResponse())

    await expect(importGitHubIssue(deps, {
      issueUrl,
      repositoryId,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'aborted' })

    expect(fetch).not.toHaveBeenCalled()
    expect(snapshot).not.toHaveBeenCalled()
    expect(createCase).not.toHaveBeenCalled()
    expect(reviseCase).not.toHaveBeenCalled()
  })

  it('returns the existing Case head revision for an exact source snapshot', async () => {
    const issue = issueSnapshot()
    const existing = importedRevision(issue, { id: 'contract-revision-existing' })
    const existingCase = deliveryCase('contract-revision-existing')
    const { deps, fetch, createCase, reviseCase } = dependencies([existing], [existingCase])
    fetch.mockResolvedValue(jsonResponse(issue))

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).resolves.toBe(existing)

    expect(createCase).not.toHaveBeenCalled()
    expect(reviseCase).not.toHaveBeenCalled()
  })

  it('does not import an Issue whose authoritative Work Brief is invalid', async () => {
    const { deps, fetch, createCase, reviseCase } = dependencies()
    fetch.mockResolvedValue(jsonResponse(issueSnapshot({
      body: validBody.replace('dsh-delivery-work-brief@1', 'dsh-delivery-work-brief@2'),
    })))

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).rejects.toMatchObject({
      code: 'missing-block',
    })

    expect(createCase).not.toHaveBeenCalled()
    expect(reviseCase).not.toHaveBeenCalled()
  })

  it('returns an existing revision when GitHub only changed its timestamp', async () => {
    const issue = issueSnapshot()
    const existing = importedRevision(issue, { id: 'contract-revision-existing-content' })
    const existingCase = deliveryCase('contract-revision-existing-content')
    const { deps, fetch, createCase, reviseCase } = dependencies([existing], [existingCase])
    fetch.mockResolvedValue(jsonResponse(issueSnapshot({
      updated_at: '2026-08-30T12:01:00.000Z',
    })))

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).resolves.toBe(existing)

    expect(createCase).not.toHaveBeenCalled()
    expect(reviseCase).not.toHaveBeenCalled()
  })

  it('revises the Case under an expected head when the Issue content changed', async () => {
    const issue = issueSnapshot()
    const previous = importedRevision(issue, { id: 'contract-revision-prior' })
    const existingCase = deliveryCase('contract-revision-prior')
    const unrelated = importedRevision(issue, { id: 'contract-revision-unrelated' })
    const unrelatedRevision = {
      ...unrelated,
      origin: {
        kind: 'github-import' as const,
        repository: { owner: 'elsewhere', name: 'project' },
        issueNumber: 42,
        contentDigest: githubIssueContentDigest({ title: issue.title, body: issue.body }),
      },
    }
    const { deps, fetch, createCase, reviseCase } = dependencies(
      [unrelatedRevision, previous],
      [deliveryCase('contract-revision-unrelated', { id: 'delivery-case-unrelated' }), existingCase],
    )
    const editedIssue = issueSnapshot({
      body: validBody.replace(
        'Keep the interaction entirely mock-backed while the data APIs remain out of scope.',
        'Use only a checked-in mock without adding a network dependency.',
      ),
      updated_at: '2026-08-30T12:05:00.000Z',
    })
    fetch.mockResolvedValue(jsonResponse(editedIssue))

    await importGitHubIssue(deps, { issueUrl, repositoryId })

    expect(createCase).not.toHaveBeenCalled()
    const [request] = reviseCase.mock.calls[0]!
    expect(request.idempotencyKey).toBe(`github:example/project:issue:42:previous:${previous.id}`)
    expect(request.caseId).toBe(existingCase.id)
    expect(request.expectedHeadRevisionId).toBe(previous.id)
    expect(request.origin).toEqual(importOrigin(editedIssue.title, editedIssue.body))
    expect(request.title).toBe(editedIssue.title)
    expect(request.revision).toEqual(workBriefContractRevisionDraft(parseGitHubIssueWorkBrief(editedIssue.body)))
  })

  it('adopts an A to B to A reversion after the Case head regardless of snapshot order', async () => {
    const first = issueSnapshot()
    const second = issueSnapshot({
      body: validBody.replace(
        'Keep the interaction entirely mock-backed while the data APIs remain out of scope.',
        'Use only a checked-in mock without adding a network dependency.',
      ),
    })
    const revisionA = importedRevision(first, { id: 'contract-revision-a' })
    const revisionB = importedRevision(second, {
      id: 'contract-revision-b',
      previousRevisionId: revisionA.id,
    })
    const kase = deliveryCase('contract-revision-b')

    const requests = await Promise.all([
      [revisionA, revisionB],
      [revisionB, revisionA],
    ].map(async (revisions) => {
      const { deps, fetch, reviseCase } = dependencies(revisions, [kase])
      fetch.mockResolvedValue(jsonResponse(first))
      await importGitHubIssue(deps, { issueUrl, repositoryId })
      return reviseCase.mock.calls[0]![0]
    }))

    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({
      idempotencyKey: `github:example/project:issue:42:previous:${revisionB.id}`,
      expectedHeadRevisionId: revisionB.id,
      origin: importOrigin(first.title, first.body),
    })
    expect(requests[1]).toEqual(requests[0])
  })

  it.each([
    ['duplicated revision identity', () => {
      const duplicate = importedRevision()
      return [duplicate, duplicate]
    }, () => [deliveryCase('contract-revision-fixture')]],
    ['a broken Case chain with a missing predecessor', () => [
      importedRevision(issueSnapshot(), {
        id: 'contract-revision-orphan',
        previousRevisionId: ContractRevisionId('contract-revision-missing'),
      }),
    ], () => [deliveryCase('contract-revision-orphan')]],
    ['a Case head that is absent from the snapshot', () => [], () => [deliveryCase('contract-revision-missing-head')]],
    ['a cyclic Case chain', () => {
      const a = importedRevision(issueSnapshot(), { id: 'contract-revision-cycle-a' })
      const b = importedRevision(issueSnapshot({ title: 'cycle-b' }), {
        id: 'contract-revision-cycle-b',
        previousRevisionId: a.id,
      })
      return [{ ...a, previousRevisionId: b.id }, b]
    }, () => [deliveryCase('contract-revision-cycle-a')]],
    ['more than one Case for the same Issue', () => [importedRevision()], () => [
      deliveryCase('contract-revision-fixture', { id: 'delivery-case-left' }),
      deliveryCase('contract-revision-fixture', { id: 'delivery-case-right' }),
    ]],
  ])('fails closed for a %s snapshot', async (_label, revisions, cases) => {
    const builtRevisions = revisions()
    const builtCases = cases()
    const { deps, fetch, createCase, reviseCase } = dependencies(builtRevisions, builtCases)
    fetch.mockResolvedValue(jsonResponse(issueSnapshot({ title: 'new Issue state' })))

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).rejects.toMatchObject({
      code: 'invalid-request',
    })

    expect(createCase).not.toHaveBeenCalled()
    expect(reviseCase).not.toHaveBeenCalled()
  })

  it('rejects an import whose matched Case is bound to another configured repository', async () => {
    const issue = issueSnapshot()
    const existing = importedRevision(issue, { id: 'contract-revision-other-repository' })
    const { deps, fetch, createCase, reviseCase } = dependencies(
      [existing],
      [deliveryCase('contract-revision-other-repository', {
        repositoryId: RepositoryId('other-repository'),
      })],
    )
    fetch.mockResolvedValue(jsonResponse(issue))

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).rejects.toMatchObject({
      code: 'invalid-request',
    })

    expect(createCase).not.toHaveBeenCalled()
    expect(reviseCase).not.toHaveBeenCalled()
  })

  it('refuses to override a Case head revised by a human actor', async () => {
    const issue = issueSnapshot()
    const imported = importedRevision(issue, { id: 'contract-revision-imported' })
    const humanHead = {
      ...imported,
      id: ContractRevisionId('contract-revision-human-head'),
      previousRevisionId: imported.id,
      origin: { kind: 'human', actorId: 'reviewer-fixture' } as const,
      title: 'Human-revised requirement',
    }
    const { deps, fetch, createCase, reviseCase } = dependencies(
      [imported, humanHead],
      [deliveryCase('contract-revision-human-head')],
    )
    fetch.mockResolvedValue(jsonResponse(issueSnapshot({ title: 'edited Issue title' })))

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).rejects.toMatchObject({
      code: 'invalid-request',
    })

    expect(createCase).not.toHaveBeenCalled()
    expect(reviseCase).not.toHaveBeenCalled()
  })

  it('never records a requirement decision or approval while importing', async () => {
    const issue = issueSnapshot()
    const { deps, fetch, recordRequirementDecision } = dependencies(
      [],
      [],
      undefined,
      importedRevision(issue, { id: 'contract-revision-committed' }),
    )
    fetch.mockResolvedValue(jsonResponse(issue))

    const revision = await importGitHubIssue(deps, { issueUrl, repositoryId })

    expect(recordRequirementDecision).not.toHaveBeenCalled()
    expect(revision.origin).toEqual(importOrigin(issue.title, issue.body))
    expect(revision.title).toBe(issue.title)
  })

  it('linearizes concurrent timestamp-only imports into one idempotent Case creation', async () => {
    const gate = deferred()
    const provider = caseDelivery(gate.promise)
    const firstIssue = issueSnapshot({ updated_at: '2026-08-30T12:00:01.000Z' })
    const secondIssue = issueSnapshot({ updated_at: '2026-08-30T12:00:02.000Z' })
    const first = importGitHubIssue({
      delivery: provider.delivery,
      fetch: async () => jsonResponse(firstIssue),
    }, { issueUrl, repositoryId })
    await provider.firstCommit
    const second = importGitHubIssue({
      delivery: provider.delivery,
      fetch: async () => jsonResponse(secondIssue),
    }, { issueUrl, repositoryId })
    await nextTurn()
    gate.resolve()

    const [firstRevision, secondRevision] = await Promise.all([first, second])
    expect(secondRevision).toEqual(firstRevision)
    expect(provider.delivery.snapshot().contractRevisions).toEqual([firstRevision])
  })

  it('linearizes concurrent changed content into one deterministic Case revision chain', async () => {
    const gate = deferred()
    const provider = caseDelivery(gate.promise)
    const firstIssue = issueSnapshot({ title: 'first current state' })
    const secondIssue = issueSnapshot({ title: 'second current state' })
    const first = importGitHubIssue({
      delivery: provider.delivery,
      fetch: async () => jsonResponse(firstIssue),
    }, { issueUrl, repositoryId })
    await provider.firstCommit
    const second = importGitHubIssue({
      delivery: provider.delivery,
      fetch: async () => jsonResponse(secondIssue),
    }, { issueUrl, repositoryId })
    await nextTurn()
    gate.resolve()

    const [firstRevision, secondRevision] = await Promise.all([first, second])
    expect(firstRevision.previousRevisionId).toBeNull()
    expect(secondRevision.previousRevisionId).toBe(firstRevision.id)
    expect(provider.delivery.snapshot().contractRevisions).toEqual([firstRevision, secondRevision])
  })

  it('appends a late older HTTP response after the current head without branching', async () => {
    const provider = caseDelivery()
    const olderIssue = issueSnapshot({
      updated_at: '2026-08-30T12:00:01.000Z',
      title: 'older Issue state',
    })
    const newerIssue = issueSnapshot({
      updated_at: '2026-08-30T12:00:02.000Z',
      title: 'newer Issue state',
    })
    let resolveOlderResponse!: (response: Response) => void
    const olderResponse = new Promise<Response>((resolve) => {
      resolveOlderResponse = resolve
    })
    let fetchOrdinal = 0
    const fetch: typeof globalThis.fetch = async () => {
      fetchOrdinal += 1
      return fetchOrdinal === 1 ? olderResponse : jsonResponse(newerIssue)
    }

    const older = importGitHubIssue({ delivery: provider.delivery, fetch }, { issueUrl, repositoryId })
    await nextTurn()
    const newer = importGitHubIssue({ delivery: provider.delivery, fetch }, { issueUrl, repositoryId })
    const newerRevision = await newer
    resolveOlderResponse(jsonResponse(olderIssue))

    const olderRevision = await older
    expect(olderRevision.previousRevisionId).toBe(newerRevision.id)
    expect(provider.delivery.snapshot().contractRevisions).toEqual([newerRevision, olderRevision])
  })

  it('does not make a different Issue wait for a delayed same-Delivery import', async () => {
    const gate = deferred()
    const provider = caseDelivery(gate.promise)
    const otherIssueUrl = 'https://github.com/example/project/issues/43'
    const first = importGitHubIssue({
      delivery: provider.delivery,
      fetch: async () => jsonResponse(issueSnapshot()),
    }, { issueUrl, repositoryId })
    await provider.firstCommit
    const other = importGitHubIssue({
      delivery: provider.delivery,
      fetch: async () => jsonResponse(issueSnapshot({
        number: 43,
        html_url: otherIssueUrl,
        title: 'different Issue',
      })),
    }, { issueUrl: otherIssueUrl, repositoryId })

    await provider.secondCommit
    await expect(other).resolves.toMatchObject({ origin: { issueNumber: 43 } })
    gate.resolve()
    await expect(first).resolves.toMatchObject({ origin: { issueNumber: 42 } })
  })

  it('imports concurrent timestamp-only retries through one root idempotency identity', async () => {
    const issue = issueSnapshot()
    const { deps, fetch, createCase, reviseCase } = dependencies(
      [],
      [],
      undefined,
      importedRevision(issue, { id: 'contract-revision-committed' }),
    )
    let responseOrdinal = 0
    fetch.mockImplementation(async () => jsonResponse(issueSnapshot({
      updated_at: `2026-08-30T12:00:0${String(++responseOrdinal)}.000Z`,
    })))

    const [first, second] = await Promise.all([
      importGitHubIssue(deps, { issueUrl, repositoryId }),
      importGitHubIssue(deps, { issueUrl, repositoryId }),
    ])

    expect(createCase).toHaveBeenCalledTimes(1)
    expect(reviseCase).not.toHaveBeenCalled()
    const [request] = createCase.mock.calls[0]!
    expect(request.idempotencyKey).toBe('github:example/project:issue:42:root')
    expect(first).toBe(second)
  })

  it('classifies cancellation after fetch resolves before response classification as aborted', async () => {
    const controller = new AbortController()
    const { deps, fetch, snapshot, createCase, reviseCase } = dependencies()
    fetch.mockImplementation(async () => {
      controller.abort()
      return new Response('forbidden', { status: 403 })
    })

    await expect(importGitHubIssue(deps, {
      issueUrl,
      repositoryId,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'aborted' })

    expect(snapshot).not.toHaveBeenCalled()
    expect(createCase).not.toHaveBeenCalled()
    expect(reviseCase).not.toHaveBeenCalled()
  })

  it('classifies a JSON rejection concurrent with cancellation as aborted', async () => {
    const controller = new AbortController()
    const { deps, fetch, snapshot, createCase, reviseCase } = dependencies()
    const response = new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    vi.spyOn(response, 'json').mockImplementation(async () => {
      controller.abort()
      throw new SyntaxError('partial JSON')
    })
    fetch.mockResolvedValue(response)

    await expect(importGitHubIssue(deps, {
      issueUrl,
      repositoryId,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'aborted' })

    expect(snapshot).not.toHaveBeenCalled()
    expect(createCase).not.toHaveBeenCalled()
    expect(reviseCase).not.toHaveBeenCalled()
  })

  it('does not return an existing revision when cancellation occurs during snapshot', async () => {
    const controller = new AbortController()
    const existing = importedRevision(issueSnapshot(), { id: 'contract-revision-existing-snapshot-abort' })
    const { deps, fetch, createCase, reviseCase } = dependencies(
      [existing],
      [deliveryCase('contract-revision-existing-snapshot-abort')],
      () => {
        controller.abort()
      },
    )
    fetch.mockResolvedValue(jsonResponse())

    await expect(importGitHubIssue(deps, {
      issueUrl,
      repositoryId,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'aborted' })

    expect(createCase).not.toHaveBeenCalled()
    expect(reviseCase).not.toHaveBeenCalled()
  })

  it('does not begin Case creation when cancellation occurs during snapshot', async () => {
    const controller = new AbortController()
    const { deps, fetch, createCase, reviseCase } = dependencies([], [], () => {
      controller.abort()
    })
    fetch.mockResolvedValue(jsonResponse())

    await expect(importGitHubIssue(deps, {
      issueUrl,
      repositoryId,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'aborted' })

    expect(createCase).not.toHaveBeenCalled()
    expect(reviseCase).not.toHaveBeenCalled()
  })

  it('returns the Delivery committed Case revision when cancellation follows the commit point', async () => {
    const controller = new AbortController()
    const committed = importedRevision(issueSnapshot(), { id: 'contract-revision-committed' })
    const { deps, fetch, createCase } = dependencies()
    createCase.mockImplementation(async () => {
      controller.abort()
      return {
        case: deliveryCase('contract-revision-committed'),
        revision: committed,
      }
    })
    fetch.mockResolvedValue(jsonResponse())

    await expect(importGitHubIssue(deps, {
      issueUrl,
      repositoryId,
      signal: controller.signal,
    })).resolves.toBe(committed)
  })
})
