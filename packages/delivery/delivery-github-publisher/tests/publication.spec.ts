import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import {
  AcceptanceClauseId,
  ContractRevisionId,
  DeliveryCaseId,
  IssuePublicationId,
  RepositoryId,
  Sha256Digest,
  VerificationCheckId,
  type GitHubRepositoryRef,
} from '@changanhua/dsh-delivery-protocol'
import { mountDeliveryTestkit, type MountedDeliveryTestkit } from '@changanhua/dsh-delivery-testkit'
import { describe, expect, it, vi } from 'vitest'
import {
  publishGitHubIssue,
  resolveGitHubIssuePublication,
  type GitHubPublisherDependencies,
} from '../src/index.ts'
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

function deliveryBoundary(delivery: MountedDeliveryTestkit['delivery']): GitHubPublisherDependencies['delivery'] {
  return {
    getCase: delivery.getCase.bind(delivery),
    getContractRevision: delivery.getContractRevision.bind(delivery),
    getIssuePublication: delivery.getIssuePublication.bind(delivery),
    prepareIssuePublication: delivery.prepareIssuePublication.bind(delivery),
    markIssuePublicationStarted: delivery.markIssuePublicationStarted.bind(delivery),
    completeIssuePublication: delivery.completeIssuePublication.bind(delivery),
    failIssuePublication: delivery.failIssuePublication.bind(delivery),
    resolveIssuePublication: delivery.resolveIssuePublication.bind(delivery),
  }
}

function publisherDependencies(
  harness: MountedDeliveryTestkit,
  overrides: Partial<GitHubPublisherDependencies> = {},
): GitHubPublisherDependencies {
  return {
    delivery: deliveryBoundary(harness.delivery),
    credentials: { resolve: async () => ({ value: 'github-secret', source: 'test' }) },
    fetch: vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error('unexpected GitHub request')
    }),
    targetForRepository: id => id === repositoryId ? { repository, credentialRef: tokenRef } : undefined,
    now: () => '2026-08-31T00:00:00.000Z',
    ...overrides,
  }
}

async function prepareUnknownPublication(
  harness: MountedDeliveryTestkit,
  deliveryCase: Awaited<ReturnType<typeof approvedCase>>['case'],
  revision: Awaited<ReturnType<typeof approvedCase>>['revision'],
) {
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
  const publication = await harness.delivery.failIssuePublication({
    publicationId: prepared.id,
    expectedPhase: 'publishing',
    failure: {
      sideEffect: 'unknown',
      category: 'transport',
      detail: 'The request outcome is unknown.',
      occurredAt: '2026-08-31T00:00:00.000Z',
    },
  })
  return { publication, rendered }
}

function publishedIssueResponse(
  rendered: ReturnType<typeof renderGitHubIssue>,
  issueNumber = 42,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    number: issueNumber,
    html_url: `https://github.com/example/project/issues/${String(issueNumber)}`,
    repository_url: 'https://api.github.com/repos/example/project',
    title: rendered.title,
    body: rendered.body,
    ...overrides,
  }
}

