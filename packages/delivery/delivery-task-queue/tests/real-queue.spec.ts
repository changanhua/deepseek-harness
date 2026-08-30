import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  CODE_CHANGE_KIND,
  CODE_VERIFY_KIND,
  DispatchBindingId,
  ExecutorId,
  GitCommitId,
  QueueWorkIdRef,
  canonicalDigest,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  ContractRevision,
  DispatchBinding,
  ResolvedCodeChange,
  WorkPacket,
} from '@deepseek-ai/dsh-delivery-protocol'
import type { VerifiedRepositoryRevision } from '@deepseek-ai/dsh-repo-workspace'
import {
  createVerifiedOperatorAuthority,
} from '@deepseek-ai/dsh-task-queue'
import type {
  OperatorWorkQueue,
  WorkHandler,
} from '@deepseek-ai/dsh-task-queue'
import {
  contractRevisionFixture,
  readyWorkPacketFixture,
} from '../../delivery-testkit/src/fixtures.ts'
import LocalTaskQueue from '../../../task-queue/task-queue-local/src/index.ts'
import {
  Config,
  apply,
  createCodeVerifyHandler,
} from '../src/index.ts'

const executorId = ExecutorId('codex')
const targetCommit = GitCommitId('e'.repeat(40))

function records(): {
  readonly contract: ContractRevision
  readonly packet: WorkPacket
} {
  const contract = contractRevisionFixture()
  return {
    contract,
    packet: readyWorkPacketFixture({
      executorPreference: { mode: 'any' },
    }),
  }
}

function submittingChange(packet: WorkPacket): Extract<DispatchBinding, {
  readonly kind: typeof CODE_CHANGE_KIND
  readonly phase: 'submitting'
}> {
  const input = { packetId: packet.id }
  return {
    schemaVersion: 1,
    id: DispatchBindingId('real-submitting-change'),
    packetId: packet.id,
    inputDigest: canonicalDigest(input),
    idempotencyKey: `delivery:${packet.id}:${CODE_CHANGE_KIND}`,
    phase: 'submitting',
    queueWorkId: null,
    kind: CODE_CHANGE_KIND,
    executorId,
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
  }
}

function submittingVerification(
  packet: WorkPacket,
  idempotencyKey: string,
): Extract<DispatchBinding, {
  readonly kind: typeof CODE_VERIFY_KIND
  readonly phase: 'submitting'
}> {
  const input = {
    packetId: packet.id,
    targetCommit,
    verificationPlanDigest: packet.verificationPlan.digest,
  }
  return {
    schemaVersion: 1,
    id: DispatchBindingId('real-submitting-verification'),
    packetId: packet.id,
    inputDigest: canonicalDigest(input),
    idempotencyKey,
    phase: 'submitting',
    queueWorkId: null,
    kind: CODE_VERIFY_KIND,
    executorId: null,
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
  }
}

function resolvedChange(packet: WorkPacket): ResolvedCodeChange {
  return {
    packetId: packet.id,
    contractRevisionId: packet.contractRevisionId,
    repositoryId: packet.repositoryId,
    baseCommit: packet.baseCommit,
    executorId,
    policyDigest: canonicalDigest({
      executorId,
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    }),
  }
}

function acceptingChangeHandler(packet: WorkPacket): WorkHandler<typeof CODE_CHANGE_KIND> {
  return {
    kind: CODE_CHANGE_KIND,
    async resolveAdmission() { return resolvedChange(packet) },
    resources() { return [] },
    policy() { return { maxAttempts: 1 } },
    async prepare(resolved) { return resolved as never },
    start() {
      return {
        done: Promise.resolve({
          status: 'failed',
          failure: {
            category: 'fixture',
            sideEffect: 'not-started',
            retriable: false,
            message: 'fixture does not execute',
          },
        }),
        async cancel() {},
      }
    },
  }
}

