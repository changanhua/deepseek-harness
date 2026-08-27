/**
 * Queue V1.1 operator workbench: a master-detail page where an operator finds
 * the next task needing attention, reads its latest attempt, and performs the
 * permitted action without raw JSON or an accidental duplicate execution. All
 * sorting, filtering, age, and dot decisions come from `view-model.ts`; all
 * reads and mutations stay on the shared `QueueStore`.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import {
  Button,
  JsonTree,
  Pill,
  RiskConfirmation,
  StateDot,
  Toast,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { JsonTreeLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  QueueJsonValue, QueueTaskState, QueueWorkSummaryView, QueueWorkView,
} from '@deepseek-ai/dsh-task-queue-remote/views'
import type { QueueWorkspaceProps } from './contract/slots.ts'
import type { QueueActionResult } from './store.ts'
import type { TaskQueueKey } from './locales.ts'
import {
  countQueueRows, dotFor, projectQueueRows, queueAge,
} from './view-model.ts'
import type { QueueAge, QueueFilter } from './view-model.ts'
import css from './QueueWorkspace.module.css'

/** One in-flight mutation, scoped to its work ID so other rows stay usable. */
type PendingKind = 'cancel' | 'retry' | 'authorize-retry' | 'confirm-failed'
type PendingAction = {
  workId: string
  kind: PendingKind
} | null

/** The dialog waiting on a checked risk acknowledgement. */
type ConfirmationKind = 'cancel' | 'authorize-retry'
type Confirmation = {
  workId: string
  kind: ConfirmationKind
} | null

/** A mutation failure that stays visible beside its row and in the detail. */
type ActionError = { workId: string; message: string } | null
/** One success Toast, keyed by sequence so repeats restart the cycle. */
type Feedback = { sequence: number; message: string } | null

const FILTERS: readonly QueueFilter[] = ['all', 'active', 'attention', 'done']

const TIME_UNIT_KEY: Readonly<Record<QueueAge['unit'], TaskQueueKey>> = {
  seconds: 'time.secondsAgo',
  minutes: 'time.minutesAgo',
  hours: 'time.hoursAgo',
  days: 'time.daysAgo',
}

const OUTCOME_KEY: Readonly<Record<'succeeded' | 'failed' | 'canceled', TaskQueueKey>> = {
  succeeded: 'outcome.succeeded',
  failed: 'outcome.failed',
  canceled: 'outcome.canceled',
}

function stateKey(state: QueueTaskState): 'status.queued' | 'status.running' | 'status.attention' | 'status.done' {
  return `status.${state}`
}

/** Localized JsonTree copy/aria labels for this render site. */
function jsonTreeLabels(t: QueueWorkspaceProps['t']): JsonTreeLabels {
  return {
    copyValue: t('jsonTree.copyValue'),
    copyJson: t('jsonTree.copyJson'),
    copyPath: t('jsonTree.copyPath'),
    copyPrettyJson: t('jsonTree.copyPrettyJson'),
    copyCompactJson: t('jsonTree.copyCompactJson'),
    copied: t('jsonTree.copied'),
    copyFailed: t('jsonTree.copyFailed'),
    collapseNode: t('jsonTree.collapseNode'),
    expandNode: t('jsonTree.expandNode'),
    copyButtonTitle: action => t('jsonTree.copyButtonTitle', { action }),
  }
}

/** Localized relative age from one clock reading. */
function ageLabel(age: QueueAge, t: QueueWorkspaceProps['t']): string {
  return t(TIME_UNIT_KEY[age.unit], { value: age.value })
}

/** Local, human-readable timestamp for summary and attempt sections. */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString()
}

/** Narrow a JSON value to an array without widening through `Array.isArray`'s `any[]` guard. */
function isQueueArray(value: QueueJsonValue): value is readonly QueueJsonValue[] {
  return Array.isArray(value)
}

