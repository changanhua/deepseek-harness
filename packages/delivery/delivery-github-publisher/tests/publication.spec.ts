import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  AcceptanceClauseId,
  RepositoryId,
  VerificationCheckId,
  type GitHubRepositoryRef,
} from '@deepseek-ai/dsh-delivery-protocol'
import { mountDeliveryTestkit } from '@deepseek-ai/dsh-delivery-testkit'
import { describe, expect, it, vi } from 'vitest'
import { publishGitHubIssue, resolveGitHubIssuePublication } from '../src/index.ts'
import { renderGitHubIssue } from '../src/render.ts'

const repositoryId = RepositoryId('workspace')
const repository: GitHubRepositoryRef = { owner: 'example', name: 'project' }
const tokenRef = credentialRef('GITHUB_CANARY_TOKEN')

async function approvedCase() {
  const harness = await mountDeliveryTestkit(new Context())
  const created = await harness.delivery.createCase({
    idempotencyKey: 'publisher-case',
    repositoryId,
    origin: { kind: 'human', actorId: 'publisher-human' },
    title: 'Publish the Delivery Case',
    revision: {
      outcome: 'Publish one exact Issue.',
      context: 'The Host owns the GitHub boundary.',
      allowedScope: ['packages/delivery'],
      forbiddenScope: ['credentials'],
      acceptanceClauses: [{
        id: AcceptanceClauseId('published-once'),
        text: 'One Issue carries the exact marker.',
      }],
      openDecisions: [],
      baseSelectionRule: { kind: 'ref-head', ref: 'refs/heads/main' },
      verificationSource: {
        kind: 'contract-field',
        checks: [{
          id: VerificationCheckId('publisher-check'),
          name: 'Publisher check',
          argv: ['node', '--version'],
          cwd: '.',
          timeoutMs: 5_000,
          severity: 'required',
          expectedExitCodes: [0],
        }],
      },
      referenceLinks: [],
    },
  })
  await harness.delivery.recordRequirementDecision({
    idempotencyKey: 'publisher-approval',
    caseId: created.case.id,
    revisionId: created.revision.id,
    decision: 'approved',
    reason: 'Publish this exact ready revision.',
    actorId: 'publisher-human',
    decisionNonce: 'publisher-approval',
  })
  return { harness, ...created }
}

