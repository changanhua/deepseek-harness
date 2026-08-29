import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AdoptContractRevisionRequest,
  DeliverySnapshot,
} from '@deepseek-ai/dsh-delivery'
import type { ContractRevision } from '@deepseek-ai/dsh-delivery-protocol'
import { RepositoryId, sourceRefContentDigest } from '@deepseek-ai/dsh-delivery-protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  importGitHubIssue,
  type GitHubIssueIntakeDependencies,
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

function dependencies(revisions: readonly ContractRevision[] = []) {
  const snapshot = vi.fn<() => DeliverySnapshot>(() => ({
    contractRevisions: revisions,
    workPackets: [],
    dispatchBindings: [],
    acceptanceDecisions: [],
  }))
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
    expect(request.idempotencyKey).toBe(`github:example/project:issue:42:${sourceRefContentDigest(issue)}`)
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
    const existing = {
      id: 'contract-revision-existing',
      sourceRef: {
        provider: 'github',
        repository: { owner: 'example', name: 'project' },
        issueNumber: 42,
        canonicalUrl: issueUrl,
        updatedAt: issue.updated_at,
        title: issue.title,
        body: issue.body,
        contentDigest: sourceRefContentDigest(issue),
      },
    } as ContractRevision
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
    const existing = {
      id: 'contract-revision-existing-content',
      sourceRef: {
        provider: 'github',
        repository: { owner: 'example', name: 'project' },
        issueNumber: 42,
        canonicalUrl: issueUrl,
        updatedAt: '2026-08-30T12:00:00.000Z',
        title: issue.title,
        body: issue.body,
        contentDigest: sourceRefContentDigest(issue),
      },
    } as ContractRevision
    const { deps, fetch, adopted } = dependencies([existing])
    fetch.mockResolvedValue(jsonResponse(issueSnapshot({
      updated_at: '2026-08-30T12:01:00.000Z',
    })))

    await expect(importGitHubIssue(deps, { issueUrl, repositoryId })).resolves.toBe(existing)

    expect(adopted).not.toHaveBeenCalled()
  })

  it('adopts an edited Issue after its latest same-Issue predecessor', async () => {
    const previous = {
      id: 'contract-revision-prior',
      sourceRef: {
        provider: 'github',
        repository: { owner: 'example', name: 'project' },
        issueNumber: 42,
      },
    } as ContractRevision
    const unrelated = {
      id: 'contract-revision-unrelated',
      sourceRef: {
        provider: 'github',
        repository: { owner: 'elsewhere', name: 'project' },
        issueNumber: 42,
      },
    } as ContractRevision
    const { deps, fetch, adopted } = dependencies([unrelated, previous])
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
    expect(request.idempotencyKey).toBe(`github:example/project:issue:42:${sourceRefContentDigest(issue)}`)
    expect(request.revision.previousRevisionId).toBe(previous.id)
  })
})
