import { Context } from '@deepseek-ai/cordis'
import { DeliveryGitHubIntakeError } from '@deepseek-ai/dsh-delivery-github-intake'
import { startCodeChange, startVerification } from '@deepseek-ai/dsh-delivery-task-queue'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as RemoteInvariant from '../src/invariant.ts'
import {
  Config,
  DeliveryRemoteService,
  type DeliveryRemoteInternals,
} from '../src/index.ts'

function legacyUnavailableIntakeError(): DeliveryGitHubIntakeError {
  const error = new DeliveryGitHubIntakeError(
    'invalid-request',
    'The C0 intake Consumer is unavailable',
  )
  Object.defineProperty(error, 'code', { value: 'unavailable' })
  return error
}

function context(): Context {
  const ctx = new Context()
  ctx.provide('delivery', {
    snapshot: () => ({
      contractRevisions: [], workPackets: [], dispatchBindings: [], acceptanceDecisions: [],
    }),
  } as never)
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
    expect(Config({})).toEqual({ operatorId: 'local-operator' })
    expect(() => Config({ operatorId: '  ' })).toThrow()
    expect(() => new DeliveryRemoteService(context(), { operatorId: '  ' })).toThrow(
      'operatorId must be non-blank',
    )
  })

  it('constructs the delivery namespace and returns an empty browser snapshot', () => {
    const service = new DeliveryRemoteService(context())

    expect(service).toBeInstanceOf(DeliveryRemoteService)
    expect(service.snapshot(new AbortController().signal)).toEqual({
      contractsWithoutPacket: [], cards: [],
    })
  })

  it('maps the C0 unavailable intake provider to one stable browser failure', async () => {
    const internals: DeliveryRemoteInternals = {
      fetch: globalThis.fetch,
      importIssue: async () => { throw legacyUnavailableIntakeError() },
      startCodeChange,
      startVerification,
    }
    const service = new DeliveryRemoteService(context(), {}, internals)

    await expect(service.importIssue({
      issueUrl: 'https://github.com/deepseek-ai/deepseek-harness/issues/13',
      repositoryId: 'repository-1',
    }, new AbortController().signal)).rejects.toMatchObject({
      failure: {
        code: 'unavailable',
        details: {
          operation: 'importIssue',
          domain: 'delivery-github-intake',
          domainCode: 'unavailable',
        },
      },
    })
  })
})
