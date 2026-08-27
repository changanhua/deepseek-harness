// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { QueueWorkView, QueueWorkSummaryView } from '@deepseek-ai/dsh-task-queue-remote/views'
import { QueueWorkspace } from '../src/client/QueueWorkspace.tsx'
import { zh, type TaskQueueKey } from '../src/client/locales.ts'
import type { QueueSnapshot, QueueStore } from '../src/client/store.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** Translate through the zh dictionary with {name} interpolation, like the locale runtime. */
const t = (key: string, params?: Record<string, unknown>): string => {
  const template = zh[key as TaskQueueKey] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    if (value === undefined) return match
    if (typeof value === 'string' || typeof value === 'number') return String(value)
    return JSON.stringify(value)
  })
}

/** One complete snapshot with fixed timestamps and per-case overrides. */
function makeSnapshot(overrides: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return {
    stats: {
      paused: false,
      byStatus: { queued: 0, starting: 0, running: 0, unknown: 0, succeeded: 0, failed: 0, canceled: 0 },
      byKind: {},
    },
    rows: [],
    selectedId: null,
    detail: null,
    loading: false,
    refreshing: false,
    error: null,
    lastSuccessfulRefreshAt: '2026-08-27T10:00:00.000Z',
    ...overrides,
  }
}

/** One summary row with the required projection fields defaulted. */
function row(partial: Partial<QueueWorkSummaryView> & { id: string }): QueueWorkSummaryView {
  return {
    kind: 'agent.run@1',
    title: partial.id,
    status: 'queued',
    state: 'queued',
    outcome: null,
    attemptCount: 0,
    maxAttempts: 3,
    batchId: null,
    ownerSessionId: null,
    createdAt: '2026-08-27T09:00:00.000Z',
    updatedAt: '2026-08-27T09:00:00.000Z',
    ...partial,
  }
}

/** A QueueStore-compatible fake with spies, feeding one fixed snapshot. */
function makeQueue(
  snapshot: QueueSnapshot,
  overrides: {
    cancel?: () => Promise<{ ok: boolean; message: string }>
    retry?: () => Promise<{ ok: boolean; message: string }>
    resolveUnknown?: () => Promise<{ ok: boolean; message: string }>
  } = {},
) {
  const cancel = overrides.cancel ?? vi.fn(async () => ({ ok: true, message: 'ok' }))
  const retry = overrides.retry ?? vi.fn(async () => ({ ok: true, message: 'ok' }))
  const resolveUnknown = overrides.resolveUnknown ?? vi.fn(async () => ({ ok: true, message: 'ok' }))
  const queue = {
    subscribe: vi.fn(() => () => {}),
    getSnapshot: vi.fn(() => snapshot),
    refresh: vi.fn(async () => {}),
    select: vi.fn(async () => {}),
    cancel,
    retry,
    resolveUnknown,
  } as unknown as QueueStore
  return { queue, cancel, retry, resolveUnknown }
}

function renderWorkspace(snapshot: QueueSnapshot, overrides: Parameters<typeof makeQueue>[1] = {}) {
  const { queue, ...spies } = makeQueue(snapshot, overrides)
  render(
    <QueueWorkspace
      queue={queue}
      useSessions={() => { throw new Error('unused') }}
      useSessionPendingInteraction={() => { throw new Error('unused') }}
      useWorkspaces={() => { throw new Error('unused') }}
      t={t}
    />,
  )
  return { queue, ...spies }
}

const attentionDetail: QueueWorkView = {
  ...row({
    id: 'attention-1', title: 'Attention one', state: 'attention', status: 'unknown',
    attemptCount: 2, maxAttempts: 3, updatedAt: '2026-08-27T09:58:00.000Z',
  }),
  failure: { category: 'worker', message: 'outcome unknown', sideEffect: 'unknown', retriable: false },
  attempts: [],
  result: null,
}