/** Render the operator workspace over one shared QueueStore. */
export function QueueWorkspace({ queue, t }: QueueWorkspaceProps) {
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot)
  const [filter, setFilter] = useState<QueueFilter>('all')
  const [query, setQuery] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [failureReason, setFailureReason] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [actionError, setActionError] = useState<ActionError>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)

  useEffect(() => {
    void queue.refresh()
  }, [queue])

  // A selection change invalidates the previous task's reason and task-scoped error.
  useEffect(() => {
    setFailureReason('')
    setActionError(null)
  }, [snapshot.selectedId])

  const rows = useMemo(
    () => projectQueueRows(snapshot.rows, filter, query),
    [snapshot.rows, filter, query],
  )
  const counts = useMemo(() => countQueueRows(snapshot.rows), [snapshot.rows])
  const nowMs = Date.now()
  const detail = snapshot.detail
  const confirmationRow = confirmation === null
    ? null
    : snapshot.rows.find(row => row.id === confirmation.workId) ?? null

  const isPending = (workId: string): boolean => pendingAction?.workId === workId

  /**
   * Run one row-scoped mutation: lock only this work ID, emit a Toast on
   * success, keep the failure beside the row, and unlock when the same
   * pending entry still owns the slot.
   */
  async function act(
    workId: string,
    kind: PendingKind,
    action: () => Promise<QueueActionResult>,
    successMessage: string,
  ): Promise<void> {
    if (pendingAction !== null) return
    setPendingAction({ workId, kind })
    setActionError(null)
    try {
      const result = await action()
      if (result.ok) {
        setFeedback({ sequence: Date.now(), message: successMessage })
      } else {
        setActionError({ workId, message: result.message })
      }
    } finally {
      setPendingAction(current =>
        current !== null && current.workId === workId && current.kind === kind ? null : current,
      )
    }
  }

  function openConfirmation(workId: string, kind: ConfirmationKind): void {
    setAcknowledged(false)
    setConfirmation({ workId, kind })
  }

  function closeConfirmation(): void {
    setAcknowledged(false)
    setConfirmation(null)
  }

  function confirmConfirmation(): void {
    if (confirmation === null) return
    const { workId, kind } = confirmation
    setAcknowledged(false)
    setConfirmation(null)
    if (kind === 'cancel') {
      void act(workId, 'cancel', () => queue.cancel(workId), t('feedback.canceled'))
    } else {
      void act(
        workId,
        'authorize-retry',
        () => queue.resolveUnknown(workId, { kind: 'authorize-retry' }),
        t('feedback.retried'),
      )
    }
  }

  function confirmFailed(): void {
    if (detail === null) return
    const reason = failureReason.trim()
    if (reason === '') return
    void act(
      detail.id,
      'confirm-failed',
      () => queue.resolveUnknown(detail.id, {
        kind: 'confirm-failed',
        failure: {
          category: 'operator-confirmed',
          message: reason,
          sideEffect: 'unknown',
          retriable: false,
        },
      }),
      t('feedback.failed'),
    )
  }

  async function copyId(): Promise<void> {
    if (detail === null) return
    const ok = await writeClipboard(detail.id)
    setFeedback({
      sequence: Date.now(),
      message: ok ? t('detail.copySucceeded') : t('detail.copyFailed'),
    })
  }

  function renderEmpty(): ReactNode {
    if (query.trim() !== '') {
      return (
        <div className={css.empty}>
          <p>{t('empty.search')}</p>
          <Button size="sm" onClick={() => { setQuery('') }}>{t('search.clear')}</Button>
        </div>
      )
    }
    const copy = filter === 'all'
      ? t('empty.all')
      : filter === 'active'
        ? t('empty.active')
        : filter === 'attention'
          ? t('empty.attention')
          : t('empty.done')
    return <p className={css.empty}>{copy}</p>
  }

  function rowAction(row: QueueWorkSummaryView): ReactNode {
    if (row.state === 'attention') {
      return (
        <Button size="sm" disabled={isPending(row.id)} onClick={() => { void queue.select(row.id) }}>
          {t('list.actions.handle')}
        </Button>
      )
    }
    if (row.state === 'queued' || row.state === 'running') {
      return (
        <Button size="sm" disabled={isPending(row.id)} onClick={() => { openConfirmation(row.id, 'cancel') }}>
          {t('list.actions.cancel')}
        </Button>
      )
    }
    if (row.outcome === 'failed') {
      return (
        <Button
          size="sm"
          disabled={isPending(row.id)}
          onClick={() => { void act(row.id, 'retry', () => queue.retry(row.id), t('feedback.retried')) }}
        >
          {t('list.actions.retry')}
        </Button>
      )
    }
    return null
  }

  function detailActions(view: QueueWorkView): ReactNode {
    if (view.state === 'attention') {
      return (
        <div className={css.actionGroup}>
          <div className={css.actionRow}>
            <Button size="sm" disabled={isPending(view.id)} onClick={() => { openConfirmation(view.id, 'authorize-retry') }}>
              {t('list.actions.confirmRetry')}
            </Button>
          </div>
          <div className={css.actionRow}>
            <label className={css.reasonField}>
              <span>{t('attention.reasonLabel')}</span>
              <input
                aria-label={`${t('attention.reasonLabel')} ${view.title}`}
                value={failureReason}
                onChange={(event) => { setFailureReason(event.target.value) }}
              />
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending(view.id) || failureReason.trim() === ''}
              onClick={confirmFailed}
            >
              {t('list.actions.confirmFailed')}
            </Button>
          </div>
          <p className={css.reasonHelp}>{t('attention.reasonHelp')}</p>
        </div>
      )
    }
    if (view.state === 'queued' || view.state === 'running') {
      return (
        <Button size="sm" disabled={isPending(view.id)} onClick={() => { openConfirmation(view.id, 'cancel') }}>
          {t('list.actions.cancel')}
        </Button>
      )
    }
    if (view.outcome === 'failed') {
      return (
        <Button
          size="sm"
          disabled={isPending(view.id)}
          onClick={() => { void act(view.id, 'retry', () => queue.retry(view.id), t('feedback.retried')) }}
        >
          {t('list.actions.retry')}
        </Button>
      )
    }
    return null
  }

  function renderResult(output: QueueJsonValue): ReactNode {
    if (output !== null && typeof output === 'object') {
      return (
        <JsonTree
          data={isQueueArray(output) ? [...output] : output}
          label={t('detail.result')}
          labels={jsonTreeLabels(t)}
        />
      )
    }
    return <p className={css.resultPrimitive}>{String(output)}</p>
  }

  function renderDetail(view: QueueWorkView): ReactNode {
    return (
      <div className={css.detailBody}>
        <div className={css.detailHead}>
          <h3 className={css.detailTitle}>{view.title}</h3>
          <span className={css.detailState}>
            {t(stateKey(view.state))}
            {view.outcome !== null && <b> · {t(OUTCOME_KEY[view.outcome])}</b>}
          </span>
          <Button size="sm" variant="outline" onClick={() => { void copyId() }}>{t('detail.copyId')}</Button>
        </div>
        <section className={css.section} aria-label={t('detail.summary')}>
          <h4 className={css.sectionLabel}>{t('detail.summary')}</h4>
          <div className={css.kv}>
            <div><span>{t('detail.kind')}</span><b>{view.kind}</b></div>
            <div><span>{t('detail.owner')}</span><b>{view.ownerSessionId ?? t('detail.ownerNone')}</b></div>
            <div><span>{t('list.columns.attempt')}</span><b>{view.attemptCount}/{view.maxAttempts}</b></div>
            <div><span>{t('detail.created')}</span><b>{formatDateTime(view.createdAt)}</b></div>
            <div><span>{t('detail.updated')}</span><b>{formatDateTime(view.updatedAt)}</b></div>
          </div>
        </section>
        {view.failure !== null && (
          <section className={css.section} aria-label={t('detail.issue')}>
            <h4 className={css.sectionLabel}>{t('detail.issue')}</h4>
            <div className={css.failureBox}>
              <p className={css.failureRow}><strong>{t('detail.issue.category')}</strong>：{view.failure.category}</p>
              <p className={css.failureRow}>{view.failure.message}</p>
              <p className={css.failureRow}><strong>{t('detail.issue.sideEffect')}</strong>：{view.failure.sideEffect}</p>
              <p className={css.failureRow}>
                <strong>{t('detail.issue.retriable')}</strong>：
                {view.failure.retriable ? t('detail.issue.retriableYes') : t('detail.issue.retriableNo')}
              </p>
            </div>
          </section>
        )}
        <section className={css.section} aria-label={t('detail.actions')}>
          <h4 className={css.sectionLabel}>{t('detail.actions')}</h4>
          {detailActions(view)}
          {actionError !== null && actionError.workId === view.id && (
            <p className={css.detailError} role="alert">{actionError.message}</p>
          )}
        </section>
        <section className={css.section} aria-label={t('detail.attempts')}>
          <h4 className={css.sectionLabel}>{t('detail.attempts')}</h4>
          {view.attempts.length === 0 ? <p>{t('detail.attemptsNone')}</p> : (
            <ul className={css.attemptList}>
              {view.attempts.map(attempt => (
                <li key={attempt.id} className={css.attemptRow}>
                  <span className={css.attemptOrdinal}>#{attempt.ordinal}</span>
                  <span>{attempt.status}</span>
                  <span>{t('detail.attempts.started')}：{formatDateTime(attempt.startedAt)}</span>
                  {attempt.finishedAt !== null && (
                    <span>{t('detail.attempts.finished')}：{formatDateTime(attempt.finishedAt)}</span>
                  )}
                  {attempt.failure !== null && (
                    <span className={css.attemptFailure}>
                      {t('detail.attempts.failure')}：{attempt.failure.message}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={css.section} aria-label={t('detail.result')}>
          <h4 className={css.sectionLabel}>{t('detail.result')}</h4>
          {view.result === null ? <p>{t('detail.resultNone')}</p> : renderResult(view.result.output)}
        </section>
        <details className={css.advanced}>
          <summary>{t('detail.advanced')}</summary>
          <JsonTree data={{ work: view }} label={t('detail.advanced')} expandTopLevel={false} labels={jsonTreeLabels(t)} />
        </details>
      </div>
    )
  }

  const isRetryConfirmation = confirmation?.kind === 'authorize-retry'
  const confirmationTitle = isRetryConfirmation ? t('attention.retryTitle') : t('attention.cancelTitle')
  const confirmationDescription = isRetryConfirmation
    ? t('attention.retryDescription', { title: confirmationRow?.title ?? '' })
    : confirmationRow?.state === 'queued'
      ? t('attention.cancelQueuedDescription')
      : t('attention.cancelRunningDescription')
  const confirmationAcknowledge = isRetryConfirmation
    ? t('attention.retryAcknowledge')
    : t('attention.cancelAcknowledge')

  return (
    <section className={css.workspace} aria-label={t('view.title')}>
      <header className={css.head}>
        <div className={css.headMeta}>
          <h2 className={css.title}>{t('view.title')}</h2>
          <span className={css.refreshMeta} role="status">
            {snapshot.refreshing
              ? t('view.updating')
              : snapshot.lastSuccessfulRefreshAt === null
                ? ''
                : t('view.updated', { time: ageLabel(queueAge(snapshot.lastSuccessfulRefreshAt, nowMs), t) })}
          </span>
        </div>
        <Button onClick={() => { void queue.refresh() }} disabled={snapshot.refreshing}>{t('view.refresh')}</Button>
      </header>
      {snapshot.error !== null && (
        <div className={css.errorBanner} role="alert">
          {t('view.updateFailed', { message: snapshot.error })}
        </div>
      )}
      <div className={css.shell}>
        <section className={css.listPane} aria-label={t('list.title')}>
          <div className={css.toolbar}>
            {FILTERS.map(value => (
              <Pill
                key={value}
                active={filter === value}
                aria-pressed={filter === value}
                onClick={() => { setFilter(value) }}
              >
                {t(`filter.${value}`)} <span className={css.count}>{counts[value]}</span>
              </Pill>
            ))}
            <input
              className={css.search}
              aria-label={t('search.placeholder')}
              placeholder={t('search.placeholder')}
              value={query}
              onChange={(event) => { setQuery(event.target.value) }}
            />
          </div>
          {rows.length === 0 ? renderEmpty() : (
            <ul className={css.rows}>
              {rows.map(row => (
                <li
                  key={row.id}
                  className={clsx(css.row, snapshot.selectedId === row.id && css.rowSelected)}
                >
                  <button
                    type="button"
                    className={css.rowSelect}
                    aria-current={snapshot.selectedId === row.id ? 'true' : undefined}
                    onClick={() => { void queue.select(row.id) }}
                  >
                    <StateDot state={dotFor(row)} />
                    <span className={css.rowState}>{t(stateKey(row.state))}</span>
                    <span className={css.rowTitle}>{row.title}</span>
                    <span className={css.rowOwner}>{row.ownerSessionId ?? t('detail.ownerNone')}</span>
                    <span className={css.rowAttempt}>{t('list.columns.attempt')} {row.attemptCount}/{row.maxAttempts}</span>
                    <span className={css.rowAge}>{ageLabel(queueAge(row.updatedAt, nowMs), t)}</span>
                  </button>
                  <div className={css.rowActions}>{rowAction(row)}</div>
                  {actionError !== null && actionError.workId === row.id && (
                    <p className={css.rowError} role="alert">{actionError.message}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className={css.detailPane} aria-label={t('detail.title')}>
          {detail === null ? <p className={css.detailEmpty}>{t('detail.select')}</p> : renderDetail(detail)}
        </aside>
      </div>
      {feedback !== null && (
        <Toast key={feedback.sequence} text={feedback.message} onDone={() => { setFeedback(null) }} />
      )}
      <RiskConfirmation
        open={confirmation !== null}
        title={confirmationTitle}
        description={confirmationDescription}
        acknowledgeLabel={confirmationAcknowledge}
        cancelLabel={t('dialog.cancel')}
        closeLabel={t('dialog.cancel')}
        confirmLabel={t('dialog.confirm')}
        acknowledged={acknowledged}
        onAcknowledgedChange={setAcknowledged}
        onCancel={closeConfirmation}
        onConfirm={confirmConfirmation}
      />
    </section>
  )
}