function bridgeContext(
  queue: LocalTaskQueue,
  durable: ReturnType<typeof records>,
  bindings: DispatchBinding[],
  options: {
    readonly beforeBind?: Promise<undefined>
    readonly beforeRevision?: Promise<undefined>
  } = {},
) {
  const spawn = vi.fn()
  let disposeBridge: (() => void) | undefined
  const snapshot = vi.fn(() => ({
    contractRevisions: [durable.contract],
    workPackets: [durable.packet],
    dispatchBindings: bindings,
    acceptanceDecisions: [],
  }))
  const bindDispatch = vi.fn(async (request: {
    readonly bindingId: DispatchBinding['id']
    readonly queueWorkId: QueueWorkIdRef
  }) => {
    await options.beforeBind
    const index = bindings.findIndex(binding => binding.id === request.bindingId)
    const current = bindings[index]
    if (current === undefined) throw new Error('fixture binding disappeared')
    const bound = {
      ...current,
      phase: 'bound' as const,
      queueWorkId: request.queueWorkId,
    }
    bindings.splice(index, 1, bound)
    return bound
  })
  const inspectRevision = vi.fn(async (request: {
    readonly repositoryId: WorkPacket['repositoryId']
    readonly commit: WorkPacket['baseCommit']
  }) => {
    await options.beforeRevision
    return ({
      repositoryId: request.repositoryId,
      commit: request.commit,
    }) as unknown as VerifiedRepositoryRevision
  })
  const ctx = {
    delivery: {
      snapshot,
      getContractRevision: vi.fn(() => durable.contract),
      getWorkPacket: vi.fn(() => durable.packet),
      bindDispatch,
    },
    deliveryEvidence: {
      bind: vi.fn(() => ({ save: vi.fn() })),
      resolve: vi.fn(),
      read: vi.fn(),
    },
    repoWorkspace: {
      inspectRevision,
      inspectRange: vi.fn(async (request: {
        readonly base: { readonly repositoryId: WorkPacket['repositoryId']; readonly commit: WorkPacket['baseCommit'] }
        readonly target: { readonly repositoryId: WorkPacket['repositoryId']; readonly commit: WorkPacket['baseCommit'] }
      }) => ({
        repositoryId: request.base.repositoryId,
        baseCommit: request.base.commit,
        targetCommit: request.target.commit,
        descendsFromBase: true,
        changedPaths: [],
      })),
      openChange: vi.fn(),
      openVerification: vi.fn(),
    },
    subprocess: { spawn },
    taskQueue: queue,
    effect: vi.fn(async (install: () => unknown) => {
      disposeBridge = await install() as () => void
    }),
  }
  return {
    ctx,
    spawn,
    bindDispatch,
    dispose() { disposeBridge?.() },
  }
}

async function createQueue(root: string): Promise<{
  readonly context: Context
  readonly queue: LocalTaskQueue
  readonly operator: OperatorWorkQueue
}> {
  const context = new Context()
  await context.plugin(LocalTaskQueue, {
    queueRoot: root,
    resourceCapacity: { 'agent-run': 1 },
  })
  const queue = context.taskQueue as LocalTaskQueue
  return {
    context,
    queue,
    operator: queue.forOperator(createVerifiedOperatorAuthority()),
  }
}

