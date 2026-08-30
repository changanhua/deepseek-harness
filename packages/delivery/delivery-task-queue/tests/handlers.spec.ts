import { describe, expect, it, vi } from 'vitest'
import {
  AcceptanceClauseId,
  CompletionClaimId,
  ContractRevisionId,
  EvidenceId,
  ExecutorId,
  GitCommitId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RepositoryRelativePath,
  RepositoryId,
  Sha256Digest,
  SourceRefId,
  VerificationCheckId,
  VerificationVerdictId,
  WorkPacketId,
  canonicalDigest,
  contractRevisionSchema,
  sourceRefContentDigest,
  verificationPlanDigest,
  workPacketDigest,
  workPacketSchema,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  CompletionClaim,
  ContractRevision,
  ResolvedCodeChange,
  ResolvedCodeVerify,
  VerificationVerdict,
  WorkPacket,
  WorkPacketDigestInput,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  DeliveryCodexRunnerError,
} from '@deepseek-ai/dsh-delivery-runner-codex'
import type {
  StartCodeChange,
} from '@deepseek-ai/dsh-delivery-runner-codex'
import {
  DeliveryVerifierError,
} from '@deepseek-ai/dsh-delivery-verifier'
import type {
  StartDeliveryVerification,
} from '@deepseek-ai/dsh-delivery-verifier'
import type { VerifiedRepositoryRevision } from '@deepseek-ai/dsh-repo-workspace'
import { AttemptId, ResultId, WorkId } from '@deepseek-ai/dsh-task-queue'
import type { WorkHandler, WorkView } from '@deepseek-ai/dsh-task-queue'
import * as bridgeModule from '../src/index.ts'
import { Config } from '../src/index.ts'

const CREATED_AT = '2026-08-29T00:00:00.000Z'
const packetId = WorkPacketId('packet-handler-1')
const contractRevisionId = ContractRevisionId('contract-handler-1')
const repositoryId = RepositoryId('repository-handler-1')
const executorId = ExecutorId('codex')
const baseCommit = GitCommitId('1'.repeat(40))
const targetCommit = GitCommitId('2'.repeat(40))
const changeWorkId = WorkId('change-work-1')
const changeAttemptId = AttemptId('change-attempt-1')
const verificationWorkId = WorkId('verification-work-1')
const verificationAttemptId = AttemptId('verification-attempt-1')
const checkId = VerificationCheckId('check-handler-1')

type CreateChangeHandler = (
  dependencies: Record<string, unknown>,
  config: bridgeModule.Config,
) => WorkHandler<'code.change@1'>
type CreateVerifyHandler = (
  dependencies: Record<string, unknown>,
  config: bridgeModule.Config,
) => WorkHandler<'code.verify@1'>

function factories(): {
  readonly change: CreateChangeHandler
  readonly verify: CreateVerifyHandler
} {
  const candidate = bridgeModule as unknown as Record<string, unknown>
  expect(candidate.createCodeChangeHandler).toBeTypeOf('function')
  expect(candidate.createCodeVerifyHandler).toBeTypeOf('function')
  return {
    change: candidate.createCodeChangeHandler as CreateChangeHandler,
    verify: candidate.createCodeVerifyHandler as CreateVerifyHandler,
  }
}

function records(): { readonly contract: ContractRevision; readonly packet: WorkPacket } {
  const sourceTitle = 'Implement the Queue bridge'
  const sourceBody = 'Keep the change inside the Delivery Queue package.'
  const contract = contractRevisionSchema.parse({
    schemaVersion: 1,
    id: contractRevisionId,
    previousRevisionId: null,
    sourceRef: {
      schemaVersion: 1,
      id: SourceRefId('source-handler-1'),
      provider: 'github',
      repository: { owner: 'deepseek-ai', name: 'deepseek-harness' },
      issueNumber: 101,
      canonicalUrl: 'https://github.com/deepseek-ai/deepseek-harness/issues/101',
      updatedAt: CREATED_AT,
      title: sourceTitle,
      body: sourceBody,
      contentDigest: sourceRefContentDigest({ title: sourceTitle, body: sourceBody }),
      createdAt: CREATED_AT,
    },
    repositoryId,
    outcome: 'Register both governed Delivery handlers.',
    context: 'Queue owns Attempts while Delivery owns Packet identity.',
    allowedScope: ['delivery-task-queue'],
    forbiddenScope: ['task-queue core'],
    acceptanceClauses: [{
      id: AcceptanceClauseId('acceptance-handler-1'),
      text: 'The focused handler tests pass.',
    }],
    openDecisions: [],
    baseSelectionRule: { kind: 'commit', commit: baseCommit },
    verificationSource: {
      kind: 'contract-field',
      checks: [{
        id: checkId,
        name: 'Run the focused handler tests',
        argv: ['pnpm', 'exec', 'vitest', 'run'],
        cwd: '.',
        timeoutMs: 60_000,
        severity: 'required',
        expectedExitCodes: [0],
      }],
    },
    referenceLinks: [],
    createdAt: CREATED_AT,
  })
  const provenance = {
    kind: 'contract-field' as const,
    contractRevisionId,
    field: 'verificationSource' as const,
  }
  const checks = contract.verificationSource?.kind === 'contract-field'
    ? contract.verificationSource.checks
    : []
  const input: WorkPacketDigestInput = {
    schemaVersion: 1,
    contractRevisionId,
    repositoryId,
    baseCommit,
    objective: 'Implement the bounded Queue bridge.',
    allowedPaths: [{
      kind: 'subtree',
      path: RepositoryRelativePath('packages/delivery/delivery-task-queue'),
    }],
    forbiddenPaths: [],
    acceptanceClauseIds: [AcceptanceClauseId('acceptance-handler-1')],
    verificationPlan: {
      checks,
      provenance,
      digest: verificationPlanDigest({ checks, provenance }),
    },
    stopConditions: [],
    executorPreference: { mode: 'required', executorId },
  }
  return {
    contract,
    packet: workPacketSchema.parse({
      ...input,
      id: packetId,
      packetDigest: workPacketDigest(input),
      createdAt: CREATED_AT,
    }),
  }
}

