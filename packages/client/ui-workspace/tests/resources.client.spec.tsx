// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { Resources } from '../src/client/workbench/Resources.tsx'
import { zh } from '../src/client/workbench/locales.ts'

afterEach(cleanup)
const props = () => ({ workspaceId: 'project' as never, t: makeTranslate(zh) as never,
  state: { busy: false, data: { configPath: '/project/.dsh/resources.json', entries: [] } },
  resourceLoad: vi.fn(), resourceAdd: vi.fn(async () => true), resourceAct: vi.fn(), resourceClosePreview: vi.fn(),
})

describe('project resources UI', () => {
  it('saves ordinary Markdown from the project resource form', async () => {
    const p = props()
    render(<Resources {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '添加资源' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '运行说明' } })
    fireEvent.change(screen.getByLabelText('资料内容'), { target: { value: '# 启动\n先准备输入。' } })
    fireEvent.click(screen.getByRole('button', { name: '保存资源' }))
    await waitFor(() =>{  expect(p.resourceAdd).toHaveBeenCalledWith('project', { kind: 'note', name: '运行说明', content: '# 启动\n先准备输入。' }) })
  })

  it('shows an owned process, its logs and the stop action without claiming service health', () => {
    const p = props()
    render(<Resources {...p} state={{ busy: false, data: { configPath: 'config', entries: [
      { id: 'server' as never, name: '查询服务', kind: 'service', command: 'node server.js', cwd: '.', status: 'running', pid: 123, logs: 'listening' },
    ] } }} />)
    expect(screen.getByText('进程运行中')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(p.resourceAct).toHaveBeenCalledWith('project', 'server', 'stop')
    expect(screen.getByText('listening')).toBeTruthy()
    expect(screen.getByRole('button', { name: '移除登记' }).hasAttribute('disabled')).toBe(true)
  })
})
