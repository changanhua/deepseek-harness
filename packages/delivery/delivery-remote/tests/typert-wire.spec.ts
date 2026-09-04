import {
  acceptedDecisionFixture,
  contractRevisionFixture,
  issuePublicationFixture,
  readyWorkPacketFixture,
} from '@changanhua/dsh-delivery-testkit'
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
    const publish = await resultSchema('publishIssue')
    const resolvePublication = await resultSchema('resolvePublication')
    const publication = issuePublicationFixture({ phase: 'published' })
    const publicationView = {
      id: publication.id,
      caseId: publication.caseId,
      revisionId: publication.revisionId,
      phase: publication.phase,
      failureCategory: null,
      issue: publication.issue,
      updatedAt: publication.updatedAt,
      marker: publication.marker,
      renderedDigest: publication.renderedDigest,
      credential: 'host-only-token',
    }
    const recordWire = record.parse(decision)
    const publishWire = publish.parse(publicationView)
    const resolutionWire = resolvePublication.parse(publicationView)
    const snapshotWire = snapshot.parse({
      cases: [],
      contractsWithoutPacket: [],
      publications: [publicationView],
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

    // The decision projection strips the Host-only decision actor; the
    // version-2 Contract revision origin keeps its requirement-source actorId.
    const recordSerialized = JSON.stringify(recordWire)
    expect(recordSerialized).not.toContain('host-only-operator')
    expect(recordSerialized).not.toContain('host-only-nonce')
    expect(recordSerialized).not.toContain('actorId')
    expect(recordSerialized).not.toContain('decisionNonce')
    const snapshotSerialized = JSON.stringify(snapshotWire)
    expect(snapshotSerialized).not.toContain('host-only-operator')
    expect(snapshotSerialized).not.toContain('host-only-nonce')
    expect(snapshotSerialized).not.toContain('decisionNonce')
    for (const wire of [publishWire, resolutionWire, snapshotWire]) {
      const serialized = JSON.stringify(wire)
      expect(serialized).not.toContain(publication.marker)
      expect(serialized).not.toContain(publication.renderedDigest)
      expect(serialized).not.toContain('host-only-token')
      expect(serialized).not.toContain('credential')
    }
  })
})
