// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { deriveWorkbench } from '../src/client/workbench/model.ts'
import { createWorkbenchStore } from '../src/client/workbench/store.ts'
import { Workbench, WorkbenchNav } from '../src/client/workbench/Workbench.tsx'
import type { WorkbenchProps, WorkbenchNavProps } from '../src/client/workbench/contract.ts'
import { zh } from '../src/client/workbench/locales.ts'

afterEach(cleanup)
const sid = (id: string) => id as SessionId
const row = (id: string, extra: Partial<SessionSummary> = {}): SessionSummary => ({
  id: sid(id), displayTitle: id, title: id, running: false, blank: false, updatedAt: 1000, ...extra,
})
const sessions = (items: SessionSummary[]): SessionListState => ({
  ids: items.map(item => item.id), byId: Object.fromEntries(items.map(item => [item.id, item])),
  phase: 'ready', current: undefined, currentAddress: undefined, jobsBySession: {}, subagentsByParent: {},
})
const project: WorkspaceView = {
  workspaceId: 'project' as never, title: 'DSH 项目', path: 'C:/work/dsh',
  sessionIds: [sid('方案'), sid('运行'), sid('归档')],
  createdAt: '2026-09-09T00:00:00Z', updatedAt: '2026-09-09T00:00:00Z',
}
const workspace = (extra: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot => ({
  items: [project], archivedSessionIds: [], phase: 'ready', state: 'idle', error: null, ...extra,
})
const pending: SessionPendingInteractionSnapshot = new Map([[sid('方案'), {
  key: 'question-1', kind: 'question', sessionId: sid('方案'),
} as never]])
function hook<T>(value: T) { return <R,>(select: (snapshot: T) => R) => select(value) }

function fixture(overrides: Partial<WorkbenchProps> = {}) {
  const instance = createWorkbenchStore().create()
  const props: WorkbenchProps = {
    useSessions: hook(sessions([row('方案'), row('运行', { running: true }), row('其他')])),
    useWorkspaces: hook(workspace()), useSessionPendingInteraction: hook(pending),
    useModules: hook(['workbench', 'queue', 'capability']),
    useStore: bindSnapshotSelector(instance), actions: instance.actions,
    openSession: vi.fn(), startSession: vi.fn(), prepareComposer: vi.fn(), composer: null,
    openModule: vi.fn(), t: makeTranslate(zh) as never,
    ...overrides,
  }
  return { props, instance }
}

describe('workbench facts and navigation', () => {
  it('excludes blank, archived and child rows while retaining running descendants under their parent', () => {
    const state = sessions([
      row('方案'), row('归档', { completed: true }), row('空白', { blank: true }),
      row('子代理', { origin: 'subagent', parentId: sid('方案'), running: true }),
      row('其他', { updatedAt: 2000 }),
    ])
    const result = deriveWorkbench(state, workspace({ archivedSessionIds: [sid('归档')] }), pending)
    expect(result.items.map(item => item.id)).toEqual(['其他', '方案'])
    expect(result.running.map(item => item.id)).toEqual(['方案'])
    expect(result.attention.map(item => item.id)).toEqual(['方案'])
    expect(result.items.find(item => item.id === sid('方案'))?.workspace).toBe(project)
    expect(state.current).toBeUndefined()
    expect(state.byId[sid('归档')]?.completed).toBe(true)
  })

  it('shows unread results as a reminder without declaring verification or acceptance', () => {
    const b = fixture({ useSessions: hook(sessions([row('检查结果', { completed: true })])) })
    render(<Workbench {...b.props} />)
    expect(screen.getAllByText('有新结果').length).toBeGreaterThan(0)
    expect(screen.queryByText('已验收')).toBeNull()
    fireEvent.click(screen.getAllByRole('button').find(button => button.textContent?.includes('检查结果'))!)
    expect(b.props.openSession).toHaveBeenCalledWith('检查结果')
  })

  it('opens a project overview without selecting or creating a conversation', () => {
    const b = fixture()
    render(<Workbench {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: /DSH 项目.*C:\/work\/dsh/ }))
    expect(screen.getByRole('heading', { level: 1, name: 'DSH 项目' })).toBeTruthy()
    expect(screen.queryByText('其他')).toBeNull()
    expect(b.props.openSession).not.toHaveBeenCalled()
    expect(b.props.startSession).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /在这个项目中开始对话/ }))
    expect(b.props.startSession).toHaveBeenCalledWith(project.workspaceId)
  })

  it('lists only tool pages actually registered in the current composition', () => {
    const b = fixture()
    b.instance.actions.navigate('tools')
    render(<Workbench {...b.props} />)
    expect(screen.getByRole('button', { name: /后台队列/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /交付工作台/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /后台队列/ }))
    expect(b.props.openModule).toHaveBeenCalledWith('queue')
  })

  it('distinguishes a connection failure from an empty ready workspace', () => {
    const b = fixture({ useSessions: hook(sessions([])), useWorkspaces: hook(workspace({ items: [], state: 'error' })) })
    const view = render(<Workbench {...b.props} />)
    expect(screen.getByRole('status').textContent).toContain('暂时不可用')
    view.rerender(<Workbench {...b.props} useWorkspaces={hook(workspace({ items: [] }))} />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('还没有工作记录。开始一段对话后，可以在这里继续。')).toBeTruthy()
  })

  it('keeps filtering local to the chosen project', () => {
    const b = fixture()
    b.instance.actions.navigate('project', project.workspaceId)
    render(<Workbench {...b.props} />)
    fireEvent.change(screen.getByRole('textbox', { name: '按标题或项目筛选' }), { target: { value: '其他' } })
    expect(screen.getByText('没有找到匹配的工作。')).toBeTruthy()
    expect(b.props.openSession).not.toHaveBeenCalled()
  })

  it('does not reset the selected page when the navigation remounts', () => {
    const b = fixture()
    const setActiveModule = vi.fn()
    const props: WorkbenchNavProps = {
      useSessions: b.props.useSessions, useWorkspaces: b.props.useWorkspaces,
      useSessionPendingInteraction: b.props.useSessionPendingInteraction,
      useStore: b.props.useStore, actions: b.props.actions, t: b.props.t,
      wide: true, activeModule: 'conversation', setActiveModule,
    }
    const first = render(<WorkbenchNav {...props} />)
    expect(setActiveModule).toHaveBeenCalledWith('workbench')
    first.unmount()
    act(() => { b.instance.actions.navigate('tools') })
    setActiveModule.mockClear()
    render(<WorkbenchNav {...props} activeModule="queue" />)
    expect(setActiveModule).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '能力与工具' }))
    expect(setActiveModule).toHaveBeenCalledWith('workbench')
    expect(b.instance.store.getSnapshot().page).toBe('tools')
  })
})
