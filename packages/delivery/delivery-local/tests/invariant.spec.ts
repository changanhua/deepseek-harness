import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it } from 'vitest'
import {
  acceptedDecisionFixture,
  boundBindingFixture,
  contractRevisionFixture,
  readyWorkPacketFixture,
} from '../../delivery-testkit/src/fixtures.ts'
import * as DeliveryLocalInvariant from '../src/invariant.ts'

const revision = contractRevisionFixture()
const packet = readyWorkPacketFixture()
const binding = boundBindingFixture()
const decision = acceptedDecisionFixture()

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  ctx.provide('delivery', {
    getContractRevision: (id: string) => id === revision.id ? revision : undefined,
    getWorkPacket: (id: string) => id === packet.id ? packet : undefined,
    getDispatchBinding: (id: string) => id === binding.id ? binding : undefined,
    snapshot: () => ({
      contractRevisions: [revision],
      workPackets: [packet],
      dispatchBindings: [binding],
      acceptanceDecisions: [decision],
    }),
  } as never)
  await ctx.plugin(DeliveryLocalInvariant)
  return ctx
}

const put = (table: string, value: unknown): DomainChanged => ({
  domain: 'personal_delivery',
  table,
  key: 'storage-key',
  operation: 'put',
  value,
})

describe('delivery-local durable projection invariant', () => {
  it('accepts matching writes for every owned table and ignores foreign domains', async () => {
    const ctx = await setup()
    for (const [table, value] of [
      ['contract_revisions', revision],
      ['work_packets', packet],
      ['dispatch_bindings', binding],
      ['acceptance_decisions', decision],
    ] as const) {
      expect(() => { ctx.emit('domain/changed', put(table, value)) }).not.toThrow()
    }
    expect(() => {
      ctx.emit('domain/changed', { ...put('contract_revisions', {}), domain: 'other' })
    }).not.toThrow()
  })

  it('rejects a durable write absent from the synchronous Delivery projection', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('domain/changed', put('contract_revisions', { ...revision, id: 'missing-revision' }))
    }).toThrow(/projection/)
  })

  it('rejects deletion from an immutable Delivery table', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('domain/changed', {
      domain: 'personal_delivery',
      table: 'work_packets',
      key: 'storage-key',
      operation: 'deleted',
    }) }).toThrow(/immutable/)
  })

  it('rejects malformed records and undeclared Delivery tables', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('domain/changed', put('contract_revisions', {})) })
      .toThrow(/without an id/)
    expect(() => { ctx.emit('domain/changed', put('unknown_table', { id: 'unknown' })) })
      .toThrow(/projection/)
  })
})
