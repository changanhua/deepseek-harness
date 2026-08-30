import { describe, expect, it, vi } from 'vitest'
import {
  CODE_CHANGE_KIND,
  CODE_VERIFY_KIND,
  DispatchBindingId,
  ExecutorId,
  QueueWorkIdRef,
  Sha256Digest,
  WorkPacketId,
  canonicalDigest,
} from '@deepseek-ai/dsh-delivery-protocol'
import { WorkId } from '@deepseek-ai/dsh-task-queue'
import type { WorkHandler, WorkView } from '@deepseek-ai/dsh-task-queue'
import { Config, DeliveryTaskQueueError, apply } from '../src/index.ts'

const packetId = WorkPacketId('packet-recovery-1')
const changeWorkId = WorkId('change-recovery-work-1')
const verificationWorkId = WorkId('verification-recovery-work-1')
const executorId = ExecutorId('codex')
const targetCommit = 'a'.repeat(40)
const planDigest = Sha256Digest(`sha256:${'b'.repeat(64)}`)

function boundView(
  kind: typeof CODE_CHANGE_KIND | typeof CODE_VERIFY_KIND,
  workId: WorkId,
): WorkView {
  const intent = kind === CODE_CHANGE_KIND
    ? { packetId }
    : { packetId, targetCommit, verificationPlanDigest: planDigest }
  return {
    work: {
      id: workId,
      kind,
      title: kind,
      intent,
      intentDigest: canonicalDigest(intent),
      resolved: {} as WorkView['work']['resolved'],
      policy: { maxAttempts: 1 },
      resources: [{ resource: 'agent-run', units: 1 }],
      tags: [],
      batchId: null,
      ownerSessionId: null,
      createdAt: '2026-08-29T00:00:00.000Z',
    },
    state: {
      workId,
      status: 'queued',
      attemptCount: 0,
      activeAttemptId: null,
      resultId: null,
      failure: null,
      cancelRequestedAt: null,
      updatedAt: '2026-08-29T00:00:00.000Z',
    },
    attempts: [],
    result: null,
  }
}

function binding(
  kind: typeof CODE_CHANGE_KIND | typeof CODE_VERIFY_KIND,
  phase: 'submitting' | 'bound',
) {
  const intent = kind === CODE_CHANGE_KIND
    ? { packetId }
    : { packetId, targetCommit, verificationPlanDigest: planDigest }
  return {
    schemaVersion: 1,
    id: DispatchBindingId(`${kind}-${phase}`),
    packetId,
    kind,
    inputDigest: canonicalDigest(intent),
    idempotencyKey: kind === CODE_CHANGE_KIND
      ? `delivery:${packetId}:${kind}`
      : `delivery:${packetId}:${kind}:${targetCommit}:${planDigest}`,
    phase,
    queueWorkId: phase === 'bound'
      ? QueueWorkIdRef(String(kind === CODE_CHANGE_KIND
        ? changeWorkId
        : verificationWorkId))
      : null,
    executorId: kind === CODE_CHANGE_KIND ? executorId : null,
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
  } as const
}

