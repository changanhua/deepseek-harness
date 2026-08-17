/**
 * The center-column Queue workspace (design §4): service state and capacity,
 * filters + search, the task list, and the selected task's detail. Default
 * view answers "is the service healthy, what is running, what needs me, and
 * what is the outcome"; internal fields (receipt, fingerprints, run pids)
 * stay behind the explicit Diagnostics disclosure. Every write verb reports
 * pending → success/failure through the aria-live feedback region and the
 * store re-reads the host after each success — the view never fabricates a
 * state the backend did not confirm.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { Button, StateDot, IconRefreshOutline16, IconPauseOutline16, IconPlayOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { QueueWorkspaceProps } from './contract/slots.ts'
import type { QueueExecutorView, QueueSnapshot } from './store.ts'
import type { QueueTaskStatus, QueueTaskView } from '@deepseek-ai/dsh-task-queue-remote/views'
import { DONE_STATUSES, LIVE_STATUSES, STATUS_DOT, STATUS_LABEL_KEY, isAttention } from './status.ts'
import css from './QueueWorkspace.module.css'

type Filter = 'all' | 'live' | 'attention' | 'done' | 'dismissed'

const FILTERS: Filter[] = ['all', 'live', 'attention', 'done', 'dismissed']

/** Service-state dot semantic (healthy green / paused amber / faulted red). */
const SERVICE_DOT = { running: 'done', paused: 'warning', faulted: 'error' } as const

/** One transient write-outcome message; auto-clears. */
interface Feedback { tone: 'ok' | 'err'; text: string }

/**
 * Render the Queue workspace.
 * @param props - shell.view owner share + injected store + locale seat.
 * @returns the workspace element tree.
 */
