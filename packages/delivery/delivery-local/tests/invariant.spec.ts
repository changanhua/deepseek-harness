import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { describe, expect, it } from 'vitest'
import {
  DELIVERY_SCHEMA_VERSION,
  AcceptanceClauseId,
  AcceptanceDecisionId,
  ContractRevisionId,
  DeliveryCaseId,
  DispatchBindingId,
  ExecutorId,
  GitCommitId,
  IssuePublicationId,
  RepositoryId,
  RepositoryRelativePath,
  RequirementDecisionId,
  VerificationCheckId,
  VerificationVerdictId,
  WorkPacketId,
  acceptanceDecisionSchema,
  canonicalDigest,
  contractRevisionSchema,
  deliveryCaseSchema,
  dispatchBindingSchema,
  issuePublicationSchema,
  requirementDecisionSchema,
  verificationPlanDigest,
  verificationPlanSchema,
  workPacketDigest,
  workPacketSchema,
  type AcceptanceDecision,
  type ContractRevision,
  type DeliveryCase,
  type DispatchBinding,
  type IssuePublication,
  type RequirementDecision,
  type WorkPacket,
} from '@changanhua/dsh-delivery-protocol'
import * as DeliveryLocalInvariant from '../src/invariant.ts'

const FIXTURE_TIME = '2026-08-29T00:00:00.000Z'
const BASE_COMMIT = GitCommitId('1111111111111111111111111111111111111111')
const TARGET_COMMIT = GitCommitId('2222222222222222222222222222222222222222')
const CHECK_ID = VerificationCheckId('verification-check-fixture')
const CLAUSE_ID = AcceptanceClauseId('acceptance-clause-fixture')
const REVISION_ID = ContractRevisionId('contract-revision-fixture')
const PACKET_ID = WorkPacketId('work-packet-fixture')
const CASE_ID = DeliveryCaseId('delivery-case-fixture')

const check = {
  id: CHECK_ID,
  name: 'Typecheck Delivery consumer',
  argv: ['pnpm', 'exec', 'tsc', '--noEmit'],
  cwd: '.' as const,
  timeoutMs: 60_000,
  severity: 'required' as const,
  expectedExitCodes: [0],
}

const plan = verificationPlanSchema.parse({
  checks: [check],
  provenance: { kind: 'contract-field', contractRevisionId: REVISION_ID, field: 'verificationSource' },
  digest: verificationPlanDigest({
    checks: [check],
    provenance: { kind: 'contract-field', contractRevisionId: REVISION_ID, field: 'verificationSource' },
  }),
})

const revision: ContractRevision = contractRevisionSchema.parse({
  schemaVersion: DELIVERY_SCHEMA_VERSION,
  id: REVISION_ID,
  previousRevisionId: null,
  origin: { kind: 'human', actorId: 'developer-fixture' },
  title: 'Deliver one bounded change',
  repositoryId: RepositoryId('repository-fixture'),
  outcome: 'A bounded change is implemented and independently verified.',
  context: 'The Consumer needs a deterministic Delivery contract.',
  allowedScope: ['Delivery package sources and focused tests'],
  forbiddenScope: ['Unrelated product behavior'],
  acceptanceClauses: [{ id: CLAUSE_ID, text: 'Focused verification passes for the bounded change.' }],
  openDecisions: [],
  baseSelectionRule: { kind: 'commit', commit: BASE_COMMIT },
  verificationSource: { kind: 'contract-field', checks: [check] },
  referenceLinks: [],
  createdAt: FIXTURE_TIME,
})

const packet: WorkPacket = workPacketSchema.parse({
  ...{
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    contractRevisionId: REVISION_ID,
    repositoryId: RepositoryId('repository-fixture'),
    baseCommit: BASE_COMMIT,
    objective: 'Implement the bounded Delivery fixture change.',
    allowedPaths: [{ kind: 'subtree', path: RepositoryRelativePath('packages/delivery') }],
    forbiddenPaths: [{ kind: 'subtree', path: RepositoryRelativePath('packages/unrelated') }],
    acceptanceClauseIds: [CLAUSE_ID],
    verificationPlan: plan,
    stopConditions: ['Stop when repository facts do not match the Contract.'],
    executorPreference: { mode: 'preferred', executorId: ExecutorId('codex-fixture') },
  },
  id: PACKET_ID,
  packetDigest: workPacketDigest({
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    contractRevisionId: REVISION_ID,
    repositoryId: RepositoryId('repository-fixture'),
    baseCommit: BASE_COMMIT,
    objective: 'Implement the bounded Delivery fixture change.',
    allowedPaths: [{ kind: 'subtree', path: RepositoryRelativePath('packages/delivery') }],
    forbiddenPaths: [{ kind: 'subtree', path: RepositoryRelativePath('packages/unrelated') }],
    acceptanceClauseIds: [CLAUSE_ID],
    verificationPlan: plan,
    stopConditions: ['Stop when repository facts do not match the Contract.'],
    executorPreference: { mode: 'preferred', executorId: ExecutorId('codex-fixture') },
  }),
  createdAt: FIXTURE_TIME,
})

