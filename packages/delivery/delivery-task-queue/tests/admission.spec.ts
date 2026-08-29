import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  CODE_CHANGE_KIND,
  CODE_VERIFY_KIND,
  AcceptanceClauseId,
  CompletionClaimId,
  ContractRevisionId,
  DispatchBindingId,
  EvidenceId,
  ExecutorId,
  GitCommitId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RepositoryId,
  Sha256Digest,
  VerificationCheckId,
  WorkPacketId,
  canonicalDigest,
  verificationPlanDigest,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  CompletionClaim,
  DispatchBinding,
  VerificationCheck,
  WorkPacket,
} from '@deepseek-ai/dsh-delivery-protocol'
import type { VerifiedRepositoryRevision } from '@deepseek-ai/dsh-repo-workspace'
import {
  AttemptId,
  ResultId,
  WorkId,
} from '@deepseek-ai/dsh-task-queue'
import type { WorkView } from '@deepseek-ai/dsh-task-queue'
import {
  Config,
  startCodeChange,
  startVerification,
} from '../src/index.ts'
import type {
  DeliveryQueueBridgeDependencies,
  StartVerificationRequest,
} from '../src/index.ts'

const CREATED_AT = '2026-08-29T00:00:00.000Z'
const packetId = WorkPacketId('packet-1')
const contractRevisionId = ContractRevisionId('contract-1')
const repositoryId = RepositoryId('repository-1')
const executorId = ExecutorId('codex')
const otherExecutorId = ExecutorId('other')
const baseCommit = GitCommitId('1'.repeat(40))
const targetCommit = GitCommitId('a'.repeat(40))
const verificationCheck: VerificationCheck = {
  id: VerificationCheckId('check-1'),
  name: 'Typecheck the bounded change',
  argv: ['pnpm', 'exec', 'tsc', '--noEmit'],
  cwd: '.',
  timeoutMs: 60_000,
  severity: 'required',
  expectedExitCodes: [0],
}
const planProvenance = {
  kind: 'contract-field' as const,
  contractRevisionId,
  field: 'verificationSource' as const,
}
const planDigest = verificationPlanDigest({
  checks: [verificationCheck],
  provenance: planProvenance,
})
const changeBindingId = DispatchBindingId('change-binding-1')
const verificationBindingId = DispatchBindingId('verification-binding-1')
const queueWorkId = QueueWorkIdRef('work-1')
const queueAttemptId = QueueAttemptIdRef('attempt-1')
const resultId = ResultId('result-1')
type SubmittingBinding = Extract<DispatchBinding, { readonly phase: 'submitting' }>
type BoundBinding = Extract<DispatchBinding, { readonly phase: 'bound' }>

function packet(
  overrides: Partial<WorkPacket> = {},
): WorkPacket {
  return {
    schemaVersion: 1,
    id: packetId,
    contractRevisionId,
    repositoryId,
    baseCommit,
    objective: 'Implement a bounded change.',
    allowedPaths: [],
    forbiddenPaths: [],
    acceptanceClauseIds: [AcceptanceClauseId('acceptance-1')],
    verificationPlan: {
      checks: [verificationCheck],
      provenance: planProvenance,
      digest: planDigest,
    },
    stopConditions: [],
    executorPreference: { mode: 'any' },
    packetDigest: Sha256Digest('sha256:' + 'c'.repeat(64)),
    createdAt: CREATED_AT,
    ...overrides,
  }
}

function completedClaim(
  overrides: Partial<Extract<CompletionClaim, { readonly disposition: 'completed' }>> = {},
): Extract<CompletionClaim, { readonly disposition: 'completed' }> {
  return {
    schemaVersion: 1,
    id: CompletionClaimId('claim-1'),
    packetId,
    queueWorkId,
    queueAttemptId,
    summary: 'Implemented and checkpointed the bounded change.',
    completedWork: ['Implemented the change.'],
    remainingWork: [],
    disposition: 'completed',
    checkpointCommit: targetCommit,
    changedPaths: [],
    evidenceIds: [EvidenceId('evidence-1')],
    resumeCapsuleEvidenceId: null,
    createdAt: CREATED_AT,
    ...overrides,
  }
}

function submitting(
  kind: typeof CODE_CHANGE_KIND | typeof CODE_VERIFY_KIND,
  idempotencyKey: string,
  inputDigest: Sha256Digest,
): SubmittingBinding {
  const common = {
    schemaVersion: 1 as const,
    id: verificationBindingId,
    packetId,
    inputDigest,
    idempotencyKey,
    phase: 'submitting' as const,
    queueWorkId: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }
  return kind === CODE_CHANGE_KIND
    ? { ...common, kind, executorId }
    : { ...common, kind, executorId: null }
}

