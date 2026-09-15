// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArchitectureNavEntry } from '../src/client/ArchitectureNavEntry.tsx'
import { ArchitectureWorkspace } from '../src/client/ArchitectureWorkspace.tsx'
import type { ArchitectureCatalog } from '../src/client/catalog.ts'
import type { ArchitectureWorkspaceProps } from '../src/client/contract.ts'
import type { ArchitectureRuntimeState } from '../src/client/runtime-controller.ts'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'

const catalog: ArchitectureCatalog = {
  schemaVersion: 3,
  profiles: [{ name: 'web', bundles: ['@deepseek-ai/dsh-web-bundle'], source: 'packages/boot/app-boot/src/profile.ts' }],
  bundles: [{
    name: '@deepseek-ai/dsh-web-bundle', short: 'web-bundle', path: 'packages/bundle/web',
    description: 'Web profile composition', packages: ['@deepseek-ai/dsh-feature', '@deepseek-ai/dsh-foundation'],
    source: 'packages/bundle/web/package.json',
  }],
  packages: [
    {
      name: '@deepseek-ai/dsh-feature', short: 'feature', group: 'client',
      path: 'packages/client/feature', source: 'packages/client/feature/package.json', description: 'Visible client feature',
      dependencies: ['@deepseek-ai/dsh-foundation'], faces: ['client'],
    },
    {
      name: '@deepseek-ai/dsh-viewer', short: 'viewer', group: 'core',
      path: 'packages/core/viewer', source: 'packages/core/viewer/package.json', description: 'Consumer of the feature',
      dependencies: ['@deepseek-ai/dsh-feature'], faces: ['remote'],
    },
    {
      name: '@deepseek-ai/dsh-foundation', short: 'foundation', group: 'util',
      path: 'packages/util/foundation', source: 'packages/util/foundation/package.json', description: 'Shared foundation',
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
  'view.map': '系统地图',
  'view.directory': '包目录',
  'map.profiles': 'Profile 模板',
  'map.bundles': 'Bundle 组合',
  'map.packages': '组合内包',
  'map.profileSource': 'Profile 来源',
  'map.bundleSource': 'Bundle 来源',
  'map.expand': '展开 Bundle',
  'map.collapse': '收起 Bundle',
  'map.runtimeObserved': '已观察',
  'map.legend': '地图证据图例',
  'map.buildIncluded': '构建包含',
  'map.activeDetail': '执行阶段见详情',
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
  'detail.source': '来源',
  'detail.faces': '声明面',
  'detail.bundles': '所属 Bundle',
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
  usePanelInfo: <T,>(selector: (info: { readonly activePanelId: string | null }) => T): T => selector({ activePanelId: null }),
  useResource: (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource'],
  useSessions: (() => { throw new Error('useSessions is not used by Architecture components') }) as ArchitectureWorkspaceProps['useSessions'],
  useSessionPendingInteraction: (() => { throw new Error('useSessionPendingInteraction is not used by Architecture components') }) as ArchitectureWorkspaceProps['useSessionPendingInteraction'],
  useWorkspaces: (() => { throw new Error('useWorkspaces is not used by Architecture components') }) as ArchitectureWorkspaceProps['useWorkspaces'],
}

afterEach(cleanup)

describe('Architecture UI', () => {
  it('shows the Profile to Bundle composition map and expands one Bundle into packages', () => {
    render(<ArchitectureWorkspace
      {...unusedStandardHooks}
      catalog={catalog}
      useRuntime={useRuntime}
      refresh={vi.fn()}
      t={t as never}
    />)

    expect(screen.getByRole('tab', { name: '系统地图' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByTestId('architecture-system-map')).not.toBeNull()
    const bundle = screen.getAllByRole('button', { name: /web-bundle/ }).find(button => button.hasAttribute('aria-expanded'))
    expect(bundle).not.toBeUndefined()
    if (bundle === undefined) throw new Error('Bundle map control missing')
    expect(bundle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(bundle)
    expect(bundle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('architecture-composition-package-feature')).not.toBeNull()
  })

  it('keeps the package directory as an explicit alternate view', () => {
    render(<ArchitectureWorkspace
      {...unusedStandardHooks}
      catalog={catalog}
      useRuntime={useRuntime}
      refresh={vi.fn()}
      t={t as never}
    />)

    fireEvent.click(screen.getByRole('tab', { name: '包目录' }))
    expect(screen.getByTestId('architecture-package-field')).not.toBeNull()
  })

  it('opens a package Bundle in the Profile that actually contains it', () => {
    const crossProfileCatalog: ArchitectureCatalog = {
      ...catalog,
      profiles: [
        ...catalog.profiles,
        { name: 'sdk', bundles: ['@deepseek-ai/dsh-sdk-bundle'], source: 'packages/boot/app-boot/src/profile.ts' },
      ],
      bundles: [
        ...catalog.bundles,
        {
          name: '@deepseek-ai/dsh-sdk-bundle', short: 'sdk-bundle', path: 'packages/bundle/sdk',
          description: 'SDK profile composition', packages: ['@deepseek-ai/dsh-viewer'],
          source: 'packages/bundle/sdk/package.json',
        },
      ],
    }
    render(<ArchitectureWorkspace
      {...unusedStandardHooks}
      catalog={crossProfileCatalog}
      useRuntime={useRuntime}
      refresh={vi.fn()}
      t={t as never}
    />)

    fireEvent.click(screen.getByRole('tab', { name: '包目录' }))
    fireEvent.click(screen.getByRole('button', { name: /viewer — Consumer of the feature/ }))
    fireEvent.click(within(screen.getByTestId('architecture-package-detail')).getByRole('button', { name: 'sdk-bundle' }))

    const sdkBundle = screen.getByRole('button', { name: /sdk-bundle — SDK profile composition/ })
    expect(sdkBundle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('architecture-composition-package-viewer')).not.toBeNull()
  })

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

    fireEvent.click(screen.getByRole('tab', { name: '包目录' }))
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

    fireEvent.click(screen.getByRole('tab', { name: '包目录' }))
    fireEvent.click(screen.getByRole('button', { name: /feature — Visible client feature/ }))
    const detail = screen.getByTestId('architecture-package-detail')
    expect(within(detail).getByText('Visible client feature')).not.toBeNull()
    expect(within(detail).getByText('foundation')).not.toBeNull()
    expect(within(detail).getByText('viewer')).not.toBeNull()
    expect(within(detail).getByText('当前运行时 · active')).not.toBeNull()
  })

  it('navigates dependency relationships by full npm identity across scopes', () => {
    const scopedCatalog: ArchitectureCatalog = {
      schemaVersion: 3,
      profiles: [],
      bundles: [],
      packages: [{
        name: '@deepseek-ai/dsh-shared', short: 'shared', group: 'core',
        path: 'packages/core/shared', source: 'packages/core/shared/package.json', description: 'Official shared package', dependencies: [], faces: ['package'],
      }, {
        name: '@changanhua/dsh-shared', short: 'shared', group: 'personal',
        path: 'packages/personal/shared', source: 'packages/personal/shared/package.json', description: 'Personal shared package', dependencies: [], faces: ['package'],
      }, {
        name: '@changanhua/dsh-consumer', short: 'consumer', group: 'personal',
        path: 'packages/personal/consumer', source: 'packages/personal/consumer/package.json', description: 'Personal consumer',
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

    fireEvent.click(screen.getByRole('tab', { name: '包目录' }))
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

    fireEvent.click(screen.getByRole('tab', { name: '包目录' }))
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索包' }), { target: { value: 'consumer' } })
    const field = screen.getByTestId('architecture-package-field')
    expect(within(field).getByRole('button', { name: /viewer/ })).not.toBeNull()
    expect(within(field).queryByRole('button', { name: /^feature —/ })).toBeNull()
  })
})
