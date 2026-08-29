import { PassThrough } from 'node:stream'
import { vi } from 'vitest'
import {
  AcceptanceClauseId,
  ContractRevisionId,
  EvidenceId,
  ExecutorId,
  GitCommitId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RepositoryId,
  RepositoryRelativePath,
  SourceRefId,
  VerificationCheckId,
  WorkPacketId,
  contractRevisionSchema,
  evidenceBytesDigest,
  evidenceRefSchema,
  sourceRefContentDigest,
  verificationPlanDigest,
  workPacketDigest,
  workPacketSchema,
  type ContractRevision,
  type EvidenceRef,
  type ResolvedCodeChange,
  type WorkPacket,
  type WorkPacketDigestInput,
} from '@deepseek-ai/dsh-delivery-protocol'
import type { BoundDeliveryEvidenceWriter } from '@deepseek-ai/dsh-delivery-evidence'
import type {
  ChangeWorkspaceLease,
  RepositoryCheckpoint,
} from '@deepseek-ai/dsh-repo-workspace'
import type {
  SubprocessHandle,
  SubprocessOutcome,
} from '@deepseek-ai/dsh-subprocess'
import type { CodeChangeRunRequest } from '../src/index.ts'

type JsonObject = Record<string, unknown>

export const CREATED_AT = '2026-08-29T00:00:00.000Z'
export const BASE_COMMIT = GitCommitId('1'.repeat(40))
export const CHECKPOINT_COMMIT = GitCommitId('2'.repeat(40))
export const CONTRACT_ID = ContractRevisionId('contract-1')
export const PACKET_ID = WorkPacketId('packet-1')
export const REPOSITORY_ID = RepositoryId('repository-1')
export const QUEUE_WORK_ID = QueueWorkIdRef('work-1')
export const QUEUE_ATTEMPT_ID = QueueAttemptIdRef('attempt-1')

export class ProtocolPeer {
  private buffer = ''
  private readonly frames: JsonObject[] = []
  private readonly wakeups = new Set<() => void>()

  constructor(input: PassThrough, private readonly output: PassThrough) {
    input.on('data', (chunk: Buffer | string) => {
      this.buffer += chunk.toString()
      for (;;) {
        const newline = this.buffer.indexOf('\n')
        if (newline < 0) break
        const line = this.buffer.slice(0, newline)
        this.buffer = this.buffer.slice(newline + 1)
        if (line.trim().length > 0) {
          this.frames.push(JSON.parse(line) as JsonObject)
        }
      }
      for (const wake of this.wakeups) wake()
      this.wakeups.clear()
    })
  }

  async nextMethod(method: string): Promise<JsonObject> {
    for (;;) {
      const index = this.frames.findIndex(frame => frame.method === method)
      if (index >= 0) return this.frames.splice(index, 1)[0] as JsonObject
      await new Promise<void>((resolve) => { this.wakeups.add(resolve) })
    }
  }

  send(...frames: readonly JsonObject[]): void {
    this.output.write(`${frames.map(frame => JSON.stringify(frame)).join('\n')}\n`)
  }

  respond(request: JsonObject, result: unknown): void {
    this.send({ id: request.id, result })
  }
}

export interface FakeChildOptions {
  readonly exitOnTerminate?: boolean
  readonly waitForExitError?: Error
}

export interface FakeChild {
  readonly handle: SubprocessHandle
  readonly peer: ProtocolPeer
  readonly observed: { threadStart?: JsonObject }
  readonly terminate: ReturnType<typeof vi.fn>
  readonly waitForExit: ReturnType<typeof vi.fn>
  settle(outcome?: SubprocessOutcome): void
}

export function fakeChild(options: FakeChildOptions = {}): FakeChild {
  const fromChild = new PassThrough()
  const toChild = new PassThrough()
  const stderr = new PassThrough()
  const peer = new ProtocolPeer(toChild, fromChild)
  const observed: { threadStart?: JsonObject } = {}
  let exited = false
  let resolveDone!: (outcome: SubprocessOutcome) => void
  const done = new Promise<SubprocessOutcome>((resolve) => {
    resolveDone = resolve
  })
  const settle = (
    outcome: SubprocessOutcome = { exitCode: 0, signal: null },
  ): void => {
    if (exited) return
    exited = true
    resolveDone(outcome)
  }
  const terminate = vi.fn(() => {
    if (options.exitOnTerminate !== false) settle()
  })
  const waitForExit = vi.fn(async () => {
    if (options.waitForExitError !== undefined) {
      throw options.waitForExitError
    }
    if (!exited) await done
    return true
  })
  const handle: SubprocessHandle = {
    pid: 1234,
    stdin: toChild,
    stdout: fromChild,
    stderr,
    collected: {},
    done,
    terminate,
    waitForExit,
  }
  return { handle, peer, observed, terminate, waitForExit, settle }
}

