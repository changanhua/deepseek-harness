// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArchitectureNavEntry } from '../src/client/ArchitectureNavEntry.tsx'
import { ArchitectureWorkspace } from '../src/client/ArchitectureWorkspace.tsx'
import type { ArchitectureCatalog } from '../src/client/catalog.ts'
import type { ArchitectureWorkspaceProps } from '../src/client/contract.ts'
import type { ArchitectureRuntimeState } from '../src/client/runtime-controller.ts'

const catalog: ArchitectureCatalog = {
  schemaVersion: 2,
  packages: [
    {
      name: '@deepseek-ai/dsh-feature', short: 'feature', group: 'client',
      path: 'packages/client/feature', description: 'Visible client feature',
      dependencies: ['@deepseek-ai/dsh-foundation'], faces: ['client'],
    },
    {
      name: '@deepseek-ai/dsh-viewer', short: 'viewer', group: 'core',
      path: 'packages/core/viewer', description: 'Consumer of the feature',
      dependencies: ['@deepseek-ai/dsh-feature'], faces: ['remote'],
    },
    {
      name: '@deepseek-ai/dsh-foundation', short: 'foundation', group: 'util',
      path: 'packages/util/foundation', description: 'Shared foundation',
      dependencies: [], faces: ['package'],
    },
  ],
}

const runtime: ArchitectureRuntimeState = {
  status: 'ready',
  error: null,
  snapshot: {
    entries: [{
      entryId: 'feature-entry' as never,
      moduleName: '@deepseek-ai/dsh-feature',
      enabled: true,
      fiberPhase: 'active',
    }],
  },
}

const copy: Record<string, string> = {
  'nav.architecture': '架构',
  'view.title': '架构浏览器',
  'view.subtitle': '当前构建目录与运行时组合分层展示。',
  'summary.packages': '正式包',
  'summary.groups': '领域组',
  'summary.runtime': '运行时工作区包',
  'summary.active': 'Active Loader 条目',
  'search.label': '搜索包',
  'search.placeholder': '按名称、路径或描述搜索…',
  'group.all': '全部领域',
  'runtime.refresh': '刷新运行时',
  'runtime.loading': '正在读取运行时…',
  'runtime.error': '运行时读取失败',
  'runtime.uncomposed': '未在当前运行时中观察到',
  'runtime.active': '当前运行时 · active',
  'runtime.pending': '当前运行时 · pending',
  'runtime.loadingPhase': '当前运行时 · loading',
  'runtime.failed': '当前运行时 · failed',
  'runtime.unloading': '当前运行时 · unloading',
  'runtime.unobserved': '当前运行时 · 未观察到 Fiber',
  'detail.path': '路径',
  'detail.faces': '声明面',
  'detail.dependencies': '依赖',
  'detail.consumers': '被谁依赖',
  'detail.none': '无',
  'evidence.catalog': '构建目录',
  'evidence.runtime': '当前运行时',
  'empty': '没有匹配的包。',
}

const t = (key: string): string => copy[key] ?? key
const useRuntime = <T,>(selector: (state: ArchitectureRuntimeState) => T): T => selector(runtime)
const unusedStandardHooks = {
  useSessions: (() => { throw new Error('useSessions is not used by Architecture components') }) as ArchitectureWorkspaceProps['useSessions'],
  useSessionPendingInteraction: (() => { throw new Error('useSessionPendingInteraction is not used by Architecture components') }) as ArchitectureWorkspaceProps['useSessionPendingInteraction'],
  useWorkspaces: (() => { throw new Error('useWorkspaces is not used by Architecture components') }) as ArchitectureWorkspaceProps['useWorkspaces'],
}

afterEach(cleanup)

