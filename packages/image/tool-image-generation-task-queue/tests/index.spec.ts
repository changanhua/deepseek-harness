import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { TaskQueue } from '@deepseek-ai/dsh-task-queue'
import { describe, expect, it, vi } from 'vitest'
import { createImageGenerationTaskQueue } from '../src/index.ts'

describe('image Queue admission tools', () => {
  async function setup() {
    const context = new Context()
    await context.plugin(SessionStore)
    const session = context.sessions.create(SessionId('image-owner'))
    const enqueue = vi.fn(async () => 'image-work-1')
    const enqueueBatch = vi.fn(async () => 'image-batch-1')
    const taskQueue = { forAgent: () => ({ enqueue, enqueueBatch }) } as unknown as TaskQueue
    return { context, session, enqueue, enqueueBatch, kit: createImageGenerationTaskQueue({ taskQueue }) }
  }

  it('registers only single and Batch image.generate@1 admission', async () => {
    const { context, kit } = await setup()
    expect(kit.tools.map(tool => tool.name)).toEqual([
      'image_generate_enqueue',
      'image_generate_enqueue_batch',
    ])
    await context.fiber.dispose()
  })

  it('atomically admits individually titled completed prompts without agent.run work', async () => {
    const { context, session, enqueueBatch, kit } = await setup()
    const tool = kit.tools.find(candidate => candidate.name === 'image_generate_enqueue_batch')!
    const items = [
      { title: 'Crime and Punishment', prompt: 'tense red stairwell', size: '1920x1920', outputFormat: 'png', watermark: false, provider: 'arkcli', model: 'seedream' },
      { title: 'Moby-Dick', prompt: 'white whale under black sea', size: '1920x1920', outputFormat: 'jpeg', watermark: true },
    ]
    await expect(tool.execute({ items, idempotencyKey: 'covers-1', maxParallel: 2 }, { agent: { session } } as never))
      .resolves.toEqual({ id: 'image-batch-1' })
    expect(enqueueBatch).toHaveBeenCalledWith({
      kind: 'image.generate@1',
      items: [
        { title: 'Crime and Punishment', input: { prompt: 'tense red stairwell', size: '1920x1920', outputFormat: 'png', watermark: false, provider: 'arkcli', model: 'seedream' } },
        { title: 'Moby-Dick', input: { prompt: 'white whale under black sea', size: '1920x1920', outputFormat: 'jpeg', watermark: true } },
      ],
      sharedPayload: {},
      idempotencyKey: 'covers-1',
      maxParallel: 2,
    })
    expect(JSON.stringify(enqueueBatch.mock.calls)).not.toContain('agent.run@1')
    await context.fiber.dispose()
  })

  it('rejects a non-positive Batch concurrency bound before admission', async () => {
    const { context, session, enqueueBatch, kit } = await setup()
    const tool = kit.tools.find(candidate => candidate.name === 'image_generate_enqueue_batch')!
    await expect(tool.execute({ items: [], idempotencyKey: 'bad', maxParallel: 0 }, { agent: { session } } as never))
      .rejects.toThrow(/maxParallel/)
    expect(enqueueBatch).not.toHaveBeenCalled()
    await context.fiber.dispose()
  })
})
