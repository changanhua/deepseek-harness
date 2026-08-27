/** Durable Queue v2 handler for image generation. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AttachmentStore, ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ImageGeneration, ImageGenerationRequest, ResolvedImageGenerationSpec } from '@deepseek-ai/dsh-image-generation'
import type { LiveAttempt, WorkFailure, WorkHandler, WorkKindDefinition } from '@deepseek-ai/dsh-task-queue'

const DEFAULT_MAX_ATTEMPTS = 1

/** Queue retry policy supplied by the deployment composition. */
export interface Config {
  /** Maximum admitted attempts for one image WorkItem. */
  readonly maxAttempts?: number
}
/** Schemastery configuration for the image Queue handler. */
export const Config: z<Config> = z.object({ maxAttempts: z.number().step(1).min(1).default(DEFAULT_MAX_ATTEMPTS) })

/** Immutable caller intent for one image generation. */
export interface ImageGenerateIntent extends ImageGenerationRequest { readonly prompt: string }
/** Prompt plus provider facts persisted before the generation side effect. */
export interface ResolvedImageGenerate { readonly prompt: string; readonly spec: ResolvedImageGenerationSpec }
/** Result persisted by Queue v2 after generated images become durable attachments. */
export interface ImageGenerateOutput {
  readonly provider: string
  readonly model: string
  readonly attachments: readonly ImageAttachmentRef[]
}

declare module '@deepseek-ai/dsh-task-queue' {
  interface WorkKindMap {
    'image.generate@1': WorkKindDefinition<ImageGenerateIntent, ResolvedImageGenerate, ResolvedImageGenerate, ImageGenerateOutput>
  }
}

/**
 * Build the image handler from the shared generation capability.
 * @param imageGeneration Shared provider dispatcher.
 * @param attachments Durable image byte store.
 * @param config Queue retry-policy configuration.
 * @returns Queue v2 handler for `image.generate@1`.
 */
export function createImageGenerateHandler(
  imageGeneration: ImageGeneration,
  attachments: AttachmentStore,
  config: Config = {},
): WorkHandler<'image.generate@1'> {
  const maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new Error('image Queue handler requires positive maxAttempts')
  return {
    kind: 'image.generate@1',
    async resolveAdmission(input, context) {
      if (input.prompt.trim() === '') throw new Error('image generation prompt must not be blank')
      const request = {
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.model === undefined ? {} : { model: input.model }),
        size: input.size,
        outputFormat: input.outputFormat,
        watermark: input.watermark,
      }
      return { prompt: input.prompt, spec: await imageGeneration.resolve(request, { signal: context.signal }) }
    },
    resources() { return [{ resource: 'image-generation', units: 1 }] },
    policy() { return { maxAttempts } },
    prepare(resolved, _context) { return Promise.resolve(resolved) },
    start(prepared, context): LiveAttempt<'image.generate@1'> {
      const controller = new AbortController()
      const signal = combineSignals(context.signal, controller.signal)
      const done = imageGeneration.generate(
        { prompt: prepared.prompt, spec: prepared.spec },
        { signal },
      ).then(async (result) => {
        const saved = await attachments.saveImages(result.images.map((image, index) => ({
          data: image.bytes,
          mediaType: image.mediaType as ImageMediaType,
          name: `image-${index + 1}.${extension(image.mediaType)}`,
        })))
        return { status: 'succeeded' as const, output: { provider: result.provider, model: result.model, attachments: saved } }
      }).catch((error: unknown) => ({ status: 'failed' as const, failure: imageFailure(error) }))
      return { done, cancel() { controller.abort('image generation canceled'); return Promise.resolve() } }
    },
  }
}

/** Register the image handler against the composing Queue v2 provider. */
export const inject = ['taskQueue', 'imageGeneration', 'attachments']
/** @param ctx - Context holding both capability seams. @returns handler registration disposer. */
export function apply(ctx: Context, config: Config): () => void {
  return ctx.taskQueue.registerHandler(
    createImageGenerateHandler(ctx.imageGeneration, ctx.attachments, config),
  )
}

function imageFailure(error: unknown): WorkFailure {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'image generation failed'
  if (error !== null
    && typeof error === 'object'
    && 'category' in error
    && 'sideEffect' in error
    && 'retriable' in error
    && typeof error.category === 'string'
    && (error.sideEffect === 'not-started' || error.sideEffect === 'started' || error.sideEffect === 'unknown')
    && typeof error.retriable === 'boolean') {
    return { category: error.category, sideEffect: error.sideEffect, retriable: error.retriable, message }
  }
  return { category: 'image-generation', sideEffect: 'unknown', retriable: false, message }
}

function combineSignals(left: AbortSignal, right: AbortSignal): AbortSignal {
  if (left.aborted || right.aborted) return AbortSignal.abort(left.aborted ? left.reason : right.reason)
  const controller = new AbortController()
  const abort = (event: Event) => { controller.abort((event.target as AbortSignal).reason) }
  left.addEventListener('abort', abort, { once: true })
  right.addEventListener('abort', abort, { once: true })
  return controller.signal
}

function extension(mediaType: string): string { return mediaType === 'image/jpeg' ? 'jpeg' : 'png' }