function bound(
  source: SubmittingBinding,
): BoundBinding {
  return {
    ...source,
    phase: 'bound',
    queueWorkId,
  }
}

function changeBinding(
  overrides: Partial<Extract<DispatchBinding, {
    readonly kind: typeof CODE_CHANGE_KIND
    readonly phase: 'bound'
  }>> = {},
): Extract<DispatchBinding, {
  readonly kind: typeof CODE_CHANGE_KIND
  readonly phase: 'bound'
}> {
  return {
    schemaVersion: 1,
    id: changeBindingId,
    packetId,
    inputDigest: canonicalDigest({ packetId }),
    idempotencyKey: 'delivery:packet-1:code.change@1',
    phase: 'bound',
    queueWorkId,
    kind: CODE_CHANGE_KIND,
    executorId,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  }
}

function successfulChangeWork(
  claim: unknown = completedClaim(),
): WorkView {
  const workId = WorkId(String(queueWorkId))
  const attemptId = AttemptId(String(queueAttemptId))
  return {
    work: {
      id: workId,
      kind: CODE_CHANGE_KIND,
      title: 'Change code for Delivery Packet packet-1',
      intent: { packetId },
      intentDigest: String(canonicalDigest({ packetId })),
      resolved: {
        packetId,
        contractRevisionId,
        repositoryId,
        baseCommit,
        executorId,
        policyDigest: Sha256Digest('sha256:' + 'd'.repeat(64)),
      },
      policy: { maxAttempts: 1 },
      resources: [],
      tags: [],
      batchId: null,
      ownerSessionId: null,
      createdAt: CREATED_AT,
    },
    state: {
      workId,
      status: 'succeeded',
      attemptCount: 1,
      activeAttemptId: null,
      resultId,
      failure: null,
      cancelRequestedAt: null,
      updatedAt: CREATED_AT,
    },
    attempts: [],
    result: {
      id: resultId,
      workId,
      attemptId,
      kind: CODE_CHANGE_KIND,
      output: { completionClaim: claim },
      createdAt: CREATED_AT,
    },
  } as WorkView
}

interface BridgeOptions {
  readonly packet?: WorkPacket | null
  readonly changeBinding?: DispatchBinding | null
  readonly changeWork?: WorkView
  readonly descendsFromBase?: boolean
  readonly beginBinding?: DispatchBinding
}

function bridge(
  options: BridgeOptions = {},
): {
  readonly dependencies: DeliveryQueueBridgeDependencies
  readonly beginDispatch: ReturnType<typeof vi.fn>
  readonly bindDispatch: ReturnType<typeof vi.fn>
  readonly enqueue: ReturnType<typeof vi.fn>
  readonly getQueueWork: ReturnType<typeof vi.fn>
  readonly inspectRevision: ReturnType<typeof vi.fn>
  readonly inspectRange: ReturnType<typeof vi.fn>
} {
  const packetValue = options.packet === null
    ? undefined
    : options.packet ?? packet()
  const changeBindingValue = options.changeBinding === null
    ? undefined
    : options.changeBinding ?? changeBinding()
  const changeWorkValue = options.changeWork ?? successfulChangeWork()
  const beginBinding = options.beginBinding ?? submitting(
    CODE_VERIFY_KIND,
    'pending-verification-key',
    canonicalDigest({ pending: true }),
  )
  const getWorkPacket = vi.fn(() => packetValue)
  const getDispatchBinding = vi.fn(() => changeBindingValue)
  const beginDispatch = vi.fn(async () => beginBinding)
  const bindDispatch = vi.fn(async () => {
    if (beginBinding.phase === 'bound') return beginBinding
    return bound(beginBinding)
  })
  const enqueue = vi.fn(async () => WorkId('work-1'))
  const getQueueWork = vi.fn(() => changeWorkValue)
  const inspectRevision = vi.fn(async (
    request: { readonly repositoryId: RepositoryId; readonly commit: GitCommitId },
  ) => ({
    repositoryId: request.repositoryId,
    commit: request.commit,
  }) as unknown as VerifiedRepositoryRevision)
  const inspectRange = vi.fn(async () => ({
    repositoryId,
    baseCommit,
    targetCommit,
    descendsFromBase: options.descendsFromBase ?? true,
    changedPaths: [],
  }))
  return {
    dependencies: {
      delivery: {
        beginDispatch,
        bindDispatch,
        getDispatchBinding,
        getWorkPacket,
      },
      queue: { enqueue, get: getQueueWork },
      repoWorkspace: { inspectRevision, inspectRange },
    },
    beginDispatch,
    bindDispatch,
    enqueue,
    getQueueWork,
    inspectRevision,
    inspectRange,
  }
}