describe('QueueWorkspace', () => {
  it('orders attention before running, queued, and done and exposes four filter counts', () => {
    const rows = [
      row({ id: 'done-old', title: 'Done old', state: 'done', outcome: 'failed', updatedAt: '2026-08-27T08:00:00.000Z' }),
      row({ id: 'done-new', title: 'Done new', state: 'done', outcome: 'succeeded', updatedAt: '2026-08-27T09:00:00.000Z' }),
      row({ id: 'queued-1', title: 'Queued one', updatedAt: '2026-08-27T07:00:00.000Z' }),
      row({ id: 'running-1', title: 'Running one', state: 'running', status: 'running', updatedAt: '2026-08-27T06:00:00.000Z' }),
      row({ id: 'attention-1', title: 'Attention one', state: 'attention', status: 'unknown', updatedAt: '2026-08-27T05:00:00.000Z' }),
    ]
    const snapshot = makeSnapshot({ rows })
    renderWorkspace(snapshot)

    const list = screen.getByRole('region', { name: t('list.title') })
    const titles = within(list).getAllByRole('button')
      .map(button => /(Attention one|Running one|Queued one|Done new|Done old)/.exec(button.textContent ?? '')?.[0])
      .filter((title): title is string => title !== undefined)
    expect(titles).toEqual([
      'Attention one', 'Running one', 'Queued one', 'Done new', 'Done old',
    ])

    expect(screen.getByRole('button', { name: '全部 5' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '进行中 2' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '需处理 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '已完成 2' })).toBeTruthy()
  })

  it('selects a row and renders owner, kind, attempts, failure, and result in the detail pane', () => {
    const work = row({
      id: 'work-1', title: 'Data sync', kind: 'data.sync@1', state: 'attention', status: 'unknown',
      attemptCount: 2, maxAttempts: 3, ownerSessionId: 'owner-1',
      createdAt: '2026-08-27T09:00:00.000Z', updatedAt: '2026-08-27T09:05:00.000Z',
    })
    const detail: QueueWorkView = {
      ...work,
      failure: { category: 'worker', message: 'outcome unknown', sideEffect: 'unknown', retriable: false },
      attempts: [
        {
          id: 'a1', ordinal: 1, status: 'failed', startedAt: '2026-08-27T08:00:00.000Z',
          runningAt: '2026-08-27T08:00:01.000Z', finishedAt: '2026-08-27T08:05:00.000Z',
          failure: { category: 'worker', message: 'boom one' },
        },
        {
          id: 'a2', ordinal: 2, status: 'unknown', startedAt: '2026-08-27T09:00:00.000Z',
          runningAt: '2026-08-27T09:00:01.000Z', finishedAt: null, failure: null,
        },
      ],
      result: { id: 'r1', output: { ok: true, lines: 42 }, createdAt: '2026-08-27T08:05:00.000Z' },
    }
    renderWorkspace(makeSnapshot({ rows: [work], selectedId: 'work-1', detail }))

    const detailPane = screen.getByRole('complementary', { name: t('detail.title') })
    expect(within(detailPane).getByRole('heading', { name: 'Data sync' })).toBeTruthy()
    expect(within(detailPane).getByText('data.sync@1')).toBeTruthy()
    expect(within(detailPane).getByText('owner-1')).toBeTruthy()
    expect(within(detailPane).getByText('#1')).toBeTruthy()
    expect(within(detailPane).getByText(/boom one/)).toBeTruthy()
    expect(within(detailPane).getByText('outcome unknown')).toBeTruthy()
    expect(within(detailPane).getByText('lines:')).toBeTruthy()
    expect(within(detailPane).getByText('42')).toBeTruthy()
  })

  it('requires risk acknowledgement before authorizing an attention retry', async () => {
    const resolveUnknown = vi.fn(async () => ({ ok: true, message: 'ok' }))
    const snapshot = makeSnapshot({
      rows: [attentionDetail],
      selectedId: 'attention-1',
      detail: attentionDetail,
    })
    renderWorkspace(snapshot, { resolveUnknown })

    fireEvent.click(screen.getByRole('button', { name: t('list.actions.confirmRetry') }))

    const dialog = screen.getByRole('dialog')
    const confirmButton = within(dialog).getByRole('button', { name: t('dialog.confirm') })
    expect(confirmButton.hasAttribute('disabled')).toBe(true)
    expect(resolveUnknown).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('checkbox'))
    expect(within(dialog).getByRole('button', { name: t('dialog.confirm') }).hasAttribute('disabled')).toBe(false)

    fireEvent.click(within(dialog).getByRole('button', { name: t('dialog.confirm') }))
    await waitFor(() => {
      expect(resolveUnknown).toHaveBeenCalledWith('attention-1', { kind: 'authorize-retry' })
    })
  })

  it('requires a trimmed reason before confirming an attention task failed', async () => {
    const resolveUnknown = vi.fn(async () => ({ ok: true, message: 'ok' }))
    const snapshot = makeSnapshot({
      rows: [attentionDetail],
      selectedId: 'attention-1',
      detail: attentionDetail,
    })
    renderWorkspace(snapshot, { resolveUnknown })

    const confirmFailed = () => screen.getByRole('button', { name: t('list.actions.confirmFailed') })
    expect(confirmFailed().hasAttribute('disabled')).toBe(true)

    fireEvent.change(screen.getByRole('textbox', { name: /确认失败原因/ }), {
      target: { value: '  output could not be verified  ' },
    })
    expect(confirmFailed().hasAttribute('disabled')).toBe(false)

    fireEvent.click(confirmFailed())
    await waitFor(() => {
      expect(resolveUnknown).toHaveBeenCalledWith('attention-1', {
        kind: 'confirm-failed',
        failure: {
          category: 'operator-confirmed',
          message: 'output could not be verified',
          sideEffect: 'unknown',
          retriable: false,
        },
      })
    })
  })

  it('disables only the work item whose mutation is pending', async () => {
    let releaseCancel!: () => void
    const gate = new Promise<void>((resolve) => { releaseCancel = resolve })
    const cancel = vi.fn(async () => { await gate; return { ok: true, message: 'ok' } })
    const running = row({ id: 'running-1', title: 'Running one', state: 'running', status: 'running' })
    const failed = row({ id: 'failed-1', title: 'Failed one', state: 'done', outcome: 'failed' })
    const snapshot = makeSnapshot({ rows: [running, failed] })
    renderWorkspace(snapshot, { cancel })

    const list = screen.getByRole('region', { name: t('list.title') })
    fireEvent.click(within(list).getByRole('button', { name: t('list.actions.cancel') }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: t('dialog.confirm') }))

    await waitFor(() => { expect(cancel).toHaveBeenCalled() })

    expect(within(list).getByRole('button', { name: t('list.actions.cancel') }).hasAttribute('disabled')).toBe(true)
    expect(within(list).getByRole('button', { name: t('list.actions.retry') }).hasAttribute('disabled')).toBe(false)

    releaseCancel()
    await waitFor(() => {
      expect(within(list).getByRole('button', { name: t('list.actions.cancel') }).hasAttribute('disabled')).toBe(false)
    })
  })

  it('keeps stale rows visible beside a refresh error and last-successful age', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-27T10:00:05.000Z')
    const work = row({ id: 'work-1', title: 'Stale work', updatedAt: '2026-08-27T09:00:00.000Z' })
    const snapshot = makeSnapshot({
      rows: [work],
      error: 'offline',
      lastSuccessfulRefreshAt: '2026-08-27T10:00:00.000Z',
    })
    renderWorkspace(snapshot)

    expect(screen.getByText('Stale work')).toBeTruthy()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('offline')
    expect(screen.getByText('更新于 5 秒前')).toBeTruthy()
  })

  it('clears a search with no matching tasks', () => {
    const work = row({ id: 'work-1', title: 'Stale work' })
    const snapshot = makeSnapshot({ rows: [work] })
    renderWorkspace(snapshot)

    fireEvent.change(screen.getByRole('textbox', { name: t('search.placeholder') }), {
      target: { value: 'zzz-no-match' },
    })
    expect(screen.getByText(t('empty.search'))).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: t('search.clear') }))
    expect(screen.getByText('Stale work')).toBeTruthy()
    expect(screen.queryByText(t('empty.search'))).toBeNull()
  })
})
