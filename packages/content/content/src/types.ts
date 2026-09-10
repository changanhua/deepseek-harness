import type { z } from 'zod'
import type {
  CaptureCommandSchema, ContentCommandSchema, ContentDraftSchema, ContentEntrySchema, ContentLimitsSchema,
  ContentReceiptSchema, ContentSnapshotSchema, ContentVersionSchema, OperationRecordSchema,
  ResolvedCaptureSchema, SessionSourceSchema, WebSourceSchema,
} from './schema.ts'

/** Schema-derived ContentEntry value. */
export type ContentEntry = z.infer<typeof ContentEntrySchema>
/** Schema-derived ContentVersion value. */
export type ContentVersion = z.infer<typeof ContentVersionSchema>
/** Schema-derived ContentDraft value. */
export type ContentDraft = z.infer<typeof ContentDraftSchema>
/** Schema-derived OperationRecord value. */
export type OperationRecord = z.infer<typeof OperationRecordSchema>
/** Schema-derived ContentReceipt value. */
export type ContentReceipt = z.infer<typeof ContentReceiptSchema>
/** Schema-derived ContentCommand value. */
export type ContentCommand = z.infer<typeof ContentCommandSchema>
/** Schema-derived CaptureCommand value. */
export type CaptureCommand = z.infer<typeof CaptureCommandSchema>
/** Schema-derived ResolvedCapture value. */
export type ResolvedCapture = z.infer<typeof ResolvedCaptureSchema>
/** Schema-derived SessionSource value. */
export type SessionSource = z.infer<typeof SessionSourceSchema>
/** Schema-derived external, unverified page source. */
export type WebSource = z.infer<typeof WebSourceSchema>
/** Schema-derived ContentLimits value. */
export type ContentLimits = z.infer<typeof ContentLimitsSchema>
/** Schema-derived ContentSnapshot value. */
export type ContentSnapshot = z.infer<typeof ContentSnapshotSchema>

/** Trusted synchronous authorization check, invoked again at the queued mutation boundary. */
export type ContentAccess = () => void
/** Host-owned resolver; never supplied by an untrusted wire request. */
export type ContentSourceResolver = (request: CaptureCommand) => Promise<ResolvedCapture>
/** Stable payload-free content failure classifications. */
export type ContentErrorCode =
  | 'invalid_request' | 'forbidden' | 'not_found' | 'revision_conflict' | 'operation_conflict'
  | 'source_conflict' | 'invalid_transition' | 'capacity_exceeded' | 'library_in_use'
  | 'storage_failed' | 'invalid_library' | 'unavailable' | 'closed'

/** Availability is independent of the rest of the Harness; no content appears in diagnostics. */
export interface ContentStatus {
  phase: 'opening' | 'ready' | 'unavailable' | 'closed'
  reason: ContentErrorCode | null
  limits: ContentLimits
}