function expectNoAdmissionWrites(
  state: ReturnType<typeof bridge>,
): void {
  expect(state.beginDispatch).not.toHaveBeenCalled()
  expect(state.enqueue).not.toHaveBeenCalled()
  expect(state.bindDispatch).not.toHaveBeenCalled()
}

describe('Delivery-to-Queue admissions', () => {
  it('freezes safe single-operator handler defaults at the composition owner', () => {
    expect(Config({})).toEqual({
      executorId: 'codex',
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
      verificationOutputBytes: 64 * 1024,
      resource: 'agent-run',
      maxAttempts: 1,
      verifierVersion: 'personal-delivery-v1',
    })
    expect(() => Config({ disposeGraceMs: 2_147_483_648 })).toThrow()
    expect(() => Config({ modelOutputBytes: 64 * 1024 * 1024 + 1 })).toThrow()
    expect(() => Config({ verificationOutputBytes: 64 * 1024 * 1024 + 1 }))
      .toThrow()
  })

  it('exposes verification selection without caller-controlled target or plan', () => {
    expectTypeOf<StartVerificationRequest>().toEqualTypeOf<{
      readonly packetId: WorkPacketId
      readonly changeBindingId: DispatchBindingId
    }>()
  })

  it('derives and binds the exact code-change identity', async () => {
    const intent = { packetId }
    const key = 'delivery:packet-1:code.change@1'
    const state = bridge({
      beginBinding: submitting(
        CODE_CHANGE_KIND,
        key,
        canonicalDigest(intent),
      ),
    })

    const result = await startCodeChange(state.dependencies, {
      packetId,
      executorId,
    })

    expect(state.beginDispatch).toHaveBeenCalledWith({
      idempotencyKey: key,
      packetId,
      inputDigest: canonicalDigest(intent),
      kind: CODE_CHANGE_KIND,
      executorId,
    })
    expect(state.enqueue).toHaveBeenCalledWith({
      kind: CODE_CHANGE_KIND,
      title: 'Change code for Delivery Packet packet-1',
      input: intent,
      idempotencyKey: key,
    })
    expect(state.bindDispatch).toHaveBeenCalledWith({
      bindingId: verificationBindingId,
      queueWorkId,
    })
    expect(result.phase).toBe('bound')
  })

  it('returns an existing bound change without another Queue admission', async () => {
    const intent = { packetId }
    const key = 'delivery:packet-1:code.change@1'
    const existing = bound(submitting(
      CODE_CHANGE_KIND,
      key,
      canonicalDigest(intent),
    ))
    const state = bridge({ beginBinding: existing })

    await expect(startCodeChange(state.dependencies, {
      packetId,
      executorId,
    })).resolves.toBe(existing)
    expect(state.enqueue).not.toHaveBeenCalled()
    expect(state.bindDispatch).not.toHaveBeenCalled()
  })

  it('rejects a missing Packet before starting either admission store', async () => {
    const state = bridge({ packet: null })

    await expect(startCodeChange(state.dependencies, {
      packetId,
      executorId,
    })).rejects.toMatchObject({
      code: 'packet-not-found',
    })
    expectNoAdmissionWrites(state)
  })

  it('rejects an executor that violates a required Packet preference before writes', async () => {
    const state = bridge({
      packet: packet({
        executorPreference: { mode: 'required', executorId: otherExecutorId },
      }),
    })

    await expect(startCodeChange(state.dependencies, {
      packetId,
      executorId,
    })).rejects.toMatchObject({
      code: 'executor-not-allowed',
    })
    expectNoAdmissionWrites(state)
  })

  it('derives verification target and plan only from successful trusted facts', async () => {
    const intent = { packetId, targetCommit, verificationPlanDigest: planDigest }
    const key = 'delivery:packet-1:code.verify@1:' + targetCommit + ':'
      + planDigest
    const state = bridge({
      beginBinding: submitting(
        CODE_VERIFY_KIND,
        key,
        canonicalDigest(intent),
      ),
    })

    const result = await startVerification(state.dependencies, {
      packetId,
      changeBindingId,
    })

    expect(state.getQueueWork).toHaveBeenCalledWith(WorkId('work-1'))
    expect(state.inspectRevision).toHaveBeenNthCalledWith(1, {
      repositoryId,
      commit: baseCommit,
    })
    expect(state.inspectRevision).toHaveBeenNthCalledWith(2, {
      repositoryId,
      commit: targetCommit,
    })
    expect(state.inspectRange).toHaveBeenCalledOnce()
    expect(state.beginDispatch).toHaveBeenCalledWith({
      idempotencyKey: key,
      packetId,
      inputDigest: canonicalDigest(intent),
      kind: CODE_VERIFY_KIND,
    })
    expect(state.enqueue).toHaveBeenCalledWith({
      kind: CODE_VERIFY_KIND,
      title: 'Verify Delivery Packet packet-1 at ' + targetCommit,
      input: intent,
      idempotencyKey: key,
    })
    expect(state.bindDispatch).toHaveBeenCalledWith({
      bindingId: verificationBindingId,
      queueWorkId,
    })
    expect(state.inspectRange.mock.invocationCallOrder[0]).toBeLessThan(
      state.beginDispatch.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    )
    expect(result.phase).toBe('bound')
  })

  it('rejects an invalid change binding without creating a verification binding', async () => {
    const state = bridge({ changeBinding: null })

    await expect(startVerification(state.dependencies, {
      packetId,
      changeBindingId,
    })).rejects.toMatchObject({
      code: 'change-binding-invalid',
    })
    expectNoAdmissionWrites(state)
  })

  it('rejects a non-successful change WorkItem without admission writes', async () => {
    const successful = successfulChangeWork()
    const state = bridge({
      changeWork: {
        ...successful,
        state: { ...successful.state, status: 'failed' },
      },
    })

    await expect(startVerification(state.dependencies, {
      packetId,
      changeBindingId,
    })).rejects.toMatchObject({
      code: 'change-work-invalid',
    })
    expectNoAdmissionWrites(state)
  })

  it('rejects a Queue WorkItem whose change intent names another Packet before writes', async () => {
    const successful = successfulChangeWork()
    const state = bridge({
      changeWork: {
        ...successful,
        work: {
          ...successful.work,
          intent: { packetId: WorkPacketId('packet-other') },
        },
      },
    })

    await expect(startVerification(state.dependencies, {
      packetId,
      changeBindingId,
    })).rejects.toMatchObject({
      code: 'change-work-invalid',
    })
    expect(state.inspectRevision).not.toHaveBeenCalled()
    expectNoAdmissionWrites(state)
  })

  it('rejects a Queue WorkItem whose stored intent digest is not canonical before writes', async () => {
    const successful = successfulChangeWork()
    const state = bridge({
      changeWork: {
        ...successful,
        work: {
          ...successful.work,
          intentDigest: String(canonicalDigest({ packetId: 'packet-other' })),
        },
      },
    })

    await expect(startVerification(state.dependencies, {
      packetId,
      changeBindingId,
    })).rejects.toMatchObject({
      code: 'change-work-invalid',
    })
    expect(state.inspectRevision).not.toHaveBeenCalled()
    expectNoAdmissionWrites(state)
  })

  it('rejects a change binding whose digest differs from its exact Queue intent before writes', async () => {
    const state = bridge({
      changeBinding: changeBinding({
        inputDigest: canonicalDigest({ packetId: 'packet-other' }),
      }),
    })

    await expect(startVerification(state.dependencies, {
      packetId,
      changeBindingId,
    })).rejects.toMatchObject({
      code: 'change-binding-invalid',
    })
    expect(state.inspectRevision).not.toHaveBeenCalled()
    expectNoAdmissionWrites(state)
  })

  it('rejects a Queue WorkItem resolved against another repository base before writes', async () => {
    const successful = successfulChangeWork()
    const state = bridge({
      changeWork: {
        ...successful,
        work: {
          ...successful.work,
          resolved: {
            ...successful.work.resolved,
            baseCommit: GitCommitId('b'.repeat(40)),
          },
        },
      },
    })

    await expect(startVerification(state.dependencies, {
      packetId,
      changeBindingId,
    })).rejects.toMatchObject({
      code: 'change-work-invalid',
    })
    expect(state.inspectRevision).not.toHaveBeenCalled()
    expectNoAdmissionWrites(state)
  })

  it('rejects malformed code-change output without admission writes', async () => {
    const state = bridge({
      changeWork: successfulChangeWork({ disposition: 'completed' }),
    })

    await expect(startVerification(state.dependencies, {
      packetId,
      changeBindingId,
    })).rejects.toMatchObject({
      code: 'change-output-invalid',
    })
    expectNoAdmissionWrites(state)
  })

  it('rejects a claim with mismatched Queue provenance without admission writes', async () => {
    const state = bridge({
      changeWork: successfulChangeWork(completedClaim({
        queueAttemptId: QueueAttemptIdRef('attempt-other'),
      })),
    })

    await expect(startVerification(state.dependencies, {
      packetId,
      changeBindingId,
    })).rejects.toMatchObject({
      code: 'change-output-invalid',
    })
    expectNoAdmissionWrites(state)
  })

  it('rejects a checkpoint outside the Packet ancestry without admission writes', async () => {
    const state = bridge({ descendsFromBase: false })

    await expect(startVerification(state.dependencies, {
      packetId,
      changeBindingId,
    })).rejects.toMatchObject({
      code: 'repository-range-invalid',
    })
    expectNoAdmissionWrites(state)
  })
})
