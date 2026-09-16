/** @vitest-environment jsdom */
/** @vitest-environment-options {"url":"https://example.test/feed"} */
import { afterEach, describe, expect, test, vi } from 'vitest'
import source from '../src/browser-page.js?raw'

const browserPageSource: unknown = source

interface BrowserIdentity {
  protocolVersion: number
  installationId: string
  grantEpoch: number
  requestId: string
  sessionId: string
  deadline: number
  fingerprint: string
}

interface BrowserRequest extends BrowserIdentity {
  target?: { tabId: number; frameId: number; documentId: string }
  payload: {
    kind: string
    page?: { tabId: number; frameId: number; documentId: string; url: string }
    mountId?: string
    selector?: string
    mode?: string
    placement?: string
    title?: string
    blocks?: unknown[]
  }
}

interface BrowserReceipt {
  outcome: string
  reason?: string
  quiescent?: boolean
  value?: unknown
}

type BrowserPageGlobal = typeof globalThis & { __dshBrowserAssistant?: {
  snapshot(options?: object): unknown
  regionRender(request: BrowserRequest): BrowserReceipt
  regionClear(request: BrowserRequest): BrowserReceipt
  pageMap?(request: BrowserRequest): BrowserReceipt
} }

const identity = (requestId: string): BrowserIdentity => ({
  protocolVersion: 1, installationId: 'installation-1', grantEpoch: 7, requestId, sessionId: 'session-1',
  deadline: Date.now() + 10_000, fingerprint: `${requestId}-fingerprint`,
})

const page = { tabId: 1, frameId: 0, documentId: 'doc-feed', url: 'https://example.test/feed' }
const target = { tabId: page.tabId, frameId: page.frameId, documentId: page.documentId }

const install = (): BrowserPageGlobal['__dshBrowserAssistant'] => {
  if (typeof browserPageSource !== 'string') throw new Error('browser page source is not text')
  globalThis.eval(browserPageSource)
  const assistant = (globalThis as BrowserPageGlobal).__dshBrowserAssistant
  if (assistant === undefined) throw new Error('browser assistant did not install')
  return assistant
}

const renderRequest = (mountId: string, extra: Partial<BrowserRequest['payload']> = {}): BrowserRequest => ({
  ...identity(`region-${mountId}`),
  target,
  payload: { kind: 'region_render', page, mountId, selector: '#side', blocks: [{ type: 'text', text: '正文' }], ...extra },
})

const clearRequest = (mountId: string): BrowserRequest => ({
  ...identity(`clear-${mountId}`), target, payload: { kind: 'region_clear', page, mountId },
})

const presentationOwner = (extra: Partial<BrowserIdentity & { page: typeof page }> = {}) => ({
  sessionId: 'session-1', installationId: 'installation-1', grantEpoch: 7, page, ...extra,
})