function completedClaim(
  overrides: Partial<Extract<CompletionClaim, { readonly disposition: 'completed' }>> = {},
): Extract<CompletionClaim, { readonly disposition: 'completed' }> {
  return {
    schemaVersion: 1,
    id: CompletionClaimId('claim-handler-1'),
    packetId,
    queueWorkId: QueueWorkIdRef(String(changeWorkId)),
    queueAttemptId: QueueAttemptIdRef(String(changeAttemptId)),
    summary: 'The bounded change was checkpointed.',
    completedWork: ['Implemented the bridge.'],
    remainingWork: [],
    disposition: 'completed',
    checkpointCommit: targetCommit,
    changedPaths: [],
    evidenceIds: [EvidenceId('change-evidence-1')],
    resumeCapsuleEvidenceId: null,
    createdAt: CREATED_AT,
    ...overrides,
  }
}

function verdict(planDigest: Sha256Digest): VerificationVerdict {
  return {
    schemaVersion: 1,
    id: VerificationVerdictId('verdict-handler-1'),
    packetId,
    targetCommit,
    baseCommit,
    verificationPlanDigest: planDigest,
    status: 'passed',
    ancestryResult: 'descendant',
    checkResults: [],
    evidenceIntegrityFindings: [{
      evidenceId: EvidenceId('verification-evidence-1'),
      required: false,
      status: 'verified',
    }],
    changedPathFindings: [],
    evidenceIds: [EvidenceId('verification-evidence-1')],
    verifierVersion: 'personal-delivery-v1',
    reviewReasons: [],
    completedAt: CREATED_AT,
  }
}

function view(
  kind: 'code.change@1' | 'code.verify@1',
  resolved: ResolvedCodeChange | ResolvedCodeVerify,
  workId: WorkId,
  attemptId: AttemptId,
): WorkView {
  const packet = records().packet
  const intent = kind === 'code.change@1'
    ? { packetId }
    : {
      packetId,
      targetCommit,
      verificationPlanDigest: packet.verificationPlan.digest,
    }
  return {
    work: {
      id: workId,
      kind,
      title: kind,
      intent,
      intentDigest: String(canonicalDigest(intent)),
      resolved,
      policy: { maxAttempts: 1 },
      resources: [{ resource: 'agent-run', units: 1 }],
      tags: [],
      batchId: null,
      ownerSessionId: null,
      createdAt: CREATED_AT,
    },
    state: {
      workId,
      status: 'starting',
      attemptCount: 1,
      activeAttemptId: attemptId,
      resultId: null,
      failure: null,
      cancelRequestedAt: null,
      updatedAt: CREATED_AT,
    },
    attempts: [{
      id: attemptId,
      workId,
      ordinal: 1,
      status: 'starting',
      startedAt: CREATED_AT,
      runningAt: null,
      finishedAt: null,
      failure: null,
    }],
    result: null,
  }
}

function successfulChangeView(resolved: ResolvedCodeChange): WorkView {
  const base = view('code.change@1', resolved, changeWorkId, changeAttemptId)
  const resultId = ResultId('change-result-1')
  return {
    ...base,
    state: {
      ...base.state,
      status: 'succeeded',
      activeAttemptId: null,
      resultId,
    },
    attempts: [{ ...base.attempts[0]!, status: 'succeeded', finishedAt: CREATED_AT }],
    result: {
      id: resultId,
      workId: changeWorkId,
      attemptId: changeAttemptId,
      kind: 'code.change@1',
      output: { completionClaim: completedClaim() },
      createdAt: CREATED_AT,
    },
  }
}

