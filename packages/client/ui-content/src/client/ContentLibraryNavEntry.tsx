import clsx from 'clsx'
import { IconBrowseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContentNavProps } from './contract.ts'
import css from './ContentLibraryNavEntry.module.css'

const MODULE_ID = 'content-library'

/** Persistent sidebar entry for the content library workspace. */
export function ContentLibraryNavEntry({ wide, activeModule, setActiveModule, t }: ContentNavProps) {
  const active = activeModule === MODULE_ID
  return (
    <button
      type="button"
      className={clsx(css.entry, active && css.active, !wide && css.rail)}
      aria-current={active ? 'page' : undefined}
      aria-label={t('nav.contentLibrary')}
      title={wide ? undefined : t('nav.contentLibrary')}
      onClick={() => { setActiveModule(MODULE_ID) }}
    >
      <IconBrowseOutline16 size={wide ? 16 : 18} />
      {wide ? <span className={css.label}>{t('nav.contentLibrary')}</span> : null}
    </button>
  )
}