const panelOf = (mountId: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-dsh-region-mount-id="${mountId}"]`)

const flushObservers = async () => {
  await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
}

afterEach(() => {
  const assistant = (globalThis as BrowserPageGlobal).__dshBrowserAssistant
  if (assistant?.regionClear) {
    const ids = [...document.querySelectorAll<HTMLElement>('[data-dsh-region-mount-id]')]
      .map(node => node.getAttribute('data-dsh-region-mount-id')).filter((value): value is string => Boolean(value))
    for (const mountId of new Set(ids)) assistant.regionClear(clearRequest(mountId))
  }
  document.body.innerHTML = ''
  history.replaceState({}, '', '/feed')
  delete (globalThis as typeof globalThis & { __dshBrowserAssistant?: unknown }).__dshBrowserAssistant
  delete (globalThis as typeof globalThis & { chrome?: unknown }).chrome
})

describe('区域内容面板挂载', () => {
  test('pageMap 返回带重要性和可占用判断的页面区域', () => {
    document.body.innerHTML = '<header>导航</header><main><article>正文</article></main><aside id="side"><div>广告</div></aside>'
    const assistant = install()
    const receipt = assistant.pageMap?.({ ...identity('map'), target, payload: { kind: 'page_map', page } })
    expect(receipt?.outcome).toBe('observed')
    const value = receipt?.value
    if (value === undefined || typeof value !== 'object' || !Array.isArray((value as { regions?: unknown }).regions)) {
      throw new Error('page map did not contain regions')
    }
    const regions = (value as { regions: Array<Record<string, unknown>> }).regions
    expect(regions.some(region => region.role === 'main' && region.importance === 'high')).toBe(true)
    expect(regions.some(region => region.role === 'complementary' && region.disposable === true)).toBe(true)
    for (const region of regions) expect(document.querySelectorAll(String(region.selector))).toHaveLength(1)
  })

  test('重复语义区域也会获得唯一 selector，宽泛 selector 不得重复渲染', () => {
    document.body.innerHTML = '<main></main><aside role="complementary"></aside><aside role="complementary"></aside>'
    const assistant = install()
    const mapped = assistant.pageMap?.({ ...identity('map-duplicates'), target, payload: { kind: 'page_map', page } })
    const regions = (mapped?.value as { regions: Array<Record<string, unknown>> }).regions
    const sidebars = regions.filter(region => region.role === 'complementary')
    expect(new Set(sidebars.map(region => region.selector)).size).toBe(2)
    const rendered = assistant.regionRender(renderRequest('panel', { selector: '[role="complementary"]' }))
    expect(rendered).toMatchObject({ outcome: 'failed', reason: 'ambiguous_region' })
    expect(document.querySelectorAll('[data-dsh-region-mount-id="panel"]')).toHaveLength(0)
  })

  test('重复 id 不能让 pageMap 返回命中多个节点的 selector', () => {
    document.body.innerHTML = '<main id="duplicate"></main><aside id="duplicate"></aside>'
    const assistant = install()
    const mapped = assistant.pageMap?.({ ...identity('map-duplicate-id'), target, payload: { kind: 'page_map', page } })
    const regions = (mapped?.value as { regions: Array<Record<string, unknown>> }).regions
    for (const region of regions) expect(document.querySelectorAll(String(region.selector))).toHaveLength(1)
  })

  test('pageMap 将同文档 URL 漂移报告为未解决而非文档消失', () => {
    const assistant = install()
    history.pushState({}, '', '/next')
    const receipt = assistant.pageMap?.({ ...identity('map-stale-url'), target, payload: { kind: 'page_map', page } })
    expect(receipt).toMatchObject({ outcome: 'failed', reason: 'target_url_stale', quiescent: true })
  })

  test('regionRender 在匹配容器内插入面板并报告渲染数', () => {
    document.body.innerHTML = '<div id="side"></div>'
    const assistant = install()
    const receipt = assistant.regionRender(renderRequest('panel', {
      title: '前 5 条回答', blocks: [{ type: 'heading', text: '回答' }, { type: 'text', text: '正文' }],
    }))
    expect(receipt).toMatchObject({ outcome: 'observed', quiescent: true, value: { rendered: 1, containers: 1 } })
    const panel = panelOf('panel')
    expect(panel).not.toBeNull()
    expect(panel?.getAttribute('aria-label')).toBe('前 5 条回答')
    expect(panel?.textContent).toContain('回答')
  })

  test('snapshot 只把可信 owner 持有且仍连接的实际面板报告为展示证据', () => {
    document.body.innerHTML = '<p>证据分歧</p><div id="side"></div>'
    const assistant = install()
    const query = { presentationQueries: [{ mountId: 'analysis-panel', text: '证据分歧' }] }
    const snapshot = (owner = presentationOwner()) => assistant.snapshot({ ...query, presentationOwner: owner })
    expect(snapshot()).toMatchObject({ presentations: [{ mountId: 'analysis-panel', text: '证据分歧', present: false }] })
    assistant.regionRender(renderRequest('analysis-panel', { blocks: [{ type: 'text', text: '证据分歧' }] }))
    expect(snapshot()).toMatchObject({ presentations: [{ mountId: 'analysis-panel', text: '证据分歧', present: true }] })
    const realPanel = panelOf('analysis-panel')
    realPanel?.remove()
    const forgedPanel = document.createElement('div')
    forgedPanel.dataset.dshRegionMountId = 'analysis-panel'
    forgedPanel.textContent = '证据分歧'
    document.querySelector('#side')?.append(forgedPanel)
    expect(snapshot()).toMatchObject({ presentations: [{ mountId: 'analysis-panel', text: '证据分歧', present: false }] })
  })

  test('snapshot 仅接受与真实面板完全匹配的 session、installation 与页面 owner', () => {
    document.body.innerHTML = '<div id="side"></div>'
    const assistant = install()
    assistant.regionRender(renderRequest('analysis-panel', { blocks: [{ type: 'text', text: '证据分歧' }] }))
    const query = { presentationQueries: [{ mountId: 'analysis-panel', text: '证据分歧' }] }
    const snapshot = (owner: ReturnType<typeof presentationOwner>) => assistant.snapshot({ ...query, presentationOwner: owner })
    expect(snapshot(presentationOwner({ sessionId: 'session-2' }))).toMatchObject({ presentations: [{ present: false }] })
    expect(snapshot(presentationOwner({ installationId: 'installation-2' }))).toMatchObject({ presentations: [{ present: false }] })
    expect(snapshot(presentationOwner({ grantEpoch: 8 }))).toMatchObject({ presentations: [{ present: false }] })
    expect(snapshot(presentationOwner({ page: { ...page, documentId: 'doc-other' } }))).toMatchObject({ presentations: [{ present: false }] })
    expect(snapshot(presentationOwner({ page: { ...page, url: 'https://example.test/other' } }))).toMatchObject({ presentations: [{ present: false }] })
    expect(snapshot(presentationOwner())).toMatchObject({ presentations: [{ mountId: 'analysis-panel', text: '证据分歧', present: true }] })
  })

  test('snapshot 在可信 owner 内规范化展示查询空白', () => {
    document.body.innerHTML = '<div id="side"></div>'
    const assistant = install()
    assistant.regionRender(renderRequest('analysis-panel', { blocks: [{ type: 'text', text: '证据 分歧' }] }))
    expect(assistant.snapshot({ presentationOwner: presentationOwner(),
      presentationQueries: [{ mountId: 'analysis-panel', text: '证据\n  分歧' }] }))
      .toMatchObject({ presentations: [{ mountId: 'analysis-panel', text: '证据 分歧', present: true }] })
  })

  test('块内容只作为文本节点渲染，不被解释为标记', () => {
    document.body.innerHTML = '<div id="side"></div>'
    const assistant = install()
    assistant.regionRender(renderRequest('panel', { blocks: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }] }))
    const panel = panelOf('panel')
    expect(panel?.querySelector('img')).toBeNull()
    expect(panel?.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  test('非 http(s) 链接不渲染为锚点', () => {
    document.body.innerHTML = '<div id="side"></div>'
    const assistant = install()
    assistant.regionRender(renderRequest('panel', {
      blocks: [{ type: 'link', text: '危险', href: 'javascript:alert(1)' }],
    }))
    const panel = panelOf('panel')
    expect(panel?.querySelector('a')).toBeNull()
  })

  test('http(s) 链接渲染为带 noopener 的新窗口锚点', () => {
    document.body.innerHTML = '<div id="side"></div>'
    const assistant = install()
    assistant.regionRender(renderRequest('panel', {
      blocks: [{ type: 'item', title: '回答 A', meta: '作者', link: 'https://example.test/a' }],
    }))
    const anchor = panelOf('panel')?.querySelector('a')
    expect(anchor?.getAttribute('href')).toBe('https://example.test/a')
    expect(anchor?.rel).toBe('noopener noreferrer')
    expect(anchor?.target).toBe('_blank')
  })

  test('同 mountId 重复渲染替换旧面板，可用于更新内容', () => {
    document.body.innerHTML = '<div id="side"></div>'
    const assistant = install()
    assistant.regionRender(renderRequest('panel'))
    const first = panelOf('panel')
    assistant.regionRender(renderRequest('panel', { blocks: [{ type: 'text', text: '新内容' }] }))
    const all = document.querySelectorAll('[data-dsh-region-mount-id="panel"]')
    expect(all).toHaveLength(1)
    expect(all[0]).not.toBe(first)
    expect(all[0].textContent).toContain('新内容')
  })

  test('更新失败时保留旧面板', () => {
    document.body.innerHTML = '<div id="side"></div>'
    const assistant = install()
    assistant.regionRender(renderRequest('panel', { blocks: [{ type: 'text', text: '旧内容' }] }))
    const failed = assistant.regionRender(renderRequest('panel', { selector: '#missing', blocks: [{ type: 'text', text: '新内容' }] }))
    expect(failed).toMatchObject({ outcome: 'failed', reason: 'region_target_not_found' })
    expect(panelOf('panel')?.textContent).toContain('旧内容')
  })

  test('不同会话不能接管或清理已有面板', () => {
    document.body.innerHTML = '<div id="side"></div>'
    const assistant = install()
    assistant.regionRender(renderRequest('panel'))
    const other = { ...renderRequest('panel'), ...identity('other'), sessionId: 'session-2' }
    expect(assistant.regionRender(other)).toMatchObject({ outcome: 'failed', reason: 'region_mount_owner_mismatch' })
    expect(assistant.regionClear({ ...clearRequest('panel'), ...identity('clear-other'), sessionId: 'session-2' })).toMatchObject({ outcome: 'failed', reason: 'region_mount_owner_mismatch' })
    expect(panelOf('panel')).not.toBeNull()
  })

  test('同会话的其他安装也不能接管已有面板', () => {
    document.body.innerHTML = '<div id="side"></div>'
    const assistant = install()
    assistant.regionRender(renderRequest('panel'))
    const other = { ...renderRequest('panel'), ...identity('other-installation'), installationId: 'installation-2' }
    expect(assistant.regionRender(other)).toMatchObject({ outcome: 'failed', reason: 'region_mount_owner_mismatch' })
    expect(panelOf('panel')).not.toBeNull()
  })

  test('同一会话在新 grantEpoch 下不能接管旧授权挂载，但可以清理它', () => {
    document.body.innerHTML = '<div id="side"></div>'
    const assistant = install()
    assistant.regionRender(renderRequest('panel'))
    const renewed = { ...renderRequest('panel'), ...identity('renewed'), grantEpoch: 8 }
    expect(assistant.regionRender(renewed)).toMatchObject({ outcome: 'failed', reason: 'region_mount_owner_mismatch' })
    expect(assistant.regionClear({ ...clearRequest('panel'), ...identity('renewed-clear'), grantEpoch: 8 }))
      .toMatchObject({ outcome: 'observed', value: { cleared: true } })
    expect(panelOf('panel')).toBeNull()
  })

  test('带选择器字符的 mountId 也能安全清理', () => {
    document.body.innerHTML = '<div id="side"></div>'
    const assistant = install()
    const mountId = 'panel"]:not(*)'
    assistant.regionRender(renderRequest(mountId))
    expect(assistant.regionClear(clearRequest(mountId))).toMatchObject({ outcome: 'observed', value: { cleared: true } })
    expect([...document.querySelectorAll<HTMLElement>('[data-dsh-region-mount-id]')]
      .some(node => node.dataset.dshRegionMountId === mountId)).toBe(false)
  })

  test('替换模式隐藏原区域并可恢复原内容', () => {
    document.body.innerHTML = '<aside id="side"><p id="keep">原内容</p></aside>'
    const assistant = install()
    const rendered = assistant.regionRender(renderRequest('panel', { mode: 'replace', blocks: [{ type: 'text', text: '结果' }] }))
    expect(rendered).toMatchObject({ outcome: 'observed', value: { replaced: 1 } })
    expect(document.querySelector('#keep')).toBeNull()
    const cleared = assistant.regionClear(clearRequest('panel'))
    expect(cleared).toMatchObject({ outcome: 'observed', value: { restored: 1 } })
    expect(document.querySelector('#keep')?.textContent).toBe('原内容')
  })

  test('placement 决定面板在容器内的位置且不替换页面内容', () => {
    document.body.innerHTML = '<div id="side"><p id="keep">保留内容</p></div>'
    const assistant = install()
    assistant.regionRender(renderRequest('panel', { placement: 'append' }))
    const side = document.querySelector('#side')
    expect(side?.lastElementChild?.getAttribute('data-dsh-region-mount-id')).toBe('panel')
    expect(document.querySelector('#keep')).not.toBeNull()
    expect(side?.firstElementChild?.getAttribute('id')).toBe('keep')
  })

  test('容器被 SPA 替换后观察者把面板补挂回来', async () => {
    document.body.innerHTML = '<div id="side"></div>'
    const assistant = install()
    assistant.regionRender(renderRequest('panel'))
    expect(document.querySelectorAll('[data-dsh-region-mount-id="panel"]')).toHaveLength(1)
    document.body.innerHTML = '<div id="side"></div>'
    await flushObservers()
    expect(document.querySelectorAll('[data-dsh-region-mount-id="panel"]')).toHaveLength(1)
  })

  test('SPA 替换时 mountId 中的选择器字符不会参与 selector 拼接', async () => {
    document.body.innerHTML = '<div id="side"></div>'
    const assistant = install()
    const mountId = 'panel"]:not(*)'
    assistant.regionRender(renderRequest(mountId))
    document.body.innerHTML = '<div id="side"></div>'
    await flushObservers()
    const panels = [...document.querySelectorAll<HTMLElement>('[data-dsh-region-mount-id]')]
      .filter(node => node.dataset.dshRegionMountId === mountId)
    expect(panels).toHaveLength(1)
  })

  test('当前 URL 变化后不再把旧面板挂回新页面', async () => {
    document.body.innerHTML = '<div id="side"></div>'
    const sendMessage = vi.fn(async () => {})
    ;(globalThis as typeof globalThis & { chrome: unknown }).chrome = { runtime: { sendMessage } }
    const assistant = install()
    assistant.regionRender(renderRequest('panel'))
    history.pushState({}, '', '/other')
    document.body.innerHTML = '<div id="side"></div>'
    await flushObservers()
    expect(document.querySelectorAll('[data-dsh-region-mount-id="panel"]')).toHaveLength(0)
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dsh-route-discarded', resource: 'region', mountId: 'panel', sessionId: 'session-1',
      installationId: 'installation-1', grantEpoch: 7,
      page: { tabId: 1, frameId: 0, documentId: 'doc-feed', url: 'https://example.test/feed' },
      currentUrl: 'https://example.test/other',
    }))
    expect(assistant.regionClear(clearRequest('panel')))
      .toMatchObject({ outcome: 'observed', quiescent: true, value: { cleared: true, restored: 0, disposition: 'route_discarded' } })
    history.pushState({}, '', '/feed')
  })

  test('pushState 尚未触发 DOM mutation 时，精确旧 region_clear 仍立即生成 route-discard 回执', () => {
    document.body.innerHTML = '<div id="side"></div>'
    const sendMessage = vi.fn(async () => {})
    ;(globalThis as typeof globalThis & { chrome: unknown }).chrome = { runtime: { sendMessage } }
    const assistant = install()
    assistant.regionRender(renderRequest('immediate'))
    history.pushState({}, '', '/without-dom-mutation')
    expect(assistant.regionClear(clearRequest('immediate'))).toMatchObject({
      outcome: 'observed', quiescent: true, value: { cleared: true, disposition: 'route_discarded' },
    })
    expect(panelOf('immediate')).toBeNull()
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'dsh-route-discarded', resource: 'region', mountId: 'immediate' }))
  })

  test('regionClear 移除面板与观察者', async () => {
    document.body.innerHTML = '<div id="side"></div>'
    const assistant = install()
    assistant.regionRender(renderRequest('panel'))
    expect(document.querySelectorAll('[data-dsh-region-mount-id="panel"]')).toHaveLength(1)
    const receipt = assistant.regionClear(clearRequest('panel'))
    expect(receipt).toMatchObject({ outcome: 'observed', quiescent: true, value: { cleared: true } })
    expect(document.querySelectorAll('[data-dsh-region-mount-id="panel"]')).toHaveLength(0)
    document.body.innerHTML = '<div id="side"></div>'
    await flushObservers()
    expect(document.querySelectorAll('[data-dsh-region-mount-id="panel"]')).toHaveLength(0)
  })

  test('regionClear 只移除登记的真实面板并保留页面伪造的同名 sibling', () => {
    document.body.innerHTML = '<div id="side"></div>'
    const assistant = install()
    assistant.regionRender(renderRequest('panel'))
    const real = panelOf('panel')
    const forged = document.createElement('div')
    forged.dataset.dshRegionMountId = 'panel'
    forged.textContent = '页面节点'
    document.querySelector('#side')?.append(forged)
    expect(assistant.regionClear(clearRequest('panel'))).toMatchObject({ outcome: 'observed', value: { cleared: true } })
    expect(real?.isConnected).toBe(false)
    expect(forged.isConnected).toBe(true)
    expect(forged.textContent).toBe('页面节点')
  })

  test('regionClear 在页面端挂载登记丢失后移除同 mountId 面板，但把替换内容保留为未解决', () => {
    document.body.innerHTML = '<aside id="side"><p id="keep">原内容</p></aside>'
    install().regionRender(renderRequest('panel', { mode: 'replace' }))
    delete (globalThis as typeof globalThis & { __dshBrowserAssistant?: unknown }).__dshBrowserAssistant
    const reinstalled = install()
    const receipt = reinstalled.regionClear(clearRequest('panel'))
    expect(receipt).toMatchObject({ outcome: 'observed', value: { cleared: false, restored: 0 } })
    expect(panelOf('panel')).toBeNull()
    expect(document.querySelector('#keep')).toBeNull()
  })

  test('regionClear 在精确证明没有登记也没有面板时明确报告 absent', () => {
    document.body.innerHTML = '<aside id="side"><p>页面原有内容</p></aside>'
    const receipt = install().regionClear(clearRequest('never-mounted'))
    expect(receipt).toMatchObject({
      outcome: 'observed', quiescent: true,
      value: { cleared: true, restored: 0, disposition: 'absent' },
    })
    expect(document.querySelector('#side')?.textContent).toBe('页面原有内容')
  })

  test('replace 面板在 SPA 新路由已写入内容后清理不会恢复旧节点', () => {
    document.body.innerHTML = '<aside id="side"><p id="old">旧路由</p></aside>'
    const assistant = install()
    assistant.regionRender(renderRequest('panel', { mode: 'replace' }))
    history.pushState({}, '', '/next')
    document.querySelector('#side')!.innerHTML = '<p id="new">新路由</p>'
    const receipt = assistant.regionClear(clearRequest('panel'))
    expect(receipt).toMatchObject({ outcome: 'observed', value: { disposition: 'route_discarded' } })
    expect(document.querySelector('#new')?.textContent).toBe('新路由')
    expect(document.querySelector('#old')).toBeNull()
    history.pushState({}, '', '/feed')
  })

  test('替换模式在同文档 URL 漂移后只移除 DSH 面板，绝不恢复旧路由内容覆盖新路由', async () => {
    document.body.innerHTML = '<aside id="side"><p id="old">旧路由</p></aside>'
    const assistant = install()
    assistant.regionRender(renderRequest('panel', { mode: 'replace' }))
    history.pushState({}, '', '/next')
    document.querySelector('#side')!.innerHTML = '<p id="new">新路由</p>'
    await flushObservers()
    expect(document.querySelector('#new')?.textContent).toBe('新路由')
    expect(document.querySelector('#old')).toBeNull()
    expect(panelOf('panel')).toBeNull()
  })

  test('路由漂移后先发生无关 mutation、框架稍后渲染时绝不恢复旧 replace 节点', async () => {
    document.body.innerHTML = '<aside id="side"><p id="old">旧路由</p></aside>'
    const assistant = install()
    assistant.regionRender(renderRequest('panel', { mode: 'replace' }))
    history.pushState({}, '', '/next')
    document.body.append(document.createElement('i'))
    await flushObservers()
    expect(document.querySelector('#old')).toBeNull()
    expect(panelOf('panel')).toBeNull()
    document.querySelector('#side')!.innerHTML = '<p id="new">新路由</p>'
    expect(document.querySelector('#new')?.textContent).toBe('新路由')
    expect(document.querySelector('#old')).toBeNull()
    history.pushState({}, '', '/feed')
  })

  test('非法载荷被拒绝且不改变页面', () => {
    document.body.innerHTML = '<div id="side"></div>'
    const assistant = install()
    const empty = assistant.regionRender({ ...identity('bad'), target, payload: { kind: 'region_render', page, mountId: 'panel', selector: '#side', blocks: [] } })
    expect(empty).toMatchObject({ outcome: 'failed', reason: 'invalid_action', quiescent: true })
    const badPlacement = assistant.regionRender(renderRequest('panel', { placement: 'replace' }))
    expect(badPlacement).toMatchObject({ outcome: 'failed', reason: 'invalid_action', quiescent: true })
    expect(document.querySelectorAll('[data-dsh-region-mount-id="panel"]')).toHaveLength(0)
  })

  test('目标 URL 与当前文档不一致时拒绝渲染', () => {
    document.body.innerHTML = '<div id="side"></div>'
    const assistant = install()
    const receipt = assistant.regionRender({
      ...identity('stale'), target,
      payload: { kind: 'region_render', page: { ...page, url: 'https://example.test/other' }, mountId: 'panel', selector: '#side', blocks: [{ type: 'text', text: 'x' }] },
    })
    expect(receipt).toMatchObject({ outcome: 'failed', reason: 'target_url_stale', quiescent: true })
    expect(document.querySelectorAll('[data-dsh-region-mount-id="panel"]')).toHaveLength(0)
  })
})
