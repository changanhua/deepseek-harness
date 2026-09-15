import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { AttemptId, createVerifiedAgentAuthority, createVerifiedOperatorAuthority, digestIntent, WorkId } from '@changanhua/dsh-task-queue'
import type { BatchRequest, WorkHandler } from '@changanhua/dsh-task-queue'
import LocalTaskQueue, { WorkQueueStore } from '../src/index.ts'

const AT = '2026-08-26T00:00:00.000Z'

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('scheduler did not settle')
}

function admittedWork(id: string, prompt: string) {
  const intent = { prompt }
  return {
    id: WorkId(id), kind: 'test@1' as never, title: prompt, intent,
    intentDigest: digestIntent(intent), resolved: { prompt } as never,
    policy: { maxAttempts: 1 }, resources: [], tags: [], batchId: null, ownerSessionId: 'session-1', createdAt: AT,
  }
}

async function appendAdmission(store: WorkQueueStore, seq: number, work: ReturnType<typeof admittedWork>): Promise<void> {
  await store.transaction(() => store.append({
    seq, changeId: `admitted-${seq}`, at: AT,
    events: [
      { type: 'work/admitted', work },
      { type: 'receipt/recorded', receipt: { owner: { type: 'agent', sessionId: 'session-1' }, source: 'test', key: `key-${seq}`, intentDigest: work.intentDigest, workIds: [work.id], batchId: null, createdAt: AT } },
    ],
  }))
}

