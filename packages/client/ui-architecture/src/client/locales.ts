/** Locale namespace and complete dictionaries for the Architecture workspace. */

export const NS = 'architecture'

/** Simplified Chinese dictionary and key-set owner. */
export const zh = {
  'nav.architecture': '架构',
  'view.title': '架构浏览器',
  'view.subtitle': '将当前构建的包目录与当前 Loader 运行时分层展示。',
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
} satisfies Record<string, string>

/** Keys accepted by the Architecture locale namespace. */
export type ArchitectureKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  'nav.architecture': 'Architecture',
  'view.title': 'Architecture Explorer',
  'view.subtitle': 'View the current build catalog separately from the current Loader runtime.',
  'summary.packages': 'Workspace packages',
  'summary.groups': 'Package groups',
  'summary.runtime': 'Runtime workspace packages',
  'summary.active': 'Active Loader entries',
  'search.label': 'Search packages',
  'search.placeholder': 'Search names, paths, or descriptions…',
  'group.all': 'All groups',
  'runtime.refresh': 'Refresh runtime',
  'runtime.loading': 'Reading runtime…',
  'runtime.error': 'Runtime read failed',
  'runtime.uncomposed': 'Not observed in the current runtime',
  'runtime.active': 'Current runtime · active',
  'runtime.pending': 'Current runtime · pending',
  'runtime.loadingPhase': 'Current runtime · loading',
  'runtime.failed': 'Current runtime · failed',
  'runtime.unloading': 'Current runtime · unloading',
  'runtime.unobserved': 'Current runtime · no Fiber observed',
  'detail.path': 'Path',
  'detail.faces': 'Declared faces',
  'detail.dependencies': 'Depends on',
  'detail.consumers': 'Used by',
  'detail.none': 'None',
  'evidence.catalog': 'Build catalog',
  'evidence.runtime': 'Current runtime',
  'empty': 'No packages match the current filters.',
} satisfies Record<ArchitectureKey, string>
