import type { z } from 'zod'
import type { quickReviewInputSchema } from './schema.ts'
/** Strict review request; identity and provenance come from the trusted Host. */
export type QuickReviewInput = z.infer<typeof quickReviewInputSchema>
