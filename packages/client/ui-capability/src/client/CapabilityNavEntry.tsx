/**
 * The sidebar's Capability module entry: a first-level navigation row with a
 * count badge derived from the shared store's snapshot. Wide renders the
 * labeled row; the collapsed rail renders the icon.
 */
import { useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { IconSkillOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilityNavEntryProps } from './contract/slots.ts'
import type { CapabilityStoreSnapshot } from './store.ts'
import css from './CapabilityNavEntry.module.css'

const MODULE_ID = 'capability'

/** The badge copy for one snapshot; undefined hides the badge. */
export function badgeFor(
  snapshot: CapabilityStoreSnapshot,
): { text: string } | undefined {
  if (snapshot.status !== 'ready' || snapshot.snapshot === undefined) return undefined
  const { skills, mcpServers, tools } = snapshot.snapshot
  const total = skills.length + mcpServers.length + tools.length
  if (total === 0) return undefined
  return { text: String(total) }
}

/**
 * Render the Capability module navigation entry.
 * @param props - sidebar module owner share + injected store + locale seat.
 * @returns the entry row (button).
 */
export function CapabilityNavEntry({ wide, activeModule, setActiveModule, capability, t }: CapabilityNavEntryProps) {
  const snapshot = useSyncExternalStore<CapabilityStoreSnapshot>(capability.subscribe, capability.getSnapshot)
  const active = activeModule === MODULE_ID
  const badge = badgeFor(snapshot)
  return (
    <button
      type="button"
      className={clsx(css.entry, active && css.active, !wide && css.rail)}
      aria-current={active ? 'page' : undefined}
      aria-label={t('nav.capability')}
      title={wide ? undefined : t('nav.capability')}
      onClick={() => { setActiveModule(MODULE_ID) }}
    >
      <IconSkillOutline16 />
      {wide && <span className={css.label}>{t('nav.capability')}</span>}
      {badge !== undefined && (
        <span className={css.badge}>{badge.text}</span>
      )}
    </button>
  )
}
