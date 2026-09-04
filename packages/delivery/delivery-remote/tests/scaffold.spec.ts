import { Context } from '@deepseek-ai/cordis'
import { DeliveryGitHubIntakeError } from '@changanhua/dsh-delivery-github-intake'
import {
  publishGitHubIssue,
  resolveGitHubIssuePublication,
} from '@changanhua/dsh-delivery-github-publisher'
import { startCodeChange, startVerification } from '@changanhua/dsh-delivery-task-queue'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as RemoteInvariant from '../src/invariant.ts'
import {
  Config,
  DeliveryRemoteService,
  type DeliveryRemoteInternals,
} from '../src/index.ts'

function networkFailureIntakeError(): DeliveryGitHubIntakeError {
  return new DeliveryGitHubIntakeError(
    'network-failure',
    'The C0 intake Consumer could not reach GitHub',
  )
}

function context(): Context {
  const ctx = new Context()
  ctx.provide('delivery', {
    snapshot: () => ({
      contractRevisions: [], workPackets: [], dispatchBindings: [], acceptanceDecisions: [],
      deliveryCases: [], requirementDecisions: [], issuePublications: [],
    }),
  } as never)
  ctx.provide('credentials', {} as never)
  ctx.provide('deliveryEvidence', {} as never)
  ctx.provide('repoWorkspace', {} as never)
  ctx.provide('taskQueue', {
    forOperator: () => ({ list: () => [], pendingAttentions: () => [] }),
  } as never)
  return ctx
}

describe('Delivery Remote host boundary', () => {
  it('registers its package invariant companion', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(RemoteInvariant).await()).resolves.toBeDefined()
    await ctx.fiber.dispose()
  })
  it('keeps the trusted operator id host-owned and non-blank', () => {
    expect(Config({})).toEqual({ operatorId: 'local-operator', repositoryId: 'workspace', githubTargets: {} })
    expect(Config({
      githubTargets: {
        workspace: { owner: 'example', name: 'project', credentialRef: 'GITHUB_CANARY_TOKEN' },
      },
    })).toMatchObject({
      githubTargets: { workspace: { labels: [] } },
    })
    expect(() => Config({ operatorId: '  ' })).toThrow()
    expect(() => new DeliveryRemoteService(context(), { operatorId: '  ' })).toThrow(
      'operatorId must be non-blank',
    )
  })

  it('constructs the delivery namespace and returns an empty browser snapshot', () => {
    const service = new DeliveryRemoteService(context())

    expect(service).toBeInstanceOf(DeliveryRemoteService)
    expect(service.snapshot(new AbortController().signal)).toEqual({
      cases: [], contractsWithoutPacket: [], cards: [], publications: [],
    })
  })

  it('maps a C0 intake network failure to one stable browser failure', async () => {
    const internals: DeliveryRemoteInternals = {
      fetch: globalThis.fetch,
      importIssue: async () => { throw networkFailureIntakeError() },
      startCodeChange,
      startVerification,
      publishGitHubIssue,
      resolveGitHubIssuePublication,
    }
    const service = new DeliveryRemoteService(context(), {}, internals)

    await expect(service.importIssue({
      issueUrl: 'https://github.com/deepseek-ai/deepseek-harness/issues/13',
    }, new AbortController().signal)).rejects.toMatchObject({
      failure: {
        code: 'unavailable',
        details: {
          operation: 'importIssue',
          domain: 'delivery-github-intake',
          domainCode: 'network-failure',
        },
      },
    })
  })
})
