/**
 * Work Observatory settings section: reads one normalized Host range and
 * renders the five accounting metrics plus the three source timelines.
 *
 * The component owns no activity listening and recomputes no business metric:
 * Human Active, Page Visible, Agent Running, Agent Solo, and Together come
 * straight from `WorkObservatoryRange.summary`, and the timelines are painted
 * from the normalized interval lists at their raw proportion of `[from, to)`.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { WorkInterval, WorkObservatoryRange } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkObservatoryKey } from './locales.ts'
import css from './WorkObservatorySection.module.css'

/** Registration-side business face for the Work Observatory settings section. */
export interface WorkObservatorySectionInjected {
  /** Load one normalized Host range for a local calendar day. */
  readRange: (from: number, to: number) => Promise<WorkObservatoryRange>
}

/** Full component props. */
export type WorkObservatorySectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.workObservatory'>
  & WorkObservatorySectionInjected

/** The three normalized source timelines, in stable render order. */
const TIMELINES: ReadonlyArray<{
  key: 'pageVisible' | 'humanActive' | 'agentRunning'
  labelKey: WorkObservatoryKey
}> = [
  { key: 'pageVisible', labelKey: 'timelineVisible' },
  { key: 'humanActive', labelKey: 'timelineActive' },
  { key: 'agentRunning', labelKey: 'timelineRunning' },
]

/** The five accounting metrics: summary field key plus its locale label key. */
const METRICS: ReadonlyArray<{
  summaryKey: keyof WorkObservatoryRange['summary']
  labelKey: WorkObservatoryKey
}> = [
  { summaryKey: 'humanActiveMs', labelKey: 'humanActive' },
  { summaryKey: 'pageVisibleMs', labelKey: 'pageVisible' },
  { summaryKey: 'agentRunningMs', labelKey: 'agentRunning' },
  { summaryKey: 'agentSoloMs', labelKey: 'agentSolo' },
  { summaryKey: 'togetherMs', labelKey: 'together' },
]

/**
 * Render one duration in a compact human form without claiming meaning beyond
 * wall time.
 * @param milliseconds - the wall-clock duration to format.
 * @returns a compact `Nh Mm` / `Nm Ss` / `Ss` string.
 */
function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.round(milliseconds / 1_000)
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

/** Today's date as an ISO calendar day in the browser's local timezone. */
function localIsoToday(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Resolve one ISO calendar day to a local-midnight half-open epoch range.
 * The end is the NEXT local midnight, so a DST day keeps its true
 * 23/24/25-hour span instead of assuming 24 hours; the Host never guesses the
 * timezone.
 * @param isoDate - `YYYY-MM-DD` in the browser's local calendar.
 * @returns `[from, to)` local midnight epochs.
 */
function localDayRange(isoDate: string): [number, number] {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number]
  const from = new Date(year, month - 1, day).getTime()
  const to = new Date(year, month - 1, day + 1).getTime()
  return [from, to]
}

/** One metric tile: a formatted wall-clock value over its label. */
function Kpi({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <div className={css.kpi}>
      <span className={css.kpiValue}>{value}</span>
      <span className={css.kpiLabel}>{label}</span>
    </div>
  )
}

/** One normalized timeline row, painted at raw proportion of `[from, to)`. */
function TimelineRow({
  label, intervals, from, to,
}: {
  label: string
  intervals: readonly WorkInterval[]
  from: number
  to: number
}): ReactNode {
  const span = to - from
  const bars = intervals.map((interval, index) => {
    const left = ((interval.start - from) / span) * 100
    const width = ((interval.end - interval.start) / span) * 100
    return (
      <div
        key={index}
        className={css.bar}
        style={{ left: `${left}%`, width: `${width}%` }}
      />
    )
  })
  return (
    <div className={css.timelineRow}>
      <span className={css.timelineLabel}>{label}</span>
      <div className={css.timelineTrack} aria-label={`${label}: ${bars.length} interval(s)`}>
        {bars}
      </div>
    </div>
  )
}

/** Work Observatory settings section body. */
export function WorkObservatorySection(props: WorkObservatorySectionProps): ReactNode {
  const { t, readRange } = props
  const [date, setDate] = useState<string>(() => localIsoToday())
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [range, setRange] = useState<WorkObservatoryRange | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    const [from, to] = localDayRange(date)
    void readRange(from, to).then((result) => {
      if (cancelled) return
      setRange(result)
      setStatus('ready')
    }).catch(() => {
      if (cancelled) return
      setStatus('error')
    })
    return () => { cancelled = true }
  }, [date, attempt, readRange])

  const metrics = useMemo(() => range?.summary, [range])

  return (
    <section className={css.section} aria-label={t('title')}>
      <h2 className={css.title}>{t('title')}</h2>
      <p className={css.description}>{t('description')}</p>

      <div className={css.controls}>
        <label className={css.dateLabel} htmlFor="work-observatory-date">{t('dateLabel')}</label>
        <input
          id="work-observatory-date"
          className={css.dateInput}
          type="date"
          value={date}
          onChange={(event) => { setDate(event.target.value) }}
        />
        <button
          type="button"
          className={css.todayButton}
          onClick={() => { setDate(localIsoToday()) }}
        >
          {t('today')}
        </button>
      </div>

      {status === 'loading' && <p aria-busy="true" className={css.status}>{t('loading')}</p>}
      {status === 'error' && (
        <>
          <p role="alert" className={css.status}>{t('error')}</p>
          <button
            type="button"
            className={css.retryButton}
            onClick={() => { setAttempt(value => value + 1) }}
          >
            {t('retry')}
          </button>
        </>
      )}

      {status === 'ready' && metrics !== undefined && range !== null && (
        <>
          <div className={css.kpis}>
            {METRICS.map(({ summaryKey, labelKey }) => (
              <Kpi key={summaryKey} label={t(labelKey)} value={formatDuration(metrics[summaryKey])} />
            ))}
          </div>
          <div className={css.timelines}>
            {TIMELINES.map(({ key, labelKey }) => (
              <TimelineRow
                key={key}
                label={t(labelKey)}
                intervals={range.timeline[key]}
                from={range.from}
                to={range.to}
              />
            ))}
          </div>
        </>
      )}

      <p className={css.limitation}>{t('limitation')}</p>
    </section>
  )
}
