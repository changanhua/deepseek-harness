/**
 * Status presentation helpers: the canonical queue statuses map onto the
 * shared StateDot semantic plus always-visible text labels, so state is never
 * carried by color alone (design §11).
 */
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { QueueTaskStatus } from '@deepseek-ai/dsh-task-queue-remote/views'
import type { TaskQueueKey } from './locales.ts'

/** Status → copy key (list badge and detail pill share it). */
export const STATUS_LABEL_KEY: Record<QueueTaskStatus, TaskQueueKey> = {
  pending: 'status.pending',
  starting: 'status.starting',
  running: 'status.running',
  stopping: 'status.stopping',
  succeeded: 'status.succeeded',
  failed: 'status.failed',
  canceled: 'status.canceled',
}

/** Status → dot semantic. */
export const STATUS_DOT: Record<QueueTaskStatus, StateDotState> = {
  pending: 'warning',
  starting: 'ongoing',
  running: 'ongoing',
  stopping: 'warning',
  succeeded: 'done',
  failed: 'error',
  canceled: 'warning',
}

/** Live (non-terminal) statuses; the "active" filter row. */
export const LIVE_STATUSES: readonly QueueTaskStatus[] = ['pending', 'starting', 'running', 'stopping']

/** Terminal statuses; the "finished" filter row. */
export const DONE_STATUSES: readonly QueueTaskStatus[] = ['succeeded', 'canceled']