function handlerHarness(
  changeState: 'active' | 'successful' = 'active',
) {
  const { contract, packet } = records()
  const changeResolved: ResolvedCodeChange = {
    packetId,
    contractRevisionId,
    repositoryId,
    baseCommit,
    executorId,
    policyDigest: canonicalDigest({
      executorId: 'codex',
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 65_536,
    }),
  }
  const verifyResolved: ResolvedCodeVerify = {
    packetId,
    contractRevisionId,
    repositoryId,
    baseCommit,
    targetCommit,
    trustedPlan: packet.verificationPlan,
  }
  const changeView = view(
    'code.change@1', changeResolved, changeWorkId, changeAttemptId,
  )
  const verifyView = view(
    'code.verify@1', verifyResolved, verificationWorkId, verificationAttemptId,
  )
  const successfulChange = successfulChangeView(changeResolved)
  const queueViews = [
    changeState === 'successful' ? successfulChange : changeView,
    verifyView,
  ]
  const list = vi.fn(() => queueViews)
  const get = vi.fn((id: WorkId) => {
    const found = queueViews.find(candidate => candidate.work.id === id)
    if (found === undefined) throw new Error('missing Queue Work')
    return found
  })
  const inspectRevision = vi.fn(async (
    request: { readonly repositoryId: RepositoryId; readonly commit: GitCommitId },
  ) => ({ ...request }) as unknown as VerifiedRepositoryRevision)
  const inspectRange = vi.fn(async () => ({
    repositoryId,
    baseCommit,
    targetCommit,
    descendsFromBase: true,
    changedPaths: [],
  }))
  const openChange = vi.fn(async () => ({ close: vi.fn(), checkpoint: vi.fn() }))
  const openVerification = vi.fn(async () => ({ close: vi.fn() }))
  const bind = vi.fn(() => ({ save: vi.fn() }))
  const resolve = vi.fn()
  const read = vi.fn()
  const startChange = vi.fn<StartCodeChange>()
  const startVerification = vi.fn<StartDeliveryVerification>()
  const changeBinding = {
    schemaVersion: 1 as const,
    id: 'change-binding-1',
    packetId,
    kind: 'code.change@1' as const,
    inputDigest: canonicalDigest({ packetId }),
    idempotencyKey: `delivery:${packetId}:code.change@1`,
    phase: 'bound' as const,
    queueWorkId: QueueWorkIdRef(String(changeWorkId)),
    executorId,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  }
  const snapshot = vi.fn(() => ({
    contractRevisions: [contract],
    workPackets: [packet],
    dispatchBindings: [changeBinding],
    acceptanceDecisions: [],
  }))
  const getContractRevision = vi.fn(() => contract)
  const getWorkPacket = vi.fn(() => packet)
  const dependencies = {
    delivery: {
      getContractRevision,
      getWorkPacket,
      snapshot,
    },
    operator: { list, get },
    repoWorkspace: {
      inspectRevision,
      inspectRange,
      openChange,
      openVerification,
    },
    evidence: { bind, resolve, read },
    startChange,
    startVerification,
  }
  return {
    contract,
    packet,
    changeResolved,
    verifyResolved,
    changeBinding,
    successfulChange,
    dependencies,
    getContractRevision,
    getWorkPacket,
    snapshot,
    list,
    get,
    inspectRevision,
    inspectRange,
    openChange,
    openVerification,
    bind,
    resolve,
    read,
    startChange,
    startVerification,
  }
}

