import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AdoptContractRevisionRequest,
  DeliverySnapshot,
} from '@deepseek-ai/dsh-delivery'
import { DeliveryError } from '@deepseek-ai/dsh-delivery'
import type { ContractRevision } from '@deepseek-ai/dsh-delivery-protocol'
import {
  ContractRevisionId,
  RepositoryId,
  SourceRefId,
  canonicalJson,
  sourceRefContentDigest,
} from '@deepseek-ai/dsh-delivery-protocol'
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
    updated_at: '2026-08-30T12:00:00.000Z',
    title: 'Adopt the exact Issue snapshot',
    body: validBody,
    ...overrides,
  }
}

function contractRevision(
  issue = issueSnapshot(),
  {
    id = 'contract-revision-fixture',
    previousRevisionId = null,
    selectedRepositoryId = repositoryId,
  }: {
    readonly id?: string
    readonly previousRevisionId?: ContractRevision['previousRevisionId']
    readonly selectedRepositoryId?: typeof repositoryId
  } = {},
): ContractRevision {
  const revisionId = ContractRevisionId(id)
  return {
    schemaVersion: 1,
    id: revisionId,
    ...workBriefContractRevisionDraft(
      parseGitHubIssueWorkBrief(issue.body),
      selectedRepositoryId,
      previousRevisionId,
    ),
    sourceRef: {
      schemaVersion: 1,
      id: SourceRefId(`source-ref-${id}`),
      provider: 'github',
      repository: { owner: 'example', name: 'project' },
      issueNumber: 42,
      canonicalUrl: issueUrl,
      updatedAt: issue.updated_at,
      title: issue.title,
      body: issue.body,
      contentDigest: sourceRefContentDigest(issue),
      createdAt: '2026-08-30T12:00:00.000Z',
    },
    createdAt: '2026-08-30T12:00:00.000Z',
  }
}

