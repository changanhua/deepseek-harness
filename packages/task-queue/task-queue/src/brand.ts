/**
 * dsh-task-queue's owned branded ids, carried across the durable task model,
 * the change-record log, and the Service seam.
 *
 * It lives in its own leaf for the same reason dsh-jobs' does: the package root
 * and `./types` reach `@deepseek-ai/dsh-subprocess` through the executor-adapter
 * signature, which a Client program cannot resolve. A browser-safe consumer
 * imports the ids here; `Branded<B>` itself comes from the zero-dependency
 * `@deepseek-ai/dsh-brand`.
 *
 * @module @deepseek-ai/dsh-task-queue/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Identifies a queued task. The backend generates `tq-<UUIDv4>`; ids are
 * predictable, so authorization — not secrecy — is the boundary.
 */
export type TaskId = Branded<'TaskId'>

/**
 * Identifies one execution attempt of a task (`run-<attempt>`). Each attempt
 * produces a distinct durable run record; the run id correlates the record
 * with its log path and notification record.
 */
export type RunId = Branded<'RunId'>

/**
 * Identifies one durable notification outbox record. Independent of the task,
 * so a retry never overwrites an already-pending notification.
 */
export type NotificationId = Branded<'NotificationId'>

/**
 * Brand a string as a {@link TaskId}.
 * @param id - the raw task-id string (`tq-<UUIDv4>`); no validation performed.
 * @returns the same string, branded.
 */
export function TaskId(id: string): TaskId {
  return id as TaskId
}

/**
 * Brand a string as a {@link RunId}.
 * @param id - the raw run-id string; no validation performed.
 * @returns the same string, branded.
 */
export function RunId(id: string): RunId {
  return id as RunId
}

/**
 * Brand a string as a {@link NotificationId}.
 * @param id - the raw notification-id string; no validation performed.
 * @returns the same string, branded.
 */
export function NotificationId(id: string): NotificationId {
  return id as NotificationId
}
