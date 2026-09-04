import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { TaskQueue } from '@changanhua/dsh-task-queue'
import { describe, expect, it, vi } from 'vitest'
import { createAgentRunTaskQueue } from '../src/index.ts'

const FORBIDDEN_FIELDS = ['executor', 'profile', 'model', 'credential', 'shell']

describe('agent.run Queue admission tools', () => {
  async function setup() {
    const context = new Context()
    await context.plugin(SessionStore)
    const session = context.sessions.create(SessionId('agent-run-owner'))
    const enqueue = vi.fn(async () => 'work-1')
    const enqueueBatch = vi.fn(async () => 'batch-1')
    const queue = {
      forAgent: () => ({ enqueue, enqueueBatch }),
      listKinds: () => ['agent.run@1'],
    } as unknown as TaskQueue
    const kit = createAgentRunTaskQueue({ taskQueue: queue })
    return { context, session, enqueue, enqueueBatch, kit }
  }

  it('registers only the single and Batch agent.run admission tools', async () => {
    const { context, kit } = await setup()
    expect(kit.tools.map(tool => tool.name)).toEqual([
      'task_queue_enqueue',
      'task_queue_enqueue_batch',
    ])
    for (const tool of kit.tools) {
      const fields = Object.keys(tool.parameters)
      expect(fields).not.toEqual(expect.arrayContaining(FORBIDDEN_FIELDS))
    }
    await context.fiber.dispose()
  })

  it('derives owner authority from exec.agent.session and admits agent.run@1', async () => {
    const { context, session, enqueue, kit } = await setup()
    const tool = kit.tools.find(candidate => candidate.name === 'task_queue_enqueue')!
    await expect(tool.execute({
      title: 'inspect repository',
      prompt: 'find the marker',
      idempotencyKey: 'single-1',
    }, { agent: { session } } as never)).resolves.toEqual({ id: 'work-1' })
    expect(enqueue).toHaveBeenCalledWith({
      kind: 'agent.run@1',
      title: 'inspect repository',
      input: { prompt: 'find the marker' },
      idempotencyKey: 'single-1',
    })
    await context.fiber.dispose()
  })

  it('preserves individual Batch titles and exposes only prompt input', async () => {
    const { context, session, enqueueBatch, kit } = await setup()
    const tool = kit.tools.find(candidate => candidate.name === 'task_queue_enqueue_batch')!
    await expect(tool.execute({
      items: [
        { title: 'first title', prompt: 'first prompt' },
        { title: 'second title', prompt: 'second prompt' },
      ],
      idempotencyKey: 'batch-1',
      maxParallel: 2,
    }, { agent: { session } } as never)).resolves.toEqual({ id: 'batch-1' })
    expect(enqueueBatch).toHaveBeenCalledWith({
      kind: 'agent.run@1',
      items: [
        { title: 'first title', input: { prompt: 'first prompt' } },
        { title: 'second title', input: { prompt: 'second prompt' } },
      ],
      sharedPayload: {},
      idempotencyKey: 'batch-1',
      maxParallel: 2,
    })
    await context.fiber.dispose()
  })

  it('rejects admission without a live Agent Session', async () => {
    const { context, kit } = await setup()
    const tool = kit.tools.find(candidate => candidate.name === 'task_queue_enqueue')!
    await expect(tool.execute({
      title: 'missing owner',
      prompt: 'must reject',
      idempotencyKey: 'missing-owner',
    }, {} as never)).rejects.toThrow(/live Agent session/)
    await context.fiber.dispose()
  })
})
