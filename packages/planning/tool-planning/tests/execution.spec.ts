import { describe, expect, it } from 'vitest'
import type { DeliveryCaseCard, DeliveryWorkbenchCard } from '@changanhua/dsh-delivery-remote'
import type { PlanningExecutionView } from '@changanhua/dsh-planning-remote/types'
import type { PlanningHandoff } from '@changanhua/dsh-planning'
import { parseExecution, renderExecution } from '../src/execution.ts'

const handoff = {
  itemId: 'plan', revisionId: 'revision', repositoryId: 'repo', key: 'key', mapperVersion: 1,
  operatorId: 'operator', source: { title: 'title', intent: 'intent', scope: [], acceptance: [], sources: [] },
  sourceDigest: 'digest', deliveryRequestDigest: 'digest', phase: 'linked', caseId: 'case',
  contractRevisionId: 'revision', preparedAt: '2026-01-01T00:00:00.000Z', linkedAt: '2026-01-01T00:00:00.000Z',
} as unknown as PlanningHandoff

const packet = {
  packet: { id: 'packet' }, completionClaim: null, verificationVerdict: null, acceptanceDecision: null,
} as unknown as DeliveryWorkbenchCard

const card = {
  lane: 'shaping', readiness: { ready: false, reasons: [] }, packets: [packet],
} as unknown as DeliveryCaseCard

describe('planning execution projection null facts', () => {
  it('renders an unclaimed, unverified, unaccepted Packet and an unavailable Case', () => {
    const withPacket: PlanningExecutionView = { available: true, handoffs: [{ handoff, case: card }] }
    expect(JSON.parse(renderExecution(withPacket, parseExecution({ item_id: 'plan', packet_id: 'packet' }), 4096)))
      .toMatchObject({ execution: null, verification: null, human_acceptance: null, evidence_ids: [] })

    const withoutCase: PlanningExecutionView = { available: true, handoffs: [{ handoff, case: null }] }
    expect(JSON.parse(renderExecution(withoutCase, parseExecution({ item_id: 'plan' }), 4096)))
      .toMatchObject({ rows: [{ packet_id: null, stage: 'unavailable', readiness: null }] })
  })
})