describe('GitHub Issue publication', () => {
  it('publishes once through the durable state machine and reuses the binding', async () => {
    const { harness, case: deliveryCase, revision } = await approvedCase()
    const rendered = renderGitHubIssue(deliveryCase.id, revision)
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(input).toBe('https://api.github.com/repos/example/project/issues')
      expect(init?.method).toBe('POST')
      expect(init?.headers).toEqual({
        accept: 'application/vnd.github+json',
        authorization: 'Bearer github-secret',
        'content-type': 'application/json',
        'x-github-api-version': '2026-03-10',
      })
      if (typeof init?.body !== 'string') throw new TypeError('publisher request body must be a string')
      expect(JSON.parse(init.body)).toEqual({
        title: rendered.title,
        body: rendered.body,
        labels: ['dsh-delivery-canary'],
      })
      return new Response(JSON.stringify({
        number: 42,
        html_url: 'https://github.com/example/project/issues/42',
        repository_url: 'https://api.github.com/repos/example/project',
        title: rendered.title,
        body: rendered.body,
      }), { status: 201, headers: { 'content-type': 'application/json' } })
    })
    const credentials = {
      resolve: vi.fn(async (ref: typeof tokenRef) => ref === tokenRef
        ? { value: 'github-secret', source: 'test' }
        : undefined),
    }
    const dependencies = {
      delivery: harness.delivery,
      credentials,
      fetch,
      targetForRepository: (id: string) => id === repositoryId
        ? { repository, credentialRef: tokenRef, labels: ['dsh-delivery-canary'] }
        : undefined,
      now: () => '2026-08-31T00:00:00.000Z',
    }
    const request = {
      caseId: deliveryCase.id,
      revisionId: revision.id,
      signal: new AbortController().signal,
    }

    const published = await publishGitHubIssue(dependencies, request)
    expect(published).toMatchObject({
      id: rendered.publicationId,
      phase: 'published',
      renderedDigest: rendered.renderedDigest,
      marker: rendered.marker,
      issue: {
        repository,
        issueNumber: 42,
        url: 'https://github.com/example/project/issues/42',
      },
    })
    await expect(publishGitHubIssue(dependencies, request)).resolves.toEqual(published)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(credentials.resolve).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(harness.delivery.snapshot())).not.toContain('github-secret')
    await harness.dispose()
  })

  it('records unknown when the external Issue exists but the published binding cannot commit', async () => {
    const { harness, case: deliveryCase, revision } = await approvedCase()
    const rendered = renderGitHubIssue(deliveryCase.id, revision)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
      number: 42,
      html_url: 'https://github.com/example/project/issues/42',
      repository_url: 'https://api.github.com/repos/example/project',
      title: rendered.title,
      body: rendered.body,
    }), { status: 201, headers: { 'content-type': 'application/json' } }))
    const delivery = {
      getCase: harness.delivery.getCase.bind(harness.delivery),
      getContractRevision: harness.delivery.getContractRevision.bind(harness.delivery),
      getIssuePublication: harness.delivery.getIssuePublication.bind(harness.delivery),
      prepareIssuePublication: harness.delivery.prepareIssuePublication.bind(harness.delivery),
      markIssuePublicationStarted: harness.delivery.markIssuePublicationStarted.bind(harness.delivery),
      completeIssuePublication: vi.fn(async () => {
        throw new Error('controlled publication commit failure')
      }),
      failIssuePublication: harness.delivery.failIssuePublication.bind(harness.delivery),
      resolveIssuePublication: harness.delivery.resolveIssuePublication.bind(harness.delivery),
    }

    await expect(publishGitHubIssue({
      delivery,
      credentials: { resolve: async () => ({ value: 'github-secret', source: 'test' }) },
      fetch,
      targetForRepository: () => ({ repository, credentialRef: tokenRef }),
      now: () => '2026-08-31T00:00:00.000Z',
    }, {
      caseId: deliveryCase.id,
      revisionId: revision.id,
    })).rejects.toMatchObject({ code: 'transport' })

    expect(harness.delivery.getIssuePublication(rendered.publicationId)).toMatchObject({
      phase: 'unknown',
      failure: {
        sideEffect: 'unknown',
        category: 'transport',
        detail: 'The published GitHub Issue binding could not be committed',
      },
    })
    await harness.dispose()
  })

  it('confirms an unknown publication only after a fresh GET validates marker and digest', async () => {
    const { harness, case: deliveryCase, revision } = await approvedCase()
    const rendered = renderGitHubIssue(deliveryCase.id, revision)
    const prepared = await harness.delivery.prepareIssuePublication({
      idempotencyKey: `github-issue:${rendered.publicationId}`,
      caseId: deliveryCase.id,
      revisionId: revision.id,
      repository,
      renderedDigest: rendered.renderedDigest,
      marker: rendered.marker,
    })
    await harness.delivery.markIssuePublicationStarted(prepared.id)
    await harness.delivery.failIssuePublication({
      publicationId: prepared.id,
      expectedPhase: 'publishing',
      failure: {
        sideEffect: 'unknown',
        category: 'transport',
        detail: 'The request outcome is unknown.',
        occurredAt: '2026-08-31T00:00:00.000Z',
      },
    })
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      expect(input).toBe('https://api.github.com/repos/example/project/issues/42')
      expect(init).toMatchObject({
        method: 'GET',
        headers: {
          accept: 'application/vnd.github+json',
          authorization: 'Bearer github-secret',
          'x-github-api-version': '2026-03-10',
        },
      })
      return new Response(JSON.stringify({
        number: 42,
        html_url: 'https://github.com/example/project/issues/42',
        repository_url: 'https://api.github.com/repos/example/project',
        title: rendered.title,
        body: rendered.body,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })

    const resolved = await resolveGitHubIssuePublication({
      delivery: harness.delivery,
      credentials: { resolve: async () => ({ value: 'github-secret', source: 'test' }) },
      fetch,
      targetForRepository: () => ({ repository, credentialRef: tokenRef }),
      now: () => '2026-08-31T00:00:00.000Z',
    }, {
      resolution: 'confirm-published',
      publicationId: prepared.id,
      issueNumber: 42,
      signal: new AbortController().signal,
    })

    expect(resolved).toMatchObject({
      phase: 'published',
      issue: { repository, issueNumber: 42, url: 'https://github.com/example/project/issues/42' },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    await harness.dispose()
  })

  it('leaves prepared intent without HTTP when the credential reference is missing', async () => {
    const { harness, case: deliveryCase, revision } = await approvedCase()
    const rendered = renderGitHubIssue(deliveryCase.id, revision)
    const fetch = vi.fn<typeof globalThis.fetch>()

    await expect(publishGitHubIssue({
      delivery: harness.delivery,
      credentials: { resolve: async () => undefined },
      fetch,
      targetForRepository: () => ({ repository, credentialRef: tokenRef }),
      now: () => '2026-08-31T00:00:00.000Z',
    }, {
      caseId: deliveryCase.id,
      revisionId: revision.id,
    })).rejects.toMatchObject({ code: 'missing-credential' })

    expect(fetch).not.toHaveBeenCalled()
    expect(harness.delivery.getIssuePublication(rendered.publicationId)).toMatchObject({
      phase: 'prepared', issue: null, failure: null,
    })
    await harness.dispose()
  })

  it('records transport uncertainty and refuses a second POST without resolution', async () => {
    const { harness, case: deliveryCase, revision } = await approvedCase()
    const rendered = renderGitHubIssue(deliveryCase.id, revision)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new TypeError('controlled socket reset')
    })
    const dependencies = {
      delivery: harness.delivery,
      credentials: { resolve: async () => ({ value: 'github-secret', source: 'test' }) },
      fetch,
      targetForRepository: () => ({ repository, credentialRef: tokenRef }),
      now: () => '2026-08-31T00:00:00.000Z',
    }
    const request = { caseId: deliveryCase.id, revisionId: revision.id }

    await expect(publishGitHubIssue(dependencies, request)).rejects.toMatchObject({ code: 'transport' })
    expect(harness.delivery.getIssuePublication(rendered.publicationId)).toMatchObject({
      phase: 'unknown',
      failure: { sideEffect: 'unknown', category: 'transport' },
    })
    await expect(publishGitHubIssue(dependencies, request)).rejects.toMatchObject({ code: 'invalid-state' })
    expect(fetch).toHaveBeenCalledTimes(1)
    await harness.dispose()
  })

  it('records unknown when a 201 response does not echo the exact rendered Issue', async () => {
    const { harness, case: deliveryCase, revision } = await approvedCase()
    const rendered = renderGitHubIssue(deliveryCase.id, revision)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
      number: 42,
      html_url: 'https://github.com/example/project/issues/42',
      repository_url: 'https://api.github.com/repos/example/project',
      title: rendered.title,
      body: `${rendered.body}\nmutated`,
    }), { status: 201, headers: { 'content-type': 'application/json' } }))

    await expect(publishGitHubIssue({
      delivery: harness.delivery,
      credentials: { resolve: async () => ({ value: 'github-secret', source: 'test' }) },
      fetch,
      targetForRepository: () => ({ repository, credentialRef: tokenRef }),
      now: () => '2026-08-31T00:00:00.000Z',
    }, {
      caseId: deliveryCase.id,
      revisionId: revision.id,
    })).rejects.toMatchObject({ code: 'invalid-response' })

    expect(harness.delivery.getIssuePublication(rendered.publicationId)).toMatchObject({
      phase: 'unknown',
      failure: { sideEffect: 'unknown', category: 'invalid-response' },
    })
    await harness.dispose()
  })
})
