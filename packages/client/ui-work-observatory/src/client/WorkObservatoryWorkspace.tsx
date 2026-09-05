import type { CSSProperties } from 'react'
import type { WorkObservatoryInterval } from '@changanhua/dsh-host-work-observatory/types'
import { IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkObservatoryWorkspaceProps } from './contract.ts'
import css from './WorkObservatoryWorkspace.module.css'

interface DurationUnits {
  readonly second: string
  readonly minute: string
  readonly hour: string
  readonly separator?: string
}

const DEFAULT_UNITS: DurationUnits = { second: '秒', minute: '分钟', hour: '小时' }

/** Compact duration copy used by headline and Session rows. */
export function formatDuration(milliseconds: number, units: DurationUnits = DEFAULT_UNITS): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000))
  if (seconds < 60) return `${seconds}${units.second}`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  const separator = units.separator ?? ''
  if (minutes < 60) {
    return rest === 0
      ? `${minutes}${units.minute}`
      : `${minutes}${units.minute}${separator}${rest}${units.second}`
  }
  const hours = Math.floor(minutes / 60)
  const restMinutes = minutes % 60
  return restMinutes === 0
    ? `${hours}${units.hour}`
    : `${hours}${units.hour}${separator}${restMinutes}${units.minute}`
}

function bandStyle(interval: WorkObservatoryInterval, from: number, to: number): CSSProperties {
  const span = to - from
  return {
    left: `${((interval.start - from) / span) * 100}%`,
    width: `${((interval.end - interval.start) / span) * 100}%`,
  }
}

/** Dedicated day/project evidence workspace. */
export function WorkObservatoryWorkspace({
  useObservatory, selectDate, refresh, openSession, t,
}: WorkObservatoryWorkspaceProps) {
  const state = useObservatory(value => value)
  const range = state.range
  const summary = range?.summary
  const durationUnits: DurationUnits = {
    second: t('unit.second'),
    minute: t('unit.minute'),
    hour: t('unit.hour'),
    separator: t('unit.separator'),
  }
  const metrics = [
    [t('summary.human'), summary?.humanActiveMs ?? 0],
    [t('summary.visible'), summary?.pageVisibleMs ?? 0],
    [t('summary.agent'), summary?.agentRunningMs ?? 0],
    [t('summary.together'), summary?.togetherMs ?? 0],
    [t('summary.solo'), summary?.agentSoloMs ?? 0],
  ] as const
  return (
    <section className={css.root} aria-label={t('nav.workObservatory')}>
      <header className={css.header}>
        <div>
          <p className={css.eyebrow}>{t('view.eyebrow')}</p>
          <h1>{t('view.title')}</h1>
          <p className={css.subtitle}>{t('view.subtitle')}</p>
        </div>
        <div className={css.controls}>
          <label>
            <span>{t('filter.date')}</span>
            <input type="date" value={state.date} onChange={(event) => { selectDate(event.currentTarget.value) }} />
          </label>
          <button type="button" onClick={refresh}><IconRefreshOutline16 />{t('action.refresh')}</button>
        </div>
      </header>

      {state.projectPath !== undefined ? (
        <div className={css.project}><span>{t('filter.project')}</span><code>{state.projectPath}</code></div>
      ) : null}
      {state.status === 'error' ? <p role="alert" className={css.error}>{t('status.error')}: {state.error}</p> : null}
      {state.status === 'loading' && range === undefined ? <p className={css.loading}>{t('status.loading')}</p> : null}

      <div className={css.dayBand} aria-label={t('timeline.label')}>
        <div className={css.hours}>{[0, 6, 12, 18, 24].map(hour => <span key={hour}>{String(hour).padStart(2, '0')}:00</span>)}</div>
        <div className={css.track}>
          {range?.timeline.pageVisible.map((interval, index) => <i key={`v${index}`} className={css.visibleBand} style={bandStyle(interval, range.from, range.to)} />)}
          {range?.timeline.agentRunning.map((interval, index) => <i key={`a${index}`} className={css.agentBand} style={bandStyle(interval, range.from, range.to)} />)}
          {range?.timeline.humanActive.map((interval, index) => <i key={`h${index}`} className={css.humanBand} style={bandStyle(interval, range.from, range.to)} />)}
        </div>
      </div>

      <dl className={css.ledger}>
        {metrics.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{formatDuration(value, durationUnits)}</dd></div>
        ))}
      </dl>

      <section className={css.sessions}>
        <h2>{t('sessions.title')}</h2>
        {range?.sessions.length ? (
          <ul>{range.sessions.map(session => (
            <li key={session.sessionId}>
              <button
                type="button"
                aria-label={`${t('sessions.open')} ${session.sessionId}`}
                onClick={() => { openSession(session.sessionId) }}
              >
                <span><strong>{session.sessionId}</strong><small>{session.projectPath}</small></span>
                <span>{t('summary.human')} {formatDuration(session.humanActiveMs, durationUnits)} · {t('summary.agent')} {formatDuration(session.agentRunningMs, durationUnits)} · {t('summary.together')} {formatDuration(session.togetherMs, durationUnits)}</span>
              </button>
            </li>
          ))}</ul>
        ) : <p>{t('sessions.empty')}</p>}
      </section>
    </section>
  )
}
