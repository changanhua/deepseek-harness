import clsx from 'clsx'
import { IconDataOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkObservatoryNavProps } from './contract.ts'
import css from './WorkObservatoryNavEntry.module.css'

const MODULE_ID = 'work-observatory'

/** Persistent sidebar entry for the dedicated observatory workspace. */
export function WorkObservatoryNavEntry({ wide, activeModule, setActiveModule, t }: WorkObservatoryNavProps) {
  const active = activeModule === MODULE_ID
  return (
    <button
      type="button"
      className={clsx(css.entry, active && css.active, !wide && css.rail)}
      aria-current={active ? 'page' : undefined}
      aria-label={t('nav.workObservatory')}
      title={wide ? undefined : t('nav.workObservatory')}
      onClick={() => { setActiveModule(MODULE_ID) }}
    >
      <IconDataOutline16 size={wide ? 16 : 18} />
      {wide ? <span className={css.label}>{t('nav.workObservatory')}</span> : null}
    </button>
  )
}
