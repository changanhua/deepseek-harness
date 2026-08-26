import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import {
  buildSection,
  createToolTaskQueue,
  markerLine,
  matchMarker,
  validateEnqueueSpec,
} from '../src/index.ts'
import type { ToolTaskQueueDeps } from '../src/index.ts'
import type {
  EnqueueSpec,
  NotificationRecord,
  QueueStats,
  Task,
  TaskQueue,
} from '@deepseek-ai/dsh-task-queue'
import { TaskId, NotificationId, RunId } from '@deepseek-ai/dsh-task-queue'

/** A controllable in-memory task-queue Service for driving the toolkit. */
function makeQueue(overrides: Partial<Pick<TaskQueue, 'list' | 'get' | 'stats' | 'dismiss'>> = {}): {
  taskQueue: TaskQueue
  enqueued: EnqueueSpec[]
  acks: { notificationId: string; messageId: string }[]
  pendingNotifications: NotificationRecord[]
} {
  const enqueued: EnqueueSpec[] = []
  const acks: { notificationId: string; messageId: string }[] = []
  const pendingNotifications: NotificationRecord[] = []
  const tasks = new Map<string, { title: string; status: string }>()
  const taskQueue = {
    async enqueueFromTool(spec: EnqueueSpec): Promise<TaskId> {
      enqueued.push(spec)
      tasks.set(`tq-${enqueued.length}`, { title: spec.title, status: 'pending' })
      return TaskId(`tq-${enqueued.length}`)
    },
    async enqueueBatchFromTool(specs: EnqueueSpec[]): Promise<TaskId[]> {
      return specs.map((spec) => {
        enqueued.push(spec)
        tasks.set(`tq-${enqueued.length}`, { title: spec.title, status: 'pending' })
        return TaskId(`tq-${enqueued.length}`)
      })
    },
    list() { return [] },
    get(id: TaskId): Task {
      const task = tasks.get(id)
      if (task === undefined) throw new Error(`unknown task ${id}`)
      return {
        id, title: task.title, prompt: '', executor: 'claude', status: task.status as never,
        priority: 10, attempt: 0, maxAttempts: 3, backoffMs: 30_000, delayUntil: null,
        timeoutMs: 1_800_000, outputDir: '', tags: [], createdAt: '', updatedAt: '',
        lastError: null, result: null, ownerSessionId: null, source: 'tool',
        receiptId: 'r', terminalSeq: null, runs: [], dismissed: false,
      }
    },
    async cancel(): Promise<'canceled' | 'stopping'> { return 'canceled' },
    async retry(id: TaskId): Promise<TaskId> { return id },
    async dismiss(_id: TaskId, _dismissed: boolean): Promise<void> {},
    stats(): QueueStats {
      return {
        serviceState: 'running',
        byStatus: { pending: 0, starting: 0, running: 0, stopping: 0, succeeded: 0, failed: 0, canceled: 0 },
        byExecutor: {},
        undismissedFailed: 0,
        byDismissed: 0,
      }
    },
    async ackNotification(notificationId: string, messageId: string): Promise<void> {
      acks.push({ notificationId, messageId })
    },
    listNotifications() { return pendingNotifications },
    registerExecutor() { return () => {} },
    listExecutors() { return [{ name: 'codex', enabled: true, toolAllowed: true }] },
    pause() {},
    resume() {},
    ...overrides,
  } as unknown as TaskQueue
  return { taskQueue, enqueued, acks, pendingNotifications }
}

function makeDeps(taskQueue: TaskQueue | undefined, opts: Partial<ToolTaskQueueDeps> = {}): ToolTaskQueueDeps {
  const sessionEvents = (_session: Session): readonly SessionEvent[] => []
  const flushSession = async (): Promise<boolean> => true
  return { taskQueue, sessionEvents, flushSession, ...opts }
}

/** Build an agent-shaped object with a live session. */
function fakeAgent(session: Session): Agent {
  return { session, id: session.id, options: {}, status: 'idle', inbox: {}, ctx: {} } as unknown as Agent
}

