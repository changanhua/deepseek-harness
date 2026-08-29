/** Shared parsing and construction for trusted verification plans. */

import { verificationPlanDigest } from './canonical.ts'
import {
  verificationPlanDocumentSchema,
  verificationPlanSchema,
} from './schemas.ts'
import type {
  VerificationCheck,
  VerificationPlan,
  VerificationPlanDocument,
  VerificationPlanProvenance,
} from './types.ts'

/** Stable failure classification for a Contract-owned plan document. */
export type VerificationPlanDocumentErrorCode =
  | 'utf8-bom'
  | 'invalid-utf8'
  | 'invalid-json'
  | 'invalid-document'

/** Typed parse failure for exact `delivery-verification-plan@1` bytes. */
export class VerificationPlanDocumentError extends Error {
  /**
   * @param code - Stable parse-failure classification.
   * @param message - Human-readable diagnostic.
   * @param options - Optional underlying decoder, JSON, or schema failure.
   */
  constructor(
    readonly code: VerificationPlanDocumentErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'VerificationPlanDocumentError'
  }
}

/**
 * Parse the exact bytes named by a Contract Git-blob verification source.
 * @param bytes - Complete bounded blob bytes returned by repository authority.
 * @returns the strict, non-empty, unique-check plan document.
 */
export function parseVerificationPlanDocument(
  bytes: Uint8Array,
): VerificationPlanDocument {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new VerificationPlanDocumentError(
      'utf8-bom',
      'verification plan document must not contain a UTF-8 BOM',
    )
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (cause) {
    throw new VerificationPlanDocumentError(
      'invalid-utf8',
      'verification plan document must be valid UTF-8',
      { cause },
    )
  }
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch (cause) {
    throw new VerificationPlanDocumentError(
      'invalid-json',
      'verification plan document must be valid JSON',
      { cause },
    )
  }
  const parsed = verificationPlanDocumentSchema.safeParse(value)
  if (!parsed.success) {
    throw new VerificationPlanDocumentError(
      'invalid-document',
      'verification plan document must match delivery-verification-plan@1',
      { cause: parsed.error },
    )
  }
  return parsed.data
}

/**
 * Construct a digest-bearing trusted plan from already validated checks.
 * @param checks - Non-empty unique fixed-argv checks.
 * @param provenance - Contract field or exact Git-blob proof.
 * @returns a strict resolved plan with its canonical digest.
 */
export function resolveVerificationPlan(
  checks: readonly VerificationCheck[],
  provenance: VerificationPlanProvenance,
): VerificationPlan {
  return verificationPlanSchema.parse({
    checks,
    provenance,
    digest: verificationPlanDigest({ checks, provenance }),
  })
}
