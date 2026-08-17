import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalTaskQueue from '../src/index.ts'
import { TaskQueueStore } from '../src/store.ts'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Queue = {
  enqueueFromTool(spec: unknown): Promise<string>
  get(id: string): { status: string; result: { exitCode: number | null } | null }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start >= timeoutMs) throw new Error('waitFor timeout')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
  context = undefined
  root = undefined
})

describe('LocalTaskQueue lifecycle', () => {
  it('does not overwrite an admission made while startup recovery is finishing', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-task-queue-lifecycle-'))
    const script = join(root, 'task.cjs')
    const result = join(root, 'result.json')
    await writeFile(script, 'require(\'node:fs\').writeFileSync(process.argv[2], \'ok\')\n', 'utf8')

    const recoverStarted = Promise.withResolvers<void>()
    const releaseRecovery = Promise.withResolvers<void>()
    const recover = TaskQueueStore.prototype.recover
    vi.spyOn(TaskQueueStore.prototype, 'recover').mockImplementation(async function (this: TaskQueueStore) {
      const recovered = await recover.call(this)
      recoverStarted.resolve()
      await releaseRecovery.promise
      return recovered
    })

    context = new Context()
    await context.plugin(LocalSubprocessRuntime)
    await context.plugin(LocalTaskQueue, {
      queueRoot: root,
      intervalMs: 5,
      maxConcurrent: 1,
      maxConcurrentPerExecutor: 1,
      executors: { node: { enabled: true } },
    } as never)

    await recoverStarted.promise
    const queue = context.taskQueue as unknown as Queue
    const taskIdPromise = queue.enqueueFromTool({
      title: 'startup race',
      prompt: JSON.stringify({ script, args: [result] }),
      executor: 'node',
      maxAttempts: 1,
      outputDir: join(root, 'output'),
    })

    const admittedDuringRecovery = await Promise.race([
      taskIdPromise.then(() => true),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 50)),
    ])
    expect(admittedDuringRecovery).toBe(false)
    releaseRecovery.resolve()
    const taskId = await taskIdPromise
    await waitFor(() => {
      let status = 'unknown'
      try { status = queue.get(taskId).status } catch { /* wait for the hydrated task */ }
      return status === 'succeeded' || status === 'failed' || status === 'canceled'
    })

    expect(queue.get(taskId).status).toBe('succeeded')
    expect(queue.get(taskId).result?.exitCode).toBe(0)
  })
})
