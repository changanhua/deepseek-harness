import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalTaskQueue from '@deepseek-ai/dsh-task-queue-local'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import {
  createToolTaskQueue,
  markerLine,
} from '../src/index.ts'
import type { ToolTaskQueueDeps } from '../src/index.ts'
import type { TaskQueue } from '@deepseek-ai/dsh-task-queue'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Golden vertical integration: real LocalTaskQueue + LocalSubprocessRuntime +
 * tool-task-queue pre-step/finalizer, proving the full business loop:
 *
 *   tool enqueue (owner session A)
 *     → LocalTaskQueue admission + durable notification outbox
 *     → scheduler claim → spawn → settle (succeeded TaskResult)
 *     → durable NotificationRecord(owner=A)
 *     → pre-step injects notification message into session A
 *     → session append observed → flush → CAS ack → acknowledged
 *
 * Only the persistence boundary (flushSession) is stubbed; the queue,
 * scheduler, executor, notification outbox, and pre-step/finalizer are real.
 */

let contexts: Context[] = []
let roots: string[] = []

afterEach(async () => {
  for (const context of contexts.reverse()) {
    await context.fiber.dispose().catch(() => {})
  }
  for (const root of roots) {
    await rm(root, { recursive: true, force: true }).catch(() => {})
  }
  contexts = []
  roots = []
  vi.restoreAllMocks()
})

function fakeAgent(session: Session): Agent {
  return { session, id: session.id, options: {}, status: 'idle', inbox: {}, ctx: {} } as unknown as Agent
}

function appendText(session: Session, text: string): void {
  session.append('user/message', {
    role: 'user',
    id: `m-${session.seq}` as never,
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }, { surfaceOp: 'append' })
}

async function poll(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start >= timeoutMs) throw new Error('poll timeout')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

interface QueueLike {
  enqueueFromTool(spec: unknown): Promise<import('@deepseek-ai/dsh-task-queue').TaskId>
  get(id: import('@deepseek-ai/dsh-task-queue').TaskId): {
    status: string
    result: { summary: string; exitCode: number; stdoutTail?: string } | null
    ownerSessionId: string | null
  }
  listNotifications(filter: { ownerSessionId: string }): Array<{
    notificationId: import('@deepseek-ai/dsh-task-queue').NotificationId
    messageId: string
    status: string
    ownerSessionId: string
    taskId: import('@deepseek-ai/dsh-task-queue').TaskId
  }>
  ackNotification(notificationId: import('@deepseek-ai/dsh-task-queue').NotificationId, messageId: string): Promise<void>
}

