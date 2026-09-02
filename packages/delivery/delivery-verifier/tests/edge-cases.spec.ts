import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DeliveryEvidenceError } from '@deepseek-ai/dsh-delivery-evidence'
import {
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
  evidenceBytesDigest,
  evidenceRefSchema,
  verificationPlanDigest,
  verificationPlanSchema,
  type EvidenceRef,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import {
  DeliveryVerifierError,
  createDeliveryVerifier,
  type DeliveryVerificationRunRequest,
} from '../src/index.ts'
import {
  CLAIM_EVIDENCE_BYTES,
  CLAIM_EVIDENCE_ID,
  PACKET_ID,
  controlledSubprocessHandle,
  createVerifierFixture,
  settledSubprocessHandle,
} from './harness.ts'

function start(
  request: DeliveryVerificationRunRequest,
  spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle,
  signal: AbortSignal = new AbortController().signal,
) {
  return createDeliveryVerifier({
    subprocess: { spawn },
    verifierVersion: 'delivery-verifier@1',
    disposeGraceMs: 5_000,
    verificationOutputBytes: 64 * 1024,
  })(request, signal)
}

describe('delivery verifier request validation', () => {
  it('classifies an already-aborted external signal without side effects', async () => {
    const fixture = await createVerifierFixture()
    try {
      const controller = new AbortController()
      controller.abort(new Error('external cancellation'))
      const spawn = vi.fn(() => settledSubprocessHandle())

      await expect(start(fixture.request, spawn, controller.signal).done)
        .rejects.toEqual(expect.objectContaining({ code: 'canceled' }))
      expect(spawn).not.toHaveBeenCalled()
      expect(fixture.close).not.toHaveBeenCalled()
    } finally {
      await fixture.cleanup()
    }
  })

  it('rejects every cross-object identity mismatch before side effects', async () => {
    const fixture = await createVerifierFixture()
    const otherCommit = GitCommitId('3333333333333333333333333333333333333333')
    const checks = [{ ...fixture.check, name: 'Another valid check identity' }]
    const provenance = fixture.request.resolved.trustedPlan.provenance
    const otherPlan = verificationPlanSchema.parse({
      checks,
      provenance,
      digest: verificationPlanDigest({ checks, provenance }),
    })
    const completed = fixture.request.completionClaim
    const blocked = {
      ...completed,
      disposition: 'blocked' as const,
      blocker: 'blocked fixture',
      nextSmallestAction: 'resolve the fixture blocker',
    }
    const cases: Array<{
      readonly name: string
      readonly request: DeliveryVerificationRunRequest
    }> = [
      {
        name: 'non-completed claim',
        request: { ...fixture.request, completionClaim: blocked as never },
      },
      {
        name: 'Contract versus Packet',
        request: {
          ...fixture.request,
          contract: {
            ...fixture.request.contract,
            id: ContractRevisionId('another-contract'),
          },
        },
      },
      {
        name: 'resolved Contract versus Packet',
        request: {
          ...fixture.request,
          resolved: {
            ...fixture.request.resolved,
            contractRevisionId: ContractRevisionId('another-contract'),
          },
        },
      },
      {
        name: 'resolved Packet',
        request: {
          ...fixture.request,
          resolved: {
            ...fixture.request.resolved,
            packetId: WorkPacketId('another-packet'),
          },
        },
      },
      {
        name: 'claim Packet',
        request: {
          ...fixture.request,
          completionClaim: {
            ...fixture.request.completionClaim,
            packetId: WorkPacketId('another-packet'),
          },
        },
      },
      {
        name: 'resolved repository',
        request: {
          ...fixture.request,
          resolved: {
            ...fixture.request.resolved,
            repositoryId: RepositoryId('another-repository'),
          },
        },
      },
      {
        name: 'resolved base',
        request: {
          ...fixture.request,
          resolved: { ...fixture.request.resolved, baseCommit: otherCommit },
        },
      },
      {
        name: 'claim target',
        request: {
          ...fixture.request,
          completionClaim: {
            ...fixture.request.completionClaim,
            checkpointCommit: otherCommit,
          },
        },
      },
      {
        name: 'trusted plan',
        request: {
          ...fixture.request,
          resolved: { ...fixture.request.resolved, trustedPlan: otherPlan },
        },
      },
    ]
    try {
      for (const testCase of cases) {
        const spawn = vi.fn(() => settledSubprocessHandle())
        await expect(
          start(testCase.request, spawn).done,
          testCase.name,
        ).rejects.toEqual(expect.objectContaining({ code: 'invalid-request' }))
        expect(spawn, testCase.name).not.toHaveBeenCalled()
      }
      expect(fixture.close).not.toHaveBeenCalled()
    } finally {
      await fixture.cleanup()
    }
  })

  it.each([
    ['Queue Work', { verificationQueueWorkId: '' }],
    ['Queue Attempt', { verificationQueueAttemptId: '' }],
  ] as const)('rejects a blank verification %s identity before side effects', async (_label, override) => {
    const fixture = await createVerifierFixture()
    const spawn = vi.fn(() => settledSubprocessHandle())
    try {
      await expect(start({
        ...fixture.request,
        ...override,
      } as DeliveryVerificationRunRequest, spawn).done).rejects.toEqual(
        expect.objectContaining({ code: 'invalid-request' }),
      )
      expect(spawn).not.toHaveBeenCalled()
      expect(fixture.close).not.toHaveBeenCalled()
    } finally {
      await fixture.cleanup()
    }
  })

  it.each([
    ['Queue Work', (request: DeliveryVerificationRunRequest) => ({
      verificationQueueWorkId: request.completionClaim.queueWorkId,
    })],
    ['Queue Attempt', (request: DeliveryVerificationRunRequest) => ({
      verificationQueueAttemptId: request.completionClaim.queueAttemptId,
    })],
  ] as const)('rejects a verification %s identity borrowed from the change Attempt', async (_label, override) => {
    const fixture = await createVerifierFixture()
    const spawn = vi.fn(() => settledSubprocessHandle())
    try {
      await expect(start({
        ...fixture.request,
        ...override(fixture.request),
      }, spawn).done).rejects.toEqual(expect.objectContaining({ code: 'invalid-request' }))
      expect(spawn).not.toHaveBeenCalled()
      expect(fixture.close).not.toHaveBeenCalled()
    } finally {
      await fixture.cleanup()
    }
  })
})

describe('delivery verifier evidence failures', () => {
  it.each([
    ['not-found', 'missing'],
    ['length-mismatch', 'size-mismatch'],
    ['reference-mismatch', 'digest-mismatch'],
  ] as const)('maps provider %s to %s', async (code, status) => {
    const fixture = await createVerifierFixture({
      claimReadError: new DeliveryEvidenceError(code, `${code} fixture`),
    })
    try {
      const verdict = await start(
        fixture.request,
        vi.fn(() => settledSubprocessHandle()),
      ).done
      expect(verdict.evidenceIntegrityFindings).toContainEqual({
        evidenceId: fixture.request.completionClaim.evidenceIds[0],
        required: true,
        status,
      })
    } finally {
      await fixture.cleanup()
    }
  })

  it.each([
    new DeliveryEvidenceError('read-failed', 'provider read failed'),
    new Error('unexpected read failure'),
  ])('classifies unreadable evidence as infrastructure failure', async (error) => {
    const fixture = await createVerifierFixture({ claimReadError: error })
    try {
      const spawn = vi.fn(() => settledSubprocessHandle())
      await expect(start(fixture.request, spawn).done).rejects.toEqual(
        expect.objectContaining({ code: 'execution' }),
      )
      expect(spawn).not.toHaveBeenCalled()
    } finally {
      await fixture.cleanup()
    }
  })

  it('detects same-length evidence byte corruption after a successful read', async () => {
    const fixture = await createVerifierFixture({
      claimReadData: new Uint8Array(CLAIM_EVIDENCE_BYTES.byteLength).fill(1),
    })
    try {
      const verdict = await start(
        fixture.request,
        vi.fn(() => settledSubprocessHandle()),
      ).done
      expect(verdict.evidenceIntegrityFindings).toContainEqual({
        evidenceId: fixture.request.completionClaim.evidenceIds[0],
        required: true,
        status: 'digest-mismatch',
      })
    } finally {
      await fixture.cleanup()
    }
  })

  it('marks a resolver response for another evidence id as mismatched', async () => {
    const fixture = await createVerifierFixture()
    const signal = new AbortController().signal
    const original = await fixture.request.resolveEvidence(CLAIM_EVIDENCE_ID, signal)
    if (original === undefined) throw new Error('fixture claim evidence must resolve')
    const wrongRef = {
      ...original,
      id: EvidenceId('another-resolved-evidence'),
    }
    const read = vi.fn(fixture.request.readEvidence)
    const request: DeliveryVerificationRunRequest = {
      ...fixture.request,
      resolveEvidence: async () => wrongRef,
      readEvidence: read,
    }
    try {
      const verdict = await start(
        request,
        vi.fn(() => settledSubprocessHandle()),
      ).done
      expect(verdict.evidenceIntegrityFindings).toContainEqual({
        evidenceId: CLAIM_EVIDENCE_ID,
        required: true,
        status: 'digest-mismatch',
      })
      expect(read).not.toHaveBeenCalled()
    } finally {
      await fixture.cleanup()
    }
  })

  it('classifies pre-workspace provider failures without process or cleanup side effects', async () => {
    const fixture = await createVerifierFixture()
    const cases: readonly DeliveryVerificationRunRequest[] = [
      {
        ...fixture.request,
        resolveEvidence: async () => { throw new Error('resolve failed') },
      },
      {
        ...fixture.request,
        inspectRange: async () => { throw new Error('range failed') },
      },
      {
        ...fixture.request,
        openWorkspace: async () => { throw new Error('open failed') },
      },
    ]
    try {
      for (const request of cases) {
        const spawn = vi.fn(() => settledSubprocessHandle())
        await expect(start(request, spawn).done).rejects.toEqual(
          expect.objectContaining({ code: 'execution' }),
        )
        expect(spawn).not.toHaveBeenCalled()
      }
      expect(fixture.close).not.toHaveBeenCalled()
    } finally {
      await fixture.cleanup()
    }
  })

  it('fails every required claim evidence object with mismatched attempt provenance', async () => {
    const fixture = await createVerifierFixture()
    const wrongId = EvidenceId('wrong-provenance-evidence')
    const wrongData = new TextEncoder().encode('wrong provenance evidence\n')
    const wrongRef = evidenceRefSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id: wrongId,
      kind: 'log',
      mediaType: 'text/plain',
      uri: 'memory://delivery-verifier/wrong-provenance',
      byteLength: wrongData.byteLength,
      digest: evidenceBytesDigest(wrongData),
      createdAt: '2026-08-29T00:00:00.000Z',
      provenance: {
        kind: 'verification-check',
        packetId: PACKET_ID,
        queueWorkId: QueueWorkIdRef('wrong-provenance-work'),
        queueAttemptId: QueueAttemptIdRef('wrong-provenance-attempt'),
        checkId: VerificationCheckId('wrong-provenance-check'),
      },
    })
    const originalResolve = fixture.request.resolveEvidence
    const originalRead = fixture.request.readEvidence
    const request: DeliveryVerificationRunRequest = {
      ...fixture.request,
      completionClaim: {
        ...fixture.request.completionClaim,
        evidenceIds: [...fixture.request.completionClaim.evidenceIds, wrongId],
      },
      resolveEvidence: (id, signal) => id === wrongId
        ? Promise.resolve(wrongRef)
        : originalResolve(id, signal),
      readEvidence: (ref, signal) => ref.id === wrongId
        ? Promise.resolve({ ref: wrongRef, data: wrongData })
        : originalRead(ref, signal),
    }
    try {
      const verdict = await start(
        request,
        vi.fn(() => settledSubprocessHandle()),
      ).done
      expect(verdict.status).toBe('failed')
      expect(verdict.reviewReasons).toContain(
        `completion evidence '${wrongId}' does not match its producing change Attempt`,
      )
    } finally {
      await fixture.cleanup()
    }
  })

  it('preserves typed cancellation while a pre-workspace provider call is pending', async () => {
    const fixture = await createVerifierFixture()
    let markResolving: () => void = () => {}
    const resolving = new Promise<void>((resolve) => { markResolving = resolve })
    const request: DeliveryVerificationRunRequest = {
      ...fixture.request,
      resolveEvidence: async (_id, signal) => await new Promise<EvidenceRef | undefined>((_resolve, reject) => {
        markResolving()
        const onAbort = () => {
          reject(signal.reason instanceof Error
            ? signal.reason
            : new Error('provider read canceled'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
      }),
    }
    try {
      const spawn = vi.fn(() => settledSubprocessHandle())
      const run = start(request, spawn)
      await resolving
      await run.cancel('cancel provider read')
      await expect(run.done).rejects.toEqual(expect.objectContaining({
        code: 'canceled',
      }))
      expect(spawn).not.toHaveBeenCalled()
      expect(fixture.close).not.toHaveBeenCalled()
    } finally {
      await fixture.cleanup()
    }
  })

  it('stops before reading bytes when cancellation races a successful evidence resolution', async () => {
    const fixture = await createVerifierFixture()
    const controller = new AbortController()
    const resolveEvidence = fixture.request.resolveEvidence
    const readEvidence = vi.fn(fixture.request.readEvidence)
    const request: DeliveryVerificationRunRequest = {
      ...fixture.request,
      resolveEvidence: async (id, signal) => {
        const reference = await resolveEvidence(id, signal)
        controller.abort(new Error('cancel after evidence resolution'))
        return reference
      },
      readEvidence,
    }
    try {
      const spawn = vi.fn(() => settledSubprocessHandle())
      await expect(start(request, spawn, controller.signal).done)
        .rejects.toEqual(expect.objectContaining({ code: 'canceled' }))
      expect(readEvidence).not.toHaveBeenCalled()
      expect(spawn).not.toHaveBeenCalled()
      expect(fixture.close).not.toHaveBeenCalled()
    } finally {
      await fixture.cleanup()
    }
  })

  it('preserves typed cancellation while evidence bytes are being read', async () => {
    const fixture = await createVerifierFixture()
    let markReading: () => void = () => {}
    const reading = new Promise<void>((resolve) => { markReading = resolve })
    const request: DeliveryVerificationRunRequest = {
      ...fixture.request,
      readEvidence: async (_ref, signal) => await new Promise<never>((_resolve, reject) => {
        markReading()
        const onAbort = () => {
          reject(signal.reason instanceof Error
            ? signal.reason
            : new Error('evidence read canceled'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
      }),
    }
    try {
      const spawn = vi.fn(() => settledSubprocessHandle())
      const run = start(request, spawn)
      await reading
      await run.cancel('cancel evidence read')
      await expect(run.done).rejects.toEqual(expect.objectContaining({
        code: 'canceled',
      }))
      expect(spawn).not.toHaveBeenCalled()
      expect(fixture.close).not.toHaveBeenCalled()
    } finally {
      await fixture.cleanup()
    }
  })

  it('stops before range inspection when cancellation races a successful evidence read', async () => {
    const fixture = await createVerifierFixture()
    const controller = new AbortController()
    const readEvidence = fixture.request.readEvidence
    const inspectRange = vi.fn(fixture.request.inspectRange)
    const request: DeliveryVerificationRunRequest = {
      ...fixture.request,
      readEvidence: async (reference, signal) => {
        const stored = await readEvidence(reference, signal)
        controller.abort(new Error('cancel after evidence read'))
        return stored
      },
      inspectRange,
    }
    try {
      const spawn = vi.fn(() => settledSubprocessHandle())
      await expect(start(request, spawn, controller.signal).done)
        .rejects.toEqual(expect.objectContaining({ code: 'canceled' }))
      expect(inspectRange).not.toHaveBeenCalled()
      expect(spawn).not.toHaveBeenCalled()
      expect(fixture.close).not.toHaveBeenCalled()
    } finally {
      await fixture.cleanup()
    }
  })

  it('stops before opening a workspace when cancellation races successful range inspection', async () => {
    const fixture = await createVerifierFixture()
    const controller = new AbortController()
    const inspectRange = fixture.request.inspectRange
    const openWorkspace = vi.fn(fixture.request.openWorkspace)
    const request: DeliveryVerificationRunRequest = {
      ...fixture.request,
      inspectRange: async (signal) => {
        const range = await inspectRange(signal)
        controller.abort(new Error('cancel after range inspection'))
        return range
      },
      openWorkspace,
    }
    try {
      const spawn = vi.fn(() => settledSubprocessHandle())
      await expect(start(request, spawn, controller.signal).done)
        .rejects.toEqual(expect.objectContaining({ code: 'canceled' }))
      expect(openWorkspace).not.toHaveBeenCalled()
      expect(spawn).not.toHaveBeenCalled()
      expect(fixture.close).not.toHaveBeenCalled()
    } finally {
      await fixture.cleanup()
    }
  })
})

describe('delivery verifier filesystem and process failures', () => {
  it.each(['missing', 'file'] as const)('rejects a %s verification cwd', async (kind) => {
    const cwd = RepositoryRelativePath(`${kind}-cwd`)
    const fixture = await createVerifierFixture({ check: { cwd } })
    try {
      if (kind === 'file') {
        await writeFile(join(fixture.workspaceRoot, cwd), 'not a directory')
      }
      const spawn = vi.fn(() => settledSubprocessHandle())
      await expect(start(fixture.request, spawn).done).rejects.toEqual(
        expect.objectContaining({ code: 'workspace-boundary' }),
      )
      expect(spawn).not.toHaveBeenCalled()
      expect(fixture.close).toHaveBeenCalledWith('remove')
    } finally {
      await fixture.cleanup()
    }
  })

  it('allows a physical repository-relative subdirectory', async () => {
    const cwd = RepositoryRelativePath('checks/focused')
    const fixture = await createVerifierFixture({ check: { cwd } })
    try {
      await mkdir(join(fixture.workspaceRoot, cwd), { recursive: true })
      let spawnedCwd = ''
      const spawn = vi.fn((spec: SubprocessSpawnSpec) => {
        spawnedCwd = spec.cwd
        return settledSubprocessHandle()
      })
      await expect(start(fixture.request, spawn).done).resolves.toMatchObject({
        status: 'passed',
      })
      const physicalWorkspaceRoot = await realpath(fixture.workspaceRoot)
      const physicalCwd = await realpath(spawnedCwd)
      expect(physicalCwd).toBe(await realpath(join(fixture.workspaceRoot, cwd)))
      expect(relative(physicalWorkspaceRoot, physicalCwd)).toBe(join('checks', 'focused'))
    } finally {
      await fixture.cleanup()
    }
  })

  it('rejects an unclassified signal exit', async () => {
    const fixture = await createVerifierFixture()
    try {
      await expect(start(
        fixture.request,
        vi.fn(() => settledSubprocessHandle({ exitCode: null, signal: 'SIGTERM' })),
      ).done).rejects.toEqual(expect.objectContaining({ code: 'execution' }))
      expect(fixture.close).toHaveBeenCalledWith('remove')
    } finally {
      await fixture.cleanup()
    }
  })

  it('classifies process-handle and process-tree observation failures', async () => {
    const fixture = await createVerifierFixture()
    try {
      const failedDone = Promise.reject(new Error('handle failed'))
      void failedDone.catch(() => undefined)
      const rejectedDone = {
        ...settledSubprocessHandle(),
        done: failedDone,
      }
      await expect(start(
        fixture.request,
        vi.fn(() => rejectedDone),
      ).done).rejects.toEqual(expect.objectContaining({ code: 'execution' }))
      expect(fixture.close).toHaveBeenNthCalledWith(1, 'remove')

      const rejectedWait = {
        ...settledSubprocessHandle(),
        waitForExit: vi.fn().mockRejectedValue(new Error('tree wait failed')),
      }
      await expect(start(
        fixture.request,
        vi.fn(() => rejectedWait),
      ).done).rejects.toEqual(expect.objectContaining({ code: 'execution' }))
      expect(fixture.close).toHaveBeenLastCalledWith('preserve')
    } finally {
      await fixture.cleanup()
    }
  })

  it('classifies collected-output and output-publication failures', async () => {
    const outputFixture = await createVerifierFixture()
    const saveFixture = await createVerifierFixture()
    const invalidRefFixture = await createVerifierFixture()
    try {
      const base = settledSubprocessHandle()
      const unreadableOutput = {
        ...base,
        collected: {
          ...base.collected,
          stdout: { readFrom: () => { throw new Error('output read failed') } },
        },
      }
      await expect(start(
        outputFixture.request,
        vi.fn(() => unreadableOutput),
      ).done).rejects.toEqual(expect.objectContaining({ code: 'execution' }))

      const saveRequest: DeliveryVerificationRunRequest = {
        ...saveFixture.request,
        evidenceFor: () => ({
          save: async () => { throw new Error('save failed') },
        }),
      }
      await expect(start(
        saveRequest,
        vi.fn(() => settledSubprocessHandle()),
      ).done).rejects.toEqual(expect.objectContaining({ code: 'execution' }))

      const originalEvidenceFor = invalidRefFixture.request.evidenceFor
      const invalidRefRequest: DeliveryVerificationRunRequest = {
        ...invalidRefFixture.request,
        evidenceFor: checkId => ({
          async save(input, signal): Promise<EvidenceRef> {
            const ref = await originalEvidenceFor(checkId).save(input, signal)
            return { ...ref, id: '' as never }
          },
        }),
      }
      await expect(start(
        invalidRefRequest,
        vi.fn(() => settledSubprocessHandle()),
      ).done).rejects.toEqual(expect.objectContaining({ code: 'execution' }))
    } finally {
      await outputFixture.cleanup()
      await saveFixture.cleanup()
      await invalidRefFixture.cleanup()
    }
  })

  it('rejects an output writer that reuses an existing verdict evidence id', async () => {
    const fixture = await createVerifierFixture()
    const originalEvidenceFor = fixture.request.evidenceFor
    const request: DeliveryVerificationRunRequest = {
      ...fixture.request,
      evidenceFor: checkId => ({
        async save(input, signal): Promise<EvidenceRef> {
          const ref = await originalEvidenceFor(checkId).save(input, signal)
          return { ...ref, id: CLAIM_EVIDENCE_ID }
        },
      }),
    }
    try {
      await expect(start(
        request,
        vi.fn(() => settledSubprocessHandle()),
      ).done).rejects.toEqual(expect.objectContaining({ code: 'execution' }))
      expect(fixture.close).toHaveBeenCalledWith('remove')
    } finally {
      await fixture.cleanup()
    }
  })

  it('records non-descendant ancestry as a failed verdict', async () => {
    const fixture = await createVerifierFixture({
      range: { descendsFromBase: false },
    })
    try {
      const verdict = await start(
        fixture.request,
        vi.fn(() => settledSubprocessHandle()),
      ).done
      expect(verdict).toMatchObject({
        status: 'failed',
        ancestryResult: 'not-descendant',
      })
    } finally {
      await fixture.cleanup()
    }
  })

  it('reports cleanup failure together with an earlier execution failure', async () => {
    const fixture = await createVerifierFixture({
      closeError: new Error('cleanup failed'),
    })
    try {
      const outcome = start(fixture.request, vi.fn(() => {
        throw new Error('spawn failed')
      })).done
      await expect(outcome).rejects.toEqual(expect.objectContaining({ code: 'cleanup' }))
      const error: unknown = await outcome.catch((cause: unknown) => cause)
      expect(error).toBeInstanceOf(DeliveryVerifierError)
      if (!(error instanceof DeliveryVerifierError)) throw new Error('expected typed cleanup failure')
      expect(error.cause).toBeInstanceOf(AggregateError)
    } finally {
      await fixture.cleanup()
    }
  })

  it('normalizes a non-Error provider rejection and still closes its lease', async () => {
    const fixture = await createVerifierFixture()
    const originalOpenWorkspace = fixture.request.openWorkspace
    const request: DeliveryVerificationRunRequest = {
      ...fixture.request,
      async openWorkspace(signal) {
        const lease = await originalOpenWorkspace(signal)
        return new Proxy(lease, {
          get(target, property, receiver) {
            if (property === 'repositoryId') throw 'non-Error provider rejection'
            return Reflect.get(target, property, receiver) as unknown
          },
        })
      },
    }
    try {
      await expect(start(
        request,
        vi.fn(() => settledSubprocessHandle()),
      ).done).rejects.toEqual(expect.objectContaining({ code: 'execution' }))
      expect(fixture.close).toHaveBeenCalledWith('remove')
    } finally {
      await fixture.cleanup()
    }
  })

  it('uses the stable cancellation message for a blank operator reason', async () => {
    const fixture = await createVerifierFixture()
    const controlled = controlledSubprocessHandle({ exitCode: null, signal: 'SIGTERM' })
    try {
      let markSpawned: () => void = () => {}
      const spawned = new Promise<void>((resolve) => { markSpawned = resolve })
      const run = start(fixture.request, vi.fn(() => {
        markSpawned()
        return controlled.handle
      }))
      await spawned
      await run.cancel('  ')
      await expect(run.done).rejects.toMatchObject({
        code: 'canceled',
        message: 'verification was canceled',
      })
    } finally {
      controlled.complete()
      await fixture.cleanup()
    }
  })

  it('retains a signal outcome independently when a timed-out process exits by signal', async () => {
    vi.useFakeTimers()
    const fixture = await createVerifierFixture({ check: { timeoutMs: 25 } })
    const controlled = controlledSubprocessHandle({ exitCode: null, signal: 'SIGTERM' })
    try {
      let markSpawned: () => void = () => {}
      const spawned = new Promise<void>((resolve) => { markSpawned = resolve })
      const run = start(fixture.request, vi.fn(() => {
        markSpawned()
        return controlled.handle
      }))
      await spawned
      await vi.advanceTimersByTimeAsync(25)
      const verdict = await run.done
      expect(verdict.checkResults).toEqual([
        expect.objectContaining({ status: 'timed-out' }),
      ])
      expect(new TextDecoder().decode(fixture.saves[0]!.data)).toContain('exitCode=null')
      expect(new TextDecoder().decode(fixture.saves[0]!.data)).toContain('signal=SIGTERM')
    } finally {
      controlled.complete()
      vi.useRealTimers()
      await fixture.cleanup()
    }
  })

  it('classifies cancellation that races synchronous spawn failure', async () => {
    const fixture = await createVerifierFixture()
    const controller = new AbortController()
    try {
      const run = start(fixture.request, vi.fn(() => {
        controller.abort(new Error('cancel during spawn'))
        throw new Error('spawn observed cancellation')
      }), controller.signal)
      await expect(run.done).rejects.toEqual(expect.objectContaining({
        code: 'canceled',
      }))
      expect(fixture.close).toHaveBeenCalledWith('remove')
    } finally {
      await fixture.cleanup()
    }
  })

  it('terminates a handle returned after cancellation fires inside spawn', async () => {
    const fixture = await createVerifierFixture()
    const controller = new AbortController()
    const controlled = controlledSubprocessHandle({ exitCode: null, signal: 'SIGTERM' })
    try {
      const run = start(fixture.request, vi.fn(() => {
        controller.abort(new Error('cancel before spawn returns'))
        return controlled.handle
      }), controller.signal)
      await expect(run.done).rejects.toEqual(expect.objectContaining({
        code: 'canceled',
      }))
      expect(controlled.terminate).toHaveBeenCalledOnce()
      expect(fixture.close).toHaveBeenCalledWith('remove')
    } finally {
      controlled.complete()
      await fixture.cleanup()
    }
  })

  it('classifies a canceled handle rejection as cancellation', async () => {
    const fixture = await createVerifierFixture()
    const controller = new AbortController()
    let rejectDone: (error: Error) => void = () => {}
    const done = new Promise<never>((_resolve, reject) => { rejectDone = reject })
    const base = settledSubprocessHandle()
    const handle: SubprocessHandle = {
      ...base,
      done,
      terminate: vi.fn(() => { rejectDone(new Error('terminated handle')) }),
    }
    try {
      let markSpawned: () => void = () => {}
      const spawned = new Promise<void>((resolve) => { markSpawned = resolve })
      const run = start(fixture.request, vi.fn(() => {
        markSpawned()
        return handle
      }), controller.signal)
      await spawned
      controller.abort(new Error('cancel active handle'))
      await expect(run.done).rejects.toEqual(expect.objectContaining({
        code: 'canceled',
      }))
      expect(fixture.close).toHaveBeenCalledWith('remove')
    } finally {
      rejectDone(new Error('test cleanup'))
      await fixture.cleanup()
    }
  })

  it('classifies cancellation that reaches output evidence publication', async () => {
    const fixture = await createVerifierFixture()
    const controller = new AbortController()
    const request: DeliveryVerificationRunRequest = {
      ...fixture.request,
      evidenceFor: () => ({
        save: async () => {
          controller.abort(new Error('cancel output save'))
          throw new Error('save observed cancellation')
        },
      }),
    }
    try {
      await expect(start(
        request,
        vi.fn(() => settledSubprocessHandle()),
        controller.signal,
      ).done).rejects.toEqual(expect.objectContaining({ code: 'canceled' }))
      expect(fixture.close).toHaveBeenCalledWith('remove')
    } finally {
      await fixture.cleanup()
    }
  })

  it('rejects cancellation when an output writer resolves successfully after observing it', async () => {
    const fixture = await createVerifierFixture()
    const controller = new AbortController()
    const evidenceFor = fixture.request.evidenceFor
    const request: DeliveryVerificationRunRequest = {
      ...fixture.request,
      evidenceFor: (checkId) => {
        const writer = evidenceFor(checkId)
        return {
          save: async (input, signal) => {
            const reference = await writer.save(input, signal)
            controller.abort(new Error('cancel after output publication'))
            return reference
          },
        }
      },
    }
    try {
      await expect(start(
        request,
        vi.fn(() => settledSubprocessHandle()),
        controller.signal,
      ).done).rejects.toEqual(expect.objectContaining({ code: 'canceled' }))
      expect(fixture.close).toHaveBeenCalledWith('remove')
    } finally {
      await fixture.cleanup()
    }
  })

  it('rejects cancellation that arrives while successful lease cleanup is pending', async () => {
    const fixture = await createVerifierFixture()
    const controller = new AbortController()
    let markClosing: () => void = () => {}
    let finishClose: () => void = () => {}
    const closing = new Promise<void>((resolve) => { markClosing = resolve })
    const closeDone = new Promise<void>((resolve) => { finishClose = resolve })
    const openWorkspace = fixture.request.openWorkspace
    const close = vi.fn(async () => {
      markClosing()
      await closeDone
    })
    const request: DeliveryVerificationRunRequest = {
      ...fixture.request,
      openWorkspace: async signal => ({
        ...await openWorkspace(signal),
        close,
      }),
    }
    try {
      const run = start(
        request,
        vi.fn(() => settledSubprocessHandle()),
        controller.signal,
      )
      await closing
      controller.abort(new Error('cancel during cleanup'))
      finishClose()
      await expect(run.done).rejects.toEqual(expect.objectContaining({ code: 'canceled' }))
      expect(close).toHaveBeenCalledWith('remove')
    } finally {
      finishClose()
      await fixture.cleanup()
    }
  })

  it('preserves cancellation and a simultaneous cleanup failure', async () => {
    const fixture = await createVerifierFixture()
    let markClosing: () => void = () => {}
    let finishClose: () => void = () => {}
    const closing = new Promise<void>((resolve) => { markClosing = resolve })
    const closeDone = new Promise<void>((resolve) => { finishClose = resolve })
    const cleanupFailure = new Error('cleanup failed after cancellation')
    const openWorkspace = fixture.request.openWorkspace
    const close = vi.fn(async () => {
      markClosing()
      await closeDone
      throw cleanupFailure
    })
    const request: DeliveryVerificationRunRequest = {
      ...fixture.request,
      openWorkspace: async signal => ({
        ...await openWorkspace(signal),
        close,
      }),
    }
    try {
      const run = start(request, vi.fn(() => settledSubprocessHandle()))
      await closing
      const canceling = run.cancel('operator canceled during cleanup')
      finishClose()
      await canceling
      const error = await run.done.catch((reason: unknown) => reason)

      expect(error).toEqual(expect.objectContaining({ code: 'cleanup' }))
      expect((error as DeliveryVerifierError).cause).toBeInstanceOf(AggregateError)
      const causes = ((error as DeliveryVerifierError).cause as AggregateError).errors
      expect(causes).toHaveLength(2)
      expect(causes).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'canceled', message: 'operator canceled during cleanup' }),
        cleanupFailure,
      ]))
      expect(close).toHaveBeenCalledWith('remove')
    } finally {
      finishClose()
      await fixture.cleanup()
    }
  })

  it('preserves execution, cancellation, and cleanup failures independently', async () => {
    const fixture = await createVerifierFixture()
    let markClosing: () => void = () => {}
    let finishClose: () => void = () => {}
    const closing = new Promise<void>((resolve) => { markClosing = resolve })
    const closeDone = new Promise<void>((resolve) => { finishClose = resolve })
    const cleanupFailure = new Error('cleanup failed after execution')
    const openWorkspace = fixture.request.openWorkspace
    const close = vi.fn(async () => {
      markClosing()
      await closeDone
      throw cleanupFailure
    })
    const request: DeliveryVerificationRunRequest = {
      ...fixture.request,
      openWorkspace: async signal => ({
        ...await openWorkspace(signal),
        close,
      }),
    }
    try {
      const run = start(request, vi.fn(() => {
        throw new Error('spawn failed before cancellation')
      }))
      await closing
      const canceling = run.cancel('operator canceled after execution failed')
      finishClose()
      await canceling
      const error = await run.done.catch((reason: unknown) => reason)

      expect(error).toEqual(expect.objectContaining({ code: 'cleanup' }))
      expect((error as DeliveryVerifierError).cause).toBeInstanceOf(AggregateError)
      const causes = ((error as DeliveryVerifierError).cause as AggregateError).errors
      expect(causes).toHaveLength(3)
      expect(causes).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'execution' }),
        expect.objectContaining({ code: 'canceled', message: 'operator canceled after execution failed' }),
        cleanupFailure,
      ]))
      expect(close).toHaveBeenCalledWith('remove')
    } finally {
      finishClose()
      await fixture.cleanup()
    }
  })
})