describe('Architecture UI', () => {
  it('registers a persistent module entry that opens the architecture workspace', () => {
    const setActiveModule = vi.fn()
    render(<ArchitectureNavEntry
      {...unusedStandardHooks}
      wide
      activeModule="conversation"
      setActiveModule={setActiveModule}
      catalog={catalog}
      t={t as never}
    />)

    const entry = screen.getByRole('button', { name: '架构' })
    expect(entry.textContent).toContain('架构')
    expect(entry.textContent).toContain('3')
    fireEvent.click(entry)
    expect(setActiveModule).toHaveBeenCalledWith('architecture')
  })

  it('filters the package field by group without hiding the catalog totals', () => {
    render(<ArchitectureWorkspace
      {...unusedStandardHooks}
      catalog={catalog}
      useRuntime={useRuntime}
      refresh={vi.fn()}
      t={t as never}
    />)

    expect(screen.getByRole('heading', { name: '架构浏览器' })).not.toBeNull()
    expect(screen.getByTestId('architecture-package-total').textContent).toContain('3')
    fireEvent.click(screen.getByRole('button', { name: 'util (1)' }))
    const field = screen.getByTestId('architecture-package-field')
    expect(within(field).getByRole('button', { name: /foundation/ })).not.toBeNull()
    expect(within(field).queryByRole('button', { name: /^feature —/ })).toBeNull()
    expect(screen.getByTestId('architecture-package-total').textContent).toContain('3')
  })

  it('shows dependency, consumer, and current Runtime evidence for the selected package', () => {
    render(<ArchitectureWorkspace
      {...unusedStandardHooks}
      catalog={catalog}
      useRuntime={useRuntime}
      refresh={vi.fn()}
      t={t as never}
    />)

    fireEvent.click(screen.getByRole('button', { name: /feature — Visible client feature/ }))
    const detail = screen.getByTestId('architecture-package-detail')
    expect(within(detail).getByText('Visible client feature')).not.toBeNull()
    expect(within(detail).getByText('foundation')).not.toBeNull()
    expect(within(detail).getByText('viewer')).not.toBeNull()
    expect(within(detail).getByText('当前运行时 · active')).not.toBeNull()
  })

  it('navigates dependency relationships by full npm identity across scopes', () => {
    const scopedCatalog: ArchitectureCatalog = {
      schemaVersion: 2,
      packages: [{
        name: '@deepseek-ai/dsh-shared', short: 'shared', group: 'core',
        path: 'packages/core/shared', description: 'Official shared package', dependencies: [], faces: ['package'],
      }, {
        name: '@changanhua/dsh-shared', short: 'shared', group: 'personal',
        path: 'packages/personal/shared', description: 'Personal shared package', dependencies: [], faces: ['package'],
      }, {
        name: '@changanhua/dsh-consumer', short: 'consumer', group: 'personal',
        path: 'packages/personal/consumer', description: 'Personal consumer',
        dependencies: ['@changanhua/dsh-shared'], faces: ['client'],
      }],
    }
    render(<ArchitectureWorkspace
      {...unusedStandardHooks}
      catalog={scopedCatalog}
      useRuntime={useRuntime}
      refresh={vi.fn()}
      t={t as never}
    />)

    fireEvent.click(screen.getByRole('button', { name: /consumer — Personal consumer/ }))
    const detail = screen.getByTestId('architecture-package-detail')
    fireEvent.click(within(detail).getByRole('button', { name: 'shared' }))
    expect(within(detail).getByText('packages/personal/shared')).not.toBeNull()
  })

  it('searches names, paths, and descriptions', () => {
    render(<ArchitectureWorkspace
      {...unusedStandardHooks}
      catalog={catalog}
      useRuntime={useRuntime}
      refresh={vi.fn()}
      t={t as never}
    />)

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索包' }), { target: { value: 'consumer' } })
    const field = screen.getByTestId('architecture-package-field')
    expect(within(field).getByRole('button', { name: /viewer/ })).not.toBeNull()
    expect(within(field).queryByRole('button', { name: /^feature —/ })).toBeNull()
  })
})