function enterDecision(): PreStepDecision {
  return { kind: 'enter', messages: [] }
}

/** Narrow a pre-step decision to its enter messages, failing the test on reject. */
function enterMessages(d: PreStepDecision): Extract<PreStepDecision, { kind: 'enter' }>['messages'] {
  if (d.kind === 'reject') throw new Error('expected an enter pre-step decision')
  return d.messages
}

function appendText(session: Session, text: string): void {
  session.append('user/message', {
    role: 'user',
    id: `m-${session.seq}` as never,
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }, { surfaceOp: 'append' })
}

describe('marker rendering and matching', () => {
  it('renders and matches the stable marker line', () => {
    const line = markerLine('n-1', 'msg-1')
    expect(line).toBe('[task-queue-notification n-1 msg-1]')
    expect(matchMarker(line)).toEqual({ notificationId: NotificationId('n-1'), messageId: 'msg-1' })
  })

  it('ignores unrelated text with no marker', () => {
    expect(matchMarker('ordinary user message')).toBeUndefined()
  })
})

describe('validateEnqueueSpec', () => {
  it('accepts a minimal spec and applies no defaults', () => {
    const spec = validateEnqueueSpec({ title: 't', prompt: 'p', executor: 'claude' })
    expect(spec).toEqual({ title: 't', prompt: 'p', executor: 'claude' })
  })

  it('rejects executor shell with a clear message', () => {
    expect(() => validateEnqueueSpec({ title: 't', prompt: 'p', executor: 'shell' }))
      .toThrow(/shell.*inbox-only/)
  })

  it('passes through optional fields after validation', () => {
    const spec = validateEnqueueSpec({
      title: 't', prompt: 'p', executor: 'codex',
      priority: 1, maxAttempts: 5, backoffMs: 1000, delayUntil: '2026-01-01T00:00:00Z',
      timeoutMs: 60000, workspaceDir: '/tmp/repo', outputDir: '/tmp/o', tags: ['a', 'b'], idempotencyKey: 'k',
    })
    expect(spec.priority).toBe(1)
    expect(spec.maxAttempts).toBe(5)
    expect(spec.workspaceDir).toBe('/tmp/repo')
    expect(spec.tags).toEqual(['a', 'b'])
    expect(spec.idempotencyKey).toBe('k')
  })

  it('rejects a null/array spec and bad scalars', () => {
    expect(() => validateEnqueueSpec(null)).toThrow(/must be an object/)
    expect(() => validateEnqueueSpec([])).toThrow(/must be an object/)
    expect(() => validateEnqueueSpec({ title: '', prompt: 'p', executor: 'claude' })).toThrow(/title/)
    expect(() => validateEnqueueSpec({ title: 't', prompt: '', executor: 'claude' })).toThrow(/prompt/)
    expect(() => validateEnqueueSpec({ title: 't', prompt: 'p', executor: 'claude', maxAttempts: 0 })).toThrow(/maxAttempts/)
    expect(() => validateEnqueueSpec({ title: 't', prompt: 'p', executor: 'claude', idempotencyKey: '' })).toThrow(/idempotencyKey/)
  })
})