describe('Delivery Queue WorkHandlers', () => {
  it('resolves exact immutable change facts and configured scheduling policy', async () => {
    const state = handlerHarness()
    const handler = factories().change(state.dependencies, Config({}))

    const resolved = await handler.resolveAdmission(
      { packetId },
      { signal: new AbortController().signal },
    )

    expect(resolved).toEqual(state.changeResolved)
    expect(handler.resources(resolved)).toEqual([
      { resource: 'agent-run', units: 1 },
    ])
    expect(handler.policy(resolved)).toEqual({ maxAttempts: 1 })
  })

  it('digests every configured change policy fact and exposes configured scheduling', async () => {
    const state = handlerHarness()
    const config = Config({
      model: 'codex-model',
      permissionMode: 'approve-for-me',
      env: { CODEX_HOME: 'isolated' },
      disposeGraceMs: 7_000,
      modelOutputBytes: 1_024,
      resource: 'delivery-agent',
      maxAttempts: 2,
    })
    const handler = factories().change(state.dependencies, config)

    const resolved = await handler.resolveAdmission(
      { packetId },
      { signal: new AbortController().signal },
    )

    expect(resolved.policyDigest).toBe(canonicalDigest({
      executorId: 'codex',
      model: 'codex-model',
      permissionMode: 'approve-for-me',
      env: { CODEX_HOME: 'isolated' },
      disposeGraceMs: 7_000,
      modelOutputBytes: 1_024,
    }))
    expect(handler.resources(resolved)).toEqual([
      { resource: 'delivery-agent', units: 1 },
    ])
    expect(handler.policy(resolved)).toEqual({ maxAttempts: 2 })
  })

  it('rejects mismatched Packet identity at admission', async () => {
    const state = handlerHarness()
    const handler = factories().change(state.dependencies, Config({}))
    await expect(handler.resolveAdmission(
      { packetId: WorkPacketId('another-packet') },
      { signal: new AbortController().signal },
    )).rejects.toMatchObject({ code: 'handler-input-invalid' })

  })

  it('rejects a persisted change binding whose executor drifts from the Codex runner', async () => {
    const state = handlerHarness()
    state.snapshot.mockReturnValueOnce({
      contractRevisions: [state.contract],
      workPackets: [state.packet],
      dispatchBindings: [{
        ...state.changeBinding,
        executorId: ExecutorId('other-executor'),
      }],
      acceptanceDecisions: [],
    })
    const handler = factories().change(state.dependencies, Config({}))

    await expect(handler.resolveAdmission(
      { packetId },
      { signal: new AbortController().signal },
    )).rejects.toMatchObject({ code: 'handler-input-invalid' })
  })

  it('rejects a Packet that requires a provider other than Codex', async () => {
    const state = handlerHarness()
    const { id, createdAt, packetDigest: _, ...priorInput } = state.packet
    const input = {
      ...priorInput,
      executorPreference: {
        mode: 'required' as const,
        executorId: ExecutorId('other-executor'),
      },
    }
    state.getWorkPacket.mockReturnValueOnce(workPacketSchema.parse({
      ...input,
      id,
      packetDigest: workPacketDigest(input),
      createdAt,
    }))
    const handler = factories().change(state.dependencies, Config({}))

    await expect(handler.resolveAdmission(
      { packetId },
      { signal: new AbortController().signal },
    )).rejects.toMatchObject({ code: 'handler-input-invalid' })
  })

  it('prepares one change request without opening a checkout or spawning work', async () => {
    const state = handlerHarness()
    const handler = factories().change(state.dependencies, Config({}))

    const prepared = await handler.prepare(state.changeResolved, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    })

    expect(prepared).toMatchObject({
      contract: state.contract,
      packet: state.packet,
      resolved: state.changeResolved,
      queueWorkId: QueueWorkIdRef(String(changeWorkId)),
      queueAttemptId: QueueAttemptIdRef(String(changeAttemptId)),
    })
    expect(state.bind).toHaveBeenCalledWith({
      kind: 'change-attempt',
      packetId,
      queueWorkId: QueueWorkIdRef(String(changeWorkId)),
      queueAttemptId: QueueAttemptIdRef(String(changeAttemptId)),
    })
    expect(state.openChange).not.toHaveBeenCalled()
    expect(state.startChange).not.toHaveBeenCalled()
    await prepared.openWorkspace(new AbortController().signal)
    expect(state.openChange).toHaveBeenCalledWith(expect.objectContaining({
      ownerAttemptId: QueueAttemptIdRef(String(changeAttemptId)),
    }))
  })

  it('rejects a changed policy or missing Attempt before a runner side effect', async () => {
    const state = handlerHarness()
    const handler = factories().change(state.dependencies, Config({}))

    await expect(handler.prepare({
      ...state.changeResolved,
      policyDigest: Sha256Digest(`sha256:${'f'.repeat(64)}`),
    }, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'handler-input-invalid' })

    state.list.mockReturnValueOnce([])
    await expect(handler.prepare(state.changeResolved, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'handler-attempt-invalid' })
    expect(state.openChange).not.toHaveBeenCalled()
  })

  it('rejects a Queue lookup that changes the Attempt or resolved change facts', async () => {
    const state = handlerHarness()
    const handler = factories().change(state.dependencies, Config({}))
    state.get.mockReturnValueOnce({
      ...view('code.change@1', state.changeResolved, changeWorkId, changeAttemptId),
      attempts: [],
    })
    await expect(handler.prepare(state.changeResolved, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'handler-attempt-invalid' })

    state.get.mockReturnValueOnce(view('code.change@1', {
      ...state.changeResolved,
      packetId: WorkPacketId('another-packet'),
    }, changeWorkId, changeAttemptId))
    await expect(handler.prepare(state.changeResolved, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'handler-attempt-invalid' })
  })

  it('rejects a stale change Attempt that is not the Work active Attempt', async () => {
    const state = handlerHarness()
    const handler = factories().change(state.dependencies, Config({}))
    const stale = view(
      'code.change@1', state.changeResolved, changeWorkId, changeAttemptId,
    )
    const corrupted = {
      ...stale,
      state: { ...stale.state, activeAttemptId: AttemptId('newer-attempt') },
    }
    state.list.mockReturnValueOnce([corrupted])
    state.get.mockReturnValueOnce(corrupted)

    await expect(handler.prepare(state.changeResolved, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'handler-attempt-invalid' })
  })

  it.each([
    ['contractRevisionId', ContractRevisionId('other-contract')],
    ['repositoryId', RepositoryId('other-repository')],
    ['baseCommit', GitCommitId('4'.repeat(40))],
    ['executorId', ExecutorId('other-executor')],
  ] as const)('rejects a change Work whose resolved %s changed', async (
    field,
    value,
  ) => {
    const state = handlerHarness()
    const handler = factories().change(state.dependencies, Config({}))
    const corrupted = view('code.change@1', {
      ...state.changeResolved,
      [field]: value,
    }, changeWorkId, changeAttemptId)
    state.list.mockReturnValueOnce([corrupted])
    state.get.mockReturnValueOnce(corrupted)

    await expect(handler.prepare(state.changeResolved, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'handler-attempt-invalid' })
  })

  it('rejects a non-starting or internally inconsistent active Attempt', async () => {
    const queuedState = handlerHarness()
    const queuedHandler = factories().change(queuedState.dependencies, Config({}))
    const queued = view(
      'code.change@1', queuedState.changeResolved, changeWorkId, changeAttemptId,
    )
    const notStarting = {
      ...queued,
      state: { ...queued.state, status: 'queued' as const },
    }
    queuedState.list.mockReturnValueOnce([notStarting])
    queuedState.get.mockReturnValueOnce(notStarting)
    await expect(queuedHandler.prepare(queuedState.changeResolved, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'handler-attempt-invalid' })

    const runningState = handlerHarness()
    const runningHandler = factories().change(runningState.dependencies, Config({}))
    const running = view(
      'code.change@1', runningState.changeResolved, changeWorkId, changeAttemptId,
    )
    const inconsistent = {
      ...running,
      attempts: running.attempts.map(attempt => ({
        ...attempt,
        status: 'running' as const,
      })),
    }
    runningState.list.mockReturnValueOnce([inconsistent])
    runningState.get.mockReturnValueOnce(inconsistent)
    await expect(runningHandler.prepare(runningState.changeResolved, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'handler-attempt-invalid' })
  })

  it('rejects canonical intent facts that disagree with resolved admission', async () => {
    const state = handlerHarness()
    const handler = factories().change(state.dependencies, Config({}))
    const intent = { packetId: WorkPacketId('other-packet') }
    const exact = view(
      'code.change@1', state.changeResolved, changeWorkId, changeAttemptId,
    )
    const corrupted = {
      ...exact,
      work: {
        ...exact.work,
        intent,
        intentDigest: canonicalDigest(intent),
      },
    }
    state.list.mockReturnValueOnce([corrupted])
    state.get.mockReturnValueOnce(corrupted)

    await expect(handler.prepare(state.changeResolved, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'handler-attempt-invalid' })
  })

  it('publishes live change ownership synchronously and forwards success and cancellation', async () => {
    const state = handlerHarness()
    const claim = completedClaim()
    const cancel = vi.fn(async () => undefined)
    state.startChange.mockImplementation(() => ({
      done: Promise.resolve(claim),
      cancel,
    }))
    const handler = factories().change(state.dependencies, Config({}))
    const prepared = await handler.prepare(state.changeResolved, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    })

    const live = handler.start(prepared, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    })

    expect(state.startChange).toHaveBeenCalledOnce()
    await expect(live.done).resolves.toEqual({
      status: 'succeeded',
      output: { completionClaim: claim },
    })
    await live.cancel('operator canceled')
    expect(cancel).toHaveBeenCalledWith('operator canceled')
  })

  it.each([
    ['configuration', 'failed', 'not-started'],
    ['invalid-request', 'failed', 'not-started'],
    ['startup', 'failed', 'not-started'],
    ['product', 'failed', 'started'],
    ['completion', 'failed', 'started'],
    ['ownership-lost', 'unknown', 'unknown'],
    ['cleanup', 'unknown', 'unknown'],
  ] as const)('maps change %s failures truthfully', async (code, status, sideEffect) => {
    const state = handlerHarness()
    state.startChange.mockImplementation(() => ({
      done: Promise.reject(new DeliveryCodexRunnerError(code, `runner ${code}`)),
      cancel: vi.fn(async () => undefined),
    }))
    const handler = factories().change(state.dependencies, Config({}))
    const prepared = await handler.prepare(state.changeResolved, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    })

    await expect(handler.start(prepared, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    }).done).resolves.toMatchObject({
      status,
      failure: { sideEffect, retriable: false },
    })
  })

  it('maps runner cancellation to Queue cancellation', async () => {
    const state = handlerHarness()
    state.startChange.mockImplementation(() => ({
      done: Promise.reject(new DeliveryCodexRunnerError('canceled', 'canceled')),
      cancel: vi.fn(async () => undefined),
    }))
    const handler = factories().change(state.dependencies, Config({}))
    const prepared = await handler.prepare(state.changeResolved, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    })

    await expect(handler.start(prepared, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    }).done).resolves.toEqual({ status: 'canceled' })
  })

  it.each([
    [new Error('unexpected change failure'), 'unexpected change failure'],
  ] as const)('keeps unclassified change failure uncertain', async (
    cause: Error,
    message: string,
  ) => {
    const state = handlerHarness()
    state.startChange.mockImplementation(() => ({
      done: Promise.reject(cause),
      cancel: vi.fn(async () => undefined),
    }))
    const handler = factories().change(state.dependencies, Config({}))
    const prepared = await handler.prepare(state.changeResolved, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    })

    const outcome = await handler.start(prepared, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    }).done
    expect(outcome.status).toBe('unknown')
    if (outcome.status === 'unknown') {
      expect(outcome.failure.message).toContain(message)
    }
  })

  it('keeps a change claim with mismatched provenance uncertain', async () => {
    const state = handlerHarness()
    state.startChange.mockImplementation(() => ({
      done: Promise.resolve(completedClaim({
        queueAttemptId: QueueAttemptIdRef('another-attempt'),
      })),
      cancel: vi.fn(async () => undefined),
    }))
    const handler = factories().change(state.dependencies, Config({}))
    const prepared = await handler.prepare(state.changeResolved, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    })

    await expect(handler.start(prepared, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    }).done).resolves.toMatchObject({
      status: 'unknown',
      failure: { category: 'delivery-change-output' },
    })
  })

  it('resolves exact verification facts and prepares attempt-bound verifier capabilities', async () => {
    const state = handlerHarness('successful')
    const handler = factories().verify(state.dependencies, Config({}))
    const intent = {
      packetId,
      targetCommit,
      verificationPlanDigest: state.packet.verificationPlan.digest,
    }

    const resolved = await handler.resolveAdmission(
      intent,
      { signal: new AbortController().signal },
    )
    expect(resolved).toEqual(state.verifyResolved)
    expect(handler.resources(resolved)).toEqual([
      { resource: 'agent-run', units: 1 },
    ])
    expect(handler.policy(resolved)).toEqual({ maxAttempts: 1 })

    const prepared = await handler.prepare(resolved, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    })
    expect(prepared).toMatchObject({
      contract: state.contract,
      packet: state.packet,
      resolved,
      completionClaim: completedClaim(),
      verificationQueueWorkId: QueueWorkIdRef(String(verificationWorkId)),
      verificationQueueAttemptId: QueueAttemptIdRef(String(verificationAttemptId)),
    })
    expect(state.bind).not.toHaveBeenCalled()
    prepared.evidenceFor(checkId)
    expect(state.bind).toHaveBeenCalledWith({
      kind: 'verification-check',
      packetId,
      queueWorkId: QueueWorkIdRef(String(verificationWorkId)),
      queueAttemptId: QueueAttemptIdRef(String(verificationAttemptId)),
      checkId,
    })
    expect(state.openVerification).not.toHaveBeenCalled()
    await prepared.inspectRange(new AbortController().signal)
    await prepared.openWorkspace(new AbortController().signal)
    await prepared.resolveEvidence(EvidenceId('change-evidence-1'), new AbortController().signal)
    await prepared.readEvidence({} as never, new AbortController().signal)
    expect(state.inspectRange).toHaveBeenCalled()
    expect(state.openVerification).toHaveBeenCalled()
    expect(state.resolve).toHaveBeenCalled()
    expect(state.read).toHaveBeenCalled()
  })

  it('rejects verification admission before persistence without an exact bound change', async () => {
    const state = handlerHarness('successful')
    state.snapshot.mockReturnValueOnce({
      contractRevisions: [state.contract],
      workPackets: [state.packet],
      dispatchBindings: [],
      acceptanceDecisions: [],
    })
    const handler = factories().verify(state.dependencies, Config({}))

    await expect(handler.resolveAdmission({
      packetId,
      targetCommit,
      verificationPlanDigest: state.packet.verificationPlan.digest,
    }, { signal: new AbortController().signal })).rejects.toMatchObject({
      code: 'handler-input-invalid',
    })
  })

  it('rejects verification admission when the bound completion claim names another target', async () => {
    const state = handlerHarness('successful')
    const corrupted = successfulChangeView(state.changeResolved)
    const exact = {
      ...corrupted,
      result: corrupted.result === null ? null : {
        ...corrupted.result,
        output: {
          completionClaim: completedClaim({
            checkpointCommit: GitCommitId('7'.repeat(40)),
          }),
        },
      },
    }
    state.list.mockReturnValueOnce([exact])
    state.get.mockReturnValueOnce(exact)
    const handler = factories().verify(state.dependencies, Config({}))

    await expect(handler.resolveAdmission({
      packetId,
      targetCommit,
      verificationPlanDigest: state.packet.verificationPlan.digest,
    }, { signal: new AbortController().signal })).rejects.toMatchObject({
      code: 'handler-input-invalid',
    })
  })

  it('keeps an explicit environment sentinel out of durable and diagnostic surfaces', async () => {
    const sentinel = 'delivery-secret-sentinel-value'
    const state = handlerHarness()
    const handler = factories().change(state.dependencies, Config({
      env: { DELIVERY_NON_SECRET_OVERRIDE: sentinel },
    }))
    const resolved = await handler.resolveAdmission(
      { packetId },
      { signal: new AbortController().signal },
    )
    const exact = view(
      'code.change@1', resolved, changeWorkId, changeAttemptId,
    )
    state.list.mockReturnValueOnce([exact])
    state.get.mockReturnValueOnce(exact)
    await handler.prepare(resolved, {
      attemptId: changeAttemptId,
      signal: new AbortController().signal,
    })

    let diagnostic: unknown
    try {
      await handler.prepare(state.changeResolved, {
        attemptId: changeAttemptId,
        signal: new AbortController().signal,
      })
    } catch (cause) {
      diagnostic = cause
    }
    const serialized = JSON.stringify({
      work: {
        resolved,
        policy: handler.policy(resolved),
        resources: handler.resources(resolved),
      },
      evidence: state.bind.mock.calls,
      diagnostic: diagnostic instanceof Error ? diagnostic.message : diagnostic,
    })
    expect(serialized).not.toContain(sentinel)
  })

  it('rejects a verification intent with Packet or ancestry mismatch', async () => {
    const state = handlerHarness('successful')
    const handler = factories().verify(state.dependencies, Config({}))
    await expect(handler.resolveAdmission({
      packetId,
      targetCommit: baseCommit,
      verificationPlanDigest: state.packet.verificationPlan.digest,
    }, { signal: new AbortController().signal })).rejects.toMatchObject({
      code: 'handler-input-invalid',
    })

    state.inspectRange.mockResolvedValueOnce({
      repositoryId,
      baseCommit,
      targetCommit,
      descendsFromBase: false,
      changedPaths: [],
    })
    await expect(handler.resolveAdmission({
      packetId,
      targetCommit,
      verificationPlanDigest: state.packet.verificationPlan.digest,
    }, { signal: new AbortController().signal })).rejects.toMatchObject({
      code: 'handler-input-invalid',
    })
  })

  it('rejects a verification Attempt whose resolved target changes', async () => {
    const state = handlerHarness('successful')
    const handler = factories().verify(state.dependencies, Config({}))
    const corrupted = view('code.verify@1', {
      ...state.verifyResolved,
      targetCommit: GitCommitId('3'.repeat(40)),
    }, verificationWorkId, verificationAttemptId)
    state.list.mockReturnValueOnce([corrupted])
    state.get.mockReturnValueOnce(corrupted)

    await expect(handler.prepare(state.verifyResolved, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'handler-attempt-invalid' })
  })

  it('rejects a stale verification Attempt that is not the Work active Attempt', async () => {
    const state = handlerHarness('successful')
    const handler = factories().verify(state.dependencies, Config({}))
    const stale = view(
      'code.verify@1', state.verifyResolved,
      verificationWorkId, verificationAttemptId,
    )
    const corrupted = {
      ...stale,
      state: { ...stale.state, activeAttemptId: AttemptId('newer-attempt') },
    }
    state.list.mockReturnValueOnce([corrupted])
    state.get.mockReturnValueOnce(corrupted)

    await expect(handler.prepare(state.verifyResolved, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'handler-attempt-invalid' })
  })

  it.each([
    ['contractRevisionId', ContractRevisionId('other-contract')],
    ['repositoryId', RepositoryId('other-repository')],
    ['baseCommit', GitCommitId('5'.repeat(40))],
  ] as const)('rejects a verification Work whose resolved %s changed', async (
    field,
    value,
  ) => {
    const state = handlerHarness('successful')
    const handler = factories().verify(state.dependencies, Config({}))
    const corrupted = view('code.verify@1', {
      ...state.verifyResolved,
      [field]: value,
    }, verificationWorkId, verificationAttemptId)
    state.list.mockReturnValueOnce([corrupted])
    state.get.mockReturnValueOnce(corrupted)

    await expect(handler.prepare(state.verifyResolved, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'handler-attempt-invalid' })
  })

  it('rejects a verification Work whose complete trusted plan changed', async () => {
    const state = handlerHarness('successful')
    const handler = factories().verify(state.dependencies, Config({}))
    const checks = [{
      ...state.packet.verificationPlan.checks[0]!,
      id: VerificationCheckId('other-check'),
    }]
    const provenance = state.packet.verificationPlan.provenance
    const corrupted = view('code.verify@1', {
      ...state.verifyResolved,
      trustedPlan: {
        checks,
        provenance,
        digest: verificationPlanDigest({ checks, provenance }),
      },
    }, verificationWorkId, verificationAttemptId)
    state.list.mockReturnValueOnce([corrupted])
    state.get.mockReturnValueOnce(corrupted)

    await expect(handler.prepare(state.verifyResolved, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'handler-attempt-invalid' })
  })

  it('rejects verification preparation without one bound successful change', async () => {
    const state = handlerHarness('successful')
    ;(state.dependencies.delivery as {
      snapshot: () => unknown
    }).snapshot = vi.fn(() => ({
      contractRevisions: [],
      workPackets: [],
      dispatchBindings: [],
      acceptanceDecisions: [],
    }))
    const handler = factories().verify(state.dependencies, Config({}))

    await expect(handler.prepare(state.verifyResolved, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'handler-attempt-invalid' })
  })

  it('rejects missing and malformed bound change results during verification preparation', async () => {
    const missing = handlerHarness('successful')
    missing.get
      .mockReturnValueOnce(view(
        'code.verify@1', missing.verifyResolved,
        verificationWorkId, verificationAttemptId,
      ))
      .mockImplementationOnce(() => {
        throw new Error('missing change')
      })
    const missingHandler = factories().verify(missing.dependencies, Config({}))
    await expect(missingHandler.prepare(missing.verifyResolved, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'handler-attempt-invalid' })

    const malformed = handlerHarness('successful')
    malformed.get
      .mockReturnValueOnce(view(
        'code.verify@1', malformed.verifyResolved,
        verificationWorkId, verificationAttemptId,
      ))
      .mockReturnValueOnce({
        ...successfulChangeView(malformed.changeResolved),
        state: {
          ...successfulChangeView(malformed.changeResolved).state,
          status: 'failed',
        },
      })
    const malformedHandler = factories().verify(
      malformed.dependencies,
      Config({}),
    )
    await expect(malformedHandler.prepare(malformed.verifyResolved, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'handler-attempt-invalid' })
  })

  it.each([
    ['state Work id', (candidate: WorkView): WorkView => ({
      ...candidate,
      state: { ...candidate.state, workId: WorkId('other-work') },
    })],
    ['state Result linkage', (candidate: WorkView): WorkView => ({
      ...candidate,
      state: { ...candidate.state, resultId: ResultId('other-result') },
    })],
    ['canonical intent', (candidate: WorkView): WorkView => ({
      ...candidate,
      work: { ...candidate.work, intent: { packetId: WorkPacketId('other') } },
    })],
    ['intent digest', (candidate: WorkView): WorkView => ({
      ...candidate,
      work: {
        ...candidate.work,
        intentDigest: String(canonicalDigest({ packetId: 'other' })),
      },
    })],
    ['resolved Contract', (candidate: WorkView): WorkView => ({
      ...candidate,
      work: {
        ...candidate.work,
        resolved: {
          ...candidate.work.resolved,
          contractRevisionId: ContractRevisionId('other-contract'),
        },
      },
    })],
    ['resolved executor', (candidate: WorkView): WorkView => ({
      ...candidate,
      work: {
        ...candidate.work,
        resolved: {
          ...candidate.work.resolved,
          executorId: ExecutorId('other-executor'),
        },
      },
    })],
    ['successful Work state', (candidate: WorkView): WorkView => ({
      ...candidate,
      state: { ...candidate.state, status: 'failed' },
    })],
    ['successful Attempt linkage', (candidate: WorkView): WorkView => ({
      ...candidate,
      attempts: [],
    })],
    ['Attempt Work ownership', (candidate: WorkView): WorkView => ({
      ...candidate,
      attempts: candidate.attempts.map(attempt => ({
        ...attempt,
        workId: WorkId('other-work'),
      })),
    })],
    ['completion claim target', (candidate: WorkView): WorkView => ({
      ...candidate,
      result: candidate.result === null ? null : {
        ...candidate.result,
        output: {
          completionClaim: {
            ...completedClaim(),
            checkpointCommit: GitCommitId('6'.repeat(40)),
          },
        },
      },
    })],
  ] as const)('rejects bound change corruption in %s', async (_, corrupt) => {
    const state = handlerHarness('successful')
    const handler = factories().verify(state.dependencies, Config({}))
    const corrupted = corrupt(state.successfulChange)
    const verification = view(
      'code.verify@1', state.verifyResolved,
      verificationWorkId, verificationAttemptId,
    )
    state.list.mockImplementation(() => state.list.mock.calls.length > 1
      ? [corrupted]
      : [verification])
    state.get
      .mockReturnValueOnce(verification)
      .mockReturnValueOnce(corrupted)

    await expect(handler.prepare(state.verifyResolved, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'handler-attempt-invalid' })
  })

  it('fails explicitly on one corrupt selected binding instead of skipping to a valid one', async () => {
    const state = handlerHarness('successful')
    const handler = factories().verify(state.dependencies, Config({}))
    state.snapshot.mockReturnValueOnce({
      contractRevisions: [state.contract],
      workPackets: [state.packet],
      dispatchBindings: [
        { ...state.changeBinding, id: 'corrupt-binding' },
        state.changeBinding,
      ],
      acceptanceDecisions: [],
    })
    state.get
      .mockReturnValueOnce(view(
        'code.verify@1', state.verifyResolved,
        verificationWorkId, verificationAttemptId,
      ))
      .mockImplementationOnce(() => {
        throw new Error('corrupt bound Work')
      })
      .mockReturnValueOnce(state.successfulChange)

    await expect(handler.prepare(state.verifyResolved, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'handler-attempt-invalid' })
  })

  it('forwards a typed verifier verdict and cancellation through live ownership', async () => {
    const state = handlerHarness('successful')
    const expected = verdict(state.packet.verificationPlan.digest)
    const cancel = vi.fn(async () => undefined)
    state.startVerification.mockImplementation(() => ({
      done: Promise.resolve(expected),
      cancel,
    }))
    const handler = factories().verify(state.dependencies, Config({}))
    const prepared = await handler.prepare(state.verifyResolved, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    })

    const live = handler.start(prepared, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    })
    expect(state.startVerification).toHaveBeenCalledOnce()
    await expect(live.done).resolves.toEqual({
      status: 'succeeded',
      output: { verificationVerdict: expected },
    })
    await live.cancel('operator canceled')
    expect(cancel).toHaveBeenCalledWith('operator canceled')
  })

  it.each([
    ['configuration', 'failed', 'not-started'],
    ['invalid-request', 'failed', 'not-started'],
    ['workspace-boundary', 'failed', 'started'],
    ['execution', 'failed', 'started'],
    ['cleanup', 'unknown', 'unknown'],
  ] as const)('maps verifier %s failures truthfully', async (code, status, sideEffect) => {
    const state = handlerHarness('successful')
    state.startVerification.mockImplementation(() => ({
      done: Promise.reject(new DeliveryVerifierError(code, `verifier ${code}`)),
      cancel: vi.fn(async () => undefined),
    }))
    const handler = factories().verify(state.dependencies, Config({}))
    const prepared = await handler.prepare(state.verifyResolved, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    })

    await expect(handler.start(prepared, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    }).done).resolves.toMatchObject({
      status,
      failure: { sideEffect, retriable: false },
    })
  })

  it('maps verifier cancellation to Queue cancellation', async () => {
    const state = handlerHarness('successful')
    state.startVerification.mockImplementation(() => ({
      done: Promise.reject(new DeliveryVerifierError('canceled', 'canceled')),
      cancel: vi.fn(async () => undefined),
    }))
    const handler = factories().verify(state.dependencies, Config({}))
    const prepared = await handler.prepare(state.verifyResolved, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    })

    await expect(handler.start(prepared, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    }).done).resolves.toEqual({ status: 'canceled' })
  })

  it.each([
    [new Error('unexpected verifier failure'), 'unexpected verifier failure'],
  ] as const)('keeps unclassified verifier failure uncertain', async (
    cause: Error,
    message: string,
  ) => {
    const state = handlerHarness('successful')
    state.startVerification.mockImplementation(() => ({
      done: Promise.reject(cause),
      cancel: vi.fn(async () => undefined),
    }))
    const handler = factories().verify(state.dependencies, Config({}))
    const prepared = await handler.prepare(state.verifyResolved, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    })

    const outcome = await handler.start(prepared, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    }).done
    expect(outcome.status).toBe('unknown')
    if (outcome.status === 'unknown') {
      expect(outcome.failure.message).toContain(message)
    }
  })

  it('keeps a verifier verdict with mismatched immutable identity uncertain', async () => {
    const state = handlerHarness('successful')
    state.startVerification.mockImplementation(() => ({
      done: Promise.resolve(verdict(
        Sha256Digest(`sha256:${'e'.repeat(64)}`),
      )),
      cancel: vi.fn(async () => undefined),
    }))
    const handler = factories().verify(state.dependencies, Config({}))
    const prepared = await handler.prepare(state.verifyResolved, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    })

    await expect(handler.start(prepared, {
      attemptId: verificationAttemptId,
      signal: new AbortController().signal,
    }).done).resolves.toMatchObject({
      status: 'unknown',
      failure: { category: 'delivery-verification-output' },
    })
  })
})