export async function reachCodexTurn(child: FakeChild): Promise<JsonObject> {
  const initialize = await child.peer.nextMethod('initialize')
  child.peer.respond(initialize, { userAgent: 'codex-cli 0.149.1' })
  await child.peer.nextMethod('initialized')
  const threadStart = await child.peer.nextMethod('thread/start')
  child.observed.threadStart = threadStart
  child.peer.respond(threadStart, {
    thread: { id: 'thread-1', ephemeral: true },
  })
  return child.peer.nextMethod('turn/start')
}

export function completeCodexTurn(
  child: FakeChild,
  turnStart: JsonObject,
  text: string,
): void {
  child.peer.send(
    { id: turnStart.id, result: { turn: { id: 'turn-1' } } },
    {
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: { type: 'agentMessage', text, phase: 'final_answer' },
      },
    },
    {
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'completed', error: null },
      },
    },
  )
}

export function completeCodexTurnWithoutOutput(
  child: FakeChild,
  turnStart: JsonObject,
): void {
  child.peer.send(
    { id: turnStart.id, result: { turn: { id: 'turn-1' } } },
    {
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: { id: 'turn-1', status: 'completed', error: null },
      },
    },
  )
}

export function failCodexTurn(
  child: FakeChild,
  turnStart: JsonObject,
  text = 'Codex returned a partial answer.',
): void {
  child.peer.send(
    { id: turnStart.id, result: { turn: { id: 'turn-1' } } },
    {
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: { type: 'agentMessage', text, phase: 'final_answer' },
      },
    },
    {
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: {
          id: 'turn-1',
          status: 'failed',
          error: { codexErrorInfo: 'internalServerError' },
        },
      },
    },
  )
}

export function completedEnvelope(): string {
  return JSON.stringify({
    disposition: 'completed',
    summary: 'Implemented the bounded change.',
    completedWork: ['Updated the owned package.'],
    remainingWork: [],
  })
}

interface RequestHarnessOptions {
  readonly ownerAttemptId?: typeof QUEUE_ATTEMPT_ID
  readonly leaseRepositoryId?: RepositoryId
  readonly leaseBaseCommit?: GitCommitId
  readonly checkpoint?: RepositoryCheckpoint | Error
  readonly closeError?: Error
  readonly openWorkspaceError?: Error
  readonly evidenceProvenance?: EvidenceRef['provenance']
  readonly saveError?: Error
}

export interface RequestHarness {
  readonly request: CodeChangeRunRequest
  readonly contract: ContractRevision
  readonly packet: WorkPacket
  readonly resolved: ResolvedCodeChange
  readonly lease: ChangeWorkspaceLease
  readonly openWorkspace: ReturnType<typeof vi.fn>
  readonly checkpoint: ReturnType<typeof vi.fn>
  readonly close: ReturnType<typeof vi.fn>
  readonly save: ReturnType<typeof vi.fn>
}