describe('tool schema validation (through execute)', () => {
  it('task_queue_executors lists the backend executors with gates', async () => {
    const queue = makeQueue()
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue))
    const executors = kit.tools.find(t => t.name === 'task_queue_executors')!
    await expect(executors.execute({}, {} as never)).resolves.toEqual({
      executors: [{ name: 'codex', enabled: true, toolAllowed: true }],
    })
  })

  it('task_queue_enqueue rejects shell and enqueues sane specs', async () => {
    const queue = makeQueue()
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue))
    const enqueue = kit.tools.find(t => t.name === 'task_queue_enqueue')!
    await expect(enqueue.execute({ spec: { title: 't', prompt: 'p', executor: 'shell' } }, {} as never))
      .rejects.toThrow(/shell/)
    const result = await enqueue.execute({ spec: { title: 'hi', prompt: 'do', executor: 'claude' } }, {} as never)
    expect(result).toEqual({ id: 'tq-1' })
    expect(queue.enqueued).toHaveLength(1)
  })

  it('task_queue_enqueue_batch rejects shell anywhere and enqueues up to 200', async () => {
    const queue = makeQueue()
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue))
    const batch = kit.tools.find(t => t.name === 'task_queue_enqueue_batch')!
    await expect(batch.execute({
      specs: [
        { title: 'a', prompt: 'a', executor: 'claude' },
        { title: 'b', prompt: 'b', executor: 'shell' },
      ],
    }, {} as never)).rejects.toThrow(/shell/)
    const over = await batch.execute({ specs: Array.from({ length: 201 }, () => ({ title: 'x', prompt: 'x', executor: 'claude' })) }, {} as never).catch((e: unknown) => e)
    expect(over).toBeInstanceOf(Error)
    expect((over as Error).message).toMatch(/200/)
    const two = await batch.execute({ specs: [
      { title: 'a', prompt: 'a', executor: 'claude' },
      { title: 'b', prompt: 'b', executor: 'codex' },
    ] }, {} as never)
    expect(two).toEqual({ ids: ['tq-1', 'tq-2'] })
  })

  it('task_queue_dismiss soft-concludes a terminal task and returns dismissed=true', async () => {
    const calls: { id: string; dismissed: boolean }[] = []
    const queue = makeQueue({
      dismiss: async (id: TaskId, dismissed: boolean) => { calls.push({ id: String(id), dismissed }) },
      get: (id: TaskId) => ({
        id, title: 't', prompt: '', executor: 'claude', status: 'succeeded',
        priority: 10, attempt: 1, maxAttempts: 3, backoffMs: 30_000, delayUntil: null,
        timeoutMs: 1_800_000, outputDir: '', tags: [], createdAt: '', updatedAt: '',
        lastError: null, result: null, ownerSessionId: null, source: 'tool',
        receiptId: 'r', terminalSeq: null, runs: [], dismissed: false,
      }),
    })
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue))
    const dismiss = kit.tools.find(t => t.name === 'task_queue_dismiss')!
    const out = await dismiss.execute({ id: 'tq-1' }, {} as never)
    expect(out).toEqual({ id: 'tq-1', dismissed: true })
    expect(calls).toEqual([{ id: 'tq-1', dismissed: true }])
  })

  it('task_queue_dismiss with dismissed:false restores (undo path)', async () => {
    const calls: { id: string; dismissed: boolean }[] = []
    const queue = makeQueue({
      dismiss: async (id: TaskId, dismissed: boolean) => { calls.push({ id: String(id), dismissed }) },
      get: (id: TaskId) => ({
        id, title: 't', prompt: '', executor: 'claude', status: 'succeeded',
        priority: 10, attempt: 1, maxAttempts: 3, backoffMs: 30_000, delayUntil: null,
        timeoutMs: 1_800_000, outputDir: '', tags: [], createdAt: '', updatedAt: '',
        lastError: null, result: null, ownerSessionId: null, source: 'tool',
        receiptId: 'r', terminalSeq: null, runs: [], dismissed: true,
      }),
    })
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue))
    const dismiss = kit.tools.find(t => t.name === 'task_queue_dismiss')!
    const out = await dismiss.execute({ id: 'tq-1', dismissed: false }, {} as never)
    expect(out).toEqual({ id: 'tq-1', dismissed: false })
    expect(calls).toEqual([{ id: 'tq-1', dismissed: false }])
  })

  it('task_queue_undismiss restores to attention (dismissed=false)', async () => {
    const calls: { id: string; dismissed: boolean }[] = []
    const queue = makeQueue({
      dismiss: async (id: TaskId, dismissed: boolean) => { calls.push({ id: String(id), dismissed }) },
      get: (id: TaskId) => ({
        id, title: 't', prompt: '', executor: 'claude', status: 'succeeded',
        priority: 10, attempt: 1, maxAttempts: 3, backoffMs: 30_000, delayUntil: null,
        timeoutMs: 1_800_000, outputDir: '', tags: [], createdAt: '', updatedAt: '',
        lastError: null, result: null, ownerSessionId: null, source: 'tool',
        receiptId: 'r', terminalSeq: null, runs: [], dismissed: true,
      }),
    })
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue))
    const undismiss = kit.tools.find(t => t.name === 'task_queue_undismiss')!
    const out = await undismiss.execute({ id: 'tq-1' }, {} as never)
    expect(out).toEqual({ id: 'tq-1', dismissed: false })
    expect(calls).toEqual([{ id: 'tq-1', dismissed: false }])
  })

  it('tools report a clear error when the backend is absent', async () => {
    const kit = createToolTaskQueue(makeDeps(undefined))
    const enqueue = kit.tools.find(t => t.name === 'task_queue_enqueue')!
    await expect(enqueue.execute({ spec: { title: 't', prompt: 'p', executor: 'claude' } }, {} as never))
      .rejects.toThrow(/task-queue-local/)
  })

  it('task_queue_enqueue binds the caller session as ownerSessionId', async () => {
    const queue = makeQueue()
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue))
    const enqueue = kit.tools.find(t => t.name === 'task_queue_enqueue')!
    const agent = fakeAgent(Session.create(SessionId('s-1')))
    await enqueue.execute({ spec: { title: 't', prompt: 'p', executor: 'claude' } }, { agent } as never)
    expect(queue.enqueued).toHaveLength(1)
    expect(queue.enqueued[0]!.ownerSessionId).toBe('s-1')
  })

  it('task_queue_enqueue_batch binds the caller session as ownerSessionId on every spec', async () => {
    const queue = makeQueue()
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue))
    const batch = kit.tools.find(t => t.name === 'task_queue_enqueue_batch')!
    const agent = fakeAgent(Session.create(SessionId('s-1')))
    await batch.execute({
      specs: [
        { title: 'a', prompt: 'a', executor: 'claude' },
        { title: 'b', prompt: 'b', executor: 'codex' },
      ],
    }, { agent } as never)
    expect(queue.enqueued).toHaveLength(2)
    expect(queue.enqueued[0]!.ownerSessionId).toBe('s-1')
    expect(queue.enqueued[1]!.ownerSessionId).toBe('s-1')
  })

  it('leaves ownerSessionId unset for a call with no Agent (host-plane dispatch)', async () => {
    const queue = makeQueue()
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue))
    const enqueue = kit.tools.find(t => t.name === 'task_queue_enqueue')!
    await enqueue.execute({ spec: { title: 't', prompt: 'p', executor: 'claude' } }, {} as never)
    expect(queue.enqueued).toHaveLength(1)
    expect(queue.enqueued[0]!.ownerSessionId).toBeUndefined()
  })
})