async function waitFor(check: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() >= deadline) throw new Error('timed out waiting for Queue state')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('Delivery Queue bridge with the real LocalTaskQueue', () => {
  it('cold-start reconciles a submitting binding before any Queue receipt exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'delivery-queue-no-receipt-'))
    const durable = records()
    const bindings: DispatchBinding[] = [submittingChange(durable.packet)]
    const state = await createQueue(root)
    const bind = Promise.withResolvers<undefined>()
    const preparation = Promise.withResolvers<undefined>()
    const bridge = bridgeContext(state.queue, durable, bindings, {
      beforeBind: bind.promise,
      beforeRevision: preparation.promise,
    })
    const secretSentinel = 'real-queue-secret-sentinel'
    try {
      const activation = apply(bridge.ctx as never, Config({
        env: { DELIVERY_NON_SECRET_OVERRIDE: secretSentinel },
      }))
      await waitFor(() => bridge.bindDispatch.mock.calls.length === 1)

      expect(state.operator.list()).toHaveLength(1)
      expect(state.operator.list()[0]).toMatchObject({
        state: { status: 'queued', attemptCount: 0 },
        attempts: [],
      })

      bind.resolve(undefined)
      await activation
      await waitFor(() => state.operator.list()[0]?.attempts.length === 1)

      expect(bindings[0]).toMatchObject({
        phase: 'bound',
        queueWorkId: QueueWorkIdRef(String(state.operator.list()[0]?.work.id)),
      })
      expect(state.operator.list()[0]?.state.status).toBe('starting')
      expect(bridge.spawn).not.toHaveBeenCalled()
      expect(JSON.stringify({
        work: state.operator.list()[0],
        binding: bindings[0],
      })).not.toContain(secretSentinel)

      bridge.dispose()
      preparation.resolve(undefined)
      await waitFor(() => state.operator.list()[0]?.state.status === 'canceled')
      expect(bridge.spawn).not.toHaveBeenCalled()
    } finally {
      bind.resolve(undefined)
      preparation.resolve(undefined)
      bridge.dispose()
      await state.context.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('cold-start reconciles a submitting binding through an existing Queue receipt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'delivery-queue-with-receipt-'))
    const durable = records()
    const first = await createQueue(root)
    const disposeFixture = first.queue.registerHandler(
      acceptingChangeHandler(durable.packet),
      { activation: 'staged' },
    )
    const binding = submittingChange(durable.packet)
    const workId = await first.operator.enqueue({
      kind: CODE_CHANGE_KIND,
      title: `Change code for Delivery Packet ${durable.packet.id}`,
      input: { packetId: durable.packet.id },
      idempotencyKey: binding.idempotencyKey,
    })
    disposeFixture()
    await first.context.fiber.dispose()

    const bindings: DispatchBinding[] = [binding]
    const restarted = await createQueue(root)
    const bind = Promise.withResolvers<undefined>()
    const preparation = Promise.withResolvers<undefined>()
    const bridge = bridgeContext(restarted.queue, durable, bindings, {
      beforeBind: bind.promise,
      beforeRevision: preparation.promise,
    })
    try {
      const activation = apply(bridge.ctx as never, Config({}))
      await waitFor(() => bridge.bindDispatch.mock.calls.length === 1)

      expect(bindings[0]).toMatchObject({
        phase: 'submitting',
      })
      expect(restarted.operator.list()).toHaveLength(1)
      expect(restarted.operator.get(workId)).toMatchObject({
        state: { status: 'queued', attemptCount: 0 },
        attempts: [],
      })

      bind.resolve(undefined)
      await activation
      await waitFor(() => restarted.operator.get(workId).attempts.length === 1)
      expect(bindings[0]).toMatchObject({
        phase: 'bound',
        queueWorkId: QueueWorkIdRef(String(workId)),
      })
      expect(restarted.operator.list()).toHaveLength(1)
    } finally {
      bind.resolve(undefined)
      bridge.dispose()
      preparation.resolve(undefined)
      await restarted.context.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('admits recovery work but never starts a runner when later reconciliation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'delivery-queue-barrier-failure-'))
    const durable = records()
    const invalidVerification = submittingVerification(
      durable.packet,
      'not-a-canonical-verification-key',
    )
    const bindings: DispatchBinding[] = [
      submittingChange(durable.packet),
      invalidVerification,
    ]
    const state = await createQueue(root)
    const bridge = bridgeContext(state.queue, durable, bindings)
    try {
      await expect(apply(bridge.ctx as never, Config({}))).rejects.toMatchObject({
        code: 'reconciliation-invalid',
      })
      await new Promise(resolve => setTimeout(resolve, 20))

      expect(state.operator.list()).toHaveLength(1)
      expect(state.operator.list()[0]).toMatchObject({
        state: { status: 'queued', attemptCount: 0 },
        attempts: [],
        result: null,
      })
      expect(bridge.spawn).not.toHaveBeenCalled()
      expect(state.queue.listKinds()).toEqual([])
    } finally {
      bridge.dispose()
      await state.context.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('activates a cold bound binding after Cordis restores its exact Queue view', async () => {
    const root = await mkdtemp(join(tmpdir(), 'delivery-queue-bound-restart-'))
    const durable = records()
    const first = await createQueue(root)
    const fixture = first.queue.registerHandler(
      acceptingChangeHandler(durable.packet),
      { activation: 'staged' },
    )
    const candidate = submittingChange(durable.packet)
    const workId = await first.operator.enqueue({
      kind: CODE_CHANGE_KIND,
      title: `Change code for Delivery Packet ${durable.packet.id}`,
      input: { packetId: durable.packet.id },
      idempotencyKey: candidate.idempotencyKey,
    })
    fixture()
    await first.context.fiber.dispose()

    const bindings: DispatchBinding[] = [{
      ...candidate,
      phase: 'bound',
      queueWorkId: QueueWorkIdRef(String(workId)),
    }]
    const restarted = await createQueue(root)
    const preparation = Promise.withResolvers<undefined>()
    const bridge = bridgeContext(restarted.queue, durable, bindings, {
      beforeRevision: preparation.promise,
    })
    try {
      expect(restarted.operator.list().map(view => view.work.id)).toEqual([
        workId,
      ])
      expect(restarted.operator.get(workId).attempts).toEqual([])

      await apply(bridge.ctx as never, Config({}))
      await waitFor(() => restarted.operator.get(workId).attempts.length === 1)
      expect(restarted.operator.get(workId).state.status).toBe('starting')
      expect(bridge.spawn).not.toHaveBeenCalled()
    } finally {
      bridge.dispose()
      preparation.resolve(undefined)
      await restarted.context.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects direct verification enqueue without a bound successful change and writes no Work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'delivery-verify-admission-'))
    const durable = records()
    const state = await createQueue(root)
    const dependencies = {
      delivery: {
        getContractRevision: vi.fn(() => durable.contract),
        getWorkPacket: vi.fn(() => durable.packet),
        snapshot: vi.fn(() => ({
          contractRevisions: [durable.contract],
          workPackets: [durable.packet],
          dispatchBindings: [],
          acceptanceDecisions: [],
        })),
      },
      operator: state.operator,
      repoWorkspace: {
        inspectRevision: vi.fn(async (request: {
          readonly repositoryId: WorkPacket['repositoryId']
          readonly commit: WorkPacket['baseCommit']
        }) => ({ ...request }) as unknown as VerifiedRepositoryRevision),
        inspectRange: vi.fn(async () => ({
          repositoryId: durable.packet.repositoryId,
          baseCommit: durable.packet.baseCommit,
          targetCommit,
          descendsFromBase: true,
          changedPaths: [],
        })),
        openChange: vi.fn(),
        openVerification: vi.fn(),
      },
      evidence: { bind: vi.fn(), resolve: vi.fn(), read: vi.fn() },
      startChange: vi.fn(),
      startVerification: vi.fn(),
    }
    const dispose = state.queue.registerHandler(
      createCodeVerifyHandler(dependencies as never, Config({})),
      { activation: 'staged' },
    )
    try {
      await expect(state.operator.enqueue({
        kind: CODE_VERIFY_KIND,
        title: `Verify Delivery Packet ${durable.packet.id}`,
        input: {
          packetId: durable.packet.id,
          targetCommit,
          verificationPlanDigest: durable.packet.verificationPlan.digest,
        },
        idempotencyKey: 'direct-verification-without-change',
      })).rejects.toMatchObject({ code: 'handler-input-invalid' })
      expect(state.operator.list()).toEqual([])
    } finally {
      dispose()
      await state.context.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
