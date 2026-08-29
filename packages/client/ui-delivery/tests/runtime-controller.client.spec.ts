// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type {
  DeliveryEvidenceView,
  DeliverySnapshotView,
} from '@deepseek-ai/dsh-delivery-remote/types'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { DeliveryRuntimeRemoteFace } from '../src/client/runtime-controller.ts'
import { createDeliveryRuntimeController } from '../src/client/runtime-controller.ts'

const EMPTY: DeliverySnapshotView = { contractsWithoutPacket: [], cards: [] }
const EVIDENCE: DeliveryEvidenceView = {
  id: 'evidence-1' as never,
  kind: 'verification-output',
  mediaType: 'text/plain',
  byteLength: 1,
  digest: `sha256:${'1'.repeat(64)}` as never,
  createdAt: '2026-08-29T00:00:00.000Z',
  provenance: {
    kind: 'change-attempt',
    packetId: 'packet-1' as never,
    queueWorkId: 'work-1' as never,
    queueAttemptId: 'attempt-1' as never,
  },
  contentBase64: 'eA==',
}
const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value })

function remote(overrides: Partial<DeliveryRuntimeRemoteFace> = {}): DeliveryRuntimeRemoteFace {
  return {
    snapshot: vi.fn(() => ok(EMPTY)),
    importIssue: vi.fn(() => ok({})),
    createPacket: vi.fn(() => ok({})),
    startChange: vi.fn(() => ok({})),
    startVerification: vi.fn(() => ok({})),
    readEvidence: vi.fn(() => ok(EVIDENCE)),
    recordDecision: vi.fn(() => ok({})),
    ...overrides,
  }
}

