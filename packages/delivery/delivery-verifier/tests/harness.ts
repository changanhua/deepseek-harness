import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import type {
  BoundDeliveryEvidenceWriter,
  SaveBoundDeliveryEvidence,
  StoredDeliveryEvidence,
} from '@changanhua/dsh-delivery-evidence'
import {
  AcceptanceClauseId,
  CompletionClaimId,
  ContractRevisionId,
  DELIVERY_SCHEMA_VERSION,
  EvidenceId,
  GitCommitId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RepositoryId,
  RepositoryRelativePath,
  VerificationCheckId,
  WorkPacketId,
  completionClaimSchema,
  contractRevisionSchema,
  evidenceBytesDigest,
  evidenceRefSchema,
  githubIssueContentDigest,
  resolvedCodeVerifySchema,
  verificationPlanDigest,
  verificationPlanSchema,
  workPacketDigest,
  workPacketSchema,
  type EvidenceRef,
  type VerificationCheck,
  type WorkPacketDigestInput,
} from '@changanhua/dsh-delivery-protocol'
import type { VerificationWorkspaceLease } from '@changanhua/dsh-repo-workspace'
import type { RepositoryRangeFacts } from '@changanhua/dsh-repo-workspace'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputRead,
} from '@deepseek-ai/dsh-subprocess'
import type { DeliveryVerificationRunRequest } from '../src/index.ts'

const FIXTURE_TIME = '2026-08-29T00:00:00.000Z'
const BASE_COMMIT = GitCommitId('1111111111111111111111111111111111111111')
const TARGET_COMMIT = GitCommitId('2222222222222222222222222222222222222222')
export const PACKET_ID = WorkPacketId('delivery-verifier-packet')
const CONTRACT_ID = ContractRevisionId('delivery-verifier-contract')
const REPOSITORY_ID = RepositoryId('delivery-verifier-repository')
const CHANGE_QUEUE_WORK_ID = QueueWorkIdRef('delivery-verifier-change-work')
const CHANGE_QUEUE_ATTEMPT_ID = QueueAttemptIdRef('delivery-verifier-change-attempt')
const VERIFICATION_QUEUE_WORK_ID = QueueWorkIdRef('delivery-verifier-verification-work')
const VERIFICATION_QUEUE_ATTEMPT_ID = QueueAttemptIdRef('delivery-verifier-verification-attempt')
const CHECK_ID = VerificationCheckId('delivery-verifier-check')
export const CLAIM_EVIDENCE_ID = EvidenceId('delivery-verifier-claim-evidence')
export const CLAIM_EVIDENCE_BYTES = new TextEncoder().encode('checkpoint evidence\n')

function outputRead(text: string): SubprocessOutputRead {
  return {
    text,
    nextOffset: Buffer.byteLength(text),
    lossy: false,
  }
}

export function settledSubprocessHandle(
  outcome: SubprocessOutcome = { exitCode: 0, signal: null },
  stdout = 'verification passed\n',
  stderr = '',
): SubprocessHandle {
  return {
    pid: 123,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {
      stdout: { readFrom: () => outputRead(stdout) },
      stderr: { readFrom: () => outputRead(stderr) },
    },
    done: Promise.resolve(outcome),
    terminate: vi.fn(),
    waitForExit: vi.fn().mockResolvedValue(true),
  }
}

export interface ControlledSubprocessHandle {
  readonly handle: SubprocessHandle
  readonly terminate: ReturnType<typeof vi.fn>
  readonly waitForExit: ReturnType<typeof vi.fn>
  complete(outcome?: SubprocessOutcome): void
}

export function controlledSubprocessHandle(
  outcomeOnTerminate: SubprocessOutcome = { exitCode: 0, signal: null },
  quiescent = true,
): ControlledSubprocessHandle {
  let resolveDone: (outcome: SubprocessOutcome) => void = () => {}
  let settled = false
  const done = new Promise<SubprocessOutcome>((resolve) => {
    resolveDone = resolve
  })
  const complete = (outcome: SubprocessOutcome = outcomeOnTerminate) => {
    if (settled) return
    settled = true
    resolveDone(outcome)
  }
  const terminate = vi.fn(() => { complete() })
  const waitForExit = vi.fn(async () => {
    await done
    return quiescent
  })
  return {
    handle: {
      pid: 456,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        stdout: { readFrom: () => outputRead('controlled stdout\n') },
        stderr: { readFrom: () => outputRead('controlled stderr\n') },
      },
      done,
      terminate,
      waitForExit,
    },
    terminate,
    waitForExit,
    complete,
  }
}

