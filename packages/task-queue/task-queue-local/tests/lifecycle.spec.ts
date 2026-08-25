import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalTaskQueue from '../src/index.ts'
import { TaskQueueStore } from '../src/store.ts'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

    // oxlint-disable-next-line no-invalid-void-type -- Promise.withResolvers<void>() is a valid use of the void generic.
    const recoverStarted = Promise.withResolvers<void>()
    // oxlint-disable-next-line no-invalid-void-type -- Promise.withResolvers<void>() is a valid use of the void generic.
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

  it('reclaims a stopping task when its settle callback is lost', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-task-queue-watchdog-'))
    const script = join(root, 'sleep.cjs')
    const result = join(root, 'out.txt')
    await writeFile(script, `setTimeout(() => require('node:fs').writeFileSync(process.argv[2], 'x'), 5000)
`, 'utf8')

    context = new Context()
    await context.plugin(LocalSubprocessRuntime)
    await context.plugin(LocalTaskQueue, {
      queueRoot: root,
      intervalMs: 5,
      maxConcurrent: 1,
      maxConcurrentPerExecutor: 1,
      stoppingGraceMs: 0,
      executors: { node: { enabled: true } },
    } as never)

    const queue = context.taskQueue as unknown as {
      enqueueFromTool(spec: unknown): Promise<string>
      cancel(id: string): Promise<'canceled' | 'stopping'>
      get(id: string): { status: string; runs: Array<{ terminationUnverified?: boolean }>; updatedAt: string }
      mutate<T>(fn: () => Promise<T>): Promise<T>
      housekeeping(): Promise<void>
      settle(): Promise<void>
    }

    const id = await queue.enqueueFromTool({
      title: 'lost settle watchdog',
      prompt: JSON.stringify({ script, args: [result] }),
      executor: 'node',
      maxAttempts: 1,
      timeoutMs: 5_000,
      outputDir: join(root, 'output'),
    })
    await waitFor(() => queue.get(id).status === 'running')

    // Simulate a lost settle callback: the child is terminated by cancel, but
    // the normal settle path is swallowed and never finalizes stopping.
    vi.spyOn(queue, 'settle').mockImplementation(async () => {})
    const outcome = await queue.cancel(id)
    expect(outcome).toBe('stopping')

    // Make the stopping task look ancient so the watchdog threshold is exceeded.
    const stuck = queue.get(id)
    stuck.updatedAt = new Date(Date.now() - 60_000).toISOString()

    // Stop the scheduler so only this test drives the watchdog pass.
    ;(queue as unknown as { scheduler: { stop(): void } }).scheduler.stop()
    await queue.mutate(() => queue.housekeeping())

    const recovered = queue.get(id)
    expect(recovered.status).toBe('canceled')
    expect(recovered.runs[recovered.runs.length - 1]?.terminationUnverified).toBe(true)
  })

  it('cancels a running task, finalizes to canceled, and keeps its output file absent', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-task-queue-cancel-running-'))
    const script = join(root, 'sleep.cjs')
    const result = join(root, 'should-not-exist.txt')
    await writeFile(script, `setTimeout(() => require('node:fs').writeFileSync(process.argv[2], 'done'), 5000)
`, 'utf8')

    context = new Context()
    await context.plugin(LocalSubprocessRuntime)
    await context.plugin(LocalTaskQueue, {
      queueRoot: root,
      intervalMs: 5,
      maxConcurrent: 1,
      maxConcurrentPerExecutor: 1,
      stoppingGraceMs: 1_000,
      executors: { node: { enabled: true } },
    } as never)

    const queue = context.taskQueue as unknown as {
      enqueueFromTool(spec: unknown): Promise<string>
      cancel(id: string): Promise<'canceled' | 'stopping'>
      get(id: string): { status: string }
    }

    const id = await queue.enqueueFromTool({
      title: 'cancel running',
      prompt: JSON.stringify({ script, args: [result] }),
      executor: 'node',
      maxAttempts: 1,
      timeoutMs: 5_000,
      outputDir: join(root, 'output'),
    })
    await waitFor(() => queue.get(id).status === 'running')

    const outcome = await queue.cancel(id)
    expect(outcome).toBe('stopping')
    await waitFor(() => queue.get(id).status === 'canceled')

    await expect(access(result)).rejects.toThrow()
  })

  it('records durationMs, logPath, output tails, and outputFiles on a succeeded task', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-task-queue-result-'))
    const script = join(root, 'produce.cjs')
    const outputDir = join(root, 'output')
    await writeFile(script, [
      'const { writeFileSync } = require(\'node:fs\')',
      'process.stdout.write(\'hello-stdout\\n\')',
      'process.stderr.write(\'hello-stderr\\n\')',
      'writeFileSync(process.argv[2], \'artifact\\n\')',
      '',
    ].join('\n'), 'utf8')

    context = new Context()
    await context.plugin(LocalSubprocessRuntime)
    await context.plugin(LocalTaskQueue, {
      queueRoot: root,
      intervalMs: 5,
      maxConcurrent: 1,
      maxConcurrentPerExecutor: 1,
      executors: { node: { enabled: true } },
    } as never)

    const queue = context.taskQueue as unknown as {
      enqueueFromTool(spec: unknown): Promise<string>
      get(id: string): {
        status: string
        result: {
          summary: string
          exitCode: number
          durationMs: number
          logPath?: string
          stdoutTail?: string
          stderrTail?: string
          outputFiles?: string[]
        } | null
      }
    }

    const id = await queue.enqueueFromTool({
      title: 'result enrichment',
      prompt: JSON.stringify({ script, args: [join(outputDir, 'artifact.txt')] }),
      executor: 'node',
      maxAttempts: 1,
      outputDir,
    })
    await waitFor(() => queue.get(id).status === 'succeeded')

    const result = queue.get(id).result!
    expect(result.summary).toMatch(/^exit 0, \d+\.\ds/)
    expect(result.exitCode).toBe(0)
    expect(result.durationMs).toBeGreaterThan(0)
    expect(result.logPath).toMatch(/runs[\\/].+[\\/]run-1\.log$/)
    expect(result.stdoutTail).toContain('hello-stdout')
    expect(result.stderrTail).toContain('hello-stderr')
    expect(result.outputFiles).toEqual(['artifact.txt'])
  })

  describe('dismiss', () => {
    async function mountDismissQueue(): Promise<{
      queue: {
        enqueueFromTool(spec: unknown): Promise<string>
        get(id: string): { status: string; dismissed: boolean; updatedAt: string }
        dismiss(id: string, dismissed: boolean): Promise<void>
        stats(): { undismissedFailed: number; byDismissed: number }
      }
      failScript: string
    }> {
      root = await mkdtemp(join(tmpdir(), 'dsh-task-queue-dismiss-'))
      const failScript = join(root, 'fail.cjs')
      await writeFile(failScript, 'process.exit(1)\n', 'utf8')
      context = new Context()
      await context.plugin(LocalSubprocessRuntime)
      await context.plugin(LocalTaskQueue, {
        queueRoot: root,
        intervalMs: 5,
        maxConcurrent: 1,
        maxConcurrentPerExecutor: 1,
        executors: { node: { enabled: true } },
      } as never)
      const queue = context.taskQueue as never as {
        enqueueFromTool(spec: unknown): Promise<string>
        get(id: string): { status: string; dismissed: boolean; updatedAt: string }
        dismiss(id: string, dismissed: boolean): Promise<void>
        stats(): { undismissedFailed: number; byDismissed: number }
      }
      return { queue, failScript }
    }

    async function driveToFailed(
      queue: { enqueueFromTool(spec: unknown): Promise<string>; get(id: string): { status: string } },
      failScript: string,
    ): Promise<string> {
      const id = await queue.enqueueFromTool({
        title: 'fail',
        prompt: JSON.stringify({ script: failScript }),
        executor: 'node',
        maxAttempts: 1,
        outputDir: join(root!, 'output'),
      })
      await waitFor(() => queue.get(id).status === 'failed')
      return id
    }

    it('dismisses a failed task: sets dismissed, emits task-queue/dismissed, leaves status', async () => {
      const { queue, failScript } = await mountDismissQueue()
      const id = await driveToFailed(queue, failScript)
      expect(queue.get(id).status).toBe('failed')

      let fired: { taskId: unknown; dismissed: boolean } | undefined
      context!.on('task-queue/dismissed', (p) => { fired = p })
      await queue.dismiss(id, true)

      expect(queue.get(id).dismissed).toBe(true)
      expect(queue.get(id).status).toBe('failed')
      expect(String(fired?.taskId)).toBe(id)
      expect(fired?.dismissed).toBe(true)
    })

    it('dismiss rejects a non-terminal task', async () => {
      const { queue } = await mountDismissQueue()
      const id = await queue.enqueueFromTool({
        title: 'pending',
        prompt: JSON.stringify({ script: 'x' }),
        executor: 'node',
        maxAttempts: 1,
        outputDir: join(root!, 'output'),
      })
      await expect(queue.dismiss(id, true)).rejects.toThrow(/terminal/)
    })

    it('dismiss is idempotent: same value is a no-op (no event, no updatedAt change)', async () => {
      const { queue, failScript } = await mountDismissQueue()
      const id = await driveToFailed(queue, failScript)
      await queue.dismiss(id, true)
      const before = queue.get(id).updatedAt
      let fired = false
      context!.on('task-queue/dismissed', () => { fired = true })
      await queue.dismiss(id, true)
      expect(queue.get(id).updatedAt).toBe(before)
      expect(fired).toBe(false)
    })

    it('undismiss restores dismissed=false and re-emits', async () => {
      const { queue, failScript } = await mountDismissQueue()
      const id = await driveToFailed(queue, failScript)
      await queue.dismiss(id, true)
      let fired: { dismissed: boolean } | undefined
      context!.on('task-queue/dismissed', (p) => { fired = p })
      await queue.dismiss(id, false)
      expect(queue.get(id).dismissed).toBe(false)
      expect(fired?.dismissed).toBe(false)
    })

    it('stats reports undismissedFailed and byDismissed', async () => {
      const { queue, failScript } = await mountDismissQueue()
      const a = await driveToFailed(queue, failScript)
      await driveToFailed(queue, failScript)
      await queue.dismiss(a, true)
      const s = queue.stats()
      expect(s.undismissedFailed).toBe(1) // only b remains attention
      expect(s.byDismissed).toBe(1)       // a is dismissed
    })
  })
})
