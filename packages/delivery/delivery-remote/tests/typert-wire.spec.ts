import {
  acceptedDecisionFixture,
  contractRevisionFixture,
  readyWorkPacketFixture,
} from '@deepseek-ai/dsh-delivery-testkit'
import { describe, expect, it, vi } from 'vitest'
import { TYPERT_REMOTE } from '../lib/typert.remote-client.js'

vi.mock('zod', async () => import('../../delivery-protocol/node_modules/zod/index.js'))

interface ResultSchema {
  parse(value: unknown): unknown
}

function resultSchema(method: string): ResultSchema {
  const descriptor = TYPERT_REMOTE.descriptors.find(candidate => candidate.method === method)
  if (descriptor === undefined) throw new Error(`Missing Delivery descriptor: ${method}`)
  if (descriptor.result.mode !== 'strict') {
    throw new Error(`Delivery descriptor is not strict: ${method}`)
  }
  return descriptor.result.schema
}

describe('Delivery Typert browser result schemas', () => {
  it('strip Host-only decision identity from record and snapshot results', () => {
    const decision = acceptedDecisionFixture({
      actor: { kind: 'human', actorId: 'host-only-operator' },
      decisionNonce: 'host-only-nonce',
    })
    const contract = contractRevisionFixture()
    const packet = readyWorkPacketFixture({ contractRevisionId: contract.id })

    const recordWire = resultSchema('recordDecision').parse(decision)
    const snapshotWire = resultSchema('snapshot').parse({
      contractsWithoutPacket: [],
      cards: [{
        contractRevision: contract,
        packet,
        lane: 'accepted',
        dispatches: [],
        completionClaim: null,
        verificationVerdict: null,
        acceptanceDecision: decision,
        attentionReasons: [],
      }],
    })

    for (const wire of [recordWire, snapshotWire]) {
      const serialized = JSON.stringify(wire)
      expect(serialized).not.toContain('host-only-operator')
      expect(serialized).not.toContain('host-only-nonce')
      expect(serialized).not.toContain('actorId')
      expect(serialized).not.toContain('decisionNonce')
    }
  })
})
