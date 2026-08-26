import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import {
  TASK_QUEUE_HOST_ACCESS,
  assertTaskQueueAccess,
  taskQueueAgentAccess,
} from '@deepseek-ai/dsh-task-queue'
import type {
  ExecutorAdapter,
} from '@deepseek-ai/dsh-task-queue'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LocalTaskQueue from '../src/index.ts'

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  context = undefined
  root = undefined
})

async function createQueue(intervalMs = 60_000): Promise<Context['taskQueue']> {
  root = await mkdtemp(join(tmpdir(), 'dsh-task-queue-authorization-'))
  context = new Context()
  await context.plugin(LocalSubprocessRuntime)
  await context.plugin(LocalTaskQueue, {
    queueRoot: root,
    intervalMs,
    maxConcurrent: 1,
    maxConcurrentPerExecutor: 1,
    executors: { dsh: { enabled: true } },
  })
  return context.taskQueue
}

function spec(title: string, idempotencyKey?: string) {
  return {
    title,
    prompt: 'run',
    executor: 'dsh',
    maxAttempts: 1,
    workspaceDir: root!,
    outputDir: join(root!, 'output'),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error('waitFor timeout')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('LocalTaskQueue authorization', () => {
  it('rejects copied access objects that were not minted by the Service Definition', () => {
    const access = taskQueueAgentAccess('session-alice')

    expect(() => {
      assertTaskQueueAccess({ ...access })
    }).toThrow(/access is required/)
  })

  it('binds agent ownership and namespaces idempotency by authenticated actor', async () => {
    const queue = await createQueue()
    const alice = taskQueueAgentAccess('session-alice')
    const bob = taskQueueAgentAccess('session-bob')

    const aliceId = await queue.enqueueFromTool(alice, spec('alice', 'shared-key'))
    const duplicateId = await queue.enqueueFromTool(alice, spec('alice duplicate', 'shared-key'))
    const bobId = await queue.enqueueFromTool(bob, spec('bob', 'shared-key'))

    expect(duplicateId).toBe(aliceId)
    expect(bobId).not.toBe(aliceId)
    expect(queue.get(alice, aliceId).ownerSessionId).toBe('session-alice')
    expect(queue.get(bob, bobId).ownerSessionId).toBe('session-bob')
  })

  it('filters ownership before limits and hides foreign or ownerless task ids', async () => {
    const queue = await createQueue()
    const alice = taskQueueAgentAccess('session-alice')
    const bob = taskQueueAgentAccess('session-bob')
    const bobId = await queue.enqueueFromTool(bob, spec('bob first'))
    const aliceId = await queue.enqueueFromTool(alice, spec('alice second'))
    const ownerlessId = await queue.enqueueFromTool(TASK_QUEUE_HOST_ACCESS, spec('host'))

    expect(queue.list(alice, { limit: 1 }).map(task => task.id)).toEqual([aliceId])
    expect(() => queue.get(alice, bobId)).toThrow(`unknown task ${bobId}`)
    expect(() => queue.get(alice, ownerlessId)).toThrow(`unknown task ${ownerlessId}`)
    await expect(queue.cancel(alice, bobId)).rejects.toThrow(`unknown task ${bobId}`)
    await expect(queue.retry(alice, bobId)).rejects.toThrow(`unknown task ${bobId}`)
    await expect(queue.dismiss(alice, bobId, true)).rejects.toThrow(`unknown task ${bobId}`)

    expect(queue.list(TASK_QUEUE_HOST_ACCESS).map(task => task.id)).toEqual([bobId, aliceId, ownerlessId])
    expect(queue.get(TASK_QUEUE_HOST_ACCESS, ownerlessId).ownerSessionId).toBeNull()
    await expect(queue.cancel(TASK_QUEUE_HOST_ACCESS, ownerlessId)).resolves.toBe('canceled')
  })

  it('scopes counters to visible tasks while retaining global service health', async () => {
    const queue = await createQueue()
    const alice = taskQueueAgentAccess('session-alice')
    const bob = taskQueueAgentAccess('session-bob')
    await queue.enqueueFromTool(alice, spec('alice one'))
    await queue.enqueueFromTool(alice, spec('alice two'))
    await queue.enqueueFromTool(bob, spec('bob'))
    await queue.enqueueFromTool(TASK_QUEUE_HOST_ACCESS, spec('host'))

    expect(queue.stats(alice)).toMatchObject({
      serviceState: 'running',
      byStatus: { pending: 2 },
      byExecutor: { dsh: 2 },
    })
    expect(queue.stats(TASK_QUEUE_HOST_ACCESS)).toMatchObject({
      serviceState: 'running',
      byStatus: { pending: 4 },
      byExecutor: { dsh: 4 },
    })
  })

  it('scopes notification listing and acknowledgement to the owner', async () => {
    const queue = await createQueue(5)
    const alice = taskQueueAgentAccess('session-alice')
    const bob = taskQueueAgentAccess('session-bob')
    const adapter: ExecutorAdapter = {
      async prepare() {
        return {
          argv: [process.execPath, '-e', 'process.stdout.write("done")'],
          cwd: root!,
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: 1_024 },
            stderr: { maxBytes: 1_024 },
          },
          graceMs: 100,
        }
      },
    }
    queue.registerExecutor('dsh', adapter)
    const taskId = await queue.enqueueFromTool(alice, spec('notify alice'))
    await waitFor(() => queue.get(alice, taskId).status === 'succeeded')

    const [notification] = queue.listNotifications(alice)
    expect(notification?.ownerSessionId).toBe('session-alice')
    expect(queue.listNotifications(bob)).toEqual([])
    await expect(queue.ackNotification(bob, notification!.notificationId, notification!.messageId))
      .rejects.toThrow(`unknown notification ${notification!.notificationId}`)
    await queue.ackNotification(alice, notification!.notificationId, notification!.messageId)
    expect(queue.listNotifications(alice)[0]?.status).toBe('acknowledged')
    expect(queue.listNotifications(TASK_QUEUE_HOST_ACCESS)).toHaveLength(1)
  })

  it('admits pause and resume only with host access', async () => {
    const queue = await createQueue()
    const alice = taskQueueAgentAccess('session-alice')

    expect(() => {
      Reflect.apply(queue.pause.bind(queue), queue, [alice])
    }).toThrow(/host access/)
    queue.pause(TASK_QUEUE_HOST_ACCESS)
    expect(queue.stats(TASK_QUEUE_HOST_ACCESS).serviceState).toBe('paused')
    queue.resume(TASK_QUEUE_HOST_ACCESS)
    expect(queue.stats(TASK_QUEUE_HOST_ACCESS).serviceState).toBe('running')
  })
})