function dependencies(
  revisions: readonly ContractRevision[] = [],
  onSnapshot?: () => void,
) {
  const snapshot = vi.fn<() => DeliverySnapshot>(() => ({
    contractRevisions: revisions,
    workPackets: [],
    dispatchBindings: [],
    acceptanceDecisions: [],
  }))
  snapshot.mockImplementation(() => {
    onSnapshot?.()
    return {
      contractRevisions: revisions,
      workPackets: [],
      dispatchBindings: [],
      acceptanceDecisions: [],
    }
  })
  const adopted = vi.fn<(request: AdoptContractRevisionRequest) => Promise<ContractRevision>>(
    async _request => ({ id: 'contract-revision-adopted' }) as ContractRevision,
  )
  const fetch = vi.fn<typeof globalThis.fetch>()
  const deps: GitHubIssueIntakeDependencies = {
    delivery: { snapshot, adoptContractRevision: adopted },
    fetch,
  }
  return { deps, snapshot, adopted, fetch }
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

function contractDelivery(firstCommitGate?: Promise<void>) {
  const revisions: ContractRevision[] = []
  const idempotency = new Map<string, { readonly input: string; readonly revision: ContractRevision }>()
  const tails = new Map<string, Promise<void>>()
  const firstAdoption = deferred()
  const secondAdoption = deferred()
  let adoptionOrdinal = 0

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

  const delivery: GitHubIssueIntakeDependencies['delivery'] = {
    snapshot: () => ({
      contractRevisions: structuredClone(revisions),
      workPackets: [],
      dispatchBindings: [],
      acceptanceDecisions: [],
    }),
    adoptContractRevision: async request => serialize(request.idempotencyKey, async () => {
      const prior = idempotency.get(request.idempotencyKey)
      const input = canonicalJson(request)
      if (prior !== undefined) {
        if (prior.input !== input) {
          throw new DeliveryError('idempotency-conflict', 'contract provider received one key with different input')
        }
        return structuredClone(prior.revision)
      }
      adoptionOrdinal += 1
      if (adoptionOrdinal === 1) {
        firstAdoption.resolve()
        if (firstCommitGate !== undefined) await firstCommitGate
      } else if (adoptionOrdinal === 2) {
        secondAdoption.resolve()
      }
      const createdAt = '2026-08-30T12:00:00.000Z'
      const revision: ContractRevision = {
        schemaVersion: 1,
        id: ContractRevisionId(`contract-revision-provider-${String(revisions.length + 1)}`),
        ...request.revision,
        sourceRef: {
          schemaVersion: 1,
          id: SourceRefId(`source-ref-provider-${String(revisions.length + 1)}`),
          provider: 'github',
          ...request.source,
          createdAt,
        },
        createdAt,
      }
      revisions.push(revision)
      idempotency.set(request.idempotencyKey, { input, revision })
      return structuredClone(revision)
    }),
  }
  return {
    delivery,
    firstAdoption: firstAdoption.promise,
    secondAdoption: secondAdoption.promise,
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
    const { deps, fetch, snapshot, adopted } = dependencies()

    await expect(importGitHubIssue(deps, {
      issueUrl: candidateUrl,
      repositoryId,
    })).rejects.toMatchObject({ code: 'invalid-request' })

    expect(fetch).not.toHaveBeenCalled()
    expect(snapshot).not.toHaveBeenCalled()
    expect(adopted).not.toHaveBeenCalled()
  })

  it('uses a content-derived idempotency key for an exact Issue snapshot', async () => {
    const { deps, fetch, adopted } = dependencies()
    const issue = issueSnapshot()
    fetch.mockResolvedValue(jsonResponse(issue))

    await importGitHubIssue(deps, { issueUrl, repositoryId })

    const [request] = adopted.mock.calls[0]!
    expect(request.idempotencyKey).toBe(`github:example/project:issue:42:previous:root:${sourceRefContentDigest(issue)}`)
  })

  it('adopts one exact GitHub snapshot through the host fetch boundary', async () => {
    const { deps, fetch, snapshot, adopted } = dependencies()
    const issue = issueSnapshot()
    const adoptedRevision = { id: 'contract-revision-adopted' } as ContractRevision
    adopted.mockResolvedValue(adoptedRevision)
    fetch.mockResolvedValue(jsonResponse(issue))

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).resolves.toBe(adoptedRevision)

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/example/project/issues/42',
      { headers: { accept: 'application/vnd.github+json' } },
    )
    expect(snapshot).toHaveBeenCalledTimes(1)
    const [request] = adopted.mock.calls[0]!
    expect(request.source).toEqual({
      repository: { owner: 'example', name: 'project' },
      issueNumber: 42,
      canonicalUrl: issueUrl,
      updatedAt: issue.updated_at,
      title: issue.title,
      body: issue.body,
      contentDigest: sourceRefContentDigest(issue),
    })
    expect(request.revision).toMatchObject({
      previousRevisionId: null,
      repositoryId,
      outcome: 'Users can move from Overview to Focus and Leaf views and return.',
    })
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
    const { deps, fetch, snapshot, adopted } = dependencies()
    fetch.mockResolvedValue(response)

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).rejects.toMatchObject({ code })

    expect(snapshot).not.toHaveBeenCalled()
    expect(adopted).not.toHaveBeenCalled()
  })

  it('reports a network failure without reading or writing Delivery', async () => {
    const { deps, fetch, snapshot, adopted } = dependencies()
    fetch.mockRejectedValue(new Error('offline'))

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).rejects.toMatchObject({
      code: 'network-failure',
    })

    expect(snapshot).not.toHaveBeenCalled()
    expect(adopted).not.toHaveBeenCalled()
  })

  it('reports an aborted fetch without reading or writing Delivery', async () => {
    const controller = new AbortController()
    const { deps, fetch, snapshot, adopted } = dependencies()
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
    expect(adopted).not.toHaveBeenCalled()
  })

  it('reports an aborted response body read without reading or writing Delivery', async () => {
    const { deps, fetch, snapshot, adopted } = dependencies()
    const response = new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    vi.spyOn(response, 'json').mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    fetch.mockResolvedValue(response)

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).rejects.toMatchObject({
      code: 'aborted',
    })

    expect(snapshot).not.toHaveBeenCalled()
    expect(adopted).not.toHaveBeenCalled()
  })

  it('does not adopt when cancellation arrives while the response body is read', async () => {
    const controller = new AbortController()
    const { deps, fetch, snapshot, adopted } = dependencies()
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
    expect(adopted).not.toHaveBeenCalled()
  })

  it('does not start intake when the caller already aborted the request', async () => {
    const controller = new AbortController()
    controller.abort()
    const { deps, fetch, snapshot, adopted } = dependencies()
    fetch.mockResolvedValue(jsonResponse())

    await expect(importGitHubIssue(deps, {
      issueUrl,
      repositoryId,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'aborted' })

    expect(fetch).not.toHaveBeenCalled()
    expect(snapshot).not.toHaveBeenCalled()
    expect(adopted).not.toHaveBeenCalled()
  })

  it('returns the existing Contract revision for an exact source snapshot', async () => {
    const issue = issueSnapshot()
    const existing = contractRevision(issue, { id: 'contract-revision-existing' })
    const { deps, fetch, adopted } = dependencies([existing])
    fetch.mockResolvedValue(jsonResponse(issue))

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).resolves.toBe(existing)

    expect(adopted).not.toHaveBeenCalled()
  })

  it('does not adopt an Issue whose authoritative Work Brief is invalid', async () => {
    const { deps, fetch, adopted } = dependencies()
    fetch.mockResolvedValue(jsonResponse(issueSnapshot({
      body: validBody.replace('dsh-delivery-work-brief@1', 'dsh-delivery-work-brief@2'),
    })))

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).rejects.toMatchObject({
      code: 'missing-block',
    })

    expect(adopted).not.toHaveBeenCalled()
  })

  it('returns an existing revision when GitHub only changed its timestamp', async () => {
    const issue = issueSnapshot()
    const existing = contractRevision(issue, { id: 'contract-revision-existing-content' })
    const { deps, fetch, adopted } = dependencies([existing])
    fetch.mockResolvedValue(jsonResponse(issueSnapshot({
      updated_at: '2026-08-30T12:01:00.000Z',
    })))

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).resolves.toBe(existing)

    expect(adopted).not.toHaveBeenCalled()
  })

  it('adopts an edited Issue after its latest same-Issue predecessor', async () => {
    const previous = contractRevision(issueSnapshot(), { id: 'contract-revision-prior' })
    const unrelated = contractRevision(issueSnapshot(), { id: 'contract-revision-unrelated' })
    const unrelatedSource = {
      ...unrelated.sourceRef,
      repository: { owner: 'elsewhere', name: 'project' },
      canonicalUrl: 'https://github.com/elsewhere/project/issues/42',
    }
    const unrelatedRevision = { ...unrelated, sourceRef: unrelatedSource }
    const { deps, fetch, adopted } = dependencies([unrelatedRevision, previous])
    const issue = issueSnapshot({
      body: validBody.replace(
        'Keep the interaction entirely mock-backed while the data APIs remain out of scope.',
        'Use only a checked-in mock without adding a network dependency.',
      ),
      updated_at: '2026-08-30T12:05:00.000Z',
    })
    fetch.mockResolvedValue(jsonResponse(issue))

    await importGitHubIssue(deps, { issueUrl, repositoryId })

    const [request] = adopted.mock.calls[0]!
    expect(request.idempotencyKey).toBe(`github:example/project:issue:42:previous:${previous.id}:${sourceRefContentDigest(issue)}`)
    expect(request.revision.previousRevisionId).toBe(previous.id)
  })

  it('adopts an A to B to A reversion after the unique current head regardless of snapshot order', async () => {
    const first = issueSnapshot()
    const second = issueSnapshot({
      body: validBody.replace(
        'Keep the interaction entirely mock-backed while the data APIs remain out of scope.',
        'Use only a checked-in mock without adding a network dependency.',
      ),
    })
    const revisionA = contractRevision(first, { id: 'contract-revision-a' })
    const revisionB = contractRevision(second, {
      id: 'contract-revision-b',
      previousRevisionId: revisionA.id,
    })

    const requests = await Promise.all([[revisionA, revisionB], [revisionB, revisionA]].map(async (revisions) => {
      const { deps, fetch, adopted } = dependencies(revisions)
      fetch.mockResolvedValue(jsonResponse(first))
      await importGitHubIssue(deps, { issueUrl, repositoryId })
      return adopted.mock.calls[0]![0]
    }))

    expect(requests).toHaveLength(2)
    expect(requests[0]).toMatchObject({
      idempotencyKey: `github:example/project:issue:42:previous:${revisionB.id}:${sourceRefContentDigest(first)}`,
      revision: { previousRevisionId: revisionB.id },
    })
    expect(requests[1]).toEqual(requests[0])
  })

  it.each([
    ['branched heads', () => {
      const root = contractRevision(issueSnapshot(), { id: 'contract-revision-root' })
      return [root,
        contractRevision(issueSnapshot({ title: 'left' }), { id: 'contract-revision-left', previousRevisionId: root.id }),
        contractRevision(issueSnapshot({ title: 'right' }), { id: 'contract-revision-right', previousRevisionId: root.id }),
      ]
    }],
    ['missing predecessor', () => [
      contractRevision(issueSnapshot(), {
        id: 'contract-revision-orphan',
        previousRevisionId: ContractRevisionId('contract-revision-missing'),
      }),
    ]],
    ['cross-Issue predecessor', () => {
      const foreign = contractRevision(issueSnapshot(), { id: 'contract-revision-foreign' })
      const foreignRevision = {
        ...foreign,
        sourceRef: {
          ...foreign.sourceRef,
          repository: { owner: 'elsewhere', name: 'project' },
          canonicalUrl: 'https://github.com/elsewhere/project/issues/42',
        },
      }
      return [
        contractRevision(issueSnapshot(), {
          id: 'contract-revision-cross-issue',
          previousRevisionId: foreign.id,
        }),
        foreignRevision,
      ]
    }],
    ['cyclic lineage', () => {
      const a = contractRevision(issueSnapshot(), { id: 'contract-revision-cycle-a' })
      const b = contractRevision(issueSnapshot({ title: 'cycle-b' }), {
        id: 'contract-revision-cycle-b',
        previousRevisionId: a.id,
      })
      return [{ ...a, previousRevisionId: b.id }, b]
    }],
    ['duplicate revision identity', () => {
      const duplicate = contractRevision(issueSnapshot(), { id: 'contract-revision-duplicate' })
      return [duplicate, duplicate]
    }],
  ])('fails closed for a %s same-Issue lineage', async (_label, revisions) => {
    const { deps, fetch, adopted } = dependencies(revisions())
    fetch.mockResolvedValue(jsonResponse(issueSnapshot({ title: 'new Issue state' })))

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).rejects.toMatchObject({
      code: 'invalid-request',
    })

    expect(adopted).not.toHaveBeenCalled()
  })

  it('fails closed when a valid chain has an independent same-Issue cycle in either snapshot order', async () => {
    const root = contractRevision(issueSnapshot(), { id: 'contract-revision-main-root' })
    const head = contractRevision(issueSnapshot({ title: 'main-head' }), {
      id: 'contract-revision-main-head',
      previousRevisionId: root.id,
    })
    const cycleLeftId = ContractRevisionId('contract-revision-cycle-left')
    const cycleRightId = ContractRevisionId('contract-revision-cycle-right')
    const cycleLeft = contractRevision(issueSnapshot({ title: 'cycle-left' }), {
      id: cycleLeftId,
      previousRevisionId: cycleRightId,
    })
    const cycleRight = contractRevision(issueSnapshot({ title: 'cycle-right' }), {
      id: cycleRightId,
      previousRevisionId: cycleLeftId,
    })

    await Promise.all([
      [root, head, cycleLeft, cycleRight],
      [cycleRight, cycleLeft, head, root],
    ].map(async (revisions) => {
      const { deps, fetch, adopted } = dependencies(revisions)
      fetch.mockResolvedValue(jsonResponse(issueSnapshot({ title: 'new Issue state' })))

      await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).rejects.toMatchObject({
        code: 'invalid-request',
      })
      expect(adopted).not.toHaveBeenCalled()
    }))
  })

  it.each([
    [[
      contractRevision(issueSnapshot({ title: 'head' }), {
        id: 'contract-revision-tail-head',
        previousRevisionId: ContractRevisionId('contract-revision-tail-left'),
      }),
      contractRevision(issueSnapshot({ title: 'left' }), {
        id: 'contract-revision-tail-left',
        previousRevisionId: ContractRevisionId('contract-revision-tail-right'),
      }),
      contractRevision(issueSnapshot({ title: 'right' }), {
        id: 'contract-revision-tail-right',
        previousRevisionId: ContractRevisionId('contract-revision-tail-left'),
      }),
    ]],
  ])('fails closed when the unique head tail enters a cycle', async (revisions) => {
    const { deps, fetch, adopted } = dependencies(revisions)
    fetch.mockResolvedValue(jsonResponse(issueSnapshot({ title: 'new Issue state' })))

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).rejects.toMatchObject({
      code: 'invalid-request',
    })
    expect(adopted).not.toHaveBeenCalled()
  })

  it('linearizes concurrent timestamp-only imports before the contract provider sees a conflicting key', async () => {
    const gate = deferred()
    const provider = contractDelivery(gate.promise)
    const firstIssue = issueSnapshot({ updated_at: '2026-08-30T12:00:01.000Z' })
    const secondIssue = issueSnapshot({ updated_at: '2026-08-30T12:00:02.000Z' })
    const first = importGitHubIssue({
      delivery: provider.delivery,
      fetch: async () => jsonResponse(firstIssue),
    }, { issueUrl, repositoryId })
    await provider.firstAdoption
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

  it('linearizes concurrent changed content into one deterministic same-Issue chain', async () => {
    const gate = deferred()
    const provider = contractDelivery(gate.promise)
    const firstIssue = issueSnapshot({ title: 'first current state' })
    const secondIssue = issueSnapshot({ title: 'second current state' })
    const first = importGitHubIssue({
      delivery: provider.delivery,
      fetch: async () => jsonResponse(firstIssue),
    }, { issueUrl, repositoryId })
    await provider.firstAdoption
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

  it('does not make a different Issue wait for a delayed same-Delivery import', async () => {
    const gate = deferred()
    const provider = contractDelivery(gate.promise)
    const otherIssueUrl = 'https://github.com/example/project/issues/43'
    const first = importGitHubIssue({
      delivery: provider.delivery,
      fetch: async () => jsonResponse(issueSnapshot()),
    }, { issueUrl, repositoryId })
    await provider.firstAdoption
    const other = importGitHubIssue({
      delivery: provider.delivery,
      fetch: async () => jsonResponse(issueSnapshot({
        number: 43,
        html_url: otherIssueUrl,
        title: 'different Issue',
      })),
    }, { issueUrl: otherIssueUrl, repositoryId })

    await provider.secondAdoption
    await expect(other).resolves.toMatchObject({ sourceRef: { issueNumber: 43 } })
    gate.resolve()
    await expect(first).resolves.toMatchObject({ sourceRef: { issueNumber: 42 } })
  })

  it('rejects a content-equivalent revision bound to another configured repository', async () => {
    const issue = issueSnapshot()
    const { deps, fetch, adopted } = dependencies([
      contractRevision(issue, {
        id: 'contract-revision-other-repository',
        selectedRepositoryId: RepositoryId('other-repository'),
      }),
    ])
    fetch.mockResolvedValue(jsonResponse(issue))

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).rejects.toMatchObject({
      code: 'invalid-request',
    })

    expect(adopted).not.toHaveBeenCalled()
  })

  it('uses one root idempotency identity for concurrent timestamp-only retries', async () => {
    const issue = issueSnapshot()
    const { deps, fetch, adopted } = dependencies()
    let responseOrdinal = 0
    fetch.mockImplementation(async () => jsonResponse(issueSnapshot({
      updated_at: `2026-08-30T12:00:0${String(++responseOrdinal)}.000Z`,
    })))

    await Promise.all([
      importGitHubIssue(deps, { issueUrl, repositoryId }),
      importGitHubIssue(deps, { issueUrl, repositoryId }),
    ])

    expect(adopted).toHaveBeenCalledTimes(2)
    expect(adopted.mock.calls.map(([request]) => request.idempotencyKey)).toEqual([
      `github:example/project:issue:42:previous:root:${sourceRefContentDigest(issue)}`,
      `github:example/project:issue:42:previous:root:${sourceRefContentDigest(issue)}`,
    ])
  })

  it('classifies cancellation after fetch resolves before response classification as aborted', async () => {
    const controller = new AbortController()
    const { deps, fetch, snapshot, adopted } = dependencies()
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
    expect(adopted).not.toHaveBeenCalled()
  })

  it('classifies a JSON rejection concurrent with cancellation as aborted', async () => {
    const controller = new AbortController()
    const { deps, fetch, snapshot, adopted } = dependencies()
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
    expect(adopted).not.toHaveBeenCalled()
  })

  it('does not return an existing revision when cancellation occurs during snapshot', async () => {
    const controller = new AbortController()
    const existing = contractRevision(issueSnapshot(), { id: 'contract-revision-existing-snapshot-abort' })
    const { deps, fetch, adopted } = dependencies([existing], () => {
      controller.abort()
    })
    fetch.mockResolvedValue(jsonResponse())

    await expect(importGitHubIssue(deps, {
      issueUrl,
      repositoryId,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'aborted' })

    expect(adopted).not.toHaveBeenCalled()
  })

  it('does not begin adoption when cancellation occurs during snapshot', async () => {
    const controller = new AbortController()
    const { deps, fetch, adopted } = dependencies([], () => {
      controller.abort()
    })
    fetch.mockResolvedValue(jsonResponse())

    await expect(importGitHubIssue(deps, {
      issueUrl,
      repositoryId,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'aborted' })

    expect(adopted).not.toHaveBeenCalled()
  })

  it('returns Delivery committed adoption when cancellation follows the adoption commit point', async () => {
    const controller = new AbortController()
    const committed = contractRevision(issueSnapshot(), { id: 'contract-revision-committed' })
    const { deps, fetch, adopted } = dependencies()
    adopted.mockImplementation(async () => {
      controller.abort()
      return committed
    })
    fetch.mockResolvedValue(jsonResponse())

    await expect(importGitHubIssue(deps, {
      issueUrl,
      repositoryId,
      signal: controller.signal,
    })).resolves.toBe(committed)
  })
})
