import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TaskQueue from '@deepseek-ai/dsh-task-queue'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import * as admission from '../src/index.ts'

class TestTaskQueue extends TaskQueue {
  constructor(ctx: Context, private readonly agentQueue: unknown) { super(ctx) }
  forAgent = vi.fn(() => this.agentQueue) as never
  forOperator(): never { throw new Error('not used by this test') }
  registerHandler(): ReturnType<TaskQueue['registerHandler']> {
    const registration = (() => {}) as ReturnType<TaskQueue['registerHandler']>
    registration.activate = () => undefined
    return registration
  }
  listKinds(): [] { return [] }
}

describe('operation.run Queue admission tools', () => {
  async function setup() {
    const context = new Context()
    await context.plugin(SessionStore)
    const session = context.sessions.create(SessionId('operation-owner'))
    const enqueue = vi.fn(async () => 'work-1')
    const enqueueBatch = vi.fn(async () => 'batch-1')
    const forAgent = vi.fn(() => ({ enqueue, enqueueBatch }))
    const taskQueue = { forAgent } as unknown as TaskQueue
    return { context, session, enqueue, enqueueBatch, forAgent, taskQueue }
  }

  it('exposes a factory for exactly the two operation admission tools', () => {
    expect(admission.createOperationRunTaskQueue).toBeTypeOf('function')
    expect(admission.Config).toBeDefined()
  })

  it('projects compiled JSON schemas with no execution internals', async () => {
    const { context, taskQueue } = await setup()
    const kit = admission.createOperationRunTaskQueue({ taskQueue })
    expect(kit.tools.map(tool => tool.name)).toEqual([
      'operation_run_enqueue',
      'operation_run_enqueue_batch',
    ])
    await context.plugin(SystemPrompt)
    await context.plugin(ToolRuntime)
    for (const tool of kit.tools) context.tools.register(tool)
    const schemas = context.tools.schemas()
    const single = schemas.find(schema => schema.name === 'operation_run_enqueue')
    const batch = schemas.find(schema => schema.name === 'operation_run_enqueue_batch')
    expect(single).toBeDefined()
    expect(batch).toBeDefined()

    const singleParameters = single!.parameters as { properties: Record<string, unknown>; additionalProperties?: boolean }
    expect(singleParameters.additionalProperties).toBe(false)
    expect(Object.keys(singleParameters.properties).sort()).toEqual(['idempotencyKey', 'operationId', 'title'])

    const batchParameters = batch!.parameters as { properties: Record<string, unknown>; additionalProperties?: boolean }
    expect(batchParameters.additionalProperties).toBe(false)
    expect(Object.keys(batchParameters.properties).sort()).toEqual(['idempotencyKey', 'items', 'maxParallel'])
    const itemArray = batchParameters.properties.items as {
      type?: string
      items?: { properties?: Record<string, unknown>; additionalProperties?: boolean }
    }
    expect(itemArray).toBeDefined()
    expect(itemArray.type).toBe('array')
    expect(itemArray.items).toBeDefined()
    expect(itemArray.items!.additionalProperties).toBe(false)
    expect(itemArray.items!.properties).toBeDefined()
    expect(Object.keys(itemArray.items!.properties!).sort()).toEqual(['operationId', 'title'])

    for (const tool of kit.tools) {
      expect(tool.output.schema).toEqual({
        type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' } },
      })
    }
    await context.fiber.dispose()
  })

  it('derives verified owner authority from the live Agent Session for one operation', async () => {
    const { context, session, enqueue, forAgent, taskQueue } = await setup()
    const tool = admission.createOperationRunTaskQueue({ taskQueue }).tools.find(tool => tool.name === 'operation_run_enqueue')!
    await expect(tool.execute({ title: 'collect metrics', operationId: 'metrics.collect', idempotencyKey: 'single-1' }, { agent: { session } } as never))
      .resolves.toEqual({ id: 'work-1' })
    expect(forAgent).toHaveBeenCalledWith({ kind: 'agent', sessionId: 'operation-owner' })
    expect(enqueue).toHaveBeenCalledWith({
      kind: 'operation.run@1', title: 'collect metrics', input: { operationId: 'metrics.collect' }, idempotencyKey: 'single-1',
    })
    await context.fiber.dispose()
  })

  it('atomically admits titled operation intents with an empty shared payload', async () => {
    const { context, session, enqueueBatch, taskQueue } = await setup()
    const tool = admission.createOperationRunTaskQueue({ taskQueue }).tools.find(tool => tool.name === 'operation_run_enqueue_batch')!
    await expect(tool.execute({
      items: [{ title: 'first', operationId: 'metrics.collect' }, { title: 'second', operationId: 'cache.prune' }],
      idempotencyKey: 'batch-1', maxParallel: 2,
    }, { agent: { session } } as never)).resolves.toEqual({ id: 'batch-1' })
    expect(enqueueBatch).toHaveBeenCalledWith({
      kind: 'operation.run@1',
      items: [
        { title: 'first', input: { operationId: 'metrics.collect' } },
        { title: 'second', input: { operationId: 'cache.prune' } },
      ],
      sharedPayload: {}, idempotencyKey: 'batch-1', maxParallel: 2,
    })
    await context.fiber.dispose()
  })

  it.each([0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid maxParallel %s before Queue access', async (maxParallel) => {
      const { context, session, enqueueBatch, forAgent, taskQueue } = await setup()
      const tool = admission.createOperationRunTaskQueue({ taskQueue }).tools.find(tool => tool.name === 'operation_run_enqueue_batch')!
      await expect(tool.execute({ items: [], idempotencyKey: 'bad-parallelism', maxParallel }, { agent: { session } } as never))
        .rejects.toThrow(/maxParallel/)
      expect(enqueueBatch).not.toHaveBeenCalled()
      expect(forAgent).not.toHaveBeenCalled()
      await context.fiber.dispose()
    })

  it('rejects admission without a live Agent Session', async () => {
    const { context, taskQueue } = await setup()
    const tool = admission.createOperationRunTaskQueue({ taskQueue }).tools.find(tool => tool.name === 'operation_run_enqueue')!
    await expect(tool.execute({ title: 'missing owner', operationId: 'metrics.collect', idempotencyKey: 'missing-owner' }, {} as never))
      .rejects.toThrow(/live Agent session/)
    await context.fiber.dispose()
  })

  it('rejects extra execution fields through the real ToolRuntime before Queue access', async () => {
    const context = new Context()
    await context.plugin(SessionStore)
    await context.plugin(SystemPrompt)
    await context.plugin(ToolRuntime)
    const session = context.sessions.create(SessionId('runtime-owner'))
    const enqueue = vi.fn(async () => 'work-1')
    const enqueueBatch = vi.fn(async () => 'batch-1')
    const queue = new TestTaskQueue(context, { enqueue, enqueueBatch })
    const fiber = await context.plugin(admission, {})

    const single = await context.tools.execute({
      signal: new AbortController().signal, callId: ToolCallId('extra-single'), name: 'operation_run_enqueue', agent: { session } as never,
      arguments: { title: 'collect', operationId: 'metrics.collect', idempotencyKey: 'extra-single', argv: ['unsafe'] },
    })
    const batch = await context.tools.execute({
      signal: new AbortController().signal, callId: ToolCallId('extra-batch'), name: 'operation_run_enqueue_batch', agent: { session } as never,
      arguments: { items: [{ title: 'collect', operationId: 'metrics.collect', env: { PATH: 'unsafe' } }], idempotencyKey: 'extra-batch', maxParallel: 1 },
    })

    expect(single.isError).toBe(true)
    expect(batch.isError).toBe(true)
    expect(queue.forAgent).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
    expect(enqueueBatch).not.toHaveBeenCalled()
    await fiber.dispose()
    await context.fiber.dispose()
  })

  it('registers tools through a real plugin fiber and removes both on disposal', async () => {
    const context = new Context()
    await context.plugin(SystemPrompt)
    await context.plugin(ToolRuntime)
    new TestTaskQueue(context, { enqueue: vi.fn(), enqueueBatch: vi.fn() })
    const fiber = await context.plugin(admission, {})
    expect(context.tools.get('operation_run_enqueue')).toBeDefined()
    expect(context.tools.get('operation_run_enqueue_batch')).toBeDefined()
    await fiber.dispose()
    expect(context.tools.get('operation_run_enqueue')).toBeUndefined()
    expect(context.tools.get('operation_run_enqueue_batch')).toBeUndefined()
    await context.fiber.dispose()
  })
})
