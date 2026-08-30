import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import TaskQueue, { type WorkHandler, type WorkKind } from '@deepseek-ai/dsh-task-queue'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { describe, expect, it, vi } from 'vitest'
import { AttemptId } from '@deepseek-ai/dsh-task-queue'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { Config as RuntimeConfig, apply, createOperationRunHandler } from '../src/index.ts'
import * as operationBridge from '../src/index.ts'
import type { Config } from '../src/types.ts'

const config: Config = { operations: { echo: {
  revision: 'echo/v1', description: 'Echo.', argv: ['node', 'echo.mjs'], cwd: '.', resource: 'ops',
  units: 1, maxAttempts: 2, collectBytes: 32, resultBytes: 8, failureTailBytes: 8, graceMs: 10, timeoutMs: 1000,
} } }
const signal = new AbortController().signal
const context = { attemptId: AttemptId('attempt-operation'), signal }
class TestQueue extends TaskQueue {
  private readonly handlers = new Map<WorkKind, WorkHandler<WorkKind>>()
  forAgent(): never { throw new Error('not used') }
  forOperator(): never { throw new Error('not used') }
  registerHandler<K extends WorkKind>(handler: WorkHandler<K>): ReturnType<TaskQueue['registerHandler']> {
    this.handlers.set(handler.kind, handler)
    const registration = (() => {
      this.handlers.delete(handler.kind)
    }) as ReturnType<TaskQueue['registerHandler']>
    registration.activate = () => undefined
    return registration
  }
  listKinds(): readonly WorkKind[] { return [...this.handlers.keys()] }
}
class TestSubprocess extends SubprocessRuntime {
  readonly executionWorld = 'local' as const
  resolveExecutable(): Promise<string> { return Promise.resolve('test') }
  spawn(): SubprocessHandle { return handle() }
  spawnTerminal(): never { throw new Error('not used') }
}
interface HandleOptions {
  exitCode?: number | null
  signal?: NodeJS.Signals | null
  stdout?: string
  stderr?: string
  quiescent?: boolean
  waitError?: Error
}
function handle(options: HandleOptions = {}): SubprocessHandle {
  const stream = new PassThrough()
  queueMicrotask(() => stream.end(options.stdout ?? ''))
  return {
    pid: 1,
    stdin: undefined,
    stdout: stream,
    stderr: undefined,
    collected: {
      stdout: { readFrom: () => ({ text: options.stdout ?? '', nextOffset: 0, lossy: false, spillPath: 'must-not-use' }) },
      stderr: { readFrom: () => ({ text: options.stderr ?? '', nextOffset: 0, lossy: false, spillPath: 'must-not-use' }) },
    },
    done: Promise.resolve({ exitCode: options.exitCode === undefined ? 0 : options.exitCode, signal: options.signal ?? null }),
    terminate() {},
    async waitForExit() {
      if (options.waitError !== undefined) throw options.waitError
      return options.quiescent ?? true
    },
  }
}

