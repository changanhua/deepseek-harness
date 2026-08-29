import clsx from 'clsx'
import { IconDataOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ArchitectureNavEntryProps } from './contract.ts'
import css from './ArchitectureNavEntry.module.css'

export function ArchitectureNavEntry({
  wide, activeModule, setActiveModule, catalog, t,
}: ArchitectureNavEntryProps) {
  const active = activeModule === 'architecture'
  return (
    <button
      type="button"
      className={clsx(css.entry, active && css.active, !wide && css.rail)}
      aria-current={active ? 'page' : undefined}
      aria-label={t('nav.architecture')}
      title={wide ? undefined : t('nav.architecture')}
      onClick={() => { setActiveModule('architecture') }}
    >
      <IconDataOutline16 size={wide ? 16 : 18} />
      {wide && <span className={css.label}>{t('nav.architecture')}</span>}
      {wide && <span className={css.badge}>{catalog.packages.length}</span>}
    </button>
  )
}
