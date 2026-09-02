import { describe, expect, it, vi } from 'vitest'
import {
  CODE_CHANGE_KIND,
  CODE_VERIFY_KIND,
  DELIVERY_SCHEMA_VERSION,
  DispatchBindingId,
  ExecutorId,
  GitCommitId,
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
    schemaVersion: DELIVERY_SCHEMA_VERSION,
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
  readonly pumpOnRegister?: () => void
  readonly disposeErrors?: readonly (Error | undefined)[]
  readonly registrationErrors?: readonly (Error | undefined)[]
} = {}) {
  const bindings = [...(options.bindings ?? [])]
  const views = [...(options.views ?? [])]
  const handlers = new Map<string, WorkHandler<never>>()
  const registrationDisposers: ReturnType<typeof vi.fn>[] = []
  const registrationActivators: ReturnType<typeof vi.fn>[] = []
  const registerHandler = vi.fn((
    handler: WorkHandler<never>,
    registrationOptions?: { readonly activation?: 'immediate' | 'staged' },
  ) => {
    const registrationIndex = registrationDisposers.length
    const registrationError = options.registrationErrors?.[registrationIndex]
    if (registrationError !== undefined) throw registrationError
    handlers.set(handler.kind, handler)
    if (registrationOptions?.activation !== 'staged') {
      options.pumpOnRegister?.()
    }
    const disposerIndex = registrationIndex
    const dispose = vi.fn(() => {
      handlers.delete(handler.kind)
      const error = options.disposeErrors?.[disposerIndex]
      if (error !== undefined) throw error
    })
    const activate = vi.fn(() => options.pumpOnRegister?.())
    Object.assign(dispose, { activate })
    registrationDisposers.push(dispose)
    registrationActivators.push(activate)
    return dispose as typeof dispose & { activate(): void }
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
  const spawn = vi.fn()
  const snapshot = vi.fn(() => ({
    contractRevisions: [],
    workPackets: [],
    dispatchBindings: bindings,
    acceptanceDecisions: [],
  }))
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
      snapshot,
      recordAcceptanceDecision,
    },
    deliveryEvidence: { bind: vi.fn(), resolve: vi.fn(), read: vi.fn() },
    repoWorkspace: {
      inspectRevision: vi.fn(),
      inspectRange: vi.fn(),
      openChange: vi.fn(),
      openVerification: vi.fn(),
    },
    subprocess: { spawn },
    taskQueue: {
      registerHandler,
      forOperator: vi.fn(() => ({ enqueue, get, list })),
    },
    effect,
  }
  return {
    ctx,
    handlers,
    registerHandler,
    registrationDisposers,
    registrationActivators,
    enqueue,
    get,
    list,
    bindDispatch,
    beginDispatch,
    recordAcceptanceDecision,
    spawn,
    snapshot,
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
    expect(state.registerHandler.mock.calls.map(([, options]) => options))
      .toEqual([
        { activation: 'staged' },
        { activation: 'staged' },
      ])
    expect(state.registrationActivators[0]).toHaveBeenCalledOnce()
    expect(state.registrationActivators[1]).toHaveBeenCalledOnce()
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

    expect(state.enqueue.mock.calls).toEqual([
      [{
        kind: CODE_CHANGE_KIND,
        title: `Change code for Delivery Packet ${packetId}`,
        input: { packetId },
        idempotencyKey: `delivery:${packetId}:${CODE_CHANGE_KIND}`,
      }],
      [{
        kind: CODE_VERIFY_KIND,
        title: `Verify Delivery Packet ${packetId} at ${targetCommit}`,
        input: { packetId, targetCommit, verificationPlanDigest: planDigest },
        idempotencyKey:
          `delivery:${packetId}:${CODE_VERIFY_KIND}:${targetCommit}:${planDigest}`,
      }],
    ])
    expect(state.bindDispatch).toHaveBeenCalledTimes(2)
    expect(state.recordAcceptanceDecision).not.toHaveBeenCalled()
  })

  it('recovers a verification binding with a 64-hex Git target identity', async () => {
    const longTarget = GitCommitId('d'.repeat(64))
    const intent = {
      packetId,
      targetCommit: longTarget,
      verificationPlanDigest: planDigest,
    }
    const candidate = {
      ...binding(CODE_VERIFY_KIND, 'submitting'),
      inputDigest: canonicalDigest(intent),
      idempotencyKey:
        `delivery:${packetId}:${CODE_VERIFY_KIND}:${longTarget}:${planDigest}`,
    }
    const state = context({ bindings: [candidate] })

    await apply(state.ctx as never, Config({}))

    expect(state.enqueue).toHaveBeenCalledWith({
      kind: CODE_VERIFY_KIND,
      title: `Verify Delivery Packet ${packetId} at ${longTarget}`,
      input: intent,
      idempotencyKey: candidate.idempotencyKey,
    })
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

    expect(state.list).toHaveBeenCalledTimes(2)
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

  it('leaves staged recovery handlers inactive when reconciliation fails', async () => {
    const pump = vi.fn()
    const state = context({
      bindings: [binding(CODE_CHANGE_KIND, 'bound')],
      views: [boundView(CODE_VERIFY_KIND, changeWorkId)],
      pumpOnRegister: pump,
    })

    await expect(apply(state.ctx as never, Config({}))).rejects.toMatchObject({
      code: 'reconciliation-invalid',
    })
    expect(pump).not.toHaveBeenCalled()
    expect(state.registrationActivators[0]).not.toHaveBeenCalled()
    expect(state.registrationActivators[1]).not.toHaveBeenCalled()
    expect(state.spawn).not.toHaveBeenCalled()
    expect(state.handlers.size).toBe(0)
  })

  it('rejects a bound Work missing from operator.list even when get can return it', async () => {
    const state = context({
      bindings: [binding(CODE_CHANGE_KIND, 'bound')],
      views: [boundView(CODE_CHANGE_KIND, changeWorkId)],
    })
    state.list.mockReturnValueOnce([])

    await expect(apply(state.ctx as never, Config({}))).rejects.toMatchObject({
      code: 'reconciliation-invalid',
    })
    expect(state.enqueue).not.toHaveBeenCalled()
  })

  it('rejects list/get disagreement for one bound Work', async () => {
    const listed = boundView(CODE_CHANGE_KIND, changeWorkId)
    const exact = {
      ...listed,
      state: { ...listed.state, updatedAt: '2026-08-29T00:00:01.000Z' },
    }
    const state = context({
      bindings: [binding(CODE_CHANGE_KIND, 'bound')],
      views: [listed],
    })
    state.get.mockReturnValueOnce(exact)

    await expect(apply(state.ctx as never, Config({}))).rejects.toMatchObject({
      code: 'reconciliation-invalid',
    })
  })

  it('rejects a tampered bound intent and mismatched state Work identity', async () => {
    const tampered = boundView(CODE_CHANGE_KIND, changeWorkId)
    const wrongIntent = {
      ...tampered,
      work: { ...tampered.work, intent: { packetId: WorkPacketId('other') } },
    } as WorkView
    const intentState = context({
      bindings: [binding(CODE_CHANGE_KIND, 'bound')],
      views: [wrongIntent],
    })
    await expect(apply(intentState.ctx as never, Config({}))).rejects.toMatchObject({
      code: 'reconciliation-invalid',
    })

    const wrongState = {
      ...tampered,
      state: { ...tampered.state, workId: WorkId('other-work') },
    }
    const stateIdentity = context({
      bindings: [binding(CODE_CHANGE_KIND, 'bound')],
      views: [wrongState],
    })
    await expect(apply(stateIdentity.ctx as never, Config({})))
      .rejects.toMatchObject({ code: 'reconciliation-invalid' })
  })

  it('rejects a bound binding whose Packet differs from its canonical Work intent', async () => {
    const state = context({
      bindings: [{
        ...binding(CODE_CHANGE_KIND, 'bound'),
        packetId: WorkPacketId('other-packet'),
      }],
      views: [boundView(CODE_CHANGE_KIND, changeWorkId)],
    })

    await expect(apply(state.ctx as never, Config({}))).rejects.toMatchObject({
      code: 'reconciliation-invalid',
    })
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

  it('rejects a submitting change binding whose durable key is not deterministic', async () => {
    const candidate = {
      ...binding(CODE_CHANGE_KIND, 'submitting'),
      idempotencyKey: 'delivery:wrong:code.change@1',
    }
    const state = context({ bindings: [candidate] })

    await expect(apply(state.ctx as never, Config({}))).rejects.toMatchObject({
      code: 'reconciliation-invalid',
    })
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
    const state = context({
      bindings: [binding(CODE_CHANGE_KIND, 'bound')],
      views: [boundView(CODE_CHANGE_KIND, changeWorkId)],
    })
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

  it('classifies a non-Error Queue enqueue rejection during reconciliation', async () => {
    const state = context({
      bindings: [binding(CODE_CHANGE_KIND, 'submitting')],
    })
    state.enqueue.mockRejectedValueOnce('non-error enqueue rejection')

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
    expect(state.handlers.size).toBe(0)
  })

  it('preserves a non-Error activation rejection when rollback has no cleanup', async () => {
    const state = context()
    state.snapshot.mockImplementationOnce(() => {
      const iterator = (function* empty() {})()
      return iterator.throw('non-error activation rejection') as never
    })

    await expect(apply(state.ctx as never, Config({}))).rejects.toThrow(
      /non-error activation rejection/,
    )
    expect(state.handlers.size).toBe(0)
  })

  it('continues normal disposal after one handler disposer throws', async () => {
    const state = context({
      disposeErrors: [undefined, new Error('verify dispose failed')],
    })
    await apply(state.ctx as never, Config({}))

    await expect(state.dispose()).rejects.toBeInstanceOf(AggregateError)
    expect(state.registrationDisposers[0]).toHaveBeenCalledOnce()
    expect(state.registrationDisposers[1]).toHaveBeenCalledOnce()
    expect(state.handlers.size).toBe(0)
  })

  it('aggregates every normal handler disposal failure', async () => {
    const state = context({
      disposeErrors: [
        new Error('change dispose failed'),
        new Error('verify dispose failed'),
      ],
    })
    await apply(state.ctx as never, Config({}))

    await expect(state.dispose()).rejects.toBeInstanceOf(AggregateError)
    expect(state.registrationDisposers[0]).toHaveBeenCalledOnce()
    expect(state.registrationDisposers[1]).toHaveBeenCalledOnce()
    expect(state.handlers.size).toBe(0)
  })

  it('continues rollback disposal and preserves reconciliation plus cleanup failures', async () => {
    const state = context({
      registrationErrors: [undefined, new Error('verify registration failed')],
      disposeErrors: [new Error('change rollback failed')],
    })

    await expect(apply(state.ctx as never, Config({}))).rejects.toBeInstanceOf(
      AggregateError,
    )
    expect(state.registrationDisposers[0]).toHaveBeenCalledOnce()
    expect(state.handlers.size).toBe(0)
  })
})
