/** Persistent sidebar entry for the Personal Delivery module. */

import { IconChecklistOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DeliveryNavEntryProps } from './contract.ts'
import css from './DeliveryNavEntry.module.css'

const MODULE_ID = 'delivery'

/** Open the Delivery module and report only the current blocked count. */
export function DeliveryNavEntry({
  wide,
  activeModule,
  setActiveModule,
  useDelivery,
  t,
}: DeliveryNavEntryProps) {
  const blocked = useDelivery(state =>
    state.snapshot?.cards.filter(card => card.lane === 'blocked').length ?? 0,
  )
  const active = activeModule === MODULE_ID
  return (
    <button
      type="button"
      className={`${css.entry}${active ? ` ${css.active}` : ''}${wide ? '' : ` ${css.rail}`}`}
      aria-current={active ? 'page' : undefined}
      aria-label={t('nav.delivery')}
      title={wide ? undefined : t('nav.delivery')}
      onClick={() => { setActiveModule(MODULE_ID) }}
    >
      <IconChecklistOutline14 size={wide ? 14 : 18} />
      {wide && <span className={css.label}>{t('nav.delivery')}</span>}
      {blocked > 0 && <span className={css.badge}>{t('nav.blocked', { count: blocked })}</span>}
    </button>
  )
}