describe('Delivery Runtime controller', () => {
  it('retains the last snapshot across Remote and carrier failures and notifies subscribers', async () => {
    let reads = 0
    const subject = remote({
      snapshot: vi.fn(() => {
        reads += 1
        if (reads === 1) return ok(EMPTY)
        if (reads === 2) return Promise.resolve({
          ok: false as const,
          error: { code: 'offline', message: 'not connected', details: {} },
        })
        return Promise.reject(new Error('carrier closed'))
      }),
    })
    const controller = createDeliveryRuntimeController(subject)
    const listener = vi.fn()
    const unsubscribe = controller.source.subscribe(listener)

    controller.load()
    await vi.waitFor(() => { expect(controller.source.getSnapshot().status).toBe('ready') })
    controller.load()
    await vi.waitFor(() => {
      expect(controller.source.getSnapshot()).toMatchObject({
        status: 'error', error: 'offline: not connected', snapshot: EMPTY,
      })
    })
    controller.load()
    await vi.waitFor(() => {
      expect(controller.source.getSnapshot()).toMatchObject({
        status: 'error', error: 'carrier closed', snapshot: EMPTY,
      })
    })
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })

  it('ignores superseded and post-disposal snapshot settlements', async () => {
    let first!: (value: { ok: true; value: typeof EMPTY }) => void
    let calls = 0
    const subject = remote({
      snapshot: vi.fn(() => {
        calls += 1
        return calls === 1
          ? new Promise<RemoteResult<DeliverySnapshotView>>((resolve) => { first = resolve })
          : ok(EMPTY)
      }),
    })
    const controller = createDeliveryRuntimeController(subject)
    controller.load()
    controller.load()
    await vi.waitFor(() => { expect(controller.source.getSnapshot().status).toBe('ready') })
    first({ ok: true, value: { contractsWithoutPacket: [], cards: [] } })
    await Promise.resolve()
    expect(controller.source.getSnapshot().status).toBe('ready')

    controller.load()
    controller.dispose()
    await Promise.resolve()
    controller.load()
    controller.cancel()
    expect(controller.source.getSnapshot().status).toBe('loading')
  })

  it('ignores superseded snapshot and operation failures and formats primitive snapshot failures', async () => {
    let rejectFirst!: (error: unknown) => void
    let snapshotCalls = 0
    const subject = remote({
      snapshot: vi.fn(() => {
        snapshotCalls += 1
        if (snapshotCalls === 1) {
          return new Promise<RemoteResult<DeliverySnapshotView>>((_resolve, reject) => { rejectFirst = reject })
        }
        const primitiveSnapshotFailure: unknown = 'primitive snapshot failure'
        if (snapshotCalls === 3) {
          // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Exercises the non-Error carrier fallback.
          return Promise.reject<RemoteResult<DeliverySnapshotView>>(primitiveSnapshotFailure)
        }
        return ok(EMPTY)
      }),
      recordDecision: vi.fn(() => Promise.reject(new Error('decision transport failed'))),
    })
    const controller = createDeliveryRuntimeController(subject)

    controller.load()
    controller.load()
    rejectFirst(new Error('stale snapshot failure'))
    await vi.waitFor(() => { expect(controller.source.getSnapshot().status).toBe('ready') })
    controller.load()
    await vi.waitFor(() => {
      expect(controller.source.getSnapshot().error).toBe('primitive snapshot failure')
    })

    await expect(controller.recordDecision({
      packetId: 'packet-1', changeBindingId: 'binding-1', verificationBindingId: 'binding-2',
      decision: 'rejected', reason: 'needs changes', decisionNonce: 'nonce-1',
    })).resolves.toBe(false)
    expect(controller.source.getSnapshot().actionError).toBe('decision transport failed')

    let settleOperation!: (value: RemoteResult<unknown>) => void
    const fulfilledController = createDeliveryRuntimeController(remote({
      startVerification: vi.fn(() => new Promise<RemoteResult<unknown>>((resolve) => { settleOperation = resolve })),
    }))
    const supersededSuccess = fulfilledController.startVerification({
      packetId: 'packet-1', changeBindingId: 'binding-1',
    })
    fulfilledController.load()
    settleOperation({ ok: true, value: {} })
    await expect(supersededSuccess).resolves.toBe(false)

    let rejectOperation!: (error: unknown) => void
    const rejectedController = createDeliveryRuntimeController(remote({
      createPacket: vi.fn(() => new Promise<RemoteResult<unknown>>((_resolve, reject) => { rejectOperation = reject })),
    }))
    const supersededFailure = rejectedController.createPacket({
      contractRevisionId: 'contract-1',
      packet: {
        objective: 'bounded', allowedPaths: [], forbiddenPaths: [{ kind: 'subtree', path: 'src' as never }],
        acceptanceClauseIds: ['clause-1' as never], stopConditions: [], executorPreference: { mode: 'any' },
      },
    })
    rejectedController.load()
    rejectOperation(new Error('stale operation failure'))
    await expect(supersededFailure).resolves.toBe(false)
  })

  it('forwards every explicit operation and stores only the selected evidence response', async () => {
    const snapshot = vi.fn(() => ok(EMPTY))
    const importIssue = vi.fn(() => ok({}))
    const createPacket = vi.fn(() => ok({}))
    const startChange = vi.fn(() => ok({}))
    const startVerification = vi.fn(() => ok({}))
    const readEvidence = vi.fn(() => ok(EVIDENCE))
    const recordDecision = vi.fn(() => ok({}))
    const subject = remote({
      snapshot, importIssue, createPacket, startChange, startVerification, readEvidence, recordDecision,
    })
    const controller = createDeliveryRuntimeController(subject)
    const cases = [
      [() => controller.importIssue({ issueUrl: 'https://github.com/o/r/issues/1', repositoryId: 'repo-1' }), importIssue],
      [() => controller.createPacket({ contractRevisionId: 'contract-1', packet: {
        objective: 'bounded', allowedPaths: [], forbiddenPaths: [{ kind: 'subtree', path: 'src' as never }],
        acceptanceClauseIds: ['clause-1' as never], stopConditions: [], executorPreference: { mode: 'any' },
      } }), createPacket],
      [() => controller.startChange({ packetId: 'packet-1', executorId: 'codex' }), startChange],
      [() => controller.startVerification({ packetId: 'packet-1', changeBindingId: 'binding-1' }), startVerification],
      [() => controller.recordDecision({
        packetId: 'packet-1', changeBindingId: 'binding-1', verificationBindingId: 'binding-2',
        decision: 'rejected', reason: 'needs changes', decisionNonce: 'nonce-1',
      }), recordDecision],
    ] as const
    for (const [invoke, spy] of cases) {
      await expect(invoke()).resolves.toBe(true)
      expect(spy).toHaveBeenCalledWith(expect.any(Object), expect.any(AbortSignal))
      await vi.waitFor(() => { expect(controller.source.getSnapshot().status).toBe('ready') })
    }
    const snapshotReads = snapshot.mock.calls.length
    await expect(controller.readEvidence({ evidenceId: 'evidence-1' as never })).resolves.toBe(true)
    expect(readEvidence).toHaveBeenCalledWith({ evidenceId: 'evidence-1' }, expect.any(AbortSignal))
    expect(controller.source.getSnapshot().evidence?.contentBase64).toBe('eA==')
    expect(snapshot.mock.calls).toHaveLength(snapshotReads)
  })

  it('refuses overlap, records thrown failures, and returns false after disposal', async () => {
    let settle!: (value: RemoteResult<unknown>) => void
    const subject = remote({
      importIssue: vi.fn(() => new Promise<RemoteResult<unknown>>((resolve) => { settle = resolve })),
      createPacket: vi.fn(() => {
        const primitiveFailure: unknown = 'primitive failure'
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Exercises the non-Error operation fallback.
        return Promise.reject(primitiveFailure)
      }),
    })
    const controller = createDeliveryRuntimeController(subject)
    const first = controller.importIssue({ issueUrl: 'https://github.com/o/r/issues/1', repositoryId: 'repo-1' })
    await expect(controller.startChange({ packetId: 'packet-1', executorId: 'codex' })).resolves.toBe(false)
    expect(controller.source.getSnapshot().actionError).toBe('Another Delivery operation is still running')
    settle({ ok: true, value: {} })
    await expect(first).resolves.toBe(true)
    await expect(controller.createPacket({ contractRevisionId: 'contract-1', packet: {
      objective: 'bounded', allowedPaths: [], forbiddenPaths: [{ kind: 'subtree', path: 'src' as never }],
      acceptanceClauseIds: ['clause-1' as never], stopConditions: [], executorPreference: { mode: 'any' },
    } })).resolves.toBe(false)
    expect(controller.source.getSnapshot().actionError).toBe('primitive failure')
    controller.dispose()
    await expect(controller.startVerification({ packetId: 'packet-1', changeBindingId: 'binding-1' })).resolves.toBe(false)
  })
})
