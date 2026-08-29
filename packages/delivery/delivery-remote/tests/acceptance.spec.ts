import {
  QueueWorkIdRef,
  canonicalDigest,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  completedClaimFixture,
  passedVerdictFixture,
  readyWorkPacketFixture,
} from '@deepseek-ai/dsh-delivery-testkit'
import {
  AttemptId,
  ResultId,
  WorkId,
  type WorkView,
} from '@deepseek-ai/dsh-task-queue'
import { describe, expect, it } from 'vitest'
import { resolveAcceptanceCandidate } from '../src/acceptance.ts'

const TIME = '2026-08-29T00:00:00.000Z'

function succeeded(idValue: string, kind: 'code.change@1' | 'code.verify@1', intent: unknown, output: unknown): WorkView {
  const id = WorkId(idValue)
  const attemptId = AttemptId(`${idValue}-attempt`)
  const resultId = ResultId(`${idValue}-result`)
  return {
    work: {
      id, kind, title: idValue, intent: intent as never, intentDigest: canonicalDigest(intent),
      resolved: {} as never, policy: { maxAttempts: 1 }, resources: [], tags: [],
      batchId: null, ownerSessionId: null, createdAt: TIME,
    },
    state: {
      workId: id, status: 'succeeded', attemptCount: 1, activeAttemptId: null,
      resultId, failure: null, cancelRequestedAt: null, updatedAt: TIME,
    },
    attempts: [{
      id: attemptId, workId: id, ordinal: 1, status: 'succeeded', startedAt: TIME,
      runningAt: TIME, finishedAt: TIME, failure: null,
    }],
    result: { id: resultId, workId: id, attemptId, kind, output: output as never, createdAt: TIME },
  } as unknown as WorkView
}

function views() {
  const packet = readyWorkPacketFixture()
  const claim = completedClaimFixture({
    queueWorkId: QueueWorkIdRef('change'),
    queueAttemptId: 'change-attempt' as never,
  })
  const intent = {
    packetId: packet.id,
    targetCommit: claim.checkpointCommit,
    verificationPlanDigest: packet.verificationPlan.digest,
  }
  return {
    change: succeeded('change', 'code.change@1', { packetId: packet.id }, { completionClaim: claim }),
    verify: succeeded('verify', 'code.verify@1', intent, {
      verificationVerdict: passedVerdictFixture({
        packetId: packet.id,
        verificationPlanDigest: packet.verificationPlan.digest,
      }),
    }),
  }
}

describe('acceptance candidate Queue resolution', () => {
  it('rejects a missing or non-successful bound Work', () => {
    expect(() => resolveAcceptanceCandidate({ get: () => { throw new Error('missing') } }, QueueWorkIdRef('change'), QueueWorkIdRef('verify')))
      .toThrow('Bound code.change@1 Work is unavailable')
    const value = views()
    const invalid: WorkView = {
      ...value.change,
      state: { ...value.change.state, status: 'failed' },
    }
    const queue = { get: (id: WorkId) => String(id) === 'change' ? invalid : value.verify }
    expect(() => resolveAcceptanceCandidate(queue, QueueWorkIdRef('change'), QueueWorkIdRef('verify')))
      .toThrow('has no exact successful result')
  })

  it('rejects each malformed typed Queue payload', () => {
    const cases = [
      { field: 'change' as const, patch: { result: { ...views().change.result!, output: {} } }, message: 'code.change@1 Work output is invalid' },
      { field: 'verify' as const, patch: { work: { ...views().verify.work, intent: {} } }, message: 'code.verify@1 Work intent is invalid' },
      { field: 'verify' as const, patch: { result: { ...views().verify.result!, output: {} } }, message: 'code.verify@1 Work output is invalid' },
    ]
    for (const scenario of cases) {
      const value = views()
      value[scenario.field] = { ...value[scenario.field], ...scenario.patch } as WorkView
      const queue = { get: (id: WorkId) => String(id) === 'change' ? value.change : value.verify }
      expect(() => resolveAcceptanceCandidate(queue, QueueWorkIdRef('change'), QueueWorkIdRef('verify')))
        .toThrow(scenario.message)
    }
  })
})
