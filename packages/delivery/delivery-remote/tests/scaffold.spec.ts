import { describe, expect, it } from 'vitest'
import {
  AcceptanceClauseId,
  RepositoryRelativePath,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  Config,
  DeliveryRemoteService,
} from '../src/index.ts'

const signal = new AbortController().signal

function scaffold(): DeliveryRemoteService {
  return Object.create(DeliveryRemoteService.prototype) as DeliveryRemoteService
}

describe('Delivery Remote unavailable boundary', () => {
  it('keeps the trusted operator id host-owned and non-blank', () => {
    expect(Config({})).toEqual({ operatorId: 'local-operator' })
    expect(() => Config({ operatorId: '  ' })).toThrow()
  })

  it('returns Promise rejections for all asynchronous unavailable methods', async () => {
    const service = scaffold()
    const calls = [
      service.importIssue({
        issueUrl: 'https://github.com/deepseek-ai/deepseek-harness/issues/13',
        repositoryId: 'repository-1',
      }, signal),
      service.createPacket({
        contractRevisionId: 'contract-1',
        packet: {
          objective: 'Bounded change',
          allowedPaths: [],
          forbiddenPaths: [{
            kind: 'subtree',
            path: RepositoryRelativePath('packages/delivery'),
          }],
          acceptanceClauseIds: [AcceptanceClauseId('acceptance-1')],
          stopConditions: [],
          executorPreference: { mode: 'any' },
        },
      }, signal),
      service.startChange({ packetId: 'packet-1', executorId: 'codex' }, signal),
      service.startVerification({
        packetId: 'packet-1',
        changeBindingId: 'binding-change-1',
      }, signal),
      service.recordDecision({
        packetId: 'packet-1',
        changeBindingId: 'binding-change-1',
        verificationBindingId: 'binding-verify-1',
        decision: 'accepted',
        reason: 'Verified evidence is sufficient.',
        decisionNonce: 'decision-1',
      }, signal),
    ]

    for (const call of calls) expect(call).toBeInstanceOf(Promise)
    await Promise.all(calls.map(call =>
      expect(call).rejects.toMatchObject({ code: 'unavailable' }),
    ))
  })

  it('keeps the read-only unavailable snapshot synchronous', () => {
    expect(() => scaffold().snapshot()).toThrow(
      expect.objectContaining({ code: 'unavailable' }),
    )
  })
})
