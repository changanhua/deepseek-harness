import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { messageAccepted, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { freezeMessage, MessageId, type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import {
  AttemptId,
  createVerifiedAgentAuthority,
  NotificationId,
  ResultId,
  WorkId,
  type AgentWorkQueue,
  type Notification,
  type TaskQueue,
  type WorkFailure,
  type WorkHandler,
  type WorkStatus,
  type WorkView,
  type VerifiedAgentAuthority,
} from '@changanhua/dsh-task-queue'
import { describe, expect, it, vi } from 'vitest'
import LocalTaskQueue from '../../task-queue-local/src/index.ts'
import {
  apply,
  createToolTaskQueue,
  inject,
  installNotificationDelivery,
  renderNotification,
} from '../src/index.ts'

const FAILURE: WorkFailure = {
  category: 'worker',
  sideEffect: 'started',
  retriable: false,
  message: 'worker failed',
}

function workView(status: WorkStatus, ownerSessionId = 'tool-owner'): WorkView {
  const workId = WorkId(`work-${status}`)
  const succeeded = status === 'succeeded'
  return {
    work: {
      id: workId,
      kind: 'agent.run@1',
      title: `work ${status}`,
      intent: { prompt: 'never render this prompt' },
      intentDigest: 'digest',
      resolved: { prompt: 'never render this prompt', workspaceDir: 'never/render/this/path' },
      policy: { maxAttempts: 1 },
      resources: [],
      tags: [],
      batchId: null,
      ownerSessionId,
      createdAt: '2026-08-27T00:00:00.000Z',
    },
    state: {
      workId,
      status,
      attemptCount: status === 'queued' ? 0 : 1,
      activeAttemptId: null,
      resultId: succeeded ? ResultId(`result-${status}`) : null,
      failure: status === 'failed' || status === 'unknown' ? FAILURE : null,
      cancelRequestedAt: status === 'canceled' ? '2026-08-27T00:00:01.000Z' : null,
      updatedAt: '2026-08-27T00:00:02.000Z',
    },
    attempts: [],
    result: succeeded ? {
      id: ResultId(`result-${status}`),
      workId,
      attemptId: AttemptId(`attempt-${status}`),
      kind: 'agent.run@1',
      output: { summary: 'Worker completed', assistantText: 'typed worker output' },
      createdAt: '2026-08-27T00:00:02.000Z',
    } : null,
  } as unknown as WorkView
}

function pendingNotification(index: number, view: WorkView, ownerSessionId = 'tool-owner'): Notification {
  const id = NotificationId(`notification-${index}`)
  return {
    id,
    workId: view.work.id,
    terminalSeq: index,
    attemptId: view.state.status === 'canceled' ? null : AttemptId(`attempt-${index}`),
    resultId: view.result?.id ?? null,
    ownerSessionId,
    messageId: `task-queue-notification:${id}`,
    status: 'pending',
    createdAt: `2026-08-27T00:00:0${index}.000Z`,
    acknowledgedAt: null,
  }
}

function queueFixture(
  ownerSessionId: string,
  views: readonly WorkView[],
  notifications: readonly Notification[] = [],
  acknowledge: AgentWorkQueue['acknowledgeNotification'] = async () => {},
): TaskQueue {
  return {
    forAgent(authority: VerifiedAgentAuthority) {
      const owned = authority.sessionId === ownerSessionId
      return {
        enqueue: vi.fn(),
        enqueueBatch: vi.fn(),
        list: () => owned ? views : [],
        get: (id: WorkId) => {
          const view = owned ? views.find(candidate => candidate.work.id === id) : undefined
          if (view === undefined) throw new Error(`WorkItem ${id} is not owned by this Agent session`)
          return view
        },
        cancel: vi.fn(),
        retry: vi.fn(),
        pendingNotifications: () => owned ? notifications : [],
        acknowledgeNotification: acknowledge,
      }
    },
    forOperator: vi.fn(),
    listKinds: () => ['agent.run@1'],
    registerHandler: vi.fn(),
  } as unknown as TaskQueue
}

function stableMessage(notification: Notification, view: WorkView): UserMessage {
  return freezeMessage({
    id: MessageId(notification.messageId),
    role: 'user',
    content: [{ type: 'text', text: renderNotification(view, notification) }],
    source: { kind: 'plugin', plugin: 'tool-task-queue', form: 'notice', summary: 'Background work completed' },
  })
}

async function proposedStep(ctx: Context, agent: Agent, decision: PreStepDecision): Promise<PreStepDecision> {
  return ctx.waterfall(
    agent.ctx as never,
    'agent/pre-step',
    { agent, messages: [], turn: 1, step: 1, signal: AbortSignal.any([]) },
    () => Promise.resolve(decision),
  )
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('condition did not become true')
}

describe('v2 task queue tools', () => {
  it('declares the Session service needed for owner Notification delivery', () => {
    expect(inject).toEqual(['tools', 'taskQueue', 'sessions'])
  })

  it('keeps WorkKind-specific admission tools out of the generic toolkit', () => {
    const kit = createToolTaskQueue({ taskQueue: queueFixture('tool-owner', []) })
    expect(kit.tools.map(tool => tool.name)).not.toContain('task_queue_enqueue')
    expect(kit.tools.map(tool => tool.name)).not.toContain('task_queue_enqueue_batch')
  })

  it.each([
    ['queued', null, null],
    ['running', null, null],
    ['succeeded', { summary: 'Worker completed', assistantText: 'typed worker output' }, null],
    ['failed', null, FAILURE],
    ['canceled', null, null],
    ['unknown', null, FAILURE],
  ] as const)('returns explicit %s result state without implicit delivery', async (status, output, failure) => {
    const context = new Context()
    await context.plugin(SessionStore)
    const session = context.sessions.create(SessionId('tool-owner'))
    const view = workView(status)
    const tool = createToolTaskQueue({ taskQueue: queueFixture('tool-owner', [view]) }).tools
      .find(item => item.name === 'task_queue_result')!

    await expect(tool.execute({ id: view.work.id }, { agent: { session } } as never)).resolves.toEqual({
      id: view.work.id,
      status,
      output,
      failure,
    })
    await context.fiber.dispose()
  })

  it('rejects task_queue_result for a foreign owner Session', async () => {
    const context = new Context()
    await context.plugin(SessionStore)
    const session = context.sessions.create(SessionId('foreign-owner'))
    const view = workView('succeeded')
    const tool = createToolTaskQueue({ taskQueue: queueFixture('tool-owner', [view]) }).tools
      .find(item => item.name === 'task_queue_result')!

    await expect(tool.execute({ id: view.work.id }, { agent: { session } } as never)).rejects.toThrow(/not owned/)
    await context.fiber.dispose()
  })

  it('renders the exact stable owner message without executor-controlled fields', () => {
    const view = workView('succeeded')
    const notification = {
      ...pendingNotification(1, view),
      attemptId: AttemptId('attempt-1'),
      resultId: ResultId('result-1'),
      assistantText: 'MALICIOUS_ASSISTANT_TEXT',
      stderr: 'MALICIOUS_STDERR',
      prompt: 'MALICIOUS_PROMPT',
      path: 'C:\\secret\\MALICIOUS_PATH',
      attachment: { name: 'MALICIOUS_ATTACHMENT' },
    }

    const rendered = renderNotification(view, notification)
    expect(rendered).toBe([
      'Background work reached a terminal outcome.',
      'Work: work succeeded (work-succeeded)',
      'Attempt: attempt-1',
      'Outcome: succeeded',
      'Result: result-1',
      'Inspect the durable result with task_queue_result.',
    ].join('\n'))
    expect(rendered).not.toMatch(/MALICIOUS/)
  })
})

describe('owner Notification delivery', () => {
  async function setup(options: { count?: number; max?: number; owner?: string; acknowledge?: AgentWorkQueue['acknowledgeNotification'] } = {}) {
    const owner = options.owner ?? 'tool-owner'
    const context = new Context()
    await context.plugin(SessionStore)
    const session = context.sessions.create(SessionId(owner))
    const views = Array.from({ length: options.count ?? 1 }, (_, index) => {
      const base = workView('succeeded', owner)
      const workId = WorkId(`work-${index + 1}`)
      return { ...base, work: { ...base.work, id: workId, title: `work ${index + 1}` }, state: { ...base.state, workId } }
    }) as WorkView[]
    const notifications = views.map((view, index) => pendingNotification(index + 1, view, owner))
    const queue = queueFixture(owner, views, notifications, options.acknowledge)
    const dispose = installNotificationDelivery(context, { taskQueue: queue, maxNotificationsPerStep: options.max ?? 1 })
    const agent = { id: session.id, session, ctx: context } as Agent
    return { context, session, views, notifications, agent, dispose }
  }

  it('adds stable messages only after downstream accepts the proposed step', async () => {
    const { context, notifications, agent } = await setup()
    const entered = await proposedStep(context, agent, { kind: 'enter', messages: [] })
    expect(entered.kind).toBe('enter')
    if (entered.kind === 'enter') {
      expect(entered.messages.map(message => message.id)).toEqual([MessageId(notifications[0]!.messageId)])
    }

    const rejected = await proposedStep(context, agent, { kind: 'reject' })
    expect(rejected).toEqual({ kind: 'reject' })
    await context.fiber.dispose()
  })

  it('isolates pending Notifications by the live Agent Session', async () => {
    const { context, session, notifications } = await setup()
    const foreign = context.sessions.create(SessionId('foreign-owner'))
    const agent = { id: foreign.id, session: foreign, ctx: context } as Agent
    const decision = await proposedStep(context, agent, { kind: 'enter', messages: [] })
    expect(decision.kind === 'enter' ? decision.messages : []).toEqual([])
    expect(messageAccepted(session.events, message => message.id === notifications[0]!.messageId)).toBe(false)
    await context.fiber.dispose()
  })

  it('limits each accepted step to maxNotificationsPerStep', async () => {
    const { context, agent } = await setup({ count: 3, max: 2 })
    const decision = await proposedStep(context, agent, { kind: 'enter', messages: [] })
    expect(decision.kind === 'enter' ? decision.messages.map(message => message.id) : []).toEqual([
      MessageId('task-queue-notification:notification-1'),
      MessageId('task-queue-notification:notification-2'),
    ])
    await context.fiber.dispose()
  })

  it('flushes the durable user/message before acknowledging exactly once', async () => {
    const order: string[] = []
    const gate = Promise.withResolvers<undefined>()
    let flushes = 0
    const acknowledge = vi.fn(async () => { order.push('ack') })
    const { context, session, notifications, views, agent } = await setup({ acknowledge })
    context.on('session/flush', async () => { flushes += 1; order.push('flush'); await gate.promise })
    const decision = await proposedStep(context, agent, { kind: 'enter', messages: [] })
    if (decision.kind !== 'enter') throw new Error('test requires an accepted step')
    const message = decision.messages[0]!
    session.append('user/message', message, { surfaceOp: 'append' })

    await eventually(() => flushes === 1)
    await proposedStep(context, agent, { kind: 'enter', messages: [] })
    expect(flushes).toBe(1)
    expect(acknowledge).not.toHaveBeenCalled()
    gate.resolve(undefined)
    await eventually(() => acknowledge.mock.calls.length === 1)
    expect(order).toEqual(['flush', 'ack'])
    expect(acknowledge).toHaveBeenCalledWith(notifications[0]!.id, notifications[0]!.messageId)
    expect(messageAccepted(session.events, candidate => candidate.id === message.id)).toBe(true)
    expect(message.content[0]).toEqual({ type: 'text', text: renderNotification(views[0]!, notifications[0]!) })
    await context.fiber.dispose()
  })

  it('leaves a Notification pending when Session flush rejects', async () => {
    const acknowledge = vi.fn()
    const { context, session, agent } = await setup({ acknowledge })
    context.on('session/flush', () => { throw new Error('disk full') })
    const decision = await proposedStep(context, agent, { kind: 'enter', messages: [] })
    if (decision.kind !== 'enter') throw new Error('test requires an accepted step')
    session.append('user/message', decision.messages[0]!, { surfaceOp: 'append' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(acknowledge).not.toHaveBeenCalled()
    await context.fiber.dispose()
  })

  it('acknowledges an existing durable message after restart without reinjection', async () => {
    const context = new Context()
    await context.plugin(SessionStore)
    const session = context.sessions.create(SessionId('tool-owner'))
    const view = workView('succeeded')
    const notification = pendingNotification(1, view)
    session.append('user/message', stableMessage(notification, view), { surfaceOp: 'append' })
    const acknowledge = vi.fn()
    installNotificationDelivery(context, {
      taskQueue: queueFixture('tool-owner', [view], [notification], acknowledge),
      maxNotificationsPerStep: 1,
    })
    context.on('session/flush', () => {})
    const agent = { id: session.id, session, ctx: context } as Agent

    const decision = await proposedStep(context, agent, { kind: 'enter', messages: [] })
    expect(decision.kind === 'enter' ? decision.messages : []).toEqual([])
    await eventually(() => acknowledge.mock.calls.length === 1)
    expect(acknowledge).toHaveBeenCalledWith(notification.id, notification.messageId)
    await context.fiber.dispose()
  })

  it('stops injecting and finalizing after delivery disposal', async () => {
    const acknowledge = vi.fn()
    const { context, session, notifications, views, agent, dispose } = await setup({ acknowledge })
    dispose()
    const decision = await proposedStep(context, agent, { kind: 'enter', messages: [] })
    expect(decision.kind === 'enter' ? decision.messages : []).toEqual([])
    session.append('user/message', stableMessage(notifications[0]!, views[0]!), { surfaceOp: 'append' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(acknowledge).not.toHaveBeenCalled()
    await context.fiber.dispose()
  })

  it('cancels a blocked delivery finalizer when the applied plugin fiber unloads', async () => {
    const owner = 'tool-owner'
    const context = new Context()
    await context.plugin(SessionStore)
    const session = context.sessions.create(SessionId(owner))
    const view = workView('succeeded', owner)
    const notification = pendingNotification(1, view, owner)
    const notifications = [notification]
    const acknowledge = vi.fn()
    const flushGate = Promise.withResolvers<undefined>()
    let flushes = 0
    const tools = { register: vi.fn() }
    context.provide('taskQueue', queueFixture(owner, [view], notifications, acknowledge) as never)
    context.provide('tools', tools as never)
    context.on('session/flush', async () => {
      flushes += 1
      await flushGate.promise
    })
    const plugin = await context.plugin({ name: 'tool-task-queue-lifecycle', inject: [...inject], apply }, {
      maxNotificationsPerStep: 1,
    }).await()
    const agent = { id: session.id, session, ctx: context } as Agent

    const decision = await proposedStep(context, agent, { kind: 'enter', messages: [] })
    if (decision.kind !== 'enter') throw new Error('test requires an accepted step')
    session.append('user/message', decision.messages[0]!, { surfaceOp: 'append' })
    await eventually(() => flushes === 1)

    await plugin.dispose()
    flushGate.resolve(undefined)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(acknowledge).not.toHaveBeenCalled()

    const later = pendingNotification(2, view, owner)
    notifications.push(later)
    const afterUnload = await proposedStep(context, agent, { kind: 'enter', messages: [] })
    expect(afterUnload.kind === 'enter' ? afterUnload.messages : []).toEqual([])
    expect(tools.register).toHaveBeenCalledTimes(7)
    await context.fiber.dispose()
  })

  it('reopens real Queue state and finalizes an existing durable message without duplication', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-owner-delivery-restart-'))
    const owner = SessionId('real-owner')
    const handler = {
      kind: 'agent.run@1' as never,
      async resolveAdmission(input: unknown) { return input },
      resources() { return [] },
      policy() { return { maxAttempts: 1 } },
      async prepare(resolved: unknown) { return resolved },
      start() { return { done: Promise.resolve({ status: 'succeeded', output: { marker: 'durable-result' } } as never), async cancel() {} } },
    } as WorkHandler<never>
    try {
      const first = new Context()
      await first.plugin(SessionStore)
      const firstSession = first.sessions.create(owner)
      const firstQueue = new LocalTaskQueue(first, { queueRoot: root })
      firstQueue.registerHandler(handler)
      const firstAgentQueue = firstQueue.forAgent(createVerifiedAgentAuthority(firstSession))
      const workId = await firstAgentQueue.enqueue({
        kind: 'agent.run@1', title: 'real delivery', input: { prompt: 'deterministic' }, idempotencyKey: 'real-delivery',
      } as never)
      await eventually(() => firstAgentQueue.pendingNotifications().length === 1)
      const firstNotification = firstAgentQueue.pendingNotifications()[0]!
      installNotificationDelivery(first, { taskQueue: firstQueue, maxNotificationsPerStep: 1 })
      first.on('session/flush', () => { throw new Error('disk full') })
      const firstAgent = { id: firstSession.id, session: firstSession, ctx: first } as Agent
      const firstDecision = await proposedStep(first, firstAgent, { kind: 'enter', messages: [] })
      if (firstDecision.kind !== 'enter') throw new Error('test requires accepted delivery')
      expect(firstDecision.messages.map(message => message.id)).toEqual([MessageId(firstNotification.messageId)])
      firstSession.append('user/message', firstDecision.messages[0]!, { surfaceOp: 'append' })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(firstAgentQueue.pendingNotifications()).toHaveLength(1)
      const persistedEvents = firstSession.events
      await first.fiber.dispose()

      const second = new Context()
      await second.plugin(SessionStore)
      const resumedSession = second.sessions.create(owner, { seed: persistedEvents })
      const reopenedQueue = new LocalTaskQueue(second, { queueRoot: root })
      await eventually(() => reopenedQueue.forAgent(createVerifiedAgentAuthority(resumedSession)).pendingNotifications().length === 1)
      installNotificationDelivery(second, { taskQueue: reopenedQueue, maxNotificationsPerStep: 1 })
      let flushes = 0
      second.on('session/flush', () => { flushes += 1 })
      const resumedAgent = { id: resumedSession.id, session: resumedSession, ctx: second } as Agent
      const resumedDecision = await proposedStep(second, resumedAgent, { kind: 'enter', messages: [] })
      expect(resumedDecision.kind === 'enter' ? resumedDecision.messages : []).toEqual([])
      const resumedQueue = reopenedQueue.forAgent(createVerifiedAgentAuthority(resumedSession))
      await eventually(() => resumedQueue.pendingNotifications().length === 0)
      expect(flushes).toBe(1)
      expect(resumedSession.events.filter(event => event.type === 'user/message' && event.data.id === firstNotification.messageId)).toHaveLength(1)
      const resultTool = createToolTaskQueue({ taskQueue: reopenedQueue }).tools.find(tool => tool.name === 'task_queue_result')!
      await expect(resultTool.execute({ id: workId }, { agent: { session: resumedSession } } as never)).resolves.toMatchObject({
        id: workId,
        status: 'succeeded',
        output: { marker: 'durable-result' },
      })
      await second.fiber.dispose()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