describe('pre-step candidate generation', () => {
  function rec(overrides: Partial<NotificationRecord>): NotificationRecord {
    return {
      notificationId: NotificationId('n'), taskId: TaskId('tq-1'), runId: RunId('r-1'), attempt: 1, terminalSeq: 1,
      ownerSessionId: SessionId('s'), messageId: 'msg', status: 'pending', acknowledgedAt: null,
      ...overrides,
    }
  }

  it('injects nothing when there are no pending notifications', () => {
    const queue = makeQueue()
    const session = Session.create(SessionId('s'))
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue, { sessionEvents: s => s.events }))
    const out = kit.preStep(fakeAgent(session), enterDecision())
    expect(enterMessages(out)).toHaveLength(0)
  })

  it('sorts candidates by terminalSeq and marks them inFlight', () => {
    const queue = makeQueue()
    queue.pendingNotifications.push(
      rec({ notificationId: NotificationId('n2'), messageId: 'm2', terminalSeq: 2 }),
      rec({ notificationId: NotificationId('n1'), messageId: 'm1', terminalSeq: 1 }),
    )
    const session = Session.create(SessionId('s'))
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue, { sessionEvents: s => s.events }))
    const out = kit.preStep(fakeAgent(session), enterDecision())
    expect(enterMessages(out)).toHaveLength(2)
    const first = enterMessages(out)[0]!.content[0]!
    expect(first.type).toBe('text')
    expect((first as { text: string }).text).toContain('m1')
    expect(kit.inFlight.has('m1')).toBe(true)
    expect(kit.inFlight.has('m2')).toBe(true)
  })

  it('skips messageIds already inFlight', () => {
    const queue = makeQueue()
    queue.pendingNotifications.push(rec({ notificationId: NotificationId('n1'), messageId: 'm1', terminalSeq: 1 }))
    const session = Session.create(SessionId('s'))
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue, { sessionEvents: s => s.events }))
    kit.inFlight.add('m1')
    const out = kit.preStep(fakeAgent(session), enterDecision())
    expect(enterMessages(out)).toHaveLength(0)
  })

  it('starts the finalizer for messageIds already present in the session (append-before-ack)', async () => {
    const queue = makeQueue()
    const flush = vi.fn<() => Promise<boolean>>(async () => true)
    queue.pendingNotifications.push(rec({ notificationId: NotificationId('n1'), messageId: 'm1', terminalSeq: 1 }))
    const session = Session.create(SessionId('s'))
    appendText(session, `done.\n${markerLine('n1', 'm1')}`)
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue, { sessionEvents: s => s.events, flushSession: flush }))
    const out = kit.preStep(fakeAgent(session), enterDecision())
    // Not re-injected (the marker exists); instead the pre-step hands the
    // already-appended marker straight to the flush→CAS finalizer.
    expect(enterMessages(out)).toHaveLength(0)
    expect(kit.inFlight.has('m1')).toBe(true)
    await vi.waitFor(() => expect(flush).toHaveBeenCalled())
    await vi.waitFor(() => expect(queue.acks).toHaveLength(1))
    expect(queue.acks[0]).toEqual({ notificationId: NotificationId('n1'), messageId: 'm1' })
    await vi.waitFor(() => expect(kit.inFlight.has('m1')).toBe(false))
  })

  it('skips acknowledged notifications', () => {
    const queue = makeQueue()
    queue.pendingNotifications.push(rec({ notificationId: NotificationId('n1'), messageId: 'm1', status: 'acknowledged' }))
    const session = Session.create(SessionId('s'))
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue, { sessionEvents: s => s.events }))
    const out = kit.preStep(fakeAgent(session), enterDecision())
    expect(enterMessages(out)).toHaveLength(0)
  })

  it('preserves existing decision messages and returns reject untouched', () => {
    const queue = makeQueue()
    queue.pendingNotifications.push(rec({ notificationId: NotificationId('n1'), messageId: 'm1' }))
    const session = Session.create(SessionId('s'))
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue, { sessionEvents: s => s.events }))
    const rejected = kit.preStep(fakeAgent(session), { kind: 'reject' })
    expect(rejected).toEqual({ kind: 'reject' })
  })
})

