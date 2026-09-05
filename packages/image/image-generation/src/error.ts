/**
 * Runtime errors for the image generation capability seam.
 * @module @changanhua/dsh-image-generation/error
 */

import type { ImageGenerationErrorCode } from './types.ts'

/** Typed image generation error with a machine-readable shared code. */
export class ImageGenerationError extends Error {
  /** Machine-readable failure code. */
  readonly code: ImageGenerationErrorCode

  /**
   * Create a shared image generation failure.
   * @param message - human-readable failure description.
   * @param code - stable machine-readable classification.
   * @param options - optional native error cause.
   */
  constructor(message: string, code: ImageGenerationErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ImageGenerationError'
    this.code = code
  }
}
