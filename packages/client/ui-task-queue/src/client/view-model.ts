/**
 * Deterministic Queue workspace projections: operator-urgency ordering,
 * four-filter counts, relative update age, and the StateDot mapping. These
 * helpers never read the clock or mutate their input rows.
 */
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { QueueTaskState, QueueWorkSummaryView } from '@deepseek-ai/dsh-task-queue-remote/views'

/** The four operator filters over the `queued | running | attention | done` projection. */
export type QueueFilter = 'all' | 'active' | 'attention' | 'done'

/** Per-filter row counts derived from one snapshot row list. */
export interface QueueCounts {
  all: number
  active: number
  attention: number
  done: number
}

/** A relative age split into a whole unit count and its unit name. */
export interface QueueAge {
  value: number
  unit: 'seconds' | 'minutes' | 'hours' | 'days'
}

/** Operator urgency order: work needing attention surfaces first. */
const STATE_RANK: Readonly<Record<QueueTaskState, number>> = {
  attention: 0,
  running: 1,
  queued: 2,
  done: 3,
}

function matchesFilter(row: QueueWorkSummaryView, filter: QueueFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'active') return row.state === 'queued' || row.state === 'running'
  return row.state === filter
}

/**
 * Filter rows by the given filter and case-insensitive title/id search, then
 * sort the returned copy by operator urgency, `updatedAt` descending, and `id`
 * descending for deterministic ties. The Remote array is never mutated.
 * @param rows - snapshot rows to project.
 * @param filter - which state set to keep.
 * @param query - case-insensitive title/id search; empty matches everything.
 * @returns a new array in display order.
 */
export function projectQueueRows(
  rows: readonly QueueWorkSummaryView[],
  filter: QueueFilter,
  query: string,
): QueueWorkSummaryView[] {
  const needle = query.trim().toLowerCase()
  const filtered = rows.filter(row => matchesFilter(row, filter)
    && (needle === '' || row.title.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle)))
  return filtered.slice().sort((left, right) => {
    const rank = STATE_RANK[left.state] - STATE_RANK[right.state]
    if (rank !== 0) return rank
    if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1
    return left.id < right.id ? 1 : -1
  })
}

/**
 * Count every operator filter from one row list.
 * @param rows - snapshot rows to count.
 * @returns one count per filter plus the total.
 */
export function countQueueRows(rows: readonly QueueWorkSummaryView[]): QueueCounts {
  let all = 0
  let active = 0
  let attention = 0
  let done = 0
  for (const row of rows) {
    all++
    if (row.state === 'queued' || row.state === 'running') active++
    if (row.state === 'attention') attention++
    if (row.state === 'done') done++
  }
  return { all, active, attention, done }
}

/**
 * Split elapsed wall time into a whole-unit age against one clock reading.
 * Future timestamps clamp to zero seconds; division floors at 60 seconds, 60
 * minutes, and 24 hours.
 * @param updatedAt - ISO timestamp to age.
 * @param nowMs - current epoch milliseconds.
 * @returns the largest whole unit that fits and its unit name.
 */
export function queueAge(updatedAt: string, nowMs: number): QueueAge {
  const seconds = Math.max(0, Math.floor((nowMs - Date.parse(updatedAt)) / 1000))
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days >= 1) return { value: days, unit: 'days' }
  if (hours >= 1) return { value: hours, unit: 'hours' }
  if (minutes >= 1) return { value: minutes, unit: 'minutes' }
  return { value: seconds, unit: 'seconds' }
}

/**
 * Map one projected row to the StateDot semantic it renders. A done row must
 * carry a terminal outcome; the Remote projection promises that invariant.
 * @param row - projected Queue row.
 * @returns the matching dot state.
 * @throws when a done row has a null outcome.
 */
export function dotFor(row: QueueWorkSummaryView): StateDotState {
  if (row.state === 'done') {
    if (row.outcome === 'succeeded') return 'done'
    if (row.outcome === 'failed') return 'error'
    if (row.outcome === 'canceled') return 'warning'
    throw new Error('Queue done row requires an outcome')
  }
  if (row.state === 'queued') return 'warning'
  if (row.state === 'running') return 'ongoing'
  return 'error'
}