describe('turn/end reconciliation', () => {
  it('clears inFlight messageIds that never reached a user/message', () => {
    const queue = makeQueue()
    const session = Session.create(SessionId('s'))
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue, { sessionEvents: s => s.events }))
    kit.inFlight.add('m1')
    kit.inFlight.add('m2')
    appendText(session, `done.\n${markerLine('n2', 'm2')}`)
    // Emit turn/end through the session/event handler.
    kit.sessionEvent(session, { type: 'turn/end', seq: session.seq, time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } } })
    expect(kit.inFlight.has('m1')).toBe(false)
    expect(kit.inFlight.has('m2')).toBe(true)
  })
})

describe('session/event finalizer', () => {
  function completedTurn(): SessionEvent {
    return { type: 'turn/end', seq: 0, time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } } }
  }

  it('acks after a successful flush and clears inFlight', async () => {
    const queue = makeQueue()
    const flush = vi.fn<() => Promise<boolean>>(async () => true)
    const session = Session.create(SessionId('s'))
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue, { flushSession: flush, sessionEvents: s => s.events }))
    kit.sessionEvent(session, { type: 'turn/end', seq: 0, time: Date.now(), data: { turn: 0, reason: { kind: 'completed' } } })
    // Append a marker-bearing user/message and route it through the handler.
    appendText(session, `task done.\n${markerLine('n1', 'm1')}`)
    const event = session.events.at(-1)!
    kit.sessionEvent(session, event)
    await vi.waitFor(() => expect(queue.acks).toHaveLength(1))
    expect(queue.acks[0]).toEqual({ notificationId: NotificationId('n1'), messageId: 'm1' })
    expect(flush).toHaveBeenCalled()
    await vi.waitFor(() => expect(kit.inFlight.has('m1')).toBe(false))
  })

  it('does not ack when flush fails and clears inFlight', async () => {
    const queue = makeQueue()
    const flush = vi.fn<() => Promise<boolean>>(async () => { throw new Error('disk full') })
    const session = Session.create(SessionId('s'))
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue, { flushSession: flush, sessionEvents: s => s.events }))
    appendText(session, `done.\n${markerLine('n1', 'm1')}`)
    kit.sessionEvent(session, session.events.at(-1)!)
    await vi.waitFor(() => expect(kit.inFlight.has('m1')).toBe(false))
    expect(queue.acks).toHaveLength(0)
  })

  it('does not ack when no flush listener participated', async () => {
    const queue = makeQueue()
    const flush = vi.fn<() => Promise<boolean>>(async () => false)
    const session = Session.create(SessionId('s'))
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue, { flushSession: flush, sessionEvents: s => s.events }))
    appendText(session, `done.\n${markerLine('n1', 'm1')}`)
    kit.sessionEvent(session, session.events.at(-1)!)
    await vi.waitFor(() => expect(kit.inFlight.has('m1')).toBe(false))
    expect(queue.acks).toHaveLength(0)
  })

  it('ignores user messages without a marker', async () => {
    const queue = makeQueue()
    const flush = vi.fn<() => Promise<boolean>>(async () => true)
    const session = Session.create(SessionId('s'))
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue, { flushSession: flush, sessionEvents: s => s.events }))
    appendText(session, 'ordinary message')
    kit.sessionEvent(session, session.events.at(-1)!)
    expect(queue.acks).toHaveLength(0)
    expect(flush).not.toHaveBeenCalled()
  })

  it('ack is idempotent: a second marker observation acks again without harm', async () => {
    const queue = makeQueue()
    const session = Session.create(SessionId('s'))
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue, { flushSession: async () => true, sessionEvents: s => s.events }))
    appendText(session, `done.\n${markerLine('n1', 'm1')}`)
    kit.sessionEvent(session, session.events.at(-1)!)
    await vi.waitFor(() => expect(queue.acks).toHaveLength(1))
  })

  it('no-ops on turn/end when there is no backend', () => {
    const kit = createToolTaskQueue(makeDeps(undefined))
    kit.inFlight.add('m1')
    const session = Session.create(SessionId('s'))
    kit.sessionEvent(session, completedTurn())
    // Without a backend the reconcile path is skipped, so inFlight is untouched.
    expect(kit.inFlight.has('m1')).toBe(true)
  })
})

