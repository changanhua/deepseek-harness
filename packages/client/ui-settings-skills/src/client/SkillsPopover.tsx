/**
 * Session title-bar Skills Popover (§5.1): the small per-session entry beside
 * the title. It shows the final effective skills for ITS ordinary session with
 * model/user invocation state, an incomplete/standing hint, and a diagnostic
 * count, plus a "Manage all" affordance that adopts this session (§3.4) and
 * opens the Skills Settings section via the injected navigator callback. A
 * subagent address renders dormant — it has no ordinary attached session, so
 * it never issues a management request (§5.1).
 */

import { useEffect, useMemo, useState } from 'react'
import { Button, IconSkillOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { isOrdinary } from './controller.ts'
import type { SkillsPopoverProps } from './feature-types.ts'
import css from './SkillsPopover.module.css'

/** Keep the popover's preview bounded; the Settings page shows everything. */
const PREVIEW_LIMIT = 6

/**
 * Render the header trigger and its anchored panel. The panel is a
 * lightweight, self-contained popover driven by component-local open state.
 */
export function SkillsPopover({ sessionId, adopt, useSessions, useSnapshot, load, openManagement, t }: SkillsPopoverProps) {
  const [open, setOpen] = useState(false)
  const row = useSessions(state => state.byId[sessionId])
  const snapshotState = useSnapshot(state => state)
  const ordinary = row !== undefined && isOrdinary({ id: sessionId, blank: row.blank, origin: row.origin })

  useEffect(() => {
    if (!open || !ordinary) return
    load(sessionId)
  }, [open, ordinary, sessionId, load])

  const effective = useMemo(
    () => (snapshotState.snapshot?.entries ?? []).filter(entry => entry.selected),
    [snapshotState.snapshot],
  )
  const diagnosticCount = snapshotState.snapshot?.diagnostics.length ?? 0
  const label = ordinary && effective.length > 0 ? `${t('nav')} · ${effective.length}` : t('nav')

  return (
    <div className={css.anchor}>
      <Button
        className={css.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
        title={label}
      >
        <IconSkillOutline16 size={16} />
        <span>{label}</span>
      </Button>

      {open && (
        <div className={css.panel} role="dialog" aria-label={t('nav')}>
          {!ordinary ? (
            <p className={css.note}>{t('emptyState')}</p>
          ) : (
            <>
              {snapshotState.snapshot?.fidelity === 'standing' && (
                <div className={css.note}>{t('standing')}</div>
              )}
              {snapshotState.snapshot?.complete === false && (
                <div className={css.note}>{t('incomplete')}</div>
              )}
              {snapshotState.status === 'error' && (
                <div className={css.note}>{t('failedToLoad')}</div>
              )}

              {effective.length === 0 && <p className={css.note}>{t('noSkills')}</p>}
              <ul className={css.list}>
                {effective.slice(0, PREVIEW_LIMIT).map(entry => (
                  <li key={entry.id} className={css.row}>
                    <span>{entry.summary.name}</span>
                    <span className={css.invocation}>
                      {entry.summary.invocation.modelInvocable ? 'M' : ''}
                      {entry.summary.invocation.userInvocable ? 'U' : ''}
                    </span>
                  </li>
                ))}
              </ul>

              {diagnosticCount > 0 && (
                <div className={css.note}>{t('diagnosticCount').replace('{count}', String(diagnosticCount))}</div>
              )}

              <Button
                className={css.manage}
                type="button"
                onClick={() => {
                  adopt(sessionId)
                  openManagement()
                  setOpen(false)
                }}
              >
                {t('manageAll')}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
