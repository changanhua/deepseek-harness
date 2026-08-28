/**
 * Skills Settings section: the session-addressed management projection over
 * the read-only `capabilityRegistry.management` Remote. The derived target
 * comes from the feature store's adopted session + the ordinary-session facts
 * available ordinary-session facts; a cold selection renders an empty state rather than querying the
 * host global registry. The page shows the selected-first effective list,
 * same-name shadow groups, invocation states, provenance labels, structured
 * diagnostics, and the incomplete/standing limitations, with an explicit
 * retry re-using the same session.
 */

import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { ordinarySessionsOf, resolveTarget } from './controller.ts'
import type { SkillsSectionProps } from './feature-types.ts'
import css from './SkillsSection.module.css'

/** Stable empty arrays so an unloaded page keeps one reference. */
const NO_ENTRIES = [] as const
const NO_DIAGNOSTICS = [] as const

/**
 * Render the section. The target is a pure derivation over framework-hook
 * data (`useAdopted` adoption + `useSessions` ordinary facts); the snapshot
 * store receives the resolved session through the injected `load` callback.
 */
export function SkillsSection({ close, useAdopted, followCurrent, useSessions, useSnapshot, load, retry, reset, t }: SkillsSectionProps) {
  const adopted = useAdopted(s => s.adopted)
  const sessions = useSessions(state => ({ byId: state.byId, current: state.current }))
  const snapshotState = useSnapshot(state => state)
  const [query, setQuery] = useState('')

  const target = useMemo(() => {
    const ordinary = ordinarySessionsOf(sessions.byId, sessions.current)
    return resolveTarget(adopted, ordinary.known, ordinary.currentOrdinary)
  }, [adopted, sessions.byId, sessions.current])

  useEffect(() => {
    if (target.mode === 'none') { reset(); return }
    load(target.sessionId)
  }, [target.mode === 'none' ? 'none' : target.sessionId, load, reset])

  const entries = snapshotState.snapshot?.entries ?? NO_ENTRIES
  const diagnostics = snapshotState.snapshot?.diagnostics ?? NO_DIAGNOSTICS
  // The effective list leads with selected candidates but still shows
  // same-name shadow groups, so every candidate participates in the search.
  const ordered = useMemo(
    () => [...entries].sort((a, b) => Number(b.selected) - Number(a.selected)),
    [entries],
  )
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return ordered
    const matches = (value: string | undefined): boolean => value !== undefined && value.toLowerCase().includes(needle)
    return ordered.filter(entry =>
      matches(entry.summary.name) || matches(entry.summary.description)
      || matches(entry.origin.provider) || matches(entry.origin.layerLabel)
      || matches(JSON.stringify(entry.origin.details ?? {})))
  }, [ordered, query])

  if (target.mode === 'none') {
    return (
      <section className={css.root}>
        <p className={css.empty}>{t('emptyState')}</p>
        <Button type="button" onClick={close}>{t('close')}</Button>
      </section>
    )
  }

  return (
    <section className={css.root} aria-label={t('nav')}>
      <div className={css.context}>
        <strong>{String(target.sessionId)}</strong>
        <span>·</span>
        <span>{snapshotState.snapshot?.fidelity === 'standing' ? t('standing') : t('live')}</span>
        <Button type="button" onClick={() => { followCurrent() }}>{t('followCurrent')}</Button>
      </div>

      {snapshotState.snapshot?.fidelity === 'standing' && (
        <div className={css.bannerStanding}>{t('standing')}</div>
      )}
      {snapshotState.snapshot?.complete === false && (
        <div className={css.bannerIncomplete}>{t('incomplete')}</div>
      )}

      <input
        className={css.search}
        aria-label={t('searchPlaceholder')}
        placeholder={t('searchPlaceholder')}
        value={query}
        onChange={event => setQuery(event.target.value)}
      />

      {snapshotState.status === 'error' && (
        <div className={css.error} role="alert">
          <span>{t('failedToLoad')}: {snapshotState.error}</span>
          <Button type="button" onClick={retry}>{t('retry')}</Button>
        </div>
      )}

      {snapshotState.status !== 'error' && filtered.length === 0 && (
        <p className={css.empty}>{t('noSkills')}</p>
      )}

      <ul className={css.list}>
        {filtered.map((entry) => {
          const winner = entries.find(candidate => candidate.id === entry.shadow?.by)
          return (
            <li
              key={entry.id}
              className={clsx(css.entry, entry.selected && css.entrySelected)}
              data-testid={`skill-${entry.summary.name}`}
            >
              <div className={css.name}>
                {entry.summary.name}
                {entry.selected && ` [${t('selected')}]`}
              </div>
              {entry.shadow !== undefined && (
                <div className={css.meta}>
                  {t('shadowed')}: {winner?.summary.name ?? entry.shadow.by}
                  {' '}({entry.shadow.reason === 'within-layer' ? t('withinLayer') : t('crossLayer')})
                </div>
              )}
              <div className={css.meta}>
                {t('modelInvocable')}: {entry.summary.invocation.modelInvocable ? '✓' : '—'}
                {' '}{t('userInvocable')}: {entry.summary.invocation.userInvocable ? '✓' : '—'}
              </div>
              <div className={css.meta}>
                {t('provider')}: {entry.origin.provider}
                {' '}· {t('layer')}: {entry.origin.layerLabel}
                {entry.summary.resourceKind !== undefined && (
                  <> · {t('source')}: {entry.summary.resourceKind}</>
                )}
                {entry.origin.details !== undefined && (
                  <div className={css.muted}>
                    {t('origin')}:
                    {entry.origin.details.relativePath !== undefined && ` ${String(entry.origin.details.relativePath)}`}
                    {entry.origin.details.rank !== undefined && ` ${t('rank')}: ${String(entry.origin.details.rank)}`}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {diagnostics.length > 0 && (
        <div className={css.diagnostics} aria-label={t('diagnostics')}>
          <div className={css.diagnosticsTitle}>{t('diagnostics')} ({diagnostics.length})</div>
          <ul className={css.list}>
            {diagnostics.map((diagnostic, index) => (
              <li key={index} className={css.diagnostic} data-severity={diagnostic.severity}>
                {diagnostic.code} · {diagnostic.stage} · {diagnostic.severity} · {diagnostic.message}
                {diagnostic.provider !== undefined && ` · ${diagnostic.provider}`}
                {diagnostic.location !== undefined && ` · ${diagnostic.location}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