export function requestHarness(
  options: RequestHarnessOptions = {},
): RequestHarness {
  const sourceTitle = 'Deliver a bounded Codex change'
  const sourceBody = 'Implement only the approved Delivery packet.'
  const contract = contractRevisionSchema.parse({
    schemaVersion: 1,
    id: CONTRACT_ID,
    previousRevisionId: null,
    sourceRef: {
      schemaVersion: 1,
      id: SourceRefId('source-1'),
      provider: 'github',
      repository: { owner: 'deepseek-ai', name: 'deepseek-harness' },
      issueNumber: 101,
      canonicalUrl: 'https://github.com/deepseek-ai/deepseek-harness/issues/101',
      updatedAt: CREATED_AT,
      title: sourceTitle,
      body: sourceBody,
      contentDigest: sourceRefContentDigest({
        title: sourceTitle,
        body: sourceBody,
      }),
      createdAt: CREATED_AT,
    },
    repositoryId: REPOSITORY_ID,
    outcome: 'Ship the bounded Codex runner change.',
    context: 'The runner must preserve Delivery authority boundaries.',
    allowedScope: ['The owned Delivery runner package.'],
    forbiddenScope: ['Every unrelated package.'],
    acceptanceClauses: [{
      id: AcceptanceClauseId('acceptance-1'),
      text: 'The focused runner tests pass.',
    }],
    openDecisions: [],
    baseSelectionRule: { kind: 'commit', commit: BASE_COMMIT },
    verificationSource: {
      kind: 'contract-field',
      checks: [{
        id: VerificationCheckId('check-1'),
        name: 'Run focused tests',
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
  const planProvenance = {
    kind: 'contract-field' as const,
    contractRevisionId: CONTRACT_ID,
    field: 'verificationSource' as const,
  }
  const planChecks = contract.verificationSource?.kind === 'contract-field'
    ? contract.verificationSource.checks
    : []
  const digestInput: WorkPacketDigestInput = {
    schemaVersion: 1,
    contractRevisionId: CONTRACT_ID,
    repositoryId: REPOSITORY_ID,
    baseCommit: BASE_COMMIT,
    objective: 'Implement the approved runner behavior.',
    allowedPaths: [{
      kind: 'subtree',
      path: RepositoryRelativePath(
        'packages/delivery/delivery-runner-codex',
      ),
    }],
    forbiddenPaths: [{
      kind: 'subtree',
      path: RepositoryRelativePath('packages/task-queue'),
    }],
    acceptanceClauseIds: [AcceptanceClauseId('acceptance-1')],
    verificationPlan: {
      checks: planChecks,
      provenance: planProvenance,
      digest: verificationPlanDigest({
        checks: planChecks,
        provenance: planProvenance,
      }),
    },
    stopConditions: ['Stop before changing an unrelated package.'],
    executorPreference: {
      mode: 'required',
      executorId: ExecutorId('codex'),
    },
  }
  const packet = workPacketSchema.parse({
    ...digestInput,
    id: PACKET_ID,
    packetDigest: workPacketDigest(digestInput),
    createdAt: CREATED_AT,
  })
  const resolved: ResolvedCodeChange = {
    packetId: PACKET_ID,
    contractRevisionId: CONTRACT_ID,
    repositoryId: REPOSITORY_ID,
    baseCommit: BASE_COMMIT,
    executorId: ExecutorId('codex'),
    policyDigest: evidenceBytesDigest(new TextEncoder().encode('policy')),
  }
  const checkpointOutcome = options.checkpoint ?? {
    repositoryId: REPOSITORY_ID,
    baseCommit: BASE_COMMIT,
    checkpointCommit: CHECKPOINT_COMMIT,
    changedPaths: [RepositoryRelativePath(
      'packages/delivery/delivery-runner-codex/src/index.ts',
    )],
    clean: true,
    descendsFromBase: true,
  }
  const checkpoint = vi.fn(async () => {
    if (checkpointOutcome instanceof Error) throw checkpointOutcome
    return structuredClone(checkpointOutcome)
  })
  const close = vi.fn(async () => {
    if (options.closeError !== undefined) throw options.closeError
  })
  const lease: ChangeWorkspaceLease = {
    ownerAttemptId: options.ownerAttemptId ?? QUEUE_ATTEMPT_ID,
    repositoryId: options.leaseRepositoryId ?? REPOSITORY_ID,
    baseCommit: options.leaseBaseCommit ?? BASE_COMMIT,
    cwd: 'C:\\delivery-worktrees\\attempt-1',
    checkpoint,
    close,
  }
  const openWorkspace = vi.fn(async () => {
    if (options.openWorkspaceError !== undefined) {
      throw options.openWorkspaceError
    }
    return lease
  })
  let evidenceOrdinal = 0
  const provenance = options.evidenceProvenance ?? {
    kind: 'change-attempt' as const,
    packetId: PACKET_ID,
    queueWorkId: QUEUE_WORK_ID,
    queueAttemptId: QUEUE_ATTEMPT_ID,
  }
  const save = vi.fn(async (
    input: Parameters<BoundDeliveryEvidenceWriter['save']>[0],
    signal?: AbortSignal,
  ): Promise<EvidenceRef> => {
    signal?.throwIfAborted()
    if (options.saveError !== undefined) throw options.saveError
    evidenceOrdinal += 1
    return evidenceRefSchema.parse({
      schemaVersion: 1,
      id: EvidenceId(`evidence-${String(evidenceOrdinal)}`),
      kind: input.kind,
      mediaType: input.mediaType,
      uri: `memory://evidence/${String(evidenceOrdinal)}`,
      byteLength: input.data.byteLength,
      digest: evidenceBytesDigest(input.data),
      createdAt: CREATED_AT,
      provenance,
    })
  })
  const evidence: BoundDeliveryEvidenceWriter = { save }
  const request: CodeChangeRunRequest = {
    contract,
    packet,
    resolved,
    queueWorkId: QUEUE_WORK_ID,
    queueAttemptId: QUEUE_ATTEMPT_ID,
    openWorkspace,
    evidence,
  }
  return {
    request,
    contract,
    packet,
    resolved,
    lease,
    openWorkspace,
    checkpoint,
    close,
    save,
  }
}

export async function nextTask(): Promise<void> {
  await new Promise<void>((resolve) => { setImmediate(resolve) })
}