describe('GitHub Issue publication', () => {
  it('fails closed before publication when Case, revision, target, or durable identity is invalid', async () => {
    const { harness, case: deliveryCase, revision } = await approvedCase()
    const base = publisherDependencies(harness)

    await expect(publishGitHubIssue(base, {
      caseId: DeliveryCaseId('missing-case'),
      revisionId: revision.id,
    })).rejects.toMatchObject({ code: 'not-found' })
    await expect(publishGitHubIssue(base, {
      caseId: deliveryCase.id,
      revisionId: ContractRevisionId('missing-revision'),
    })).rejects.toMatchObject({ code: 'not-found' })
    await expect(publishGitHubIssue({ ...base, targetForRepository: () => undefined }, {
      caseId: deliveryCase.id,
      revisionId: revision.id,
    })).rejects.toMatchObject({ code: 'unmapped-repository' })

    const originalPrepare = base.delivery.prepareIssuePublication
    await expect(publishGitHubIssue({
      ...base,
      delivery: {
        ...base.delivery,
        prepareIssuePublication: async request => ({
          ...await originalPrepare(request),
          id: IssuePublicationId('wrong-publication-id'),
        }),
      },
    }, {
      caseId: deliveryCase.id,
      revisionId: revision.id,
    })).rejects.toMatchObject({ code: 'invalid-state' })
    await harness.dispose()
  })

  it('honors cancellation before and immediately after the durable request-start boundary', async () => {
    const before = await approvedCase()
    const preflight = new AbortController()
    preflight.abort('cancel before publication')
    await expect(publishGitHubIssue(publisherDependencies(before.harness), {
      caseId: before.case.id,
      revisionId: before.revision.id,
      signal: preflight.signal,
    })).rejects.toMatchObject({ code: 'aborted' })
    await before.harness.dispose()

    const after = await approvedCase()
    const controller = new AbortController()
    const fetch = vi.fn<typeof globalThis.fetch>()
    const boundary = deliveryBoundary(after.harness.delivery)
    const originalMark = boundary.markIssuePublicationStarted
    const dependencies = publisherDependencies(after.harness, {
      fetch,
      delivery: {
        ...boundary,
        markIssuePublicationStarted: async (publicationId) => {
          const publishing = await originalMark(publicationId)
          controller.abort('cancel before POST')
          return publishing
        },
      },
    })
    await expect(publishGitHubIssue(dependencies, {
      caseId: after.case.id,
      revisionId: after.revision.id,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'aborted' })
    expect(fetch).not.toHaveBeenCalled()
    expect(after.harness.delivery.snapshot().issuePublications[0]).toMatchObject({
      phase: 'failed',
      failure: { sideEffect: 'not-started', category: 'canceled' },
    })
    await after.harness.dispose()
  })

  it('records cancellation uncertainty when the POST boundary reports AbortError', async () => {
    const { harness, case: deliveryCase, revision } = await approvedCase()
    const abortError = Object.assign(new Error('controlled abort'), { name: 'AbortError' })
    await expect(publishGitHubIssue(publisherDependencies(harness, {
      fetch: vi.fn<typeof globalThis.fetch>(async () => { throw abortError }),
    }), {
      caseId: deliveryCase.id,
      revisionId: revision.id,
    })).rejects.toMatchObject({ code: 'aborted' })
    expect(harness.delivery.snapshot().issuePublications[0]).toMatchObject({
      phase: 'unknown',
      failure: { sideEffect: 'unknown', category: 'canceled' },
    })
    await harness.dispose()
  })

  it('classifies definitive GitHub HTTP rejection separately from server transport failure', async () => {
    for (const [status, category] of [[422, 'rejected'], [503, 'transport']] as const) {
      const { harness, case: deliveryCase, revision } = await approvedCase()
      await expect(publishGitHubIssue(publisherDependencies(harness, {
        fetch: vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status })),
        targetForRepository: () => ({ repository, credentialRef: tokenRef, labels: [] }),
      }), {
        caseId: deliveryCase.id,
        revisionId: revision.id,
      })).rejects.toMatchObject({ code: 'http-failure' })
      expect(harness.delivery.snapshot().issuePublications[0]).toMatchObject({
        phase: 'failed',
        failure: { sideEffect: 'not-started', category },
      })
      await harness.dispose()
    }
  })

  it('records invalid response uncertainty for missing content type and malformed JSON', async () => {
    for (const response of [
      new Response('{}', { status: 201 }),
      new Response('{', { status: 201, headers: { 'content-type': 'application/json; charset=utf-8' } }),
    ]) {
      const { harness, case: deliveryCase, revision } = await approvedCase()
      await expect(publishGitHubIssue(publisherDependencies(harness, {
        fetch: vi.fn<typeof globalThis.fetch>(async () => response),
      }), {
        caseId: deliveryCase.id,
        revisionId: revision.id,
      })).rejects.toMatchObject({ code: 'invalid-response' })
      expect(harness.delivery.snapshot().issuePublications[0]).toMatchObject({
        phase: 'unknown',
        failure: { sideEffect: 'unknown', category: 'invalid-response' },
      })
      await harness.dispose()
    }
  })

  it('returns the committed binding when only the completion acknowledgement fails', async () => {
    const { harness, case: deliveryCase, revision } = await approvedCase()
    const rendered = renderGitHubIssue(deliveryCase.id, revision)
    const boundary = deliveryBoundary(harness.delivery)
    const originalComplete = boundary.completeIssuePublication
    const published = await publishGitHubIssue(publisherDependencies(harness, {
      fetch: vi.fn<typeof globalThis.fetch>(async () => new Response(
        JSON.stringify(publishedIssueResponse(rendered)),
        { status: 201, headers: { 'content-type': 'application/json' } },
      )),
      delivery: {
        ...boundary,
        completeIssuePublication: async (request) => {
          await originalComplete(request)
          throw new Error('lost completion acknowledgement')
        },
      },
    }), {
      caseId: deliveryCase.id,
      revisionId: revision.id,
    })
    expect(published.phase).toBe('published')
    await harness.dispose()
  })
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

  it('rejects reconciliation for missing, inactive, or orphaned publication records', async () => {
    const created = await approvedCase()
    const base = publisherDependencies(created.harness)
    await expect(resolveGitHubIssuePublication(base, {
      resolution: 'confirm-published',
      publicationId: IssuePublicationId('missing-publication'),
      issueNumber: 42,
    })).rejects.toMatchObject({ code: 'not-found' })

    const rendered = renderGitHubIssue(created.case.id, created.revision)
    const prepared = await created.harness.delivery.prepareIssuePublication({
      idempotencyKey: `github-issue:${rendered.publicationId}`,
      caseId: created.case.id,
      revisionId: created.revision.id,
      repository,
      renderedDigest: rendered.renderedDigest,
      marker: rendered.marker,
    })
    await expect(resolveGitHubIssuePublication(base, {
      resolution: 'confirm-published',
      publicationId: prepared.id,
      issueNumber: 42,
    })).rejects.toMatchObject({ code: 'invalid-state' })

    await created.harness.delivery.markIssuePublicationStarted(prepared.id)
    const request = {
      resolution: 'confirm-published' as const,
      publicationId: prepared.id,
      issueNumber: 42,
    }
    await expect(resolveGitHubIssuePublication({
      ...base,
      delivery: { ...base.delivery, getCase: () => undefined },
    }, request)).rejects.toMatchObject({ code: 'invalid-state' })
    await expect(resolveGitHubIssuePublication({
      ...base,
      delivery: { ...base.delivery, getContractRevision: () => undefined },
    }, request)).rejects.toMatchObject({ code: 'invalid-state' })
    await created.harness.dispose()
  })

  it('returns an already-published reconciliation without credentials or HTTP', async () => {
    const created = await approvedCase()
    const rendered = renderGitHubIssue(created.case.id, created.revision)
    const prepared = await created.harness.delivery.prepareIssuePublication({
      idempotencyKey: `github-issue:${rendered.publicationId}`,
      caseId: created.case.id,
      revisionId: created.revision.id,
      repository,
      renderedDigest: rendered.renderedDigest,
      marker: rendered.marker,
    })
    await created.harness.delivery.markIssuePublicationStarted(prepared.id)
    const published = await created.harness.delivery.completeIssuePublication({
      publicationId: prepared.id,
      expectedPhase: 'publishing',
      issue: {
        repository,
        issueNumber: 42,
        url: 'https://github.com/example/project/issues/42',
      },
    })
    const fetch = vi.fn<typeof globalThis.fetch>()
    const credentials = { resolve: vi.fn(async () => undefined) }
    await expect(resolveGitHubIssuePublication(publisherDependencies(created.harness, {
      fetch,
      credentials,
    }), {
      resolution: 'confirm-published',
      publicationId: prepared.id,
      issueNumber: 42,
    })).resolves.toEqual(published)
    expect(fetch).not.toHaveBeenCalled()
    expect(credentials.resolve).not.toHaveBeenCalled()
    await created.harness.dispose()
  })

  it('reconciliation revalidates repository, render identity, and credential before GET', async () => {
    const created = await approvedCase()
    const { publication } = await prepareUnknownPublication(created.harness, created.case, created.revision)
    const request = {
      resolution: 'confirm-published' as const,
      publicationId: publication.id,
      issueNumber: 42,
    }
    const base = publisherDependencies(created.harness)
    await expect(resolveGitHubIssuePublication({ ...base, targetForRepository: () => undefined }, request))
      .rejects.toMatchObject({ code: 'unmapped-repository' })
    for (const mismatchedRepository of [
      { owner: 'other', name: repository.name },
      { owner: repository.owner, name: 'other' },
    ]) {
      await expect(resolveGitHubIssuePublication({
        ...base,
        targetForRepository: () => ({
          repository: mismatchedRepository,
          credentialRef: tokenRef,
        }),
      }, request)).rejects.toMatchObject({ code: 'invalid-state' })
    }
    for (const mutated of [
      { ...publication, id: IssuePublicationId('wrong-publication-id') },
      { ...publication, renderedDigest: Sha256Digest('sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff') },
      { ...publication, marker: '<!-- wrong marker -->' },
    ]) {
      await expect(resolveGitHubIssuePublication({
        ...base,
        delivery: { ...base.delivery, getIssuePublication: () => mutated },
      }, { ...request, publicationId: mutated.id })).rejects.toMatchObject({ code: 'invalid-state' })
    }
    await expect(resolveGitHubIssuePublication({
      ...base,
      credentials: { resolve: async () => undefined },
    }, request)).rejects.toMatchObject({ code: 'missing-credential' })
    await created.harness.dispose()
  })

  it('maps reconciliation cancellation, transport, HTTP, and response decoding failures', async () => {
    const created = await approvedCase()
    const { publication } = await prepareUnknownPublication(created.harness, created.case, created.revision)
    const request = {
      resolution: 'confirm-published' as const,
      publicationId: publication.id,
      issueNumber: 42,
    }
    const abortError = Object.assign(new Error('controlled abort'), { name: 'AbortError' })
    for (const [failure, code] of [
      [abortError, 'aborted'],
      [new TypeError('controlled socket reset'), 'transport'],
    ] as const) {
      await expect(resolveGitHubIssuePublication(publisherDependencies(created.harness, {
        fetch: vi.fn<typeof globalThis.fetch>(async () => { throw failure }),
      }), request)).rejects.toMatchObject({ code })
    }
    await expect(resolveGitHubIssuePublication(publisherDependencies(created.harness, {
      fetch: vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 404 })),
    }), request)).rejects.toMatchObject({ code: 'http-failure' })
    for (const response of [
      new Response('{}', { status: 200 }),
      new Response('{', { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } }),
    ]) {
      await expect(resolveGitHubIssuePublication(publisherDependencies(created.harness, {
        fetch: vi.fn<typeof globalThis.fetch>(async () => response),
      }), request)).rejects.toMatchObject({ code: 'invalid-response' })
    }

    const controller = new AbortController()
    controller.abort('cancel before GET')
    await expect(resolveGitHubIssuePublication(publisherDependencies(created.harness), {
      ...request,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'aborted' })
    await created.harness.dispose()
  })

  it('rejects every malformed or mismatched reconciliation payload', async () => {
    const created = await approvedCase()
    const { publication, rendered } = await prepareUnknownPublication(
      created.harness,
      created.case,
      created.revision,
    )
    const request = {
      resolution: 'confirm-published' as const,
      publicationId: publication.id,
      issueNumber: 42,
    }
    const payloads: unknown[] = [
      null,
      'not-an-object',
      publishedIssueResponse(rendered, 42, { number: 0 }),
      publishedIssueResponse(rendered, 42, { number: 1.5 }),
      publishedIssueResponse(rendered, 42, { html_url: 'https://github.com/example/project/issues/other' }),
      publishedIssueResponse(rendered, 42, { repository_url: 'https://api.github.com/repos/example/other' }),
      publishedIssueResponse(rendered, 42, { title: 'mutated title' }),
      publishedIssueResponse(rendered, 42, { body: 'mutated body' }),
      publishedIssueResponse(rendered, 43),
    ]
    for (const payload of payloads) {
      await expect(resolveGitHubIssuePublication(publisherDependencies(created.harness, {
        fetch: vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),
      }), request)).rejects.toMatchObject({ code: 'invalid-response' })
    }
    await created.harness.dispose()
  })
})
