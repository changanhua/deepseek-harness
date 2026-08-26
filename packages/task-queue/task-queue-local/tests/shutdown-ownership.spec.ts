import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalTaskQueue from '../src/index.ts'
import { TaskQueueStore } from '../src/store.ts'
import { acquireQueueOwnership } from '../src/lock.ts'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Shutdown ownership fence tests. The invariant under test: a LocalTaskQueue
 * must not release `owner.lock` until every possible old-owner durable write —
 * boot recovery, detached scheduler execution, and queued service mutation —
 * has reached quiescence. Each test drives the real LocalTaskQueue +
 * LocalSubprocessRuntime stack and only delays a leaf write to hold a race
 * open while another host attempts acquisition on the same queue root.
 */

interface OwnedQueue {
  enqueueFromTool(spec: unknown): Promise<string>
  get(id: string): { status: string }
  ackNotification(notificationId: unknown, messageId: string): Promise<void>
  listNotifications(filter: { ownerSessionId: string }): Array<{
    notificationId: string
    messageId: string
    ownerSessionId: string
    status: string
  }>
  mutate<T>(fn: () => Promise<T>): Promise<T>
}

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

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

/** Mount a real LocalTaskQueue on `root` and return its context + typed service. */
async function mountQueue(root: string, intervalMs = 5): Promise<{ context: Context; queue: OwnedQueue }> {
  const context = new Context()
  contexts.push(context)
  await context.plugin(LocalSubprocessRuntime)
  await context.plugin(LocalTaskQueue, {
    queueRoot: root,
    intervalMs,
    maxConcurrent: 1,
    maxConcurrentPerExecutor: 1,
    executors: { node: { enabled: true } },
  } as never)
  await context.fiber.await?.().catch(() => {})
  return { context, queue: context.taskQueue as unknown as OwnedQueue }
}

/** A node script that prints to stdout, writes an artifact, and exits 0. */
async function writeProductiveScript(root: string): Promise<{ script: string; outputDir: string }> {
  const script = join(root, 'task.cjs')
  const outputDir = join(root, 'output')
  await writeFile(script, [
    'const { writeFileSync } = require(\'node:fs\')',
    'process.stdout.write(\'did-work\\n\')',
    'writeFileSync(process.argv[2], \'artifact\\n\')',
    '',
  ].join('\n'), 'utf8')
  return { script, outputDir }
}

async function poll(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start >= timeoutMs) throw new Error('poll timeout')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

async function lockPresent(root: string): Promise<boolean> {
  try {
    await access(join(root, 'owner.lock'))
    return true
  } catch {
    return false
  }
}

