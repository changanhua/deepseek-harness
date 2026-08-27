/**
 * Shared vocabulary for the image generation capability seam.
 * @module @deepseek-ai/dsh-image-generation/types
 */

/** Media container requested from an image generation provider. */
export type ImageOutputFormat = 'png' | 'jpeg'

/** Caller-supplied execution requirements resolved before a prompt is generated. */
export interface ImageGenerationRequest {
  /** Explicit provider id; omitted permits sole-provider auto-selection. */
  readonly provider?: string
  /** Requested model id; omitted lets the selected provider choose its configured model. */
  readonly model?: string
  /** Provider-supported size expression, such as `2048x3072`. */
  readonly size: string
  /** Required output media container. */
  readonly outputFormat: ImageOutputFormat
  /** Whether the generated image should contain the provider's watermark. */
  readonly watermark: boolean
}

/** Provider-resolved execution facts persisted before generation starts. */
export interface ResolvedImageGenerationSpec {
  /** Provider id selected by the shared registry. */
  readonly provider: string
  /** Concrete model id selected by the provider. */
  readonly model: string
  /** Provider-validated size expression. */
  readonly size: string
  /** Provider-validated output media container. */
  readonly outputFormat: ImageOutputFormat
  /** Resolved watermark choice. */
  readonly watermark: boolean
  /** Provider-owned serializable facts needed to execute without discovery. */
  readonly providerSpec?: unknown
}

/** Provider-resolved fields before the registry stamps the selected provider id. */
export type ImageGenerationProviderSpec = Omit<ResolvedImageGenerationSpec, 'provider'>

/** Prompt plus a previously resolved execution spec passed to generation. */
export interface ImageGenerationInput {
  /** Complete prompt to render. */
  readonly prompt: string
  /** Execution facts returned by `ImageGeneration.resolve()`. */
  readonly spec: ResolvedImageGenerationSpec
}

/** One generated raster image with decoded media facts. */
export interface GeneratedImage {
  /** Encoded PNG or JPEG bytes. */
  readonly bytes: Uint8Array
  /** Detected media type of `bytes`. */
  readonly mediaType: string
  /** Decoded pixel width. */
  readonly width: number
  /** Decoded pixel height. */
  readonly height: number
}

/** Normalized outcome of one generation call. */
export interface ImageGenerationResult {
  /** Provider id that produced the images. */
  readonly provider: string
  /** Concrete model id used by the provider. */
  readonly model: string
  /** Generated images in provider order. */
  readonly images: readonly GeneratedImage[]
}

/** Per-call execution context forwarded unchanged to the selected provider. */
export interface ImageGenerationContext {
  /** Cancellation signal for provider discovery or generation. */
  readonly signal?: AbortSignal
}

/** A backend registered on `ctx.imageGeneration`. */
export interface ImageGenerationProvider {
  /** Stable registry key. */
  readonly id: string
  /**
   * Resolve and validate provider execution facts without generating an image.
   * @param request - caller requirements, including the optional provider selector.
   * @param context - per-call cancellation context.
   * @returns provider-owned resolved fields; the service adds `provider`.
   */
  resolve(request: ImageGenerationRequest, context: ImageGenerationContext): Promise<ImageGenerationProviderSpec>
  /**
   * Generate images from an already resolved input.
   * @param input - prompt and persisted resolved execution facts.
   * @param context - per-call cancellation context.
   * @returns generated images and actual provider/model attribution.
   */
  generate(input: ImageGenerationInput, context: ImageGenerationContext): Promise<ImageGenerationResult>
}

/** Stable shared error codes emitted by the image generation registry. */
export type ImageGenerationErrorCode =
  | 'IMAGE_GENERATION_PROVIDER_MISSING'
  | 'IMAGE_GENERATION_PROVIDER_AMBIGUOUS'
  | 'IMAGE_GENERATION_PROVIDER_DUPLICATE'
  | 'IMAGE_GENERATION_INVALID_SIZE'
