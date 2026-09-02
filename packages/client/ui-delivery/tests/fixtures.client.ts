import {
  AcceptanceDecisionId,
  ContractRevisionId,
  DispatchBindingId,
  EvidenceId,
  ExecutorId,
  GitCommitId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  VerificationVerdictId,
  WorkPacketId,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  DeliveryAcceptanceDecisionView,
  DeliveryContractRevisionView,
  DeliveryDispatchBindingView,
  DeliveryWorkbenchCard,
  DeliveryWorkPacketView,
} from '@deepseek-ai/dsh-delivery-remote/types'

const TIME = '2026-08-29T00:00:00.000Z'
const BASE = '1111111111111111111111111111111111111111'
const TARGET = '2222222222222222222222222222222222222222'
const DIGEST = `sha256:${'1'.repeat(64)}`

/** Browser-wire Contract fixture; deliberately independent of Host testkits. */
export function contractRevisionFixture(
  overrides: Partial<DeliveryContractRevisionView> = {},
): DeliveryContractRevisionView {
  return {
    schemaVersion: 2,
    id: ContractRevisionId('contract-revision-fixture'),
    previousRevisionId: null,
    origin: { kind: 'human' },
    title: 'Deliver one bounded change',
    repositoryId: 'repository-fixture',
    outcome: 'A bounded change is implemented and independently verified.',
    context: 'The Consumer needs a deterministic Delivery contract.',
    allowedScope: ['Delivery package sources and focused tests'],
    forbiddenScope: ['Unrelated product behavior'],
    acceptanceClauses: [{
      id: 'acceptance-clause-fixture',
      text: 'Focused verification passes for the bounded change.',
    }],
    openDecisions: [],
    baseSelectionRule: { kind: 'commit', commit: BASE },
    verificationSource: { kind: 'contract-field', checks: [] },
    referenceLinks: [],
    createdAt: TIME,
    ...overrides,
  } as unknown as DeliveryContractRevisionView
}

/** Browser-wire Packet fixture with only immutable projected facts. */
export function readyWorkPacketFixture(
  overrides: Partial<DeliveryWorkPacketView> = {},
): DeliveryWorkPacketView {
  const contractRevisionId = overrides.contractRevisionId ?? ContractRevisionId('contract-revision-fixture')
  return {
    schemaVersion: 2,
    id: WorkPacketId('work-packet-fixture'),
    contractRevisionId,
    repositoryId: 'repository-fixture',
    baseCommit: BASE,
    objective: 'Implement the bounded Delivery fixture change.',
    allowedPaths: [{ kind: 'subtree', path: 'packages/delivery' }],
    forbiddenPaths: [{ kind: 'subtree', path: 'packages/unrelated' }],
    acceptanceClauseIds: ['acceptance-clause-fixture'],
    verificationPlan: {
      checks: [],
      provenance: { kind: 'contract-field', contractRevisionId, field: 'verificationSource' },
      digest: DIGEST,
    },
    stopConditions: ['Stop when repository facts do not match the Contract.'],
    executorPreference: { mode: 'preferred', executorId: ExecutorId('codex-fixture') },
    packetDigest: DIGEST,
    createdAt: TIME,
    ...overrides,
  } as unknown as DeliveryWorkPacketView
}

type BoundBinding = DeliveryDispatchBindingView & {
  readonly phase: 'bound'
  readonly queueWorkId: QueueWorkIdRef
}

/** Browser-wire bound dispatch fixture. */
export function boundBindingFixture(overrides: Partial<BoundBinding> = {}): BoundBinding {
  return {
    id: DispatchBindingId('dispatch-binding-fixture'),
    packetId: WorkPacketId('work-packet-fixture'),
    kind: 'code.change@1',
    phase: 'bound',
    queueWorkId: QueueWorkIdRef('queue-work-fixture'),
    executorId: ExecutorId('codex-fixture'),
    createdAt: TIME,
    updatedAt: TIME,
    ...overrides,
  }
}

type CompletionClaimView = NonNullable<DeliveryWorkbenchCard['completionClaim']>

/** Browser-wire completed claim fixture. */
export function completedClaimFixture(
  overrides: Partial<CompletionClaimView> = {},
): CompletionClaimView {
  return {
    schemaVersion: 2,
    id: 'completion-claim-fixture',
    packetId: WorkPacketId('work-packet-fixture'),
    queueWorkId: QueueWorkIdRef('queue-work-fixture'),
    queueAttemptId: QueueAttemptIdRef('queue-attempt-fixture'),
    summary: 'The bounded change was implemented and checkpointed.',
    completedWork: ['Implemented the requested behavior.'],
    remainingWork: [],
    disposition: 'completed',
    checkpointCommit: TARGET,
    changedPaths: ['packages/delivery/example.ts'],
    evidenceIds: [EvidenceId('evidence-fixture')],
    resumeCapsuleEvidenceId: null,
    createdAt: TIME,
    ...overrides,
  } as unknown as CompletionClaimView
}

type VerificationVerdictView = NonNullable<DeliveryWorkbenchCard['verificationVerdict']>

/** Browser-wire passed verdict fixture. */
export function passedVerdictFixture(
  overrides: Partial<VerificationVerdictView> = {},
): VerificationVerdictView {
  const evidenceIds = overrides.evidenceIds ?? [EvidenceId('evidence-fixture')]
  return {
    schemaVersion: 2,
    id: VerificationVerdictId('verification-verdict-fixture'),
    packetId: WorkPacketId('work-packet-fixture'),
    targetCommit: GitCommitId(TARGET),
    baseCommit: BASE,
    verificationPlanDigest: DIGEST,
    status: 'passed',
    ancestryResult: 'descendant',
    checkResults: [{
      checkId: 'verification-check-fixture',
      checkDigest: DIGEST,
      severity: 'required',
      durationMs: 25,
      evidenceIds,
      status: 'exited',
      exitCode: 0,
      expected: true,
    }],
    evidenceIntegrityFindings: evidenceIds.map(evidenceId => ({
      evidenceId, required: true, status: 'verified',
    })),
    changedPathFindings: [],
    evidenceIds,
    verifierVersion: 'ui-delivery-test/1',
    reviewReasons: [],
    completedAt: TIME,
    ...overrides,
  } as unknown as VerificationVerdictView
}

/** Browser-wire human decision fixture. */
export function acceptedDecisionFixture(
  overrides: Partial<DeliveryAcceptanceDecisionView> = {},
): DeliveryAcceptanceDecisionView {
  return {
    schemaVersion: 2,
    id: AcceptanceDecisionId('acceptance-decision-fixture'),
    packetId: WorkPacketId('work-packet-fixture'),
    targetCommit: GitCommitId(TARGET),
    verdictId: VerificationVerdictId('verification-verdict-fixture'),
    decision: 'accepted',
    reason: 'Independent verification passed and the outcome was reviewed.',
    decidedAt: TIME,
    ...overrides,
  }
}
