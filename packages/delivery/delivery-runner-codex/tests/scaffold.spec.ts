import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  GitCommitId,
  QueueAttemptIdRef,
  RepositoryId,
  WorkPacketId,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  QueueWorkIdRef,
} from '@deepseek-ai/dsh-delivery-protocol'
import {
  DeliveryCodexRunnerError,
  MAX_MODEL_OUTPUT_BYTES,
  createCodexChangeRunner,
} from '../src/index.ts'
import type { CodeChangeRunRequest } from '../src/index.ts'
import {
  CHECKPOINT_COMMIT,
  PACKET_ID,
  QUEUE_ATTEMPT_ID,
  QUEUE_WORK_ID,
  completeCodexTurn,
  completeCodexTurnWithoutOutput,
  completedEnvelope,
  failCodexTurn,
  fakeChild,
  nextTask,
  reachCodexTurn,
  requestHarness,
} from './harness.ts'

describe('delivery Codex runner', () => {
  it('requires both Queue identities in every operation-local request', () => {
    expectTypeOf<CodeChangeRunRequest['queueWorkId']>()
      .toEqualTypeOf<QueueWorkIdRef>()
    expectTypeOf<CodeChangeRunRequest['queueAttemptId']>()
      .toEqualTypeOf<QueueAttemptIdRef>()
  })

  it('returns a bound completion claim only after the explicit workspace child is quiescent', async () => {
    const child = fakeChild({ exitOnTerminate: false })
    const state = requestHarness()
    const spawn = vi.fn(() => child.handle)
    const start = createCodexChangeRunner({
      spawn,
      model: 'codex-test-model',
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })

    const run = start(
      state.request,
      new AbortController().signal,
    )
    expect(Object.keys(run).sort()).toEqual(['cancel', 'done'])
    expect(state.openWorkspace).not.toHaveBeenCalled()

    const turnStart = await Promise.race([
      reachCodexTurn(child),
      run.done.then(() => {
        throw new Error('runner settled before Codex startup')
      }),
    ])
    expect(state.openWorkspace).toHaveBeenCalledOnce()
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      cwd: state.lease.cwd,
    }))
    const turnStartJson = JSON.stringify(turnStart.params)
    expect(child.observed.threadStart).toMatchObject({
      params: {
        cwd: state.lease.cwd,
        model: 'codex-test-model',
      },
    })
    expect(turnStartJson).toContain(state.packet.objective)
    expect(turnStartJson).toContain(
      'Output retention is UTF-8 head retention: at most the first 65536 bytes',
    )
    expect(turnStartJson).not.toContain('delivery-worktrees')

    completeCodexTurn(child, turnStart, completedEnvelope())
    await nextTask()
    expect(child.terminate).toHaveBeenCalledOnce()
    expect(state.checkpoint).not.toHaveBeenCalled()

    child.settle({ exitCode: 0, signal: null })
    const claim = await run.done

    expect(child.waitForExit).toHaveBeenCalledOnce()
    expect(state.checkpoint).toHaveBeenCalledOnce()
    expect(state.save).toHaveBeenCalledTimes(2)
    expect(state.close).toHaveBeenCalledWith('remove')
    expect(claim).toEqual(expect.objectContaining({
      disposition: 'completed',
      packetId: PACKET_ID,
      queueWorkId: QUEUE_WORK_ID,
      queueAttemptId: QUEUE_ATTEMPT_ID,
      checkpointCommit: CHECKPOINT_COMMIT,
      summary: 'Implemented the bounded change.',
      completedWork: ['Updated the owned package.'],
      remainingWork: [],
      evidenceIds: ['evidence-1', 'evidence-2'],
    }))
    await expect(run.cancel('already complete')).resolves.toBeUndefined()
  })

  it.each([
    {
      envelope: {
        disposition: 'blocked',
        summary: 'A repository prerequisite is missing.',
        completedWork: ['Inspected the bounded package.'],
        remainingWork: ['Implement the requested change.'],
        blocker: 'The required generated input is absent.',
        nextSmallestAction: 'Provide the generated input.',
      },
      fields: {
        blocker: 'The required generated input is absent.',
        nextSmallestAction: 'Provide the generated input.',
      },
    },
    {
      envelope: {
        disposition: 'needs-decision',
        summary: 'One product choice remains unresolved.',
        completedWork: ['Inspected the bounded package.'],
        remainingWork: ['Implement the selected behavior.'],
        question: 'Which accepted behavior should be implemented?',
      },
      fields: {
        question: 'Which accepted behavior should be implemented?',
      },
    },
    {
      envelope: {
        disposition: 'needs-scope-change',
        summary: 'The requested outcome crosses the approved boundary.',
        completedWork: ['Confirmed the current package boundary.'],
        remainingWork: ['Change the dependency owner.'],
        proposedScopeDelta: 'Allow the dependency owner package.',
        reason: 'The requested behavior cannot be implemented locally.',
      },
      fields: {
        proposedScopeDelta: 'Allow the dependency owner package.',
        reason: 'The requested behavior cannot be implemented locally.',
      },
    },
  ])(
    'returns a truthful $envelope.disposition claim without inventing checkpoint facts',
    async ({ envelope, fields }) => {
      const child = fakeChild()
      const state = requestHarness()
      const start = createCodexChangeRunner({
        spawn: () => child.handle,
        permissionMode: 'never',
        env: {},
        disposeGraceMs: 5_000,
        modelOutputBytes: 64 * 1024,
      })
      const run = start(state.request, new AbortController().signal)
      const turnStart = await reachCodexTurn(child)

      completeCodexTurn(child, turnStart, JSON.stringify(envelope))
      const claim = await run.done

      expect(claim).toEqual(expect.objectContaining({
        disposition: envelope.disposition,
        summary: envelope.summary,
        completedWork: envelope.completedWork,
        remainingWork: envelope.remainingWork,
        checkpointCommit: null,
        changedPaths: [],
        ...fields,
      }))
      expect(state.checkpoint).not.toHaveBeenCalled()
      expect(state.save).toHaveBeenCalledOnce()
      expect(state.close).toHaveBeenCalledWith('preserve')
    },
  )

  it('surfaces process-tree cleanup failure to the cancellation caller', async () => {
    const child = fakeChild({
      waitForExitError: new Error('process tree ownership was lost'),
    })
    const state = requestHarness()
    const start = createCodexChangeRunner({
      spawn: () => child.handle,
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })
    const caller = new AbortController()
    const run = start(state.request, caller.signal)
    const turnStart = await reachCodexTurn(child)
    child.peer.respond(turnStart, { turn: { id: 'turn-1' } })
    await nextTask()

    const cancellation = run.cancel('operator canceled')
    await child.peer.nextMethod('turn/interrupt')

    await expect(cancellation).rejects.toEqual(expect.objectContaining({
      code: 'cleanup',
      name: 'DeliveryCodexRunnerError',
    }))
    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'cleanup',
      name: 'DeliveryCodexRunnerError',
    }))
    expect(state.close).toHaveBeenCalledWith('preserve')
  })

  it('distinguishes startup failure before a Codex run is published', async () => {
    const state = requestHarness()
    const start = createCodexChangeRunner({
      spawn: () => { throw new Error('codex executable is unavailable') },
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })

    const caller = new AbortController()
    const run = start(state.request, caller.signal)

    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'startup',
      name: 'DeliveryCodexRunnerError',
    }))
    expect(state.close).toHaveBeenCalledWith('remove')
  })

  it('distinguishes a published Codex product failure', async () => {
    const child = fakeChild()
    const state = requestHarness()
    const start = createCodexChangeRunner({
      spawn: () => child.handle,
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })
    const run = start(state.request, new AbortController().signal)
    const turnStart = await reachCodexTurn(child)

    failCodexTurn(child, turnStart)

    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'product',
      name: 'DeliveryCodexRunnerError',
      stopReason: 'error',
    }))
    expect(state.checkpoint).not.toHaveBeenCalled()
    expect(state.close).toHaveBeenCalledWith('preserve')
  })

  it('propagates caller cancellation and resolves cancel only after tree exit', async () => {
    const child = fakeChild({ exitOnTerminate: false })
    const state = requestHarness()
    const start = createCodexChangeRunner({
      spawn: () => child.handle,
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })
    const caller = new AbortController()
    const run = start(state.request, caller.signal)
    const turnStart = await reachCodexTurn(child)
    child.peer.respond(turnStart, { turn: { id: 'turn-1' } })
    await nextTask()

    let cancellationSettled = false
    const cancellation = run.cancel('operator canceled')
      .then(() => { cancellationSettled = true })
    await child.peer.nextMethod('turn/interrupt')
    caller.abort(new Error('duplicate caller cancellation'))
    await vi.waitFor(() => {
      expect(child.terminate).toHaveBeenCalledOnce()
    })
    expect(cancellationSettled).toBe(false)

    child.settle({ exitCode: null, signal: 'SIGTERM' })
    await cancellation
    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'canceled',
      name: 'DeliveryCodexRunnerError',
    }))
    expect(state.close).toHaveBeenCalledWith('preserve')
  })

  it('rejects a lease owned by another Attempt without touching it', async () => {
    const state = requestHarness({
      ownerAttemptId: 'attempt-2' as QueueAttemptIdRef,
    })
    const spawn = vi.fn()
    const start = createCodexChangeRunner({
      spawn,
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })

    const run = start(state.request, new AbortController().signal)

    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'ownership-lost',
      name: 'DeliveryCodexRunnerError',
    }))
    expect(spawn).not.toHaveBeenCalled()
    expect(state.close).not.toHaveBeenCalled()
  })

  it('rejects an incomplete bounded completion envelope', async () => {
    const child = fakeChild()
    const state = requestHarness()
    const start = createCodexChangeRunner({
      spawn: () => child.handle,
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 2,
    })
    const run = start(state.request, new AbortController().signal)
    const turnStart = await reachCodexTurn(child)

    completeCodexTurn(child, turnStart, `😀${completedEnvelope()}`)

    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'completion',
      name: 'DeliveryCodexRunnerError',
    }))
    await expect(run.done).rejects.toThrow(/retained head/u)
    expect(state.checkpoint).not.toHaveBeenCalled()
    expect(state.close).toHaveBeenCalledWith('preserve')
  })

  it('rejects mismatched durable request identities before workspace startup', async () => {
    const state = requestHarness()
    const start = createCodexChangeRunner({
      spawn: vi.fn(),
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })
    const request = {
      ...state.request,
      resolved: {
        ...state.resolved,
        packetId: WorkPacketId('another-packet'),
      },
    }

    const run = start(request, new AbortController().signal)

    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'invalid-request',
    }))
    expect(state.openWorkspace).not.toHaveBeenCalled()
  })

  it('honors a caller signal already canceled before live work starts', async () => {
    const state = requestHarness()
    const controller = new AbortController()
    controller.abort(new Error('already canceled'))
    const start = createCodexChangeRunner({
      spawn: vi.fn(),
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })

    const run = start(state.request, controller.signal)

    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'canceled',
    }))
    expect(state.openWorkspace).not.toHaveBeenCalled()
  })

  it('classifies workspace allocation failure as startup failure', async () => {
    const state = requestHarness({
      openWorkspaceError: new Error('worktree allocation failed'),
    })
    const start = createCodexChangeRunner({
      spawn: vi.fn(),
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })

    const run = start(state.request, new AbortController().signal)

    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'startup',
    }))
    expect(state.close).not.toHaveBeenCalled()
  })

  it('rejects a lease for another repository without starting Codex', async () => {
    const state = requestHarness({
      leaseRepositoryId: RepositoryId('another-repository'),
    })
    const spawn = vi.fn()
    const start = createCodexChangeRunner({
      spawn,
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })

    const run = start(state.request, new AbortController().signal)

    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'ownership-lost',
    }))
    expect(spawn).not.toHaveBeenCalled()
    expect(state.close).toHaveBeenCalledWith('remove')
  })

  it('preserves the selected transport product error when no final text exists', async () => {
    const child = fakeChild()
    const state = requestHarness()
    const start = createCodexChangeRunner({
      spawn: () => child.handle,
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })
    const run = start(state.request, new AbortController().signal)
    const turnStart = await reachCodexTurn(child)

    completeCodexTurnWithoutOutput(child, turnStart)

    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'product',
      stopReason: 'error',
    }))
    expect(state.close).toHaveBeenCalledWith('preserve')
  })

  it.each([
    'not-json',
    JSON.stringify({
      disposition: 'completed',
      summary: '',
      completedWork: [],
      remainingWork: [],
    }),
    JSON.stringify({
      disposition: 'completed',
      summary: 'Done.',
      completedWork: [],
      remainingWork: [],
      unexpected: true,
    }),
    JSON.stringify({
      disposition: 'blocked',
      summary: 'Blocked.',
      completedWork: [],
      remainingWork: [],
      blocker: 'Missing input.',
    }),
    JSON.stringify({
      disposition: 'needs-decision',
      summary: 'Decision needed.',
      completedWork: [],
      remainingWork: [],
      question: '',
    }),
    JSON.stringify({
      disposition: 'needs-scope-change',
      summary: 'Scope change needed.',
      completedWork: [],
      remainingWork: [],
      proposedScopeDelta: '',
      reason: 'Dependency ownership.',
    }),
  ])('rejects malformed completion envelope %s', async (envelope) => {
    const child = fakeChild()
    const state = requestHarness()
    const start = createCodexChangeRunner({
      spawn: () => child.handle,
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })
    const run = start(state.request, new AbortController().signal)
    const turnStart = await reachCodexTurn(child)

    completeCodexTurn(child, turnStart, envelope)

    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'completion',
    }))
    expect(state.close).toHaveBeenCalledWith('preserve')
  })

  it('rejects checkpoint failure after Codex process-tree quiescence', async () => {
    const child = fakeChild()
    const state = requestHarness({
      checkpoint: new Error('git checkpoint failed'),
    })
    const start = createCodexChangeRunner({
      spawn: () => child.handle,
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })
    const run = start(state.request, new AbortController().signal)
    const turnStart = await reachCodexTurn(child)

    completeCodexTurn(child, turnStart, completedEnvelope())

    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'completion',
    }))
    expect(state.close).toHaveBeenCalledWith('preserve')
  })

  it('rejects checkpoint facts for another Packet base', async () => {
    const child = fakeChild()
    const state = requestHarness({
      checkpoint: {
        repositoryId: RepositoryId('repository-1'),
        baseCommit: GitCommitId('3'.repeat(40)),
        checkpointCommit: GitCommitId('4'.repeat(40)),
        changedPaths: [],
        clean: true,
        descendsFromBase: true,
      },
    })
    const start = createCodexChangeRunner({
      spawn: () => child.handle,
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })
    const run = start(state.request, new AbortController().signal)
    const turnStart = await reachCodexTurn(child)

    completeCodexTurn(child, turnStart, completedEnvelope())

    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'ownership-lost',
    }))
    expect(state.close).toHaveBeenCalledWith('preserve')
  })

  it('rejects evidence published under another Attempt', async () => {
    const child = fakeChild()
    const state = requestHarness({
      evidenceProvenance: {
        kind: 'change-attempt',
        packetId: PACKET_ID,
        queueWorkId: QUEUE_WORK_ID,
        queueAttemptId: QueueAttemptIdRef('another-attempt'),
      },
    })
    const start = createCodexChangeRunner({
      spawn: () => child.handle,
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })
    const run = start(state.request, new AbortController().signal)
    const turnStart = await reachCodexTurn(child)

    completeCodexTurn(child, turnStart, completedEnvelope())

    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'ownership-lost',
    }))
    expect(state.close).toHaveBeenCalledWith('preserve')
  })

  it('classifies evidence publication failure as completion failure', async () => {
    const child = fakeChild()
    const state = requestHarness({
      saveError: new Error('evidence store failed'),
    })
    const start = createCodexChangeRunner({
      spawn: () => child.handle,
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })
    const run = start(state.request, new AbortController().signal)
    const turnStart = await reachCodexTurn(child)

    completeCodexTurn(child, turnStart, completedEnvelope())

    const failure = await run.done.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(DeliveryCodexRunnerError)
    if (!(failure instanceof DeliveryCodexRunnerError)) {
      throw new Error('expected a DeliveryCodexRunnerError')
    }
    expect(failure.code).toBe('completion')
    expect(failure.cause).toEqual(expect.objectContaining({
      message: 'evidence store failed',
    }))
    expect(state.close).toHaveBeenCalledWith('preserve')
  })

  it('surfaces process-tree cleanup failure after Codex completion', async () => {
    const child = fakeChild({
      waitForExitError: new Error('process tree inspection failed'),
    })
    const state = requestHarness()
    const start = createCodexChangeRunner({
      spawn: () => child.handle,
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })
    const run = start(state.request, new AbortController().signal)
    const turnStart = await reachCodexTurn(child)

    completeCodexTurn(child, turnStart, completedEnvelope())

    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'cleanup',
    }))
    expect(state.checkpoint).not.toHaveBeenCalled()
    expect(state.close).toHaveBeenCalledWith('preserve')
  })

  it('surfaces lease cleanup failure after a non-completed claim', async () => {
    const child = fakeChild()
    const state = requestHarness({
      closeError: new Error('workspace preservation failed'),
    })
    const start = createCodexChangeRunner({
      spawn: () => child.handle,
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })
    const run = start(state.request, new AbortController().signal)
    const turnStart = await reachCodexTurn(child)
    const blocked = {
      disposition: 'blocked',
      summary: 'Blocked.',
      completedWork: [],
      remainingWork: ['Resume later.'],
      blocker: 'Missing input.',
      nextSmallestAction: 'Provide input.',
    }

    completeCodexTurn(child, turnStart, JSON.stringify(blocked))

    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'cleanup',
    }))
  })

  it('surfaces lease cleanup failure after a completed claim', async () => {
    const child = fakeChild()
    const state = requestHarness({
      closeError: new Error('workspace removal failed'),
    })
    const start = createCodexChangeRunner({
      spawn: () => child.handle,
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })
    const run = start(state.request, new AbortController().signal)
    const turnStart = await reachCodexTurn(child)

    completeCodexTurn(child, turnStart, completedEnvelope())

    await expect(run.done).rejects.toEqual(expect.objectContaining({
      code: 'cleanup',
    }))
  })

  it('retains both product and lease cleanup failures', async () => {
    const child = fakeChild()
    const state = requestHarness({
      closeError: new Error('workspace preservation failed'),
    })
    const start = createCodexChangeRunner({
      spawn: () => child.handle,
      permissionMode: 'never',
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    })
    const run = start(state.request, new AbortController().signal)
    const turnStart = await reachCodexTurn(child)

    failCodexTurn(child, turnStart)

    const failure = await run.done.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(DeliveryCodexRunnerError)
    if (!(failure instanceof DeliveryCodexRunnerError)) {
      throw new Error('expected a DeliveryCodexRunnerError')
    }
    expect(failure.code).toBe('cleanup')
    const aggregate = failure.cause
    expect(aggregate).toBeInstanceOf(AggregateError)
    if (!(aggregate instanceof AggregateError)) {
      throw new Error('expected an AggregateError cause')
    }
    const errors = aggregate.errors as unknown[]
    expect(errors[0]).toEqual(expect.objectContaining({
      code: 'product',
    }))
  })

  it('rejects timer and model-output budgets outside the frozen safe range', () => {
    const spawn = vi.fn()
    const valid = {
      spawn,
      permissionMode: 'never' as const,
      env: {},
      disposeGraceMs: 5_000,
      modelOutputBytes: 64 * 1024,
    }

    for (const disposeGraceMs of [0, 1.5, 2_147_483_648]) {
      expect(() => createCodexChangeRunner({
        ...valid,
        disposeGraceMs,
      })).toThrow(expect.objectContaining({ code: 'configuration' }))
    }
    for (const modelOutputBytes of [0, 1.5, MAX_MODEL_OUTPUT_BYTES + 1]) {
      expect(() => createCodexChangeRunner({
        ...valid,
        modelOutputBytes,
      })).toThrow(expect.objectContaining({ code: 'configuration' }))
    }
  })
})
