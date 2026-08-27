/**
 * Service Definition for the shared image generation capability (`ctx.imageGeneration`).
 * @module @deepseek-ai/dsh-image-generation
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {
  ImageGenerationContext,
  ImageGenerationInput,
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  ResolvedImageGenerationSpec,
} from './types.ts'
import { ImageGenerationError } from './error.ts'

export { ImageGenerationError } from './error.ts'
export type {
  GeneratedImage,
  ImageGenerationContext,
  ImageGenerationErrorCode,
  ImageGenerationInput,
  ImageGenerationProvider,
  ImageGenerationProviderSpec,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageOutputFormat,
  ResolvedImageGenerationSpec,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    imageGeneration: ImageGeneration
  }
}

/** Shared provider registry and two-phase image generation dispatcher. */
export class ImageGeneration extends Service {
  private readonly providers = new Map<string, ImageGenerationProvider>()

  /**
   * Install the image generation Service Definition on a Cordis context.
   * @param ctx - context that owns the service.
   */
  constructor(ctx: Context) {
    super(ctx, 'imageGeneration')
  }

  /**
   * Register one provider for the calling fiber's lifetime.
   * Throws {@link ImageGenerationError} with
   * `IMAGE_GENERATION_PROVIDER_DUPLICATE` when the id is already registered.
   * @param provider - provider keyed by its stable id.
   * @returns disposer that removes this exact registration.
   */
  registerProvider(provider: ImageGenerationProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new ImageGenerationError(
        `image generation provider "${provider.id}" is already registered`,
        'IMAGE_GENERATION_PROVIDER_DUPLICATE',
      )
    }
    const providers = this.providers
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.id, provider)
      yield () => providers.delete(provider.id)
    }, 'imageGeneration.registerProvider()')
    return () => void dispose()
  }

  /**
   * Select a provider and resolve all execution facts before generation starts.
   * Rejects with {@link ImageGenerationError} for blank sizes, a missing
   * explicit provider, no providers, or ambiguous automatic selection.
   * Provider validation failures and cancellation rejections pass through
   * unchanged; providers must honor `context.signal`.
   * @param request - provider/model/format requirements without a prompt.
   * @param context - cancellation context forwarded unchanged to the provider.
   * @returns fully resolved facts stamped with the selected provider id.
   */
  async resolve(
    request: ImageGenerationRequest,
    context: ImageGenerationContext,
  ): Promise<ResolvedImageGenerationSpec> {
    if (request.size.trim().length === 0) {
      throw new ImageGenerationError('image generation size must not be blank', 'IMAGE_GENERATION_INVALID_SIZE')
    }
    const provider = this.selectProvider(request.provider)
    const spec = await provider.resolve(request, context)
    return { ...spec, provider: provider.id }
  }

  /**
   * Generate images through the provider recorded in a resolved input.
   * Throws {@link ImageGenerationError} with
   * `IMAGE_GENERATION_PROVIDER_MISSING` when the resolved provider has been
   * disposed. Provider failures and cancellation rejections pass through
   * unchanged; providers must honor `context.signal`.
   * @param input - prompt and spec returned by {@link resolve}.
   * @param context - cancellation context forwarded unchanged to the provider.
   * @returns provider result with provider/model attribution and encoded images.
   */
  generate(input: ImageGenerationInput, context: ImageGenerationContext): Promise<ImageGenerationResult> {
    const provider = this.providers.get(input.spec.provider)
    if (provider === undefined) {
      throw new ImageGenerationError(
        `image generation provider "${input.spec.provider}" is not registered`,
        'IMAGE_GENERATION_PROVIDER_MISSING',
      )
    }
    return provider.generate(input, context)
  }

  /** Resolve an explicit provider or the sole registered provider. */
  private selectProvider(explicitId: string | undefined): ImageGenerationProvider {
    if (explicitId !== undefined) {
      const provider = this.providers.get(explicitId)
      if (provider === undefined) {
        throw new ImageGenerationError(
          `image generation provider "${explicitId}" is not registered`,
          'IMAGE_GENERATION_PROVIDER_MISSING',
        )
      }
      return provider
    }
    if (this.providers.size === 0) {
      throw new ImageGenerationError(
        'no image generation provider is registered',
        'IMAGE_GENERATION_PROVIDER_MISSING',
      )
    }
    if (this.providers.size > 1) {
      throw new ImageGenerationError(
        `multiple image generation providers are registered (${[...this.providers.keys()].join(', ')}); select one explicitly`,
        'IMAGE_GENERATION_PROVIDER_AMBIGUOUS',
      )
    }
    return this.providers.values().next().value as ImageGenerationProvider
  }
}

export default ImageGeneration
