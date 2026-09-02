// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { formatDuration, WorkObservatoryWorkspace } from '../src/client/WorkObservatoryWorkspace.tsx'
import type { ObservatoryViewState } from '../src/client/controller.ts'
import type { WorkObservatoryWorkspaceProps } from '../src/client/contract.ts'

const ready: ObservatoryViewState = {
  status: 'ready',
  error: null,
  date: '2026-09-02',
  projectPath: 'C:\\repo',
  range: {
    from: 0,
    to: 1_000_000,
    projectPath: 'C:\\repo',
    summary: {
      humanActiveMs: 60_000,
      pageVisibleMs: 180_000,
      agentRunningMs: 120_000,
      togetherMs: 30_000,
      agentSoloMs: 90_000,
    },
    timeline: { humanActive: [], pageVisible: [], agentRunning: [] },
    sessions: [{
      sessionId: SessionId('s1'),
      projectPath: 'C:\\repo',
      humanActiveMs: 60_000,
      agentRunningMs: 120_000,
      togetherMs: 30_000,
    }],
  },
}

describe('WorkObservatoryWorkspace', () => {
  it('formats duration units for the active locale', () => {
    expect(formatDuration(90_000, { second: 's', minute: 'm', hour: 'h', separator: ' ' })).toBe('1m 30s')
  })

  it('explains the accounting semantics and opens a Session drilldown', () => {
    const openSession = vi.fn()
    const props = {
      useObservatory: <S,>(selector: (state: ObservatoryViewState) => S): S => selector(ready),
      selectDate: () => {},
      refresh: () => {},
      openSession,
      t: (key: string) => ({
        'nav.workObservatory': '工作观测',
        'view.title': '工作观测',
        'view.eyebrow': '本地证据 · 24 小时',
        'view.subtitle': '按本机证据查看人机协作时间，不代表生产力或节省时间。',
        'summary.human': '人类活跃',
        'summary.visible': '页面可见',
        'summary.agent': 'Agent 步骤',
        'summary.together': '协作重叠',
        'summary.solo': 'Agent 单独',
        'filter.date': '日期',
        'filter.project': '项目',
        'action.refresh': '刷新',
        'sessions.title': 'Session 明细',
        'sessions.empty': '暂无记录',
        'sessions.open': '打开 Session',
        'timeline.label': '24 小时证据时间线',
        'unit.second': '秒',
        'unit.minute': '分钟',
        'unit.hour': '小时',
        'unit.separator': '',
      } as Record<string, string>)[key] ?? key,
    } as unknown as WorkObservatoryWorkspaceProps
    render(<WorkObservatoryWorkspace {...props} />)

    expect(screen.getByText('按本机证据查看人机协作时间，不代表生产力或节省时间。')).toBeTruthy()
    expect(screen.getByText('1分钟')).toBeTruthy()
    expect(screen.getByText('2分钟')).toBeTruthy()
    expect(screen.getByText('30秒')).toBeTruthy()
    expect(screen.getByText('1分钟30秒')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /打开 Session.*s1/ }))
    expect(openSession).toHaveBeenCalledWith(SessionId('s1'))
  })
})