function context(options: {
  readonly bindings?: readonly ReturnType<typeof binding>[]
  readonly views?: readonly WorkView[]
} = {}) {
  const bindings = [...(options.bindings ?? [])]
  const views = [...(options.views ?? [])]
  const handlers = new Map<string, WorkHandler<never>>()
  const registrationDisposers: ReturnType<typeof vi.fn>[] = []
  const registerHandler = vi.fn((handler: WorkHandler<never>) => {
    handlers.set(handler.kind, handler)
    const dispose = vi.fn(() => handlers.delete(handler.kind))
    registrationDisposers.push(dispose)
    return dispose
  })
  const enqueue = vi.fn(async (request: { readonly kind: string }) =>
    request.kind === CODE_CHANGE_KIND ? changeWorkId : verificationWorkId)
  const get = vi.fn((id: WorkId) => {
    const found = views.find(view => view.work.id === id)
    if (found === undefined) throw new Error(`missing Queue view ${id}`)
    return found
  })
  const list = vi.fn(() => views)
  const bindDispatch = vi.fn(async (request: {
    readonly bindingId: DispatchBindingId
    readonly queueWorkId: QueueWorkIdRef
  }) => {
    const current = bindings.find(item => item.id === request.bindingId)
    if (current === undefined) throw new Error('missing binding')
    const next = { ...current, phase: 'bound', queueWorkId: request.queueWorkId }
    bindings.splice(bindings.indexOf(current), 1, next as never)
    return next
  })
  const beginDispatch = vi.fn(async (request: { readonly kind: string }) => {
    const current = bindings.find(item => item.kind === request.kind)
    if (current === undefined) throw new Error('missing binding')
    return current
  })
  let lifecycleDispose: (() => unknown) | undefined
  const effect = vi.fn(async (install: () => unknown) => {
    lifecycleDispose = await install() as () => unknown
  })
  const recordAcceptanceDecision = vi.fn()
  const ctx = {
    delivery: {
      beginDispatch,
      bindDispatch,
      getDispatchBinding: vi.fn((id: DispatchBindingId) =>
        bindings.find(item => item.id === id)),
      getWorkPacket: vi.fn(() => ({
        id: packetId,
        executorPreference: { mode: 'required', executorId },
        verificationPlan: { digest: planDigest },
      })),
      getContractRevision: vi.fn(),
      snapshot: vi.fn(() => ({
        contractRevisions: [],
        workPackets: [],
        dispatchBindings: bindings,
        acceptanceDecisions: [],
      })),
      recordAcceptanceDecision,
    },
    deliveryEvidence: { bind: vi.fn(), resolve: vi.fn(), read: vi.fn() },
    repoWorkspace: {
      inspectRevision: vi.fn(),
      inspectRange: vi.fn(),
      openChange: vi.fn(),
      openVerification: vi.fn(),
    },
    subprocess: { spawn: vi.fn() },
    taskQueue: {
      registerHandler,
      forOperator: vi.fn(() => ({ enqueue, get, list })),
    },
    effect,
  }
  return {
    ctx,
    handlers,
    registrationDisposers,
    enqueue,
    get,
    list,
    bindDispatch,
    beginDispatch,
    recordAcceptanceDecision,
    dispose: async () => lifecycleDispose?.(),
  }
}

