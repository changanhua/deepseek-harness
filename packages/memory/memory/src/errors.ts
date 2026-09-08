/** Stable project-memory failures. @module @changanhua/dsh-memory/errors */
import type { MemoryErrorCode } from './types.ts'

/** An operation failed without granting broader project or decision authority. */
export class MemoryError extends Error {
  /**
   * @param code - Provider-independent failure category.
   * @param message - Diagnostic without inaccessible source contents.
   * @param options - Optional underlying infrastructure failure.
   */
  constructor(readonly code: MemoryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MemoryError'
  }
}
