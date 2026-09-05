import { describe, expect, it, vi } from 'vitest'
import { AttemptId } from '@changanhua/dsh-task-queue'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { ImageGeneration, ImageGenerationInput } from '@changanhua/dsh-image-generation'
import { createImageGenerateHandler } from '../src/index.ts'

describe('image.generate@1 handler', () => {
  it('persists generated images through the AttachmentStore', async () => {
    const resolve = vi.fn(async () => ({
      provider: 'arkcli', model: 'seedream', size: '1920x1920',
      outputFormat: 'png' as const, watermark: false, providerSpec: { profile: 'agent-plan' },
    }))
    const generate = vi.fn(async (input: ImageGenerationInput) => {
      expect(input.prompt).toBe('a dramatic book cover')
      expect(input.spec.providerSpec).toEqual({ profile: 'agent-plan' })
      return {
        provider: 'arkcli', model: 'seedream',
        images: [{ bytes: new Uint8Array([1, 2]), mediaType: 'image/png', width: 1, height: 2 }],
      }
    })
    const saveImages = vi.fn(async () => [{
      attachmentId: 'attachment-1', mediaType: 'image/png' as const, bytes: 2, width: 1, height: 2,
    }])
    const handler = createImageGenerateHandler(
      { resolve, generate } as unknown as ImageGeneration,
      { saveImages } as unknown as AttachmentStore,
      { maxAttempts: 2 },
    )
    const resolved = await handler.resolveAdmission(
      { prompt: 'a dramatic book cover', size: '1920x1920', outputFormat: 'png', watermark: false },
      { signal: new AbortController().signal },
    )
    expect(handler.policy(resolved)).toEqual({ maxAttempts: 2 })
    const prepared = await handler.prepare(
      resolved,
      { attemptId: AttemptId('attempt-1'), signal: new AbortController().signal },
    )
    const live = handler.start(prepared, { attemptId: AttemptId('attempt-1'), signal: new AbortController().signal })
    await expect(live.done).resolves.toMatchObject({ status: 'succeeded', output: { attachments: [{ attachmentId: 'attachment-1' }] } })
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(saveImages).toHaveBeenCalledWith([{ data: new Uint8Array([1, 2]), mediaType: 'image/png', name: 'image-1.png' }])
  })
})