describe('system-prompt section', () => {
  it('registers the expected name, order, and guidance content', () => {
    const section = buildSection()
    expect(section.name).toBe('tool:task-queue')
    expect(section.order).toBe(107)
    expect(section.text).toContain('task_queue_*')
    expect(section.text).toContain('task_queue_stats')
    expect(section.text).toContain('task_queue_retry')
    expect(section.text).toContain('task_queue_list')
    expect(section.text).toContain('task_queue_dismiss')
    expect(section.text).toContain('use dsh/claude/codex/opencode/arkcli')
    expect(section.text).toMatch(/Enqueue a batch first/)
    expect(section.text).toMatch(/just 3 or more|3 or more independent tasks/)
  })
})

describe('owner authorization', () => {
  const ownerSession = SessionId('s-1')
  const otherSession = SessionId('s-2')

  function taskWithOwner(ownerSessionId: string | null): Task {
    return {
      id: TaskId('tq-1'), title: 't', prompt: '', executor: 'claude', status: 'succeeded',
      priority: 10, attempt: 1, maxAttempts: 3, backoffMs: 30_000, delayUntil: null,
      timeoutMs: 1_800_000, outputDir: '', tags: [], createdAt: '', updatedAt: '',
      lastError: null, result: null, ownerSessionId, source: 'tool',
      receiptId: 'r', terminalSeq: 1, runs: [], dismissed: false,
    }
  }

  it('allows the owner Agent to cancel their own task', async () => {
    const queue = makeQueue({ get: () => taskWithOwner(ownerSession) })
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue))
    const cancel = kit.tools.find(t => t.name === 'task_queue_cancel')!
    const agent = fakeAgent(Session.create(ownerSession))
    const out = await cancel.execute({ id: 'tq-1' }, { agent } as never)
    expect(out).toEqual({ outcome: 'canceled' })
  })

  it('allows the owner Agent to retry their own task', async () => {
    const queue = makeQueue({ get: () => taskWithOwner(ownerSession) })
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue))
    const retry = kit.tools.find(t => t.name === 'task_queue_retry')!
    const agent = fakeAgent(Session.create(ownerSession))
    const out = await retry.execute({ id: 'tq-1' }, { agent } as never)
    expect(out).toEqual({ id: 'tq-1' })
  })

  it('allows the owner Agent to dismiss their own task', async () => {
    const queue = makeQueue({ get: () => taskWithOwner(ownerSession) })
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue))
    const dismiss = kit.tools.find(t => t.name === 'task_queue_dismiss')!
    const agent = fakeAgent(Session.create(ownerSession))
    const out = await dismiss.execute({ id: 'tq-1' }, { agent } as never)
    expect(out).toEqual({ id: 'tq-1', dismissed: true })
  })

  it('rejects a non-owner Agent from canceling another session\'s task', async () => {
    const queue = makeQueue({ get: () => taskWithOwner(ownerSession) })
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue))
    const cancel = kit.tools.find(t => t.name === 'task_queue_cancel')!
    const agent = fakeAgent(Session.create(otherSession))
    await expect(cancel.execute({ id: 'tq-1' }, { agent } as never))
      .rejects.toThrow(/owned by session/)
  })

  it('rejects a non-owner Agent from retrying another session\'s task', async () => {
    const queue = makeQueue({ get: () => taskWithOwner(ownerSession) })
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue))
    const retry = kit.tools.find(t => t.name === 'task_queue_retry')!
    const agent = fakeAgent(Session.create(otherSession))
    await expect(retry.execute({ id: 'tq-1' }, { agent } as never))
      .rejects.toThrow(/owned by session/)
  })

  it('rejects a non-owner Agent from dismissing another session\'s task', async () => {
    const queue = makeQueue({ get: () => taskWithOwner(ownerSession) })
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue))
    const dismiss = kit.tools.find(t => t.name === 'task_queue_dismiss')!
    const agent = fakeAgent(Session.create(otherSession))
    await expect(dismiss.execute({ id: 'tq-1' }, { agent } as never))
      .rejects.toThrow(/owned by session/)
  })

  it('allows host-operator (no Agent) to cancel any task', async () => {
    const queue = makeQueue({ get: () => taskWithOwner(ownerSession) })
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue))
    const cancel = kit.tools.find(t => t.name === 'task_queue_cancel')!
    const out = await cancel.execute({ id: 'tq-1' }, {} as never)
    expect(out).toEqual({ outcome: 'canceled' })
  })

  it('allows host-operator (no Agent) to retry any task', async () => {
    const queue = makeQueue({ get: () => taskWithOwner(ownerSession) })
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue))
    const retry = kit.tools.find(t => t.name === 'task_queue_retry')!
    const out = await retry.execute({ id: 'tq-1' }, {} as never)
    expect(out).toEqual({ id: 'tq-1' })
  })

  it('allows host-operator (no Agent) to dismiss any task', async () => {
    const queue = makeQueue({ get: () => taskWithOwner(ownerSession) })
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue))
    const dismiss = kit.tools.find(t => t.name === 'task_queue_dismiss')!
    const out = await dismiss.execute({ id: 'tq-1' }, {} as never)
    expect(out).toEqual({ id: 'tq-1', dismissed: true })
  })

  it('rejects a non-owner Agent from operating on an unowned task', async () => {
    const queue = makeQueue({ get: () => taskWithOwner(null) })
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue))
    const cancel = kit.tools.find(t => t.name === 'task_queue_cancel')!
    const agent = fakeAgent(Session.create(otherSession))
    await expect(cancel.execute({ id: 'tq-1' }, { agent } as never))
      .rejects.toThrow(/owned by session/)
  })
})