describe('Delivery Queue bridge activation', () => {
  it('registers exactly both WorkKinds and disposes both registrations', async () => {
    const state = context()

    await apply(state.ctx as never, Config({ model: 'codex-model' }))

    expect([...state.handlers.keys()]).toEqual([
      CODE_CHANGE_KIND,
      CODE_VERIFY_KIND,
    ])
    await state.dispose()
    expect(state.registrationDisposers).toHaveLength(2)
    expect(state.registrationDisposers[0]).toHaveBeenCalledOnce()
    expect(state.registrationDisposers[1]).toHaveBeenCalledOnce()
    expect(state.handlers.size).toBe(0)
  })

  it('retries both submitting bindings with their deterministic identities', async () => {
    const state = context({
      bindings: [
        binding(CODE_CHANGE_KIND, 'submitting'),
        binding(CODE_VERIFY_KIND, 'submitting'),
      ],
    })

    await apply(state.ctx as never, Config({}))

    expect(state.enqueue).toHaveBeenNthCalledWith(1, expect.objectContaining({
      kind: CODE_CHANGE_KIND,
      idempotencyKey: `delivery:${packetId}:${CODE_CHANGE_KIND}`,
    }))
    expect(state.enqueue).toHaveBeenNthCalledWith(2, expect.objectContaining({
      kind: CODE_VERIFY_KIND,
      idempotencyKey:
        `delivery:${packetId}:${CODE_VERIFY_KIND}:${targetCommit}:${planDigest}`,
    }))
    expect(state.bindDispatch).toHaveBeenCalledTimes(2)
    expect(state.recordAcceptanceDecision).not.toHaveBeenCalled()
  })

  it('does not resubmit bound bindings after an idempotent restart', async () => {
    const state = context({
      bindings: [
        binding(CODE_CHANGE_KIND, 'bound'),
        binding(CODE_VERIFY_KIND, 'bound'),
      ],
      views: [
        boundView(CODE_CHANGE_KIND, changeWorkId),
        boundView(CODE_VERIFY_KIND, verificationWorkId),
      ],
    })

    await apply(state.ctx as never, Config({}))

    expect(state.list).toHaveBeenCalledOnce()
    expect(state.get).toHaveBeenCalledTimes(2)
    expect(state.enqueue).not.toHaveBeenCalled()
    expect(state.bindDispatch).not.toHaveBeenCalled()
    expect(state.recordAcceptanceDecision).not.toHaveBeenCalled()
  })

  it('fails activation on a missing or malformed bound Queue view without admission', async () => {
    const state = context({
      bindings: [binding(CODE_CHANGE_KIND, 'bound')],
      views: [boundView(CODE_VERIFY_KIND, changeWorkId)],
    })

    let error: unknown
    try {
      await apply(state.ctx as never, Config({}))
    } catch (cause) {
      error = cause
    }
    expect(error).toBeInstanceOf(DeliveryTaskQueueError)
    if (error instanceof DeliveryTaskQueueError) {
      expect(error.code).toBe('reconciliation-invalid')
      expect(error.message).toMatch(/bound.*Queue|Queue.*bound/)
    }
    expect(state.enqueue).not.toHaveBeenCalled()
    expect(state.bindDispatch).not.toHaveBeenCalled()
    expect(state.recordAcceptanceDecision).not.toHaveBeenCalled()
  })

  it('fails activation when a bound Queue Work is missing', async () => {
    const state = context({
      bindings: [binding(CODE_CHANGE_KIND, 'bound')],
      views: [],
    })

    await expect(apply(state.ctx as never, Config({}))).rejects.toThrow(
      /bound.*Queue|Queue.*bound/,
    )
    expect(state.enqueue).not.toHaveBeenCalled()
  })

  it('rejects a non-canonical submitting verification key', async () => {
    const candidate = {
      ...binding(CODE_VERIFY_KIND, 'submitting'),
      idempotencyKey: 'not-a-delivery-key',
    }
    const state = context({ bindings: [candidate] })

    await expect(apply(state.ctx as never, Config({}))).rejects.toThrow(
      /non-canonical idempotency key/,
    )
    expect(state.enqueue).not.toHaveBeenCalled()
  })

  it('rejects a submitting binding whose digest does not match its intent', async () => {
    const candidate = {
      ...binding(CODE_CHANGE_KIND, 'submitting'),
      inputDigest: Sha256Digest(`sha256:${'c'.repeat(64)}`),
    }
    const state = context({ bindings: [candidate] })

    await expect(apply(state.ctx as never, Config({}))).rejects.toThrow(
      /canonical Queue intent/,
    )
    expect(state.enqueue).not.toHaveBeenCalled()
  })

  it('rejects a verification binding whose canonical prefix has invalid intent facts', async () => {
    const candidate = {
      ...binding(CODE_VERIFY_KIND, 'submitting'),
      idempotencyKey: `delivery:${packetId}:${CODE_VERIFY_KIND}:invalid`,
    }
    const state = context({ bindings: [candidate] })

    await expect(apply(state.ctx as never, Config({}))).rejects.toThrow(
      /reconstruct its exact Queue intent/,
    )
    expect(state.enqueue).not.toHaveBeenCalled()
  })

  it('classifies a non-Error reconciliation rejection without losing uncertainty', async () => {
    const state = context()
    state.list.mockImplementationOnce(() => {
      throw 'non-error Queue rejection'
    })

    let error: unknown
    try {
      await apply(state.ctx as never, Config({}))
    } catch (cause) {
      error = cause
    }
    expect(error).toBeInstanceOf(DeliveryTaskQueueError)
    if (error instanceof DeliveryTaskQueueError) {
      expect(error.code).toBe('reconciliation-invalid')
      expect(error.message).toContain('non-Error')
    }
    expect(state.enqueue).not.toHaveBeenCalled()
  })
})