export function QueueWorkspace({ queue, t }: QueueWorkspaceProps) {
  const snapshot = useSyncExternalStore<QueueSnapshot>(queue.subscribe, queue.getSnapshot)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [diag, setDiag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const feedbackTimer = useRef<number | undefined>(undefined)

  // Re-hydrate the panel on every mount (the frame unmounts inactive module
  // views, so opening the workspace is the refresh trigger; the plugin poll
  // keeps the badge live in between).
  useEffect(() => { void queue.refresh() }, [queue])

  useEffect(() => () => { window.clearTimeout(feedbackTimer.current) }, [])

  const stats = snapshot.stats
  const serviceState = stats?.serviceState ?? null

  /** Run one steering verb with pending → confirmed feedback. */
  async function runAction(action: () => Promise<{ ok: boolean; message: string }>): Promise<void> {
    setBusy(true)
    const outcome = await action()
    setBusy(false)
    showFeedback(outcome.ok ? 'ok' : 'err', outcome.message)
  }

  function showFeedback(tone: Feedback['tone'], text: string): void {
    setFeedback({ tone, text })
    window.clearTimeout(feedbackTimer.current)
    feedbackTimer.current = window.setTimeout(() => { setFeedback(null) }, 2600)
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return snapshot.summaries.filter((task) => {
      if (filter === 'live' && !LIVE_STATUSES.includes(task.status)) return false
      if (filter === 'attention' && !isAttention(task)) return false
      if (filter === 'done' && !DONE_STATUSES.includes(task.status)) return false
      if (filter === 'dismissed' && !task.dismissed) return false
      if (q !== '' && !task.title.toLowerCase().includes(q) && !task.id.toLowerCase().includes(q)) return false
      return true
    })
  }, [snapshot.summaries, filter, query])

  const running = stats?.byStatus.running ?? 0
  const starting = stats?.byStatus.starting ?? 0
  const failed = stats?.undismissedFailed ?? 0
  const dismissedCount = stats?.byDismissed ?? 0
  const total = snapshot.summaries.length

  const canCancel = (status: QueueTaskStatus) => status === 'pending' || status === 'starting' || status === 'running'
  const canRetry = (status: QueueTaskStatus) => status === 'failed' || status === 'canceled'
  const canDismiss = (task: { status: QueueTaskStatus; dismissed: boolean }) =>
    (task.status === 'succeeded' || task.status === 'failed' || task.status === 'canceled') && !task.dismissed
  const canUndismiss = (task: { dismissed: boolean }) => task.dismissed

  return (
    <div className={css.workspace}>
      <header className={css.head}>
        <div>
          <h1 className={css.title}>{t('view.title')}</h1>
          <p className={css.subtitle}>{t('view.subtitle')}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          icon={<IconRefreshOutline16 />}
          disabled={busy || snapshot.refreshing}
          onClick={() => { void queue.refresh() }}
        >
          {t('view.refresh')}
        </Button>
      </header>

      {serviceState === 'faulted' && (
        <div className={css.faultBanner} role="alert">
          <StateDot state="error" />
          <span>{t('service.faultBanner')}</span>
        </div>
      )}

      <div className={clsx(css.serviceBar, serviceState === 'faulted' && css.faulted, serviceState === 'paused' && css.paused)}>
        {serviceState === null
          ? <span className={css.serviceText}>{t('service.running')}</span>
          : (
            <>
              <StateDot state={SERVICE_DOT[serviceState]} />
              <span className={css.serviceText}>
                {serviceState === 'running' ? t('service.running') : serviceState === 'paused' ? t('service.paused') : t('service.faulted')}
              </span>
            </>
          )}
        <span className={css.capacity}>
          {running} {t('service.capacity')}{starting > 0 ? ` · ${starting} ${t('status.starting')}` : ''}
        </span>
        <div className={css.serviceActions}>
          {serviceState === 'running' && (
            <Button
              variant="ghost"
              size="sm"
              icon={<IconPauseOutline16 />}
              disabled={busy}
              onClick={() => { void runAction(() => queue.pause()) }}
            >
              {t('service.pause')}
            </Button>
          )}
          {(serviceState === 'paused' || serviceState === 'faulted') && (
            <Button
              variant="ghost"
              size="sm"
              icon={<IconPlayOutline16 />}
              disabled={busy || serviceState === 'faulted'}
              title={serviceState === 'faulted' ? t('service.resumeDisabled') : undefined}
              onClick={() => { void runAction(() => queue.resume()) }}
            >
              {t('service.resume')}
            </Button>
          )}
        </div>
      </div>

      <div className={css.shell}>
        <section className={css.listPane} aria-label={t('view.title')}>
          <div className={css.toolbar}>
            {FILTERS.map(kind => (
              <button
                key={kind}
                type="button"
                className={clsx(css.filter, filter === kind && css.filterActive)}
                aria-pressed={filter === kind}
                onClick={() => { setFilter(kind) }}
              >
                {t(`filter.${kind}`)}
                {kind === 'all' && <span className={css.count}>{total}</span>}
                {kind === 'attention' && failed > 0 && <span className={css.count}>{failed}</span>}
                {kind === 'dismissed' && dismissedCount > 0 && <span className={css.count}>{dismissedCount}</span>}
              </button>
            ))}
            <input
              className={css.search}
              aria-label={t('search.placeholder')}
              placeholder={t('search.placeholder')}
              value={query}
              onChange={(event) => { setQuery(event.target.value) }}
            />
            {snapshot.summaries.some(task => task.status === 'failed' && !task.dismissed) && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  const ids = snapshot.summaries
                    .filter(task => task.status === 'failed' && !task.dismissed)
                    .map(task => task.id)
                  void runAction(() => queue.retryMany(ids))
                }}
              >
                {t('list.actions.retryAllFailed')}
              </Button>
            )}
            {failed > 0 && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(t('list.actions.dismissAllFailedConfirm'))) return
                  void runAction(() => queue.dismissMany(snapshot.summaries.filter(task => task.status === 'failed' && !task.dismissed).map(task => task.id), true))
                }}
              >
                {t('list.actions.dismissAllFailed')}
              </Button>
            )}
            {snapshot.summaries.some(task => LIVE_STATUSES.includes(task.status)) && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  const ids = snapshot.summaries
                    .filter(task => LIVE_STATUSES.includes(task.status))
                    .map(task => task.id)
                  void runAction(() => queue.cancelMany(ids))
                }}
              >
                {t('list.actions.cancelAllLive')}
              </Button>
            )}
          </div>
          {rows.length === 0
            ? <div className={css.empty}>{t('list.empty')}</div>
            : (
              <ul className={css.rows}>
                {rows.map(task => (
                  <li key={task.id}>
                    <button
                      type="button"
                      className={clsx(css.row, snapshot.selectedId === task.id && css.rowSelected)}
                      onClick={() => { void queue.select(task.id) }}
                    >
                      <div className={css.rowMain}>
                        <span className={css.rowTitle}>{task.title}</span>
                        <span className={css.rowId}>{task.id}</span>
                      </div>
                      <span className={clsx(css.status, css[task.status])}>
                        <StateDot state={STATUS_DOT[task.status]} size={10} />
                        {t(STATUS_LABEL_KEY[task.status])}
                      </span>
                      <span className={css.executor}>{task.executor}</span>
                      <span className={css.attempt}>
                        {task.attempt}/{task.maxAttempts}
                      </span>
                      <span className={css.updated}>{task.updatedAt.slice(11, 16)}</span>
                      <span className={css.rowActions}>
                        {canCancel(task.status) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={(event) => {
                              event.stopPropagation()
                              void runAction(() => queue.cancel(task.id))
                            }}
                          >
                            {t('list.actions.cancel')}
                          </Button>
                        )}
                        {canRetry(task.status) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={(event) => {
                              event.stopPropagation()
                              void runAction(() => queue.retry(task.id))
                            }}
                          >
                            {t('list.actions.retry')}
                          </Button>
                        )}
                        {canDismiss(task) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={(event) => {
                              event.stopPropagation()
                              void runAction(() => queue.dismiss(task.id))
                            }}
                          >
                            {t('list.actions.dismiss')}
                          </Button>
                        )}
                        {canUndismiss(task) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={(event) => {
                              event.stopPropagation()
                              void runAction(() => queue.undismiss(task.id))
                            }}
                          >
                            {t('list.actions.undismiss')}
                          </Button>
                        )}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </section>
        <QueueDetail
          task={snapshot.detail}
          selected={snapshot.selectedId !== null}
          loading={snapshot.loading}
          diag={diag}
          setDiag={setDiag}
          t={t}
          executors={snapshot.executors}
          onReadRunLog={(taskId, runId) => queue.readRunLog(taskId, runId)}
        />
      </div>

      {snapshot.error !== null && (
        <div className={css.errorBanner} role="alert">
          <StateDot state="error" />
          <span>{snapshot.error}</span>
        </div>
      )}

      <div className={css.feedback} role="status" aria-live="polite">
        {feedback !== null && (
          <span className={clsx(css.feedbackText, feedback.tone === 'err' && css.feedbackErr)}>{feedback.text}</span>
        )}
      </div>
    </div>
  )
}