describe('notification summary', () => {
  function textOf(msg: { content: readonly { type: string; text?: string }[] }): string {
    let out = ''
    for (const block of msg.content) {
      if (block.type === 'text' && block.text !== undefined) out += block.text
    }
    return out
  }

  it('includes result summary in the notification message when the task succeeded with one', () => {
    const queue = makeQueue({
      get: () => ({
        id: TaskId('tq-1'), title: 'my task', prompt: '', executor: 'claude', status: 'succeeded' as const,
        priority: 10, attempt: 1, maxAttempts: 3, backoffMs: 30_000, delayUntil: null,
        timeoutMs: 1_800_000, outputDir: '', tags: [], createdAt: '', updatedAt: '',
        lastError: null, result: { summary: 'exit 0, 2.5s, 1 output file', exitCode: 0, signal: null, durationMs: 2500 },
        ownerSessionId: null, source: 'tool' as const,
        receiptId: 'r', terminalSeq: 1, runs: [], dismissed: false,
      }),
    })
    const session = Session.create(SessionId('s'))
    queue.pendingNotifications.push({
      notificationId: NotificationId('n1'),
      taskId: TaskId('tq-1'),
      runId: RunId('r1'),
      attempt: 1,
      terminalSeq: 1,
      ownerSessionId: session.id,
      messageId: 'm1',
      status: 'pending',
      acknowledgedAt: null,
    })
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue, {
      sessionEvents: s => s.events,
    }))
    const decision = kit.preStep(fakeAgent(session), { kind: 'enter', messages: [] })
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('expected enter decision')
    expect(decision.messages).toHaveLength(1)
    expect(textOf(decision.messages[0]!)).toContain('exit 0, 2.5s, 1 output file')
  })

  it('omits the outcome line when the task has no result summary', () => {
    const queue = makeQueue({
      get: () => ({
        id: TaskId('tq-1'), title: 'my task', prompt: '', executor: 'claude', status: 'failed' as const,
        priority: 10, attempt: 1, maxAttempts: 3, backoffMs: 30_000, delayUntil: null,
        timeoutMs: 1_800_000, outputDir: '', tags: [], createdAt: '', updatedAt: '',
        lastError: null, result: null,
        ownerSessionId: null, source: 'tool' as const,
        receiptId: 'r', terminalSeq: 1, runs: [], dismissed: false,
      }),
    })
    const session = Session.create(SessionId('s'))
    queue.pendingNotifications.push({
      notificationId: NotificationId('n1'),
      taskId: TaskId('tq-1'),
      runId: RunId('r1'),
      attempt: 1,
      terminalSeq: 1,
      ownerSessionId: session.id,
      messageId: 'm1',
      status: 'pending',
      acknowledgedAt: null,
    })
    const kit = createToolTaskQueue(makeDeps(queue.taskQueue, {
      sessionEvents: s => s.events,
    }))
    const decision = kit.preStep(fakeAgent(session), { kind: 'enter', messages: [] })
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('expected enter decision')
    expect(textOf(decision.messages[0]!)).not.toContain('Outcome:')
  })
})