describe('LocalTaskQueue v2 scheduler', () => {
  it('admits idempotent ownerless single and Batch work through the trusted operator facade', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-operator-admission-'))
    const queueContext = new Context()
    try {
      const queue = new LocalTaskQueue(queueContext, { queueRoot: root, maxConcurrent: 3 })
      let admissionCalls = 0
      queue.registerHandler({
        kind: 'test@1' as never,
        async resolveAdmission(input) { admissionCalls += 1; return input as never },
        resources() { return [] },
        policy() { return { maxAttempts: 1 } },
        async prepare(resolved) { return resolved },
        start() { return { done: Promise.resolve({ status: 'succeeded' as const, output: { ok: true } as never }), async cancel() {} } },
      })
      const operator = queue.forOperator(createVerifiedOperatorAuthority())
      const single = {
        kind: 'test@1' as never,
        title: 'operator single',
        input: { prompt: 'single' },
        idempotencyKey: 'operator-single',
      }
      const [firstId, repeatedId] = await Promise.all([operator.enqueue(single as never), operator.enqueue(single as never)])
      expect(repeatedId).toBe(firstId)
      expect(await operator.enqueue(single as never)).toBe(firstId)
      await expect(operator.enqueue({ ...single, input: { prompt: 'changed' } })).rejects.toThrow(/idempotency conflict/)

      const batch = {
        kind: 'test@1' as never,
        items: [
          { title: 'operator batch one', input: { prompt: 'batch-one' } },
          { title: 'operator batch two', input: { prompt: 'batch-two' } },
        ],
        sharedPayload: { source: 'host' },
        idempotencyKey: 'operator-batch',
        maxParallel: 2,
      }
      const [firstBatchId, repeatedBatchId] = await Promise.all([
        operator.enqueueBatch(batch as never),
        operator.enqueueBatch(batch as never),
      ])
      expect(repeatedBatchId).toBe(firstBatchId)
      expect(await operator.enqueueBatch(batch as never)).toBe(firstBatchId)
      await waitFor(() => operator.list().length === 3 && operator.list().every(view => view.state.status === 'succeeded'))

      const internals = queue as unknown as { store: WorkQueueStore }
      expect(operator.get(firstId).work).toMatchObject({ ownerSessionId: null, batchId: null })
      expect(operator.list().filter(view => view.work.batchId === firstBatchId)).toHaveLength(2)
      expect(operator.list().every(view => view.work.ownerSessionId === null)).toBe(true)
      expect([...internals.store.current().receiptsByKey.values()]).toEqual(expect.arrayContaining([
        expect.objectContaining({ owner: { type: 'operator' }, source: 'operator', key: 'operator-single', workIds: [firstId], batchId: null }),
        expect.objectContaining({ owner: { type: 'operator' }, source: 'operator', key: 'operator-batch', batchId: firstBatchId }),
      ]))
      expect(internals.store.current().notificationsById.size).toBe(0)
      expect(admissionCalls).toBe(3)
    } finally {
      await queueContext.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses an Agent facade access to a different session owner\'s WorkItem', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-scheduler-'))
    try {
      const authorityContext = new Context()
      await authorityContext.plugin(SessionStore)
      const owner = authorityContext.sessions.create(SessionId('owner'))
      const other = authorityContext.sessions.create(SessionId('other'))
      const queue = new LocalTaskQueue(new Context(), { queueRoot: root })
      const internals = queue as unknown as { ready: Promise<void>; store: WorkQueueStore }
      await internals.ready
      const intent = { prompt: 'run' }
      const work = {
        id: WorkId('owned-work'), kind: 'test@1' as never, title: 'run', intent,
        intentDigest: digestIntent(intent), resolved: { resolved: true } as never,
        policy: { maxAttempts: 1 }, resources: [], tags: [], batchId: null, ownerSessionId: owner.id, createdAt: AT,
      }
      await internals.store.transaction(() => internals.store.append({
        seq: 1,
        changeId: 'admitted',
        at: AT,
        events: [
          { type: 'work/admitted', work },
          {
            type: 'receipt/recorded',
            receipt: {
              owner: { type: 'agent', sessionId: owner.id }, source: 'agent', key: 'key-1',
              intentDigest: work.intentDigest, workIds: [work.id], batchId: null, createdAt: AT,
            },
          },
        ],
      }))

      expect(queue.forAgent(createVerifiedAgentAuthority(owner)).get(work.id).work.id).toBe(work.id)
      expect(() => queue.forAgent(createVerifiedAgentAuthority(other)).get(work.id)).toThrow(/not owned by this Agent session/)
      const ownerQueue = queue.forAgent(createVerifiedAgentAuthority(owner))
      const otherQueue = queue.forAgent(createVerifiedAgentAuthority(other))
      expect(ownerQueue.list().map(view => view.work.id)).toEqual([work.id])
      expect(otherQueue.list()).toEqual([])
      const operatorQueue = queue.forOperator(createVerifiedOperatorAuthority())
      expect(operatorQueue.list().map(view => view.work.id)).toEqual([work.id])
      await authorityContext.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('claims, prepares, starts, and persists a successful handler result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-scheduler-'))
    try {
      const queue = new LocalTaskQueue(new Context(), { queueRoot: root, maxConcurrent: 2 })
      const internals = queue as unknown as { store: WorkQueueStore; pump(): Promise<void> }
      const handler: WorkHandler<never> = {
        kind: 'test@1' as never,
        async resolveAdmission() { return { resolved: true } },
        resources() { return [] },
        policy() { return { maxAttempts: 1 } },
        async prepare() { return { prepared: true } },
        start() { return { done: Promise.resolve({ status: 'succeeded' as const, output: { ok: true } as never }), async cancel() {} } },
      }
      queue.registerHandler(handler)
      const intent = { prompt: 'run' }
      const work = { id: WorkId('work-1'), kind: 'test@1' as never, title: 'run', intent, intentDigest: digestIntent(intent), resolved: { resolved: true } as never, policy: { maxAttempts: 1 }, resources: [], tags: [], batchId: null, ownerSessionId: 'session-1', createdAt: AT }
      await internals.store.transaction(() => internals.store.append({ seq: 1, changeId: 'admitted', at: AT, events: [{ type: 'work/admitted', work }, { type: 'receipt/recorded', receipt: { owner: { type: 'agent', sessionId: 'session-1' }, source: 'agent', key: 'key-1', intentDigest: work.intentDigest, workIds: [work.id], batchId: null, createdAt: AT } }] }))
      await internals.pump()
      await waitFor(() => internals.store.current().statesByWorkId.get(work.id)?.status === 'succeeded')
      expect(internals.store.current().resultsById.size).toBe(1)
      const notification = [...internals.store.current().notificationsById.values()][0]
      expect(notification).toMatchObject({
        workId: work.id,
        ownerSessionId: 'session-1',
        status: 'pending',
      })
      expect(typeof notification?.resultId).toBe('string')
      expect(notification?.messageId).toBe(`task-queue-notification:${notification?.id}`)
      expect(notification?.terminalSeq).toBe(internals.store.current().lastSeq)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('creates pending Attention with a handler-reported unknown attempt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-scheduler-'))
    try {
      const queue = new LocalTaskQueue(new Context(), { queueRoot: root })
      const internals = queue as unknown as { store: WorkQueueStore; pump(): Promise<void> }
      const work = admittedWork('unknown-work', 'unknown')
      queue.registerHandler({
        kind: 'test@1' as never, async resolveAdmission() { return { resolved: true } }, resources() { return [] }, policy() { return { maxAttempts: 1 } },
        async prepare(resolved) { return resolved }, start() { return { done: Promise.resolve({ status: 'unknown' as const, failure: { category: 'lost', sideEffect: 'unknown' as const, retriable: false, message: 'lost ownership' } }), async cancel() {} } },
      })
      await appendAdmission(internals.store, 1, work)
      await internals.pump()
      await waitFor(() => internals.store.current().statesByWorkId.get(work.id)?.status === 'unknown')
      expect(internals.store.current().attentionsById.size).toBe(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('never treats a rejected LiveAttempt as a safe pre-start retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-live-rejection-'))
    const queueContext = new Context()
    try {
      const queue = new LocalTaskQueue(queueContext, { queueRoot: root })
      const internals = queue as unknown as { ready: Promise<void>; store: WorkQueueStore; pump(): Promise<void> }
      await internals.ready
      const work = { ...admittedWork('live-rejection-work', 'live rejection'), policy: { maxAttempts: 2 } }
      await appendAdmission(internals.store, 1, work)
      const attemptedEventTypes: string[] = []
      const originalAppend = internals.store.append.bind(internals.store)
      vi.spyOn(internals.store, 'append').mockImplementation(async (change) => {
        attemptedEventTypes.push(...change.events.map(event => event.type))
        return originalAppend(change)
      })
      const live = Promise.withResolvers<never>()
      void live.promise.catch(() => undefined)
      let starts = 0
      queue.registerHandler({
        kind: 'test@1' as never,
        async resolveAdmission(input) { return input as never },
        resources() { return [] },
        policy() { return { maxAttempts: 1 } },
        async prepare(resolved) { return resolved },
        start() {
          starts += 1
          return {
            done: live.promise,
            async cancel() {},
          }
        },
      })
      await internals.pump()
      await waitFor(() => internals.store.current().statesByWorkId.get(work.id)?.status === 'running')
      live.reject(new Error('live settlement rejected'))
      await waitFor(() => internals.store.current().statesByWorkId.get(work.id)?.status === 'unknown')
      expect(internals.store.current().statesByWorkId.get(work.id)).toMatchObject({
        status: 'unknown',
        attemptCount: 1,
        failure: { category: 'live-attempt-rejected', sideEffect: 'unknown', retriable: false },
      })
      expect(internals.store.current().attentionsById.size).toBe(1)
      expect(starts).toBe(1)
      expect(attemptedEventTypes).not.toContain('attempt/failed')
      expect(attemptedEventTypes).not.toContain('work/auto-retry-authorized')
    } finally {
      vi.restoreAllMocks()
      await queueContext.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves a failed post-start terminal append as unknown without retrying', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-terminal-append-'))
    const queueContext = new Context()
    try {
      const queue = new LocalTaskQueue(queueContext, { queueRoot: root })
      const internals = queue as unknown as { ready: Promise<void>; store: WorkQueueStore; pump(): Promise<void> }
      await internals.ready
      const work = { ...admittedWork('terminal-append-work', 'terminal append'), policy: { maxAttempts: 2 } }
      await appendAdmission(internals.store, 1, work)
      const attemptedEventTypes: string[] = []
      const originalAppend = internals.store.append.bind(internals.store)
      let injected = false
      vi.spyOn(internals.store, 'append').mockImplementation(async (change) => {
        attemptedEventTypes.push(...change.events.map(event => event.type))
        if (!injected && change.events.some(event => event.type === 'attempt/succeeded')) {
          injected = true
          throw new Error('injected terminal append failure')
        }
        return originalAppend(change)
      })
      let starts = 0
      queue.registerHandler({
        kind: 'test@1' as never,
        async resolveAdmission(input) { return input as never },
        resources() { return [] },
        policy() { return { maxAttempts: 1 } },
        async prepare(resolved) { return resolved },
        start() {
          starts += 1
          return {
            done: Promise.resolve({ status: 'succeeded' as const, output: { ok: true } as never }),
            async cancel() {},
          }
        },
      })
      await internals.pump()
      await waitFor(() => internals.store.current().statesByWorkId.get(work.id)?.status === 'unknown')
      expect(internals.store.current().statesByWorkId.get(work.id)).toMatchObject({
        status: 'unknown',
        attemptCount: 1,
        failure: { category: 'post-start-settlement', sideEffect: 'unknown', retriable: false },
      })
      expect(internals.store.current().attentionsById.size).toBe(1)
      expect(starts).toBe(1)
      expect(attemptedEventTypes).not.toContain('attempt/failed')
      expect(attemptedEventTypes).not.toContain('work/auto-retry-authorized')
    } finally {
      vi.restoreAllMocks()
      await queueContext.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not retry after running and first unknown persistence both fail post-start', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-running-durability-'))
    const queueContext = new Context()
    let releaseQuiescence: (() => void) | undefined
    try {
      const queue = new LocalTaskQueue(queueContext, { queueRoot: root, shutdownTimeoutMs: 1_000 })
      const internals = queue as unknown as { ready: Promise<void>; store: WorkQueueStore; pump(): Promise<void> }
      await internals.ready
      const work = { ...admittedWork('running-durability-work', 'durability fault'), policy: { maxAttempts: 2 } }
      await appendAdmission(internals.store, 1, work)
      const order: string[] = []
      const attemptedEventTypes: string[] = []
      let cancelReason: string | undefined
      let handlerSignal: AbortSignal | undefined
      const quiescence = new Promise<void>((resolve) => { releaseQuiescence = resolve })
      const originalAppend = internals.store.append.bind(internals.store)
      let runningFailureInjected = false
      let unknownFailureInjected = false
      const append = vi.spyOn(internals.store, 'append').mockImplementation(async (change) => {
        attemptedEventTypes.push(...change.events.map(event => event.type))
        if (!runningFailureInjected && change.events.some(event => event.type === 'attempt/running')) {
          runningFailureInjected = true
          throw new Error('injected running append failure')
        }
        if (!unknownFailureInjected && change.events.some(event => event.type === 'attempt/unknown')) {
          unknownFailureInjected = true
          order.push('unknown-failed')
          throw new Error('injected first unknown append failure')
        }
        if (change.events.some(event => event.type === 'attempt/unknown')) order.push('unknown')
        return originalAppend(change)
      })
      queue.registerHandler({
        kind: 'test@1' as never,
        async resolveAdmission(input) { return input as never },
        resources() { return [] },
        policy() { return { maxAttempts: 1 } },
        async prepare(resolved) { return resolved },
        start(_prepared, context) {
          handlerSignal = context.signal
          order.push('start')
          return {
            done: quiescence.then(() => ({ status: 'canceled' as const })),
            async cancel(reason) {
              cancelReason = reason
              order.push('cancel')
              await quiescence
              order.push('quiescent')
            },
          }
        },
      })
      await internals.pump()
      await waitFor(() => order.includes('cancel'))
      expect(internals.store.current().statesByWorkId.get(work.id)?.status).toBe('starting')
      expect(internals.store.current().attentionsById.size).toBe(0)

      const release = releaseQuiescence
      if (release === undefined) throw new Error('LiveAttempt cancellation did not expose its quiescence release')
      release()
      await waitFor(() => internals.store.current().statesByWorkId.get(work.id)?.status === 'unknown')
      expect(order).toEqual(['start', 'cancel', 'quiescent', 'unknown-failed', 'unknown'])
      expect(cancelReason).toMatch(/could not persist the running attempt/)
      expect(handlerSignal?.aborted).toBe(true)
      expect(handlerSignal?.reason).toMatch(/could not persist the running attempt/)
      const state = internals.store.current().statesByWorkId.get(work.id)
      expect(state).toMatchObject({
        status: 'unknown',
        attemptCount: 1,
        failure: {
          category: 'post-start-durability',
          sideEffect: 'unknown',
          retriable: false,
        },
      })
      expect(state?.failure?.message).toMatch(/initial unknown persistence failed: injected first unknown append failure/)
      expect(internals.store.current().attentionsById.size).toBe(1)
      expect(internals.store.current().attemptsById.size).toBe(1)
      expect(attemptedEventTypes).not.toContain('attempt/failed')
      expect(attemptedEventTypes).not.toContain('work/auto-retry-authorized')
      append.mockRestore()
    } finally {
      releaseQuiescence?.()
      vi.restoreAllMocks()
      await queueContext.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each([
    { mode: 'cancel-rejected' as const, expected: /cancellation rejected: cancel rejected/ },
    { mode: 'settlement-rejected' as const, expected: /settlement rejected: settlement rejected/ },
    { mode: 'timeout' as const, expected: /did not reach quiescence within 20ms/ },
    {
      mode: 'cancel-rejected-timeout' as const,
      expected: /cancellation rejected: cancel rejected; LiveAttempt did not reach quiescence within 20ms/,
    },
  ])('records unknown after post-start cleanup is $mode', async ({ mode, expected }) => {
    const root = await mkdtemp(join(tmpdir(), `dsh-work-queue-running-${mode}-`))
    const queueContext = new Context()
    try {
      const queue = new LocalTaskQueue(queueContext, { queueRoot: root, shutdownTimeoutMs: 20 })
      const internals = queue as unknown as { ready: Promise<void>; store: WorkQueueStore; pump(): Promise<void> }
      await internals.ready
      const work = admittedWork(`running-${mode}-work`, `${mode} cleanup`)
      await appendAdmission(internals.store, 1, work)
      const originalAppend = internals.store.append.bind(internals.store)
      let injected = false
      vi.spyOn(internals.store, 'append').mockImplementation(async (change) => {
        if (!injected && change.events.some(event => event.type === 'attempt/running')) {
          injected = true
          throw new Error('injected running append failure')
        }
        return originalAppend(change)
      })
      queue.registerHandler({
        kind: 'test@1' as never,
        async resolveAdmission(input) { return input as never },
        resources() { return [] },
        policy() { return { maxAttempts: 1 } },
        async prepare(resolved) { return resolved },
        start() {
          if (mode === 'cancel-rejected') {
            return {
              done: Promise.resolve({ status: 'canceled' as const }),
              cancel: () => Promise.reject(new Error('cancel rejected')),
            }
          }
          if (mode === 'settlement-rejected') {
            return {
              done: Promise.reject(new Error('settlement rejected')),
              cancel: () => Promise.resolve(),
            }
          }
          if (mode === 'cancel-rejected-timeout') {
            return {
              done: new Promise<never>(() => undefined),
              cancel: () => Promise.reject(new Error('cancel rejected')),
            }
          }
          return {
            done: new Promise<never>(() => undefined),
            cancel: () => new Promise<void>(() => undefined),
          }
        },
      })
      await internals.pump()
      await waitFor(() => internals.store.current().statesByWorkId.get(work.id)?.status === 'unknown')
      expect(internals.store.current().statesByWorkId.get(work.id)?.failure?.message).toMatch(expected)
      expect(internals.store.current().attentionsById.size).toBe(1)
    } finally {
      vi.restoreAllMocks()
      await queueContext.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('writes owner Notifications atomically for queued and live cancellation only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-cancel-outbox-'))
    let settleLive: (() => void) | undefined
    try {
      const queue = new LocalTaskQueue(new Context(), { queueRoot: root })
      const internals = queue as unknown as { ready: Promise<void>; store: WorkQueueStore; pump(): Promise<void> }
      await internals.ready
      const queued = admittedWork('queued-cancel-work', 'queued cancel')
      const live = admittedWork('live-cancel-work', 'live cancel')
      const ownerless = { ...admittedWork('ownerless-cancel-work', 'ownerless cancel'), ownerSessionId: null }
      await appendAdmission(internals.store, 1, queued)
      await appendAdmission(internals.store, 2, live)
      await internals.store.transaction(() => internals.store.append({
        seq: 3, changeId: 'ownerless-admitted', at: AT, events: [
          { type: 'work/admitted', work: ownerless },
          { type: 'receipt/recorded', receipt: { owner: { type: 'operator' }, source: 'test', key: 'ownerless', intentDigest: ownerless.intentDigest, workIds: [ownerless.id], batchId: null, createdAt: AT } },
        ],
      }))
      const operator = queue.forOperator(createVerifiedOperatorAuthority())
      await operator.cancel(queued.id)
      await operator.cancel(ownerless.id)

      queue.registerHandler({
        kind: 'test@1' as never,
        async resolveAdmission() { return { resolved: true } }, resources() { return [] }, policy() { return { maxAttempts: 1 } },
        async prepare(resolved) { return resolved },
        start(prepared) {
          if ((prepared as { prompt: string }).prompt !== 'live cancel') return { done: new Promise<never>(() => undefined), async cancel() {} }
          return {
            done: new Promise((resolve) => {
              settleLive = () => { resolve({ status: 'canceled' as const }) }
            }),
            async cancel() { settleLive?.() },
          }
        },
      })
      await internals.pump()
      await waitFor(() => internals.store.current().statesByWorkId.get(live.id)?.status === 'running')

      await operator.cancel(live.id)
      await waitFor(() => internals.store.current().statesByWorkId.get(live.id)?.status === 'canceled')

      const notifications = [...internals.store.current().notificationsById.values()]
      const queuedNotification = notifications.find(value => value.workId === queued.id)
      const liveNotification = notifications.find(value => value.workId === live.id)
      const liveAttempt = [...internals.store.current().attemptsById.values()].find(value => value.workId === live.id)
      expect(queuedNotification).toMatchObject({ attemptId: null, resultId: null, ownerSessionId: 'session-1' })
      expect(liveNotification).toMatchObject({ resultId: null, ownerSessionId: 'session-1' })
      expect(liveNotification?.attemptId).toBe(liveAttempt?.id)
      expect(queuedNotification?.terminalSeq).toBeLessThan(liveNotification?.terminalSeq ?? 0)
      expect(liveNotification?.terminalSeq).toBe(internals.store.current().lastSeq)
      expect(notifications.some(value => value.workId === ownerless.id)).toBe(false)
    } finally {
      settleLive?.()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('lets an accepted cancellation win when a live handler then reports success', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-cancel-success-race-'))
    const queueContext = new Context()
    let settleAsSuccess: (() => void) | undefined
    let cancelCalls = 0
    try {
      const queue = new LocalTaskQueue(queueContext, { queueRoot: root })
      const internals = queue as unknown as { store: WorkQueueStore; pump(): Promise<void> }
      const work = admittedWork('cancel-success-race', 'cancel then exit zero')
      queue.registerHandler({
        kind: 'test@1' as never,
        async resolveAdmission() { return { resolved: true } },
        resources() { return [] },
        policy() { return { maxAttempts: 1 } },
        async prepare(resolved) { return resolved },
        start() {
          return {
            done: new Promise((resolve) => {
              settleAsSuccess = () => { resolve({ status: 'succeeded' as const, output: { exitCode: 0 } }) }
            }),
            async cancel() { cancelCalls += 1; settleAsSuccess?.() },
          }
        },
      })
      await appendAdmission(internals.store, 1, work)
      await internals.pump()
      await waitFor(() => internals.store.current().statesByWorkId.get(work.id)?.status === 'running')

      await queue.forOperator(createVerifiedOperatorAuthority()).cancel(work.id)
      await waitFor(() => {
        const status = internals.store.current().statesByWorkId.get(work.id)?.status
        return status === 'canceled' || status === 'succeeded'
      })

      expect(cancelCalls).toBe(1)
      expect(internals.store.current().statesByWorkId.get(work.id)?.status).toBe('canceled')
      expect(internals.store.current().resultsById.size).toBe(0)
      const notification = [...internals.store.current().notificationsById.values()]
        .find(value => value.workId === work.id)
      expect(notification).toMatchObject({ resultId: null, ownerSessionId: 'session-1' })
    } finally {
      settleAsSuccess?.()
      await queueContext.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('admits concurrent equal Batch requests exactly once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-scheduler-'))
    try {
      const authorityContext = new Context()
      await authorityContext.plugin(SessionStore)
      const owner = authorityContext.sessions.create(SessionId('owner'))
      const queue = new LocalTaskQueue(new Context(), { queueRoot: root, maxConcurrent: 1 })
      queue.registerHandler({
        kind: 'test@1' as never,
        async resolveAdmission() { return { resolved: true } },
        resources() { return [] },
        policy() { return { maxAttempts: 1 } },
        async prepare() { return { prepared: true } },
        start() { return { done: Promise.resolve({ status: 'succeeded' as const, output: { ok: true } as never }), async cancel() {} } },
      })
      const request = {
        kind: 'test@1' as never,
        items: [{ title: 'first cover', input: { prompt: 'first' } }, { title: 'second cover', input: { prompt: 'second' } }],
        sharedPayload: { collection: 'covers' },
        idempotencyKey: 'same-batch',
        maxParallel: 2,
      } as never
      const agentQueue = queue.forAgent(createVerifiedAgentAuthority(owner))

      const [first, second] = await Promise.all([agentQueue.enqueueBatch(request), agentQueue.enqueueBatch(request)])

      expect(first).toBe(second)
      const internals = queue as unknown as { store: WorkQueueStore }
      expect(internals.store.current().batchesById.size).toBe(1)
      expect(internals.store.current().worksById.size).toBe(2)
      expect(internals.store.current().receiptsByKey.size).toBe(1)
      await waitFor(() => [...internals.store.current().statesByWorkId.values()].every(state => state.status === 'succeeded'))
      await internals.store.close()
      const reopened = new WorkQueueStore(root)
      await reopened.open()
      expect(reopened.current().batchesById.size).toBe(1)
      expect(reopened.current().worksById.size).toBe(2)
      expect(reopened.current().receiptsByKey.size).toBe(1)
      await reopened.close()
      await authorityContext.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a reused Batch receipt key when any Batch-shaping input changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-batch-receipt-'))
    let authorityContext: Context | undefined
    let queueContext: Context | undefined
    try {
      authorityContext = new Context()
      await authorityContext.plugin(SessionStore)
      const owner = authorityContext.sessions.create(SessionId('owner'))
      queueContext = new Context()
      const queue = new LocalTaskQueue(queueContext, { queueRoot: root })
      const handler: WorkHandler<never> = {
        kind: 'test@1' as never,
        async resolveAdmission(input) { return input },
        resources() { return [] },
        policy() { return { maxAttempts: 1 } },
        async prepare(resolved) { return resolved },
        start() { return { done: Promise.resolve({ status: 'succeeded' as const, output: {} as never }), async cancel() {} } },
      }
      queue.registerHandler(handler)
      queue.registerHandler({ ...handler, kind: 'other-test@1' as never })
      const agentQueue = queue.forAgent(createVerifiedAgentAuthority(owner))
      const request: BatchRequest<never> = {
        kind: 'test@1' as never,
        items: [{ title: 'one', input: { prompt: 'one' } }],
        sharedPayload: { collection: 'covers' },
        idempotencyKey: 'batch-receipt-key',
        maxParallel: 1,
      }

      const first = await agentQueue.enqueueBatch(request)
      await expect(agentQueue.enqueueBatch(request)).resolves.toBe(first)
      await expect(agentQueue.enqueueBatch({ ...request, items: [{ title: 'two', input: { prompt: 'two' } }] })).rejects.toThrow(/idempotency conflict/)
      await expect(agentQueue.enqueueBatch({ ...request, sharedPayload: { collection: 'posters' } })).rejects.toThrow(/idempotency conflict/)
      await expect(agentQueue.enqueueBatch({ ...request, maxParallel: 2 })).rejects.toThrow(/idempotency conflict/)
      await expect(agentQueue.enqueueBatch({ ...request, kind: 'other-test@1' as never })).rejects.toThrow(/idempotency conflict/)
    } finally {
      await queueContext?.fiber.dispose()
      await authorityContext?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reserves Batch capacity for other eligible work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-scheduler-'))
    const settle: Array<() => void> = []
    try {
      const authorityContext = new Context()
      await authorityContext.plugin(SessionStore)
      const owner = authorityContext.sessions.create(SessionId('owner'))
      const queue = new LocalTaskQueue(new Context(), { queueRoot: root, maxConcurrent: 4 })
      const started: string[] = []
      queue.registerHandler({
        kind: 'test@1' as never,
        async resolveAdmission(input) { return { prompt: (input as { prompt: string }).prompt } },
        resources() { return [] },
        policy() { return { maxAttempts: 1 } },
        async prepare(resolved) { return resolved },
        start(prepared) {
          started.push((prepared as { prompt: string }).prompt)
          return {
            done: new Promise(resolve => settle.push(() =>{  resolve({ status: 'succeeded' as const, output: { ok: true } }) })),
            async cancel() {},
          }
        },
      })
      const agentQueue = queue.forAgent(createVerifiedAgentAuthority(owner))
      await agentQueue.enqueueBatch({
        kind: 'test@1' as never,
        items: [{ title: 'one', input: { prompt: 'one' } }, { title: 'two', input: { prompt: 'two' } }, { title: 'three', input: { prompt: 'three' } }],
        sharedPayload: {},
        idempotencyKey: 'first-batch',
        maxParallel: 2,
      })
      await agentQueue.enqueueBatch({
        kind: 'test@1' as never,
        items: [{ title: 'other', input: { prompt: 'other' } }],
        sharedPayload: {},
        idempotencyKey: 'second-batch',
        maxParallel: 1,
      })

      await waitFor(() => started.length >= 3)
      expect(started).toEqual(['one', 'two', 'other'])
      for (const done of settle) done()
      await waitFor(() => started.length === 4)
      for (const done of settle) done()
      const internals = queue as unknown as { store: WorkQueueStore }
      await waitFor(() => [...internals.store.current().statesByWorkId.values()].every(state => state.status === 'succeeded'))
      await authorityContext.fiber.dispose()
    } finally {
      for (const done of settle) done()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('marks orphaned starting and running attempts unknown before registered work dispatches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-recovery-'))
    let queueContext: Context | undefined
    try {
      const raw = new WorkQueueStore(root)
      await raw.open()
      const queued = admittedWork('queued-work', 'queued')
      const starting = admittedWork('starting-work', 'starting')
      const running = admittedWork('running-work', 'running')
      await appendAdmission(raw, 1, queued)
      await appendAdmission(raw, 2, starting)
      await appendAdmission(raw, 3, running)
      await raw.transaction(() => raw.append({ seq: 4, changeId: 'starting-attempt', at: AT, events: [{ type: 'attempt/started', attempt: { id: AttemptId('attempt-starting'), workId: starting.id, ordinal: 1, startedAt: AT } }] }))
      await raw.transaction(() => raw.append({ seq: 5, changeId: 'running-attempt', at: AT, events: [{ type: 'attempt/started', attempt: { id: AttemptId('attempt-running'), workId: running.id, ordinal: 1, startedAt: AT } }] }))
      await raw.transaction(() => raw.append({ seq: 6, changeId: 'running-attempt-confirmed', at: AT, events: [{ type: 'attempt/running', attemptId: AttemptId('attempt-running'), at: AT }] }))
      await raw.close()

      queueContext = new Context()
      const queue = new LocalTaskQueue(queueContext, { queueRoot: root })
      const internals = queue as unknown as { ready: Promise<void>; store: WorkQueueStore }
      await internals.ready
      expect(internals.store.current().statesByWorkId.get(starting.id)).toMatchObject({ status: 'unknown', failure: { category: 'host-restart', sideEffect: 'unknown' } })
      expect(internals.store.current().statesByWorkId.get(running.id)).toMatchObject({ status: 'unknown', failure: { category: 'host-restart', sideEffect: 'unknown' } })
      expect(internals.store.current().attentionsById.size).toBe(2)
      expect(internals.store.current().statesByWorkId.get(queued.id)?.status).toBe('queued')

      const operator = queue.forOperator(createVerifiedOperatorAuthority())
      await operator.resolveUnknown(running.id, {
        kind: 'confirm-failed',
        failure: { category: 'operator-confirmed', message: 'not completed', sideEffect: 'unknown', retriable: false },
      })
      expect(internals.store.current().statesByWorkId.get(running.id)?.status).toBe('failed')
      const notification = [...internals.store.current().notificationsById.values()]
        .find(value => value.workId === running.id)
      expect(notification).toMatchObject({ ownerSessionId: 'session-1', status: 'pending' })
      expect(notification?.terminalSeq).toBe(internals.store.current().lastSeq)

      queue.registerHandler({
        kind: 'test@1' as never,
        async resolveAdmission() { return { resolved: true } },
        resources() { return [] },
        policy() { return { maxAttempts: 1 } },
        async prepare(resolved) { return resolved },
        start() { return { done: Promise.resolve({ status: 'succeeded' as const, output: { ok: true } as never }), async cancel() {} } },
      })
      await waitFor(() => internals.store.current().statesByWorkId.get(queued.id)?.status === 'succeeded')
    } finally {
      await queueContext?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('drains active attempts before releasing Queue-root ownership', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-shutdown-'))
    let queueContext: Context | undefined
    try {
      queueContext = new Context()
      const queue = new LocalTaskQueue(queueContext, { queueRoot: root, maxConcurrent: 3, shutdownTimeoutMs: 20 })
      const internals = queue as unknown as { ready: Promise<void>; store: WorkQueueStore; pump(): Promise<void> }
      await internals.ready
      const canceled = admittedWork('cancel-work', 'cancel')
      const throws = admittedWork('throw-work', 'throw')
      const hangs = admittedWork('hang-work', 'hang')
      await appendAdmission(internals.store, 1, canceled)
      await appendAdmission(internals.store, 2, throws)
      await appendAdmission(internals.store, 3, hangs)
      const cancelCalls: string[] = []
      queue.registerHandler({
        kind: 'test@1' as never,
        async resolveAdmission(input) { return input as never },
        resources() { return [] },
        policy() { return { maxAttempts: 1 } },
        async prepare(resolved) { return resolved },
        start(prepared) {
          const prompt = (prepared as { prompt: string }).prompt
          if (prompt === 'cancel') {
            let settle: ((value: { status: 'canceled' }) => void) | undefined
            const done = new Promise<{ status: 'canceled' }>((resolve) => { settle = resolve })
            return { done, async cancel() { cancelCalls.push(prompt); settle?.({ status: 'canceled' }) } }
          }
          if (prompt === 'throw') return { done: new Promise<never>(() => undefined), async cancel() { cancelCalls.push(prompt); throw new Error('cancel failed') } }
          return { done: new Promise<never>(() => undefined), async cancel() { cancelCalls.push(prompt) } }
        },
      })
      await internals.pump()
      await waitFor(() => cancelCalls.length === 0 && [...internals.store.current().statesByWorkId.values()].filter(state => state.status === 'running').length === 3)

      const disposing = queueContext.fiber.dispose()
      await waitFor(() => cancelCalls.length === 3)
      const contender = new WorkQueueStore(root)
      await expect(contender.open()).rejects.toThrow(/owned|owner/i)
      await disposing

      expect(internals.store.current().statesByWorkId.get(canceled.id)?.status).toBe('canceled')
      expect(internals.store.current().statesByWorkId.get(throws.id)).toMatchObject({ status: 'unknown', failure: { sideEffect: 'unknown' } })
      expect(internals.store.current().statesByWorkId.get(hangs.id)).toMatchObject({ status: 'unknown', failure: { sideEffect: 'unknown' } })
      expect(internals.store.current().attentionsById.size).toBe(2)
      const reopened = new WorkQueueStore(root)
      await reopened.open()
      await reopened.close()
    } finally {
      await queueContext?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('bounds shutdown when LiveAttempt.cancel never settles, records unknown before unlocking, and reopens', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-shutdown-hung-cancel-'))
    let queueContext: Context | undefined
    let releaseCancel: (() => void) | undefined
    let disposing: Promise<void> | undefined
    try {
      queueContext = new Context()
      const queue = new LocalTaskQueue(queueContext, { queueRoot: root, shutdownTimeoutMs: 20 })
      const internals = queue as unknown as { ready: Promise<void>; store: WorkQueueStore; pump(): Promise<void> }
      await internals.ready
      const work = admittedWork('hung-cancel-work', 'hung cancel')
      await appendAdmission(internals.store, 1, work)
      let cancelStarted = false
      queue.registerHandler({
        kind: 'test@1' as never,
        async resolveAdmission(input) { return input as never },
        resources() { return [] },
        policy() { return { maxAttempts: 1 } },
        async prepare(resolved) { return resolved },
        start() {
          return {
            done: new Promise<never>(() => undefined),
            cancel() {
              cancelStarted = true
              return new Promise<void>((resolve) => { releaseCancel = resolve })
            },
          }
        },
      })
      await internals.pump()
      await waitFor(() => internals.store.current().statesByWorkId.get(work.id)?.status === 'running')

      disposing = queueContext.fiber.dispose()
      await waitFor(() => cancelStarted)
      const contender = new WorkQueueStore(root)
      await expect(contender.open()).rejects.toThrow(/owned|owner/i)
      await expect(Promise.race([
        disposing.then(() => 'disposed'),
        new Promise<string>((resolve) => { setTimeout(() => { resolve('timed out') }, 200) }),
      ])).resolves.toBe('disposed')

      expect(internals.store.current().statesByWorkId.get(work.id)).toMatchObject({ status: 'unknown', failure: { category: 'shutdown', sideEffect: 'unknown' } })
      expect([...internals.store.current().attentionsById.values()]).toHaveLength(1)
      const reopened = new WorkQueueStore(root)
      await reopened.open()
      await reopened.close()
    } finally {
      releaseCancel?.()
      await disposing
      await queueContext?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps staged admission and receipt lookup queued across restart before activation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-staged-restart-'))
    let firstContext: Context | undefined
    let reopenedContext: Context | undefined
    try {
      firstContext = new Context()
      const queue = new LocalTaskQueue(firstContext, { queueRoot: root })
      const registration = queue.registerHandler({
        kind: 'test@1' as never,
        async resolveAdmission(input) { return input as never },
        resources() { return [] },
        policy() { return { maxAttempts: 1 } },
        async prepare(resolved) { return resolved },
        start() {
          return {
            done: Promise.resolve({
              status: 'succeeded' as const,
              output: { ok: true } as never,
            }),
            async cancel() {},
          }
        },
      }, { activation: 'staged' })
      const operator = queue.forOperator(createVerifiedOperatorAuthority())
      const request = {
        kind: 'test@1' as never,
        title: 'staged receipt',
        input: { prompt: 'staged receipt' },
        idempotencyKey: 'staged-receipt',
      }
      const workId = await operator.enqueue(request)
      await expect(operator.enqueue(request)).resolves.toBe(workId)
      expect(operator.get(workId)).toMatchObject({
        state: { status: 'queued', attemptCount: 0 },
        attempts: [],
      })
      registration()
      await firstContext.fiber.dispose()
      firstContext = undefined

      reopenedContext = new Context()
      const reopened = new LocalTaskQueue(reopenedContext, { queueRoot: root })
      const internals = reopened as unknown as { ready: Promise<void> }
      await internals.ready
      const reopenedView = reopened
        .forOperator(createVerifiedOperatorAuthority())
        .get(workId)
      expect(reopenedView).toMatchObject({
        state: { status: 'queued', attemptCount: 0 },
        attempts: [],
      })
      expect(reopened
        .forOperator(createVerifiedOperatorAuthority())
        .pendingAttentions()).toEqual([])
    } finally {
      await firstContext?.fiber.dispose()
      await reopenedContext?.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('creates exactly one Attempt only after its staged registration activates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-staged-activate-'))
    const ctx = new Context()
    try {
      const queue = new LocalTaskQueue(ctx, { queueRoot: root })
      const starts = vi.fn()
      const registration = queue.registerHandler({
        kind: 'test@1' as never,
        async resolveAdmission(input) { return input as never },
        resources() { return [] },
        policy() { return { maxAttempts: 1 } },
        async prepare(resolved) { return resolved },
        start() {
          starts()
          return {
            done: Promise.resolve({
              status: 'succeeded' as const,
              output: { ok: true } as never,
            }),
            async cancel() {},
          }
        },
      }, { activation: 'staged' })
      const operator = queue.forOperator(createVerifiedOperatorAuthority())
      const workId = await operator.enqueue({
        kind: 'test@1' as never,
        title: 'activate once',
        input: { prompt: 'activate once' },
        idempotencyKey: 'staged-activate-once',
      })
      expect(operator.get(workId).attempts).toEqual([])
      expect(starts).not.toHaveBeenCalled()

      registration.activate()
      await waitFor(() => operator.get(workId).state.status === 'succeeded')
      expect(operator.get(workId).attempts).toHaveLength(1)
      expect(starts).toHaveBeenCalledOnce()
      expect(() => { registration.activate() }).toThrow(/already active/i)
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects disposed and stale activation without affecting a successor registration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-staged-stale-'))
    const ctx = new Context()
    try {
      const queue = new LocalTaskQueue(ctx, { queueRoot: root })
      const starts = vi.fn()
      const handler: WorkHandler<never> = {
        kind: 'test@1' as never,
        async resolveAdmission(input) { return input },
        resources() { return [] },
        policy() { return { maxAttempts: 1 } },
        async prepare(resolved) { return resolved },
        start() {
          starts()
          return {
            done: Promise.resolve({
              status: 'succeeded' as const,
              output: { ok: true } as never,
            }),
            async cancel() {},
          }
        },
      }
      const stale = queue.registerHandler(handler, { activation: 'staged' })
      const operator = queue.forOperator(createVerifiedOperatorAuthority())
      const workId = await operator.enqueue({
        kind: 'test@1' as never,
        title: 'stale registration',
        input: { prompt: 'stale registration' },
        idempotencyKey: 'staged-stale',
      })
      stale()
      expect(() => { stale.activate() }).toThrow(/disposed/i)

      const successor = queue.registerHandler(handler, { activation: 'staged' })
      expect(() => { stale.activate() }).toThrow(/disposed/i)
      expect(operator.get(workId)).toMatchObject({
        state: { status: 'queued', attemptCount: 0 },
        attempts: [],
      })
      successor.activate()
      await waitFor(() => operator.get(workId).state.status === 'succeeded')
      expect(starts).toHaveBeenCalledOnce()
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('aborts only its pre-start execution when an active registration is disposed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-work-queue-registration-dispose-'))
    const ctx = new Context()
    const preparation = Promise.withResolvers<{ prompt: string }>()
    try {
      const queue = new LocalTaskQueue(ctx, { queueRoot: root })
      const prepareStarted = Promise.withResolvers<undefined>()
      const starts = vi.fn()
      const registration = queue.registerHandler({
        kind: 'test@1' as never,
        async resolveAdmission(input) { return input as never },
        resources() { return [] },
        policy() { return { maxAttempts: 1 } },
        async prepare() {
          prepareStarted.resolve(undefined)
          return preparation.promise
        },
        start() {
          starts()
          return {
            done: Promise.resolve({
              status: 'succeeded' as const,
              output: { ok: true } as never,
            }),
            async cancel() {},
          }
        },
      }, { activation: 'staged' })
      const operator = queue.forOperator(createVerifiedOperatorAuthority())
      const workId = await operator.enqueue({
        kind: 'test@1' as never,
        title: 'dispose before start',
        input: { prompt: 'dispose before start' },
        idempotencyKey: 'registration-dispose-before-start',
      })
      registration.activate()
      await prepareStarted.promise
      expect(operator.get(workId).state.status).toBe('starting')

      registration()
      preparation.resolve({ prompt: 'prepared after disposal' })
      await waitFor(() => operator.get(workId).state.status === 'canceled')
      expect(starts).not.toHaveBeenCalled()
      expect(operator.get(workId).attempts).toHaveLength(1)
    } finally {
      preparation.resolve({ prompt: 'test cleanup' })
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