describe('operation.run@1 handler', () => {
  it('freezes allowlisted facts and spawns without an environment', async () => {
    const spawned: SubprocessSpawnSpec[] = []
    const handler = createOperationRunHandler(config, { spawn: (spec) => { spawned.push(spec); return handle({ stdout: 'abcdefghijk' }) } })
    const resolved = await handler.resolveAdmission({ operationId: ' echo ' }, { signal })
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(handler.resources(resolved)).toEqual([{ resource: 'ops', units: 1 }])
    expect(handler.policy(resolved)).toEqual({ maxAttempts: 2 })
    const live = handler.start(await handler.prepare(resolved, context), context)
    await expect(live.done).resolves.toEqual({ status: 'succeeded', output: { operationId: 'echo', revision: 'echo/v1', summary: 'operation completed; stdout truncated to 8 UTF-8 bytes', stdout: { text: 'abcdefgh', truncated: true } } })
    expect(spawned[0]).toMatchObject({ argv: ['node', 'echo.mjs'], cwd: '.', graceMs: 10 })
    expect(spawned[0]).not.toHaveProperty('env')
  })

  it('rejects unknown ids and prepares only existing directories', async () => {
    const handler = createOperationRunHandler(config, { spawn: () => handle() })
    await expect(handler.resolveAdmission({ operationId: 'missing' }, { signal })).rejects.toThrow(/operation\.run admission/)
    const resolved = await handler.resolveAdmission({ operationId: 'echo' }, { signal })
    await expect(handler.prepare({ ...resolved, cwd: join(tmpdir(), 'does-not-exist-operation-run') }, context)).rejects.toThrow(/operation\.run preparation/)
  })

  it('classifies synchronous spawn errors as not started', async () => {
    const handler = createOperationRunHandler(config, { spawn() { throw new Error('spawn failed') } })
    const resolved = await handler.resolveAdmission({ operationId: 'echo' }, { signal })
    await expect(handler.start(resolved, context).done).resolves.toMatchObject({ status: 'failed', failure: { category: 'operation-spawn', sideEffect: 'not-started' } })
  })

  it('waits for tree quiescence and classifies exit failures', async () => {
    const child = handle({ exitCode: 2, stderr: 'prefix-very-long-tail' })
    const wait = vi.spyOn(child, 'waitForExit')
    const handler = createOperationRunHandler(config, { spawn: () => child })
    const resolved = await handler.resolveAdmission({ operationId: 'echo' }, { signal })
    await expect(handler.start(resolved, context).done).resolves.toMatchObject({ status: 'failed', failure: { category: 'operation-exit', sideEffect: 'started' } })
    expect(wait).toHaveBeenCalledOnce()
  })

  it('makes cancellation terminate once and win an exit-zero race', async () => {
    let release!: () => void
    const child = handle()
    Object.assign(child, { done: new Promise((resolve) => { release = () => { resolve({ exitCode: 0, signal: null }) } }) })
    const terminate = vi.spyOn(child, 'terminate')
    const handler = createOperationRunHandler(config, { spawn: () => child })
    const resolved = await handler.resolveAdmission({ operationId: 'echo' }, { signal })
    const live = handler.start(resolved, context)
    await Promise.all([live.cancel('user'), live.cancel('again')])
    release()
    await expect(live.done).resolves.toEqual({ status: 'canceled' })
    expect(terminate).toHaveBeenCalledOnce()
  })

  it('reports unknown when tree quiescence cannot be proved', async () => {
    const handler = createOperationRunHandler(config, { spawn: () => handle({ quiescent: false }) })
    const resolved = await handler.resolveAdmission({ operationId: 'echo' }, { signal })
    await expect(handler.start(resolved, context).done).resolves.toMatchObject({ status: 'unknown', failure: { category: 'operation-quiescence', sideEffect: 'unknown' } })
  })

  it('treats a rejected handle promise as a not-started spawn failure', async () => {
    const child = handle()
    Object.assign(child, { done: Promise.reject(new Error('launch rejected')) })
    const handler = createOperationRunHandler(config, { spawn: () => child })
    const resolved = await handler.resolveAdmission({ operationId: 'echo' }, { signal })
    await expect(handler.start(resolved, context).done).resolves.toMatchObject({ status: 'failed', failure: { category: 'operation-spawn', sideEffect: 'not-started', retriable: true } })
  })

  it('uses a stdout pipe so the persisted result is the real stream head', async () => {
    const stdout = new PassThrough()
    const child = handle({ stdout: 'tail-only' })
    Object.assign(child, { stdout })
    const spawned: SubprocessSpawnSpec[] = []
    const handler = createOperationRunHandler(config, { spawn: (spec) => { spawned.push(spec); return child } })
    const resolved = await handler.resolveAdmission({ operationId: 'echo' }, { signal })
    const live = handler.start(resolved, context)
    stdout.end('first-eight-then-more')
    await expect(live.done).resolves.toMatchObject({ status: 'succeeded', output: { stdout: { text: 'first-ei', truncated: true } } })
    expect(spawned[0]?.stdio.stdout).toBe('pipe')
  })

  it('rejects zero grace, duplicate revisions, and prototype operation ids', () => {
    const operation = config.operations.echo
    if (operation === undefined) throw new Error('missing echo operation')
    expect(() => createOperationRunHandler(
      { operations: { echo: { ...operation, graceMs: 0 } } }, { spawn: () => handle() },
    )).toThrow(/operation\.run configuration/)
    expect(() => createOperationRunHandler(
      { operations: { first: operation, second: { ...operation } } }, { spawn: () => handle() },
    )).toThrow(/operation\.run configuration/)
    const handler = createOperationRunHandler(config, { spawn: () => handle() })
    return Promise.all(['constructor', 'toString'].map(operationId => expect(handler.resolveAdmission({ operationId }, { signal })).rejects.toThrow(/operation\.run admission/)))
  })

  it('returns a started timeout failure after the deadline terminates the process tree', async () => {
    vi.useFakeTimers()
    try {
      let release!: () => void
      const child = handle()
      Object.assign(child, { done: new Promise((resolve) => { release = () => { resolve({ exitCode: null, signal: 'SIGTERM' }) } }) })
      const terminate = vi.spyOn(child, 'terminate')
      const handler = createOperationRunHandler(config, { spawn: () => child })
      const resolved = await handler.resolveAdmission({ operationId: 'echo' }, { signal })
      const live = handler.start(resolved, context)
      await vi.advanceTimersByTimeAsync(1000)
      release()
      await expect(live.done).resolves.toMatchObject({ status: 'failed', failure: { category: 'operation-timeout', sideEffect: 'started' } })
      expect(terminate).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })

  it('renders a signal exit and the exact bounded stderr tail', async () => {
    const handler = createOperationRunHandler(config, {
      spawn: () => handle({ exitCode: null, signal: 'SIGTERM', stderr: 'prefix-终尾' }),
    })
    const resolved = await handler.resolveAdmission({ operationId: 'echo' }, { signal })
    const outcome = await handler.start(resolved, context).done
    expect(outcome).toMatchObject({ status: 'failed', failure: { category: 'operation-exit' } })
    expect(JSON.stringify(outcome)).toContain('终尾')
  })

  it('exposes a loader-visible runtime schema', () => {
    expect(typeof RuntimeConfig).toBe('function')
    const operation = config.operations.echo
    if (operation === undefined) throw new Error('missing echo operation')
    expect(() => RuntimeConfig({ operations: { echo: { ...operation, graceMs: 0 } } })).toThrow()
  })

  it('returns unknown when tree quiescence rejects', async () => {
    const handler = createOperationRunHandler(config, { spawn: () => handle({ waitError: new Error('tree probe failed') }) })
    const resolved = await handler.resolveAdmission({ operationId: 'echo' }, { signal })
    await expect(handler.start(resolved, context).done).resolves.toMatchObject({ status: 'unknown', failure: { category: 'operation-quiescence' } })
  })

  it('keeps the deadline after direct child close until termination makes the tree quiescent', async () => {
    vi.useFakeTimers()
    try {
      const child = handle()
      let quiesce!: () => void
      const waitForExit = vi.fn((bound?: AbortSignal) => new Promise<boolean>((resolve) => {
        if (bound !== undefined) bound.addEventListener('abort', () => { resolve(false) }, { once: true })
        else quiesce = () => { resolve(true) }
      }))
      Object.assign(child, { waitForExit, terminate: () => { quiesce() } })
      const terminate = vi.spyOn(child, 'terminate')
      const handler = createOperationRunHandler(config, { spawn: () => child })
      const resolved = await handler.resolveAdmission({ operationId: 'echo' }, { signal })
      const live = handler.start(resolved, context)
      await vi.advanceTimersByTimeAsync(1000)
      await expect(live.done).resolves.toMatchObject({ status: 'failed', failure: { category: 'operation-timeout', sideEffect: 'started' } })
      expect(terminate).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })

  it('classifies a missing stdout pipe as started output loss', async () => {
    const child = handle()
    Object.assign(child, { stdout: undefined })
    const handler = createOperationRunHandler(config, { spawn: () => child })
    const resolved = await handler.resolveAdmission({ operationId: 'echo' }, { signal })
    await expect(handler.start(resolved, context).done).resolves.toMatchObject({ status: 'unknown', failure: { category: 'operation-output', sideEffect: 'unknown' } })
  })

  it('observes stdout pipe errors even when the process exits nonzero', async () => {
    const stdout = new PassThrough()
    const child = handle({ exitCode: 3 })
    Object.assign(child, { stdout })
    const handler = createOperationRunHandler(config, { spawn: () => child })
    const resolved = await handler.resolveAdmission({ operationId: 'echo' }, { signal })
    const live = handler.start(resolved, context)
    stdout.destroy(new Error('collector lost'))
    await expect(live.done).resolves.toMatchObject({ status: 'unknown', failure: { category: 'operation-output', sideEffect: 'unknown' } })
  })

  it('lets cancellation win over a concurrent stdout pipe error', async () => {
    const stdout = new PassThrough()
    const child = handle()
    Object.assign(child, { stdout })
    const handler = createOperationRunHandler(config, { spawn: () => child })
    const resolved = await handler.resolveAdmission({ operationId: 'echo' }, { signal })
    const live = handler.start(resolved, context)
    await live.cancel('operator')
    stdout.destroy(new Error('collector lost'))
    await expect(live.done).resolves.toEqual({ status: 'canceled' })
  })

  it('lets timeout win over a concurrent stdout pipe error', async () => {
    vi.useFakeTimers()
    try {
      const stdout = new PassThrough()
      const child = handle()
      Object.assign(child, { stdout })
      const handler = createOperationRunHandler(config, { spawn: () => child })
      const resolved = await handler.resolveAdmission({ operationId: 'echo' }, { signal })
      const live = handler.start(resolved, context)
      await vi.advanceTimersByTimeAsync(1000)
      stdout.destroy(new Error('collector lost'))
      await expect(live.done).resolves.toMatchObject({ status: 'failed', failure: { category: 'operation-timeout', sideEffect: 'started' } })
    } finally { vi.useRealTimers() }
  })

  it('accepts timer limits at MAX and rejects MAX plus one in schema and factory', () => {
    const operation = config.operations.echo
    if (operation === undefined) throw new Error('missing echo operation')
    const atMax = { ...operation, graceMs: MAX_TIMER_DELAY_MS, timeoutMs: MAX_TIMER_DELAY_MS }
    expect(() => RuntimeConfig({ operations: { echo: atMax } })).not.toThrow()
    expect(() => createOperationRunHandler({ operations: { echo: atMax } }, { spawn: () => handle() })).not.toThrow()
    for (const field of ['graceMs', 'timeoutMs'] as const) {
      const over = { ...operation, [field]: MAX_TIMER_DELAY_MS + 1 }
      expect(() => RuntimeConfig({ operations: { echo: over } })).toThrow()
      expect(() => createOperationRunHandler(
        { operations: { echo: over } }, { spawn: () => handle() },
      )).toThrow(/operation\.run configuration/)
    }
  })

  it('owns context abort without forwarding the signal to spawn or double termination', async () => {
    const controller = new AbortController()
    const child = handle()
    const terminate = vi.spyOn(child, 'terminate')
    const spawned: SubprocessSpawnSpec[] = []
    const handler = createOperationRunHandler(config, { spawn: (spec) => { spawned.push(spec); return child } })
    const resolved = await handler.resolveAdmission({ operationId: 'echo' }, { signal: controller.signal })
    const live = handler.start(resolved, { attemptId: AttemptId('abort-owner'), signal: controller.signal })
    controller.abort()
    await expect(live.done).resolves.toEqual({ status: 'canceled' })
    expect(terminate).toHaveBeenCalledOnce()
    expect(spawned[0]).not.toHaveProperty('signal')
  })

  it('registers through one effect whose disposer is returned by the queue', () => {
    const dispose = vi.fn()
    const registerHandler = vi.fn(() => dispose)
    let setup!: () => () => void
    const effect = vi.fn((registered: () => () => void) => { setup = registered })
    apply({ subprocess: { spawn: () => handle() }, taskQueue: { registerHandler }, effect } as never, config)
    expect(effect).toHaveBeenCalledOnce()
    expect(registerHandler).not.toHaveBeenCalled()
    expect(setup()).toBe(dispose)
  })

  it('removes its handler from a real Cordis plugin fiber on unload', async () => {
    const realContext = new Context()
    const queue = new TestQueue(realContext)
    new TestSubprocess(realContext)
    const fiber = await realContext.plugin(operationBridge, config)
    expect(queue.listKinds()).toContain('operation.run@1')
    await fiber.dispose()
    expect(queue.listKinds()).not.toContain('operation.run@1')
    await realContext.fiber.dispose()
  })
})
