/** Branded identifiers owned by the durable work queue. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one immutable WorkItem. */
export type WorkId = Branded<'WorkId'>
/** Identifies one WorkAttempt. */
export type AttemptId = Branded<'AttemptId'>
/** Identifies one WorkResult. */
export type ResultId = Branded<'ResultId'>
/** Identifies one atomic Batch. */
export type BatchId = Branded<'BatchId'>
/** Identifies one durable Attention record. */
export type AttentionId = Branded<'AttentionId'>
/** Identifies one durable owner-notification record. */
export type NotificationId = Branded<'NotificationId'>

/**
 * Brand a raw WorkItem id.
 * @param value - Raw id.
 * @returns The branded WorkId.
 */
export const WorkId = (value: string): WorkId => value as WorkId
/**
 * Brand a raw attempt id.
 * @param value - Raw id.
 * @returns The branded AttemptId.
 */
export const AttemptId = (value: string): AttemptId => value as AttemptId
/**
 * Brand a raw result id.
 * @param value - Raw id.
 * @returns The branded ResultId.
 */
export const ResultId = (value: string): ResultId => value as ResultId
/**
 * Brand a raw Batch id.
 * @param value - Raw id.
 * @returns The branded BatchId.
 */
export const BatchId = (value: string): BatchId => value as BatchId
/**
 * Brand a raw Attention id.
 * @param value - Raw id.
 * @returns The branded AttentionId.
 */
export const AttentionId = (value: string): AttentionId => value as AttentionId
/**
 * Brand a raw Notification id.
 * @param value - Raw id.
 * @returns The branded NotificationId.
 */
export const NotificationId = (value: string): NotificationId => value as NotificationId