describe('vertical business loop', () => {
  it('enqueues from a tool, settles, delivers a notification back to the owner session, and acks it', { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-task-queue-vertical-'))
    roots.push(root)
    // Write a real node script that produces stdout + an artifact.
    const script = join(root, 'work.cjs')
    const outputDir = join(root, 'output')
    await writeFile(script, [
      'const { writeFileSync } = require(\'node:fs\')',
      'process.stdout.write(\'vertical-result\\n\')',
      'writeFileSync(process.argv[2], \'done\\n\')',
      '',
    ].join('\n'), 'utf8')

    // Mount the real backend.
    const context = new Context()
    contexts.push(context)
    await context.plugin(LocalSubprocessRuntime)
    await context.plugin(LocalTaskQueue, {
      queueRoot: root,
      intervalMs: 5,
      maxConcurrent: 1,
      maxConcurrentPerExecutor: 1,
      executors: { node: { enabled: true } },
    } as never)

    const queue = context.taskQueue as unknown as QueueLike

    // Build the tool toolkit bound to the real queue. Only flushSession is
    // stubbed (it returns true to stand in for a real persistence listener).
    const session = Session.create(SessionId('s-owner-A'))
    const flushSpy = vi.fn<(s: typeof session) => Promise<boolean>>(async () => true)
    const deps: ToolTaskQueueDeps = {
      taskQueue: context.taskQueue as unknown as TaskQueue,
      sessionEvents: s => s.events,
      flushSession: flushSpy,
    }
    const kit = createToolTaskQueue(deps)
    const agent = fakeAgent(session)

    // Step 1: enqueue through the tool with the owner agent.
    const enqueue = kit.tools.find(t => t.name === 'task_queue_enqueue')!
    const taskId = (await enqueue.execute({
      spec: {
        title: 'vertical task',
        prompt: JSON.stringify({ script, args: [join(outputDir, 'artifact.txt')] }),
        executor: 'node',
        maxAttempts: 1,
        outputDir,
      },
    }, { agent } as never) as { id: string }).id

    // Step 2: wait for the task to succeed and produce a notification.
    await poll(() => {
      let status = 'unknown'
      try { status = queue.get(taskId as never).status } catch { /* boot */ }
      return status === 'succeeded'
    })

    const task = queue.get(taskId as never)
    expect(task.status).toBe('succeeded')
    expect(task.result?.summary).toMatch(/^exit 0/)
    expect(task.result?.exitCode).toBe(0)
    expect(task.result?.stdoutTail).toContain('vertical-result')
    expect(task.ownerSessionId).toBe('s-owner-A')

    // Step 3: a notification must exist for the owner session.
    await poll(() => queue.listNotifications({ ownerSessionId: 's-owner-A' }).length > 0)
    const notifications = queue.listNotifications({ ownerSessionId: 's-owner-A' })
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.status).toBe('pending')
    expect(notifications[0]!.ownerSessionId).toBe('s-owner-A')

    // Step 4: the pre-step must inject the notification message (with outcome
    // summary) into the session.
    const decision = kit.preStep(agent, { kind: 'enter', messages: [] } as PreStepDecision)
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('expected enter')
    expect(decision.messages).toHaveLength(1)
    let text = ''
    for (const block of decision.messages[0]!.content) {
      if (block.type === 'text') text += block.text
    }
    expect(text).toContain('vertical task')
    expect(text).toContain('succeeded')
    expect(text).toContain('Outcome:')
    // The marker line is embedded.
    expect(text).toMatch(/\[task-queue-notification\s+\S+\s+\S+\]/)

    // Step 5: append the notification message to the session (simulating the
    // agent loop accepting the pre-step proposal), then route the append
    // through the session/event finalizer.
    appendText(session, text)
    const event = session.events.at(-1)!
    expect(event.type).toBe('user/message')
    kit.sessionEvent(session, event)

    // Step 6: the finalizer must flush and CAS-ack the notification.
    await poll(() => {
      const ns = queue.listNotifications({ ownerSessionId: 's-owner-A' })
      return ns.length === 1 && ns[0]!.status === 'acknowledged'
    })
    expect(flushSpy).toHaveBeenCalled()
    const acked = queue.listNotifications({ ownerSessionId: 's-owner-A' })[0]!
    expect(acked.status).toBe('acknowledged')

    // Step 7: a second pre-step must not re-inject the acknowledged notification.
    const secondDecision = kit.preStep(agent, { kind: 'enter', messages: [] } as PreStepDecision)
    expect(secondDecision.kind).toBe('enter')
    if (secondDecision.kind !== 'enter') throw new Error('expected enter')
    expect(secondDecision.messages).toHaveLength(0)
  })

  it('append-before-ack recovery: a marker already in the session is not re-injected but is still acked', { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-task-queue-append-before-ack-'))
    roots.push(root)

    const script = join(root, 'work.cjs')
    await writeFile(script, 'process.stdout.write(\'ok\\n\')\n', 'utf8')

    const context = new Context()
    contexts.push(context)
    await context.plugin(LocalSubprocessRuntime)
    await context.plugin(LocalTaskQueue, {
      queueRoot: root,
      intervalMs: 5,
      maxConcurrent: 1,
      maxConcurrentPerExecutor: 1,
      executors: { node: { enabled: true } },
    } as never)

    const queue = context.taskQueue as unknown as QueueLike
    const session = Session.create(SessionId('s-recover'))
    const flushSpy = vi.fn<(s: typeof session) => Promise<boolean>>(async () => true)
    const deps: ToolTaskQueueDeps = {
      taskQueue: context.taskQueue as unknown as TaskQueue,
      sessionEvents: s => s.events,
      flushSession: flushSpy,
    }
    const kit = createToolTaskQueue(deps)
    const agent = fakeAgent(session)

    // Enqueue and wait for success + notification.
    const enqueue = kit.tools.find(t => t.name === 'task_queue_enqueue')!
    const taskId = (await enqueue.execute({
      spec: {
        title: 'crash recovery',
        prompt: JSON.stringify({ script }),
        executor: 'node',
        maxAttempts: 1,
        outputDir: join(root, 'output'),
      },
    }, { agent } as never) as { id: string }).id

    await poll(() => {
      let status = 'unknown'
      try { status = queue.get(taskId as never).status } catch { /* boot */ }
      return status === 'succeeded'
    })
    await poll(() => queue.listNotifications({ ownerSessionId: 's-recover' }).length > 0)

    // Simulate the append-before-ack crash: the marker was appended to the
    // session before the ack persisted, then the process crashed.
    const notifications = queue.listNotifications({ ownerSessionId: 's-recover' })
    const record = notifications[0]!
    expect(record.status).toBe('pending')
    appendText(session, `Background task "crash recovery" reached succeeded.\n${markerLine(record.notificationId, record.messageId)}`)

    // Persist the marker before recreating the toolkit, while the queue
    // notification is still pending.
    expect(await flushSpy(session)).toBe(true)
    flushSpy.mockClear()
    const restartedKit = createToolTaskQueue(deps)

    // The next pre-step sees the marker already present. It must NOT re-inject
    // a duplicate message, but it MUST start the finalizer to flush and ack.
    const decision = restartedKit.preStep(agent, { kind: 'enter', messages: [] } as PreStepDecision)
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('expected enter')
    expect(decision.messages).toHaveLength(0) // no duplicate injection

    // The finalizer was launched; wait for the CAS ack.
    await poll(() => {
      const ns = queue.listNotifications({ ownerSessionId: 's-recover' })
      return ns.length === 1 && ns[0]!.status === 'acknowledged'
    })
    expect(flushSpy).toHaveBeenCalled()
  })
})