/** Right-hand task detail, driven by the store's selected detail view. */
function QueueDetail({ task, selected, loading, diag, setDiag, t, executors, onReadRunLog }: {
  task: QueueTaskView | null
  selected: boolean
  loading: boolean
  diag: boolean
  setDiag: (open: boolean) => void
  t: QueueWorkspaceProps['t']
  executors: QueueExecutorView[]
  onReadRunLog: (taskId: string, runId: string) => Promise<{ ok: true; content: string } | { ok: false; message: string }>
}) {
  const [log, setLog] = useState<{ runId: string; content: string | null; loading: boolean; error: string | null } | null>(null)
  async function loadRunLog(runId: string): Promise<void> {
    if (task === null) return
    setLog({ runId, content: null, loading: true, error: null })
    const result = await onReadRunLog(task.id, runId)
    if (result.ok) {
      setLog({ runId, content: result.content, loading: false, error: null })
    } else {
      setLog({ runId, content: null, loading: false, error: result.message })
    }
  }

  if (!selected && task === null) {
    return (
      <aside className={css.detailPane}>
        <div className={css.detailHead}>{t('detail.title')}</div>
        <div className={css.detailEmpty}>{t('detail.select')}</div>
      </aside>
    )
  }
  if (task === null) {
    return (
      <aside className={css.detailPane}>
        <div className={css.detailHead}>{t('detail.title')}</div>
        <div className={css.detailEmpty}>{loading ? '…' : t('detail.select')}</div>
      </aside>
    )
  }
  const kv = (label: string, value: string) => (
    <div className={css.kv} key={label}><span>{label}</span><b>{value}</b></div>
  )
  return (
    <aside className={css.detailPane}>
      <div className={css.detailHead}>
        <span className={css.detailTitle}>{task.title}</span>
        <span className={clsx(css.status, css[task.status])}>
          <StateDot state={STATUS_DOT[task.status]} size={10} />
          {t(STATUS_LABEL_KEY[task.status])}
        </span>
      </div>
      <div className={css.detailBody}>
        <section className={css.section}>
          <div className={css.sectionLabel}>{t('detail.executor')}</div>
          <div className={css.card}>
            {kv(t('detail.executor'), task.executor)}
            {kv(t('detail.priority'), String(task.priority))}
            {kv(t('list.columns.attempt'), `${task.attempt}/${task.maxAttempts}`)}
            {kv(t('detail.created'), task.createdAt.slice(0, 19).replace('T', ' '))}
            {kv(t('detail.updated'), task.updatedAt.slice(0, 19).replace('T', ' '))}
            {kv(t('detail.owner'), task.ownerSessionId ?? t('detail.ownerNone'))}
          </div>
        </section>

        {task.tags.length > 0 && (
          <section className={css.section}>
            <div className={css.sectionLabel}>Tags</div>
            <div className={css.card}>
              {task.tags.map(tag => <span key={tag} className={css.tag}>{tag}</span>)}
            </div>
          </section>
        )}

        {task.prompt !== '' && (
          <section className={css.section}>
            <div className={css.sectionLabel}>{t('detail.prompt')}</div>
            <div className={clsx(css.card, css.prompt)}>{task.prompt}</div>
          </section>
        )}

        {task.status === 'failed' && (
          <section className={css.section}>
            <div className={css.sectionLabel}>{t('detail.error')}</div>
            <div className={css.errorBox}>
              {task.lastError ?? '—'}
              <div className={css.errorNext}>{t('detail.errorNext')}</div>
            </div>
          </section>
        )}

        {task.status === 'stopping' && (
          <section className={css.section}>
            <div className={clsx(css.card, css.note)}>{t('detail.stopping')}</div>
          </section>
        )}

        {task.status === 'canceled' && (
          <section className={css.section}>
            <div className={clsx(css.card, css.note)}>{t('detail.canceled')}</div>
          </section>
        )}

        {task.dismissed && (
          <section className={css.section}>
            <div className={clsx(css.card, css.note)}>{t('detail.dismissed')}</div>
          </section>
        )}

        {task.result !== null && (
          <section className={css.section}>
            <div className={css.sectionLabel}>{t('detail.result')}</div>
            <div className={css.card}>
              {kv(t('detail.result.exit'), String(task.result.exitCode))}
              {kv(t('detail.result.duration'), `${(task.result.durationMs / 1000).toFixed(1)} s`)}
              {task.result.outputFiles.length > 0 && (
                <div className={css.artifacts}>
                  {task.result.outputFiles.map(file => (
                    <div key={file} className={css.artifact}><span className={css.artifactDot} />{file}</div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        <section className={css.section}>
          <div className={css.sectionLabel}>{t('detail.runs')}</div>
          <div className={css.card}>
            {task.runs.length === 0
              ? <div className={css.note}>{t('detail.runs.none')}</div>
              : task.runs.map(run => (
                <div key={run.runId} className={css.runRow}>
                  <span className={css.runAttempt}>{t('detail.runs.attempt')} {run.attempt}</span>
                  <span className={css.runMeta}>
                    {run.logPath ?? '—'} · {run.actualStartedAt?.slice(11, 19) ?? '—'}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={log?.runId === run.runId && log.loading}
                    onClick={() => { void loadRunLog(run.runId) }}
                  >
                    {log?.runId === run.runId && log.loading ? '…' : t('detail.runs.viewLog')}
                  </Button>
                  {log?.runId === run.runId && log.error !== null && (
                    <div className={css.runLogError}>{log.error}</div>
                  )}
                  {log?.runId === run.runId && log.content !== null && (
                    <pre className={css.runLog}>{log.content}</pre>
                  )}
                </div>
              ))}
          </div>
        </section>

        <section className={css.section}>
          <button type="button" className={css.diagToggle} aria-expanded={diag} onClick={() => { setDiag(!diag) }}>
            {t('detail.diagnostics')}
            <span>{diag ? t('detail.diagnostics.close') : t('detail.diagnostics.open')}</span>
          </button>
          {diag && (
            <div className={css.diagContent}>
              id: {task.id} · source: {task.source} · receipt: {task.receiptId}{'\n'}
              outputDir: {task.outputDir} · backoff: {task.backoffMs} ms · timeout: {task.timeoutMs} ms{'\n'}
              delayUntil: {task.delayUntil ?? '—'} · ownerSessionId: {task.ownerSessionId ?? '—'}
              {executors.map(e => `\nexecutor ${e.name}: enabled=${e.enabled} toolAllowed=${e.toolAllowed} live=${e.running}`).join('')}
              {task.runs.map(run => `\nrun ${run.attempt}: pid=${run.pid ?? '—'} fp=${run.commandFingerprint ?? '—'} unverified=${run.terminationUnverified}`).join('')}
            </div>
          )}
        </section>
      </div>
    </aside>
  )
}
