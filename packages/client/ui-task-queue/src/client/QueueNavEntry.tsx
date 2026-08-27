/**
 * The sidebar's Queue module entry: a first-level navigation row with a status
 * badge derived from the shared store's stats — the badge
 * only says whether attention is needed, never the whole queue. Wide renders
 * the labeled row; the collapsed rail renders the icon with the badge.
 */
import { useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { IconQueueOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { QueueNavEntryProps } from './contract/slots.ts'
import type { QueueSnapshot } from './store.ts'
import css from './QueueNavEntry.module.css'

const MODULE_ID = 'queue'

/** The badge copy/kind for one stats snapshot; undefined hides the badge. */
export function badgeFor(snapshot: QueueSnapshot, t: QueueNavEntryProps['t']):
  { text: string; kind: 'hot' | 'idle' | 'plain' } | undefined {
  const stats = snapshot.stats
  if (stats === null) return undefined
  const needsOperator = stats.byStatus.unknown + stats.byStatus.failed
  if (needsOperator > 0) return { text: `${needsOperator} ${t('nav.queue.failed')}`, kind: 'hot' }
  const running = stats.byStatus.running
  if (running > 0) return { text: `${running} ${t('nav.queue.running')}`, kind: 'idle' }
  return { text: stats.paused ? 'paused' : t('nav.queue.idle'), kind: 'plain' }
}

/**
 * Render the Queue module navigation entry.
 * @param props - sidebar module owner share + injected store + locale seat.
 * @returns the entry row (button).
 */
export function QueueNavEntry({ wide, activeModule, setActiveModule, queue, t }: QueueNavEntryProps) {
  const snapshot = useSyncExternalStore<QueueSnapshot>(queue.subscribe, queue.getSnapshot)
  const active = activeModule === MODULE_ID
  const badge = badgeFor(snapshot, t)
  return (
    <button
      type="button"
      className={clsx(css.entry, active && css.active, !wide && css.rail)}
      aria-current={active ? 'page' : undefined}
      aria-label={t('nav.queue')}
      title={wide ? undefined : t('nav.queue')}
      onClick={() => { setActiveModule(MODULE_ID) }}
    >
      <IconQueueOutline14 />
      {wide && <span className={css.label}>{t('nav.queue')}</span>}
      {badge !== undefined && (
        <span className={clsx(css.badge, css[badge.kind])}>{badge.text}</span>
      )}
    </button>
  )
}