describe('shutdown ownership fence', () => {
  it('holds owner.lock while a running execution is settling, releases it after disposal completes', async () => {
    const root = await tempRoot('dsh-task-queue-ownrace-')
    const { script, outputDir } = await writeProductiveScript(root)

    // Host A mounts and owns the root.
    const a = await mountQueue(root)
    const id = await a.queue.enqueueFromTool({
      title: 'slow settle',
      prompt: JSON.stringify({ script, args: [join(outputDir, 'artifact.txt')] }),
      executor: 'node',
      maxAttempts: 1,
      outputDir,
    })
    await poll(() => a.queue.get(id).status === 'running')

    // Gate the terminal settlement: the running task's executor produces its
    // output, but its `succeeded` durable write is held open until we release it.
    // oxlint-disable-next-line no-invalid-void-type -- Promise.withResolvers<void>() is a valid use of the void generic.
    const gate = Promise.withResolvers<void>()
    const originalAppend = TaskQueueStore.prototype.appendActive
    // oxlint-disable-next-line no-invalid-void-type -- Promise.withResolvers<void>() is a valid use of the void generic.
    const terminalWriteStarted = Promise.withResolvers<void>()
    vi.spyOn(TaskQueueStore.prototype, 'appendActive').mockImplementation(async function (this: TaskQueueStore, change) {
      if ((change as { op?: string }).op === 'succeeded' || (change as { op?: string }).op === 'canceled' || (change as { op?: string }).op === 'failed') {
        terminalWriteStarted.resolve()
        await gate.promise
      }
      return originalAppend.call(this, change)
    })

    // Begin disposal (not awaited): the disposer must block on the held settle.
    const disposeA = a.context.fiber.dispose()
    await terminalWriteStarted.promise

    // While A's settle is still held, the file remains owned.
    expect(await lockPresent(root)).toBe(true)
    // A fresh acquisition attempt on the same root must fail.
    await expect(acquireQueueOwnership(root)).rejects.toThrow()

    // Release the settle; A's disposer drains and releases the lock.
    gate.resolve()
    await disposeA

    expect(await lockPresent(root)).toBe(false)
    // A new host can now acquire the root.
    const ownership = await acquireQueueOwnership(root)
    await ownership.release()
  })

  it('waits for an in-flight FIFO mutation before releasing ownership', async () => {
    const root = await tempRoot('dsh-task-queue-ownfifo-')
    const { script } = await writeProductiveScript(root)

    const a = await mountQueue(root)

    // Gate the `created` durable write so an enqueue mutation stalls inside
    // the service FIFO after admission has already passed.
    // oxlint-disable-next-line no-invalid-void-type -- Promise.withResolvers<void>() is a valid use of the void generic.
    const gate = Promise.withResolvers<void>()
    // oxlint-disable-next-line no-invalid-void-type -- Promise.withResolvers<void>() is a valid use of the void generic.
    const createdStarted = Promise.withResolvers<void>()
    const originalAppend = TaskQueueStore.prototype.appendActive
    vi.spyOn(TaskQueueStore.prototype, 'appendActive').mockImplementation(async function (this: TaskQueueStore, change) {
      if ((change as { op?: string }).op === 'created') {
        createdStarted.resolve()
        await gate.promise
      }
      return originalAppend.call(this, change)
    })

    // Start the enqueue (unawaited); it has cleared admission and is stalled
    // on its durable append, holding the FIFO tail.
    const enqueuePromise = a.queue.enqueueFromTool({
      title: 'stalled mutation',
      prompt: JSON.stringify({ script, args: [join(root, 'out.txt')] }),
      executor: 'node',
      maxAttempts: 1,
      outputDir: join(root, 'output'),
    })
    await createdStarted.promise

    // Begin disposal: it drains the scheduler (empty) and then waitForMutationDrain
    // must block on the stalled enqueue tail.
    const disposePromise = a.context.fiber.dispose()

    // Give the disposer a beat to reach the drain; the lock must still be held.
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(await lockPresent(root)).toBe(true)
    // A fresh acquisition attempt fails while A's mutation is still in flight.
    await expect(acquireQueueOwnership(root)).rejects.toThrow()

    // Release the stalled mutation; A's disposer drains and releases the lock.
    gate.resolve()
    await enqueuePromise
    await disposePromise

    expect(await lockPresent(root)).toBe(false)
  })

  it('rejects every public mutation once disposed, but lets an in-flight settle finish', async () => {
    const root = await tempRoot('dsh-task-queue-ownreject-')
    const { script, outputDir } = await writeProductiveScript(root)

    const a = await mountQueue(root)
    const id = await a.queue.enqueueFromTool({
      title: 'dispose fence',
      prompt: JSON.stringify({ script, args: [join(outputDir, 'artifact.txt')] }),
      executor: 'node',
      maxAttempts: 1,
      outputDir,
    })
    await poll(() => a.queue.get(id).status === 'running')

    // Hold the terminal settle so the execution is still in flight at disposal.
    // oxlint-disable-next-line no-invalid-void-type -- Promise.withResolvers<void>() is a valid use of the void generic.
    const settleGate = Promise.withResolvers<void>()
    const originalAppend = TaskQueueStore.prototype.appendActive
    vi.spyOn(TaskQueueStore.prototype, 'appendActive').mockImplementation(async function (this: TaskQueueStore, change) {
      if ((change as { op?: string }).op === 'succeeded') {
        await settleGate.promise
      }
      return originalAppend.call(this, change)
    })

    // Begin disposal; it sets `disposed` immediately but blocks on the settle.
    const disposePromise = a.context.fiber.dispose()

    // New public admission/control must now be rejected.
    const queue = a.queue as unknown as {
      enqueueFromTool(spec: unknown): Promise<string>
      cancel(id: string): Promise<string>
      retry(id: string): Promise<string>
      dismiss(id: string, dismissed: boolean): Promise<void>
    }
    await expect(queue.enqueueFromTool({
      title: 'after dispose', prompt: JSON.stringify({ script }), executor: 'node', maxAttempts: 1, outputDir: join(root, 'o2'),
    })).rejects.toThrow(/shutting down/)
    await expect(queue.cancel(id)).rejects.toThrow(/shutting down/)
    await expect(queue.retry(id)).rejects.toThrow(/shutting down/)
    await expect(queue.dismiss(id, true)).rejects.toThrow(/shutting down/)
    await expect(a.queue.ackNotification('missing', 'missing')).rejects.toThrow(/shutting down/)

    // The in-flight settle is still allowed to complete, and disposal finishes.
    settleGate.resolve()
    await disposePromise

    expect(await lockPresent(root)).toBe(false)
  })

  it('owner handoff preserves durable state: consistent seq, no duplicate notification or run', async () => {
    const root = await tempRoot('dsh-task-queue-ownhandoff-')
    const { script, outputDir } = await writeProductiveScript(root)

    const a = await mountQueue(root)
    const id = await a.queue.enqueueFromTool({
      title: 'handoff',
      prompt: JSON.stringify({ script, args: [join(outputDir, 'artifact.txt')] }),
      executor: 'node',
      maxAttempts: 1,
      outputDir,
      ownerSessionId: 's-owner-handoff',
    })
    await poll(() => a.queue.get(id).status === 'succeeded')

    // Record A's durable view before teardown.
    const before = a.queue.get(id) as unknown as {
      status: string
      result: { summary: string; exitCode: number } | null
      runs: unknown[]
      ownerSessionId: string | null
      attempt: number
    }
    const beforeNotifications = a.queue.listNotifications({ ownerSessionId: 's-owner-handoff' })
    expect(before.ownerSessionId).toBe('s-owner-handoff')
    expect(beforeNotifications).toHaveLength(1)
    await a.context.fiber.dispose()

    // Host B acquires the same root and recovers the log. Boot is async, so
    // poll until the recovered task is visible before asserting state.
    const b = await mountQueue(root)
    await poll(() => {
      try { return b.queue.get(id).status === 'succeeded' } catch { return false }
    })
    const after = b.queue.get(id) as unknown as {
      status: string
      result: { summary: string; exitCode: number } | null
      runs: unknown[]
      ownerSessionId: string | null
      attempt: number
    }

    expect(after.status).toBe(before.status)
    expect(after.result).toEqual(before.result)
    expect(after.runs).toEqual(before.runs)
    expect(after.ownerSessionId).toBe(before.ownerSessionId)
    expect(after.attempt).toBe(before.attempt)
    expect(b.queue.listNotifications({ ownerSessionId: 's-owner-handoff' })).toEqual(beforeNotifications)

    // Read the durable log and assert seq continuity (no gap, no duplicate).
    const lines = (await readFile(join(root, 'active.jsonl'), 'utf8')).trim().split('\n').filter(Boolean)
    const seqs = lines.map(line => (JSON.parse(line) as { seq: number }).seq)
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe((seqs[i - 1] ?? 0) + 1)
    }
    // No duplicate seq values.
    expect(new Set(seqs).size).toBe(seqs.length)
  })
})