export interface VerifierFixture {
  readonly request: DeliveryVerificationRunRequest
  readonly check: VerificationCheck
  readonly workspaceRoot: string
  readonly close: ReturnType<typeof vi.fn>
  readonly saves: SaveBoundDeliveryEvidence[]
  cleanup(): Promise<void>
}

export interface VerifierFixtureOptions {
  readonly check?: Partial<VerificationCheck>
  readonly range?: Partial<RepositoryRangeFacts>
  readonly missingClaimEvidence?: boolean
  readonly closeError?: Error
  readonly contractRepositoryId?: RepositoryId
  readonly claimReadData?: Uint8Array
  readonly claimReadError?: Error
  readonly claimEvidenceProvenance?: EvidenceRef['provenance']
  readonly workspace?: Partial<Pick<
    VerificationWorkspaceLease,
    'repositoryId' | 'baseCommit' | 'targetCommit'
  >>
}

export async function createVerifierFixture(
  options: VerifierFixtureOptions = {},
): Promise<VerifierFixture> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-delivery-verifier-'))
  const sourceTitle = 'Verify one immutable target'
  const sourceBody = 'Run the trusted fixed verification plan.'
  const check: VerificationCheck = {
    id: CHECK_ID,
    name: 'Focused verifier check',
    argv: ['node', '--version'],
    cwd: '.',
    timeoutMs: 1_000,
    severity: 'required',
    expectedExitCodes: [0],
    ...options.check,
  }
  const contract = contractRevisionSchema.parse({
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    id: CONTRACT_ID,
    previousRevisionId: null,
    origin: {
      kind: 'github-import',
      repository: { owner: 'deepseek-ai', name: 'deepseek-harness' },
      issueNumber: 101,
      contentDigest: githubIssueContentDigest({ title: sourceTitle, body: sourceBody }),
    },
    title: sourceTitle,
    repositoryId: options.contractRepositoryId ?? REPOSITORY_ID,
    outcome: 'The immutable target passes independent verification.',
    context: 'Delivery verifier behavior fixture.',
    allowedScope: ['Verifier package'],
    forbiddenScope: ['Unrelated packages'],
    acceptanceClauses: [{
      id: AcceptanceClauseId('delivery-verifier-acceptance'),
      text: 'The trusted check passes.',
    }],
    openDecisions: [],
    baseSelectionRule: { kind: 'commit', commit: BASE_COMMIT },
    verificationSource: { kind: 'contract-field', checks: [check] },
    referenceLinks: [],
    createdAt: FIXTURE_TIME,
  })
  const provenance = {
    kind: 'contract-field' as const,
    contractRevisionId: CONTRACT_ID,
    field: 'verificationSource' as const,
  }
  const trustedPlan = verificationPlanSchema.parse({
    checks: [check],
    provenance,
    digest: verificationPlanDigest({ checks: [check], provenance }),
  })
  const packetInput: WorkPacketDigestInput = {
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    contractRevisionId: CONTRACT_ID,
    repositoryId: REPOSITORY_ID,
    baseCommit: BASE_COMMIT,
    objective: 'Verify the bounded target.',
    allowedPaths: [{
      kind: 'subtree',
      path: RepositoryRelativePath('packages/delivery/delivery-verifier'),
    }],
    forbiddenPaths: [{
      kind: 'subtree',
      path: RepositoryRelativePath('packages/unrelated'),
    }],
    acceptanceClauseIds: [AcceptanceClauseId('delivery-verifier-acceptance')],
    verificationPlan: trustedPlan,
    stopConditions: ['Stop on infrastructure loss.'],
    executorPreference: { mode: 'any' },
  }
  const packet = workPacketSchema.parse({
    ...packetInput,
    id: PACKET_ID,
    packetDigest: workPacketDigest(packetInput),
    createdAt: FIXTURE_TIME,
  })
  const completionClaim = completionClaimSchema.parse({
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    id: CompletionClaimId('delivery-verifier-claim'),
    packetId: PACKET_ID,
    queueWorkId: CHANGE_QUEUE_WORK_ID,
    queueAttemptId: CHANGE_QUEUE_ATTEMPT_ID,
    summary: 'The target was checkpointed.',
    completedWork: ['Implemented the bounded change.'],
    remainingWork: [],
    disposition: 'completed',
    checkpointCommit: TARGET_COMMIT,
    changedPaths: [RepositoryRelativePath('packages/delivery/delivery-verifier/src/index.ts')],
    evidenceIds: [CLAIM_EVIDENCE_ID],
    resumeCapsuleEvidenceId: null,
    createdAt: FIXTURE_TIME,
  })
  if (completionClaim.disposition !== 'completed') throw new Error('fixture claim must be completed')
  const resolved = resolvedCodeVerifySchema.parse({
    packetId: PACKET_ID,
    contractRevisionId: CONTRACT_ID,
    repositoryId: REPOSITORY_ID,
    baseCommit: BASE_COMMIT,
    targetCommit: TARGET_COMMIT,
    trustedPlan,
  })
  const claimReference = evidenceRefSchema.parse({
    schemaVersion: DELIVERY_SCHEMA_VERSION,
    id: CLAIM_EVIDENCE_ID,
    kind: 'checkpoint-metadata',
    mediaType: 'text/plain',
    uri: 'memory://delivery-verifier/claim-evidence',
    byteLength: CLAIM_EVIDENCE_BYTES.byteLength,
    digest: evidenceBytesDigest(CLAIM_EVIDENCE_BYTES),
    createdAt: FIXTURE_TIME,
    provenance: options.claimEvidenceProvenance ?? {
      kind: 'change-attempt',
      packetId: PACKET_ID,
      queueWorkId: CHANGE_QUEUE_WORK_ID,
      queueAttemptId: CHANGE_QUEUE_ATTEMPT_ID,
    },
  })
  const close = options.closeError === undefined
    ? vi.fn<VerificationWorkspaceLease['close']>().mockResolvedValue(undefined)
    : vi.fn<VerificationWorkspaceLease['close']>().mockRejectedValue(options.closeError)
  const saves: SaveBoundDeliveryEvidence[] = []
  const stored = new Map<EvidenceId, StoredDeliveryEvidence>([
    [CLAIM_EVIDENCE_ID, { ref: claimReference, data: CLAIM_EVIDENCE_BYTES }],
  ])
  let outputOrdinal = 0
  const evidenceFor = (checkId: VerificationCheckId): BoundDeliveryEvidenceWriter => ({
    async save(input, signal) {
      signal?.throwIfAborted()
      saves.push({ ...input, data: input.data.slice() })
      outputOrdinal += 1
      const id = EvidenceId(`delivery-verifier-output-${String(outputOrdinal)}`)
      const ref = evidenceRefSchema.parse({
        schemaVersion: DELIVERY_SCHEMA_VERSION,
        id,
        kind: input.kind,
        mediaType: input.mediaType,
        uri: `memory://delivery-verifier/${id}`,
        byteLength: input.data.byteLength,
        digest: evidenceBytesDigest(input.data),
        createdAt: FIXTURE_TIME,
        provenance: {
          kind: 'verification-check',
          packetId: PACKET_ID,
          queueWorkId: VERIFICATION_QUEUE_WORK_ID,
          queueAttemptId: VERIFICATION_QUEUE_ATTEMPT_ID,
          checkId,
        },
      })
      stored.set(id, { ref, data: input.data.slice() })
      return ref
    },
  })
  return {
    request: {
      contract,
      packet,
      resolved,
      completionClaim,
      verificationQueueWorkId: VERIFICATION_QUEUE_WORK_ID,
      verificationQueueAttemptId: VERIFICATION_QUEUE_ATTEMPT_ID,
      inspectRange: async (signal) => {
        signal.throwIfAborted()
        return {
          repositoryId: REPOSITORY_ID,
          baseCommit: BASE_COMMIT,
          targetCommit: TARGET_COMMIT,
          descendsFromBase: true,
          changedPaths: [RepositoryRelativePath('packages/delivery/delivery-verifier/src/index.ts')],
          ...options.range,
        }
      },
      openWorkspace: async (signal) => {
        signal.throwIfAborted()
        return {
          ownerAttemptId: VERIFICATION_QUEUE_ATTEMPT_ID,
          repositoryId: REPOSITORY_ID,
          baseCommit: BASE_COMMIT,
          targetCommit: TARGET_COMMIT,
          cwd: workspaceRoot,
          close,
          ...options.workspace,
        }
      },
      evidenceFor,
      resolveEvidence: async (id, signal): Promise<EvidenceRef | undefined> => {
        signal.throwIfAborted()
        if (options.missingClaimEvidence && id === CLAIM_EVIDENCE_ID) return undefined
        return stored.get(id)?.ref
      },
      readEvidence: async (ref, signal): Promise<StoredDeliveryEvidence> => {
        signal.throwIfAborted()
        if (options.claimReadError !== undefined && ref.id === CLAIM_EVIDENCE_ID) {
          throw options.claimReadError
        }
        const value = stored.get(ref.id)
        if (value === undefined) throw new Error(`missing fixture evidence ${ref.id}`)
        return {
          ref: value.ref,
          data: ref.id === CLAIM_EVIDENCE_ID && options.claimReadData !== undefined
            ? options.claimReadData.slice()
            : value.data.slice(),
        }
      },
    },
    check,
    workspaceRoot,
    close,
    saves,
    cleanup: () => rm(workspaceRoot, { recursive: true, force: true }),
  }
}
