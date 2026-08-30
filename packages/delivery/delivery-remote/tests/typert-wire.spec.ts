import {
  acceptedDecisionFixture,
  contractRevisionFixture,
  readyWorkPacketFixture,
} from '@deepseek-ai/dsh-delivery-testkit'
import { describe, expect, it, vi } from 'vitest'

vi.mock('zod', async () => import('../../delivery-protocol/node_modules/zod/index.js'))

interface ResultSchema {
  parse(value: unknown): unknown
}

interface RemoteDescriptorCandidate {
  readonly method: string
  readonly result: {
    readonly mode: string
    readonly schema?: ResultSchema
  }
}

interface GeneratedRemoteModule {
  readonly TYPERT_REMOTE: {
    readonly descriptors: readonly RemoteDescriptorCandidate[]
  }
}

async function generatedRemote(): Promise<GeneratedRemoteModule['TYPERT_REMOTE']> {
  const builtUrl = new URL('../lib/typert.remote-client.js', import.meta.url).href
  const generated = await import(builtUrl) as GeneratedRemoteModule
  return generated.TYPERT_REMOTE
}

async function resultSchema(method: string): Promise<ResultSchema> {
  const remote = await generatedRemote()
  const descriptor = remote.descriptors.find(
    (candidate: RemoteDescriptorCandidate) => candidate.method === method,
  )
  if (descriptor === undefined) throw new Error(`Missing Delivery descriptor: ${method}`)
  if (descriptor.result.mode !== 'strict') {
    throw new Error(`Delivery descriptor is not strict: ${method}`)
  }
  if (descriptor.result.schema === undefined) {
    throw new Error(`Delivery descriptor has no result schema: ${method}`)
  }
  return descriptor.result.schema
}

describe('Delivery Typert browser result schemas', () => {
  it('strip Host-only decision identity from record and snapshot results', async () => {
    const decision = acceptedDecisionFixture({
      actor: { kind: 'human', actorId: 'host-only-operator' },
      decisionNonce: 'host-only-nonce',
    })
    const contract = contractRevisionFixture()
    const packet = readyWorkPacketFixture({ contractRevisionId: contract.id })

    const record = await resultSchema('recordDecision')
    const snapshot = await resultSchema('snapshot')
    const recordWire = record.parse(decision)
    const snapshotWire = snapshot.parse({
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