const binding: DispatchBinding = dispatchBindingSchema.parse({
  schemaVersion: DELIVERY_SCHEMA_VERSION,
  id: DispatchBindingId('dispatch-binding-fixture'),
  packetId: PACKET_ID,
  kind: 'code.change@1',
  inputDigest: canonicalDigest({ packetId: PACKET_ID }),
  idempotencyKey: 'dispatch-fixture-v2',
  phase: 'submitting',
  queueWorkId: null,
  executorId: ExecutorId('codex-fixture'),
  createdAt: FIXTURE_TIME,
  updatedAt: FIXTURE_TIME,
})

const decision: AcceptanceDecision = acceptanceDecisionSchema.parse({
  schemaVersion: DELIVERY_SCHEMA_VERSION,
  id: AcceptanceDecisionId('acceptance-decision-fixture'),
  packetId: PACKET_ID,
  targetCommit: TARGET_COMMIT,
  verdictId: VerificationVerdictId('verification-verdict-fixture'),
  decision: 'accepted',
  reason: 'Independent verification passed and the outcome was reviewed.',
  actor: { kind: 'human', actorId: 'developer-fixture' },
  decisionNonce: 'acceptance-fixture-v2',
  decidedAt: FIXTURE_TIME,
})

const kase: DeliveryCase = deliveryCaseSchema.parse({
  schemaVersion: DELIVERY_SCHEMA_VERSION,
  id: CASE_ID,
  repositoryId: RepositoryId('repository-fixture'),
  headRevisionId: REVISION_ID,
  createdAt: FIXTURE_TIME,
  updatedAt: FIXTURE_TIME,
})

const requirementDecision: RequirementDecision = requirementDecisionSchema.parse({
  schemaVersion: DELIVERY_SCHEMA_VERSION,
  id: RequirementDecisionId('requirement-decision-fixture'),
  caseId: CASE_ID,
  revisionId: REVISION_ID,
  decision: 'approved',
  reason: 'Requirement reviewed and approved.',
  actor: { kind: 'human', actorId: 'developer-fixture' },
  decisionNonce: 'requirement-decision-fixture-v2',
  decidedAt: FIXTURE_TIME,
})

const publication: IssuePublication = issuePublicationSchema.parse({
  schemaVersion: DELIVERY_SCHEMA_VERSION,
  id: IssuePublicationId('issue-publication-fixture'),
  caseId: CASE_ID,
  revisionId: REVISION_ID,
  repository: { owner: 'deepseek-ai', name: 'deepseek-harness' },
  renderedDigest: canonicalDigest({ rendered: 'fixture' }),
  marker: 'delivery-issue-publication-marker',
  phase: 'prepared',
  issue: null,
  failure: null,
  createdAt: FIXTURE_TIME,
  updatedAt: FIXTURE_TIME,
})

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  ctx.provide('delivery', {
    getCase: (id: string) => id === kase.id ? kase : undefined,
    getRequirementDecision: (id: string) => id === requirementDecision.id ? requirementDecision : undefined,
    getIssuePublication: (id: string) => id === publication.id ? publication : undefined,
    getContractRevision: (id: string) => id === revision.id ? revision : undefined,
    getWorkPacket: (id: string) => id === packet.id ? packet : undefined,
    getDispatchBinding: (id: string) => id === binding.id ? binding : undefined,
    snapshot: () => ({
      contractRevisions: [revision],
      workPackets: [packet],
      dispatchBindings: [binding],
      acceptanceDecisions: [decision],
      deliveryCases: [kase],
      requirementDecisions: [requirementDecision],
      issuePublications: [publication],
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
      ['delivery_cases', kase],
      ['requirement_decisions', requirementDecision],
      ['issue_publications', publication],
    ] as const) {
      expect(() => { ctx.emit('domain/changed', put(table, value)) }).not.toThrow()
    }
    expect(() => {
      ctx.emit('domain/changed', { ...put('contract_revisions', {}), domain: 'other' })
    }).not.toThrow()
  })

  it('rejects a durable write absent from the synchronous Delivery projection', async () => {
    const ctx = await setup()
    for (const [table, value] of [
      ['contract_revisions', { ...revision, id: 'missing-revision' }],
      ['delivery_cases', { ...kase, id: 'missing-case' }],
      ['requirement_decisions', { ...requirementDecision, id: 'missing-decision' }],
      ['issue_publications', { ...publication, id: 'missing-publication' }],
    ] as const) {
      expect(() => { ctx.emit('domain/changed', put(table, value)) }).toThrow(/projection/)
    }
  })

  it('rejects deletion from an immutable Delivery table', async () => {
    const ctx = await setup()
    for (const table of [
      'contract_revisions',
      'work_packets',
      'dispatch_bindings',
      'acceptance_decisions',
      'delivery_cases',
      'requirement_decisions',
      'issue_publications',
    ] as const) {
      expect(() => { ctx.emit('domain/changed', {
        domain: 'personal_delivery',
        table,
        key: 'storage-key',
        operation: 'deleted',
      }) }).toThrow(/immutable/)
    }
  })

  it('rejects malformed records and undeclared Delivery tables', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('domain/changed', put('contract_revisions', {})) })
      .toThrow(/without an id/)
    expect(() => { ctx.emit('domain/changed', put('unknown_table', { id: 'unknown' })) })
      .toThrow(/projection/)
    expect(() => { ctx.emit('domain/changed', put('delivery_cases', {})) })
      .toThrow(/without an id/)
  })
})
