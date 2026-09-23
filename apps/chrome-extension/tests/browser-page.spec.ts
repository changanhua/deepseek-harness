/** @vitest-environment jsdom */
/** @vitest-environment-options {"url":"https://example.test/article"} */
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

interface BrowserPage {
  url: string
  tabId?: number
  frameId?: number
  documentId?: string
}

interface BrowserElement {
  snapshotId: string
  elementId: string
  tag: string
  text: string
  attributes: Record<string, string | null>
  state?: Record<string, unknown>
  page?: BrowserPage
}

interface BrowserAction {
  kind: string
  page?: BrowserPage
  element?: BrowserElement
  intent?: string
  value?: string
  url?: string
  x?: number
  y?: number
  milliseconds?: number
}

interface BrowserSnapshot {
  snapshotId: string
  url: string
  title: string
  text: string
  textTruncated: boolean
  scanTruncated: boolean
  elements: BrowserElement[]
  source?: {
    version: number
    extractorVersion: string
    contentBlocks: Array<{ blockId: string; ordinal: number; kind: string; text: string; truncated: boolean }>
    omissions: string[]
  }
  structure?: {
    regions: Array<{ kind: string; label: string; text: string }>
    collections: Array<{
      kind: string
      itemCount: number
      items: Array<{
        index: number
        text: string
        controls: Array<{ elementId: string; role: string; label: string; state?: Record<string, unknown> }>
      }>
    }>
  }
}

interface BrowserDescription {
  effect: string
  target?: { label: string }
  valuePreview?: string
}

interface BrowserReceipt {
  outcome: string
  reason?: string
  quiescent?: boolean
  value?: unknown
}

interface BrowserPreparationReceipt extends BrowserReceipt {
  value: {
    preparationId: string
    expiresAt: number
    description: BrowserDescription
  }
}

type BrowserPayload = BrowserAction
  | { kind: 'prepare'; action: BrowserAction; expiresAt?: number }
  | { kind: 'commit'; action: BrowserAction; preparationId: string }

type BrowserRequest = BrowserIdentity & { payload: BrowserPayload }

interface BrowserAssistant {
  snapshot(options?: { references?: boolean; query?: string; offset?: number; limit?: number; textLimit?: number }): BrowserSnapshot
  prepare(request: BrowserRequest): Promise<BrowserPreparationReceipt>
  execute(request: BrowserRequest): Promise<BrowserReceipt>
  inspect(identity: BrowserIdentity, options?: { cancel?: boolean }): BrowserReceipt
  revealSource(reference: { snapshotId: string; blockId: string; url: string }): { ok: boolean; reason?: string; text?: string }
}

type BrowserPageGlobal = typeof globalThis & { __dshBrowserAssistant?: BrowserAssistant }

const identity = (requestId: string, extra: Partial<BrowserIdentity> = {}): BrowserIdentity => ({
  protocolVersion: 1, installationId: 'installation-1', grantEpoch: 7, requestId, sessionId: 'session-1',
  deadline: Date.now() + 10_000, fingerprint: `${requestId}-fingerprint`, ...extra,
})
const install = (): BrowserAssistant => {
  if (typeof browserPageSource !== 'string') throw new Error('browser page source is not text')
  globalThis.eval(browserPageSource)
  const assistant = (globalThis as BrowserPageGlobal).__dshBrowserAssistant
  if (assistant === undefined) throw new Error('browser assistant did not install')
  return assistant
}

afterEach(() => {
  document.body.innerHTML = ''
  delete (globalThis as typeof globalThis & { __dshBrowserAssistant?: unknown }).__dshBrowserAssistant
  history.replaceState({}, '', '/article')
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('页面内浏览器助手', () => {
  test('已采集原文祖先隐藏时主动失效，并拒绝当前网页定位', async () => {
    document.body.innerHTML = '<main><section id="container"><p>仅在三种模板中验证。</p></section></main>'
    const sendMessage = vi.fn(async () => ({}))
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const assistant = install(), snapshot = assistant.snapshot()
    const block = snapshot.source!.contentBlocks[0]
    document.querySelector('#container')!.setAttribute('hidden', '')
    await vi.waitFor(() => { expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dsh-source-position', snapshotId: snapshot.snapshotId, invalidated: true,
    })) })
    expect(assistant.revealSource({ snapshotId: snapshot.snapshotId, blockId: block.blockId, url: location.href }))
      .toMatchObject({ ok: false, reason: 'source_changed' })
  })
  test('开放 Shadow DOM 中的原文变化会主动使来源失效', async () => {
    document.body.innerHTML = '<main><div id="host"></div></main>'
    const shadow = document.querySelector('#host')!.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<p id="source">工具失败后先检查状态。</p>'
    const sendMessage = vi.fn(async () => ({}))
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const assistant = install(), snapshot = assistant.snapshot({ textLimit: 0 })
    const block = snapshot.source!.contentBlocks.find(item => item.text === '工具失败后先检查状态。')!
    expect(block).toBeTruthy()
    shadow.querySelector('#source')!.textContent = '工具失败后直接重试。'
    await vi.waitFor(() => { expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dsh-source-position', snapshotId: snapshot.snapshotId, invalidated: true,
    })) })
    expect(assistant.revealSource({ snapshotId: snapshot.snapshotId, blockId: block.blockId, url: location.href }))
      .toMatchObject({ ok: false, reason: 'source_changed' })
  })
  test('开放 Shadow DOM 的宿主被隐藏时也会主动使来源失效', async () => {
    document.body.innerHTML = '<main><div id="host"></div></main>'
    const host = document.querySelector('#host')!, shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<p>宿主隐藏后这段原文不可定位。</p>'
    const sendMessage = vi.fn(async () => ({}))
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const assistant = install(), snapshot = assistant.snapshot({ textLimit: 0 })
    const block = snapshot.source!.contentBlocks.find(item => item.text === '宿主隐藏后这段原文不可定位。')!
    expect(block).toBeTruthy()
    host.setAttribute('hidden', '')
    await vi.waitFor(() => { expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dsh-source-position', snapshotId: snapshot.snapshotId, invalidated: true,
    })) })
    expect(assistant.revealSource({ snapshotId: snapshot.snapshotId, blockId: block.blockId, url: location.href }))
      .toMatchObject({ ok: false, reason: 'source_changed' })
  })
  test('开放 Shadow DOM 的宿主被移除时也会主动使来源失效', async () => {
    document.body.innerHTML = '<main><div id="host"></div></main>'
    const host = document.querySelector('#host')!, shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<p>宿主移除后这段原文不可定位。</p>'
    const sendMessage = vi.fn(async () => ({}))
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const assistant = install(), snapshot = assistant.snapshot({ textLimit: 0 })
    const block = snapshot.source!.contentBlocks.find(item => item.text === '宿主移除后这段原文不可定位。')!
    expect(block).toBeTruthy()
    host.remove()
    await vi.waitFor(() => { expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dsh-source-position', snapshotId: snapshot.snapshotId, invalidated: true,
    })) })
    expect(assistant.revealSource({ snapshotId: snapshot.snapshotId, blockId: block.blockId, url: location.href }))
      .toMatchObject({ ok: false, reason: 'source_changed' })
  })
  test('来源块有独立身份，段落回源核对原文，重复文本不猜位置', () => {
    document.body.innerHTML = '<main><h1>缓存测试</h1><p id="first">只在三种模板中观察到平均约 14% 的提升。</p>'
      + '<p id="second">只在三种模板中观察到平均约 14% 的提升。</p><input value="PRIVATE"></main>'
    const assistant = install(), snapshot = assistant.snapshot()
    expect(snapshot.source?.contentBlocks.map(block => block.text)).toEqual(['缓存测试', '只在三种模板中观察到平均约 14% 的提升。', '只在三种模板中观察到平均约 14% 的提升。'])
    const blocks = snapshot.source!.contentBlocks
    expect(blocks[1].blockId).not.toBe(blocks[2].blockId)
    const second = document.querySelector('#second') as HTMLElement
    const scroll = vi.fn(); second.scrollIntoView = scroll
    expect(assistant.revealSource({ snapshotId: snapshot.snapshotId, blockId: blocks[2].blockId, url: location.href }))
      .toMatchObject({ ok: true, text: blocks[2].text })
    expect(scroll).toHaveBeenCalledOnce()
    second.textContent = '缓存总能提升 14%。'
    expect(assistant.revealSource({ snapshotId: snapshot.snapshotId, blockId: blocks[2].blockId, url: location.href })).toMatchObject({ ok: false, reason: 'source_changed' })
    second.remove()
    expect(assistant.revealSource({ snapshotId: snapshot.snapshotId, blockId: blocks[2].blockId, url: location.href }).ok).toBe(false)
  })

  test('来源块不丢代码空白和表格行顺序，并明确截断边界', () => {
    document.body.innerHTML = '<main><pre>if ready:\n    run()</pre><table><tr><th>型号</th><th>评分</th></tr><tr><td>A</td><td>91</td></tr></table>'
      + `<p>${'长'.repeat(1400)}</p></main>`
    const source = install().snapshot().source
    expect(source?.contentBlocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'code', text: 'if ready:\n    run()' }),
      expect.objectContaining({ kind: 'table-row', text: '型号 | 评分' }),
      expect.objectContaining({ kind: 'table-row', text: 'A | 91' }),
      expect.objectContaining({ truncated: true }),
    ]))
    expect(source?.omissions.length).toBeGreaterThan(0)
  })
  test('无语义标签的正文仍按可见内容块采集，不把整页或导航混为一块', () => {
    document.body.innerHTML = '<nav><div>登录 注册</div></nav><main><div><div>先连接服务。</div>'
      + '<div><strong>失败处理：</strong><span>检查端口后再试。</span></div></div><div><input value="PRIVATE"></div></main>'
    const assistant = install(), snapshot = assistant.snapshot({ textLimit: 0 })
    expect(snapshot.source?.contentBlocks.map(block => block.text)).toEqual(['先连接服务。', '失败处理： 检查端口后再试。'])
    const block = snapshot.source!.contentBlocks[1]
    expect(assistant.revealSource({ snapshotId: snapshot.snapshotId, blockId: block.blockId, url: location.href }))
      .toMatchObject({ ok: true, text: '失败处理： 检查端口后再试。' })
  })
  test('重复的纯 div 实体卡片按每条记录回源，不把字段拆散或合并整页', () => {
    document.body.innerHTML = '<main><div class="players">'
      + '<div class="player" id="first-player"><div><strong>Kylian Mbappé</strong></div><div>ST · 91</div></div>'
      + '<div class="player" id="second-player"><div><strong>Aitana Bonmatí</strong></div><div>CM · 91</div></div>'
      + '</div></main>'
    const assistant = install(), snapshot = assistant.snapshot({ textLimit: 0 })
    expect(snapshot.source?.contentBlocks.map(block => block.text)).toEqual([
      'Kylian Mbappé ST · 91', 'Aitana Bonmatí CM · 91',
    ])
    const target = document.querySelector('#second-player') as HTMLElement, scroll = vi.fn()
    target.scrollIntoView = scroll
    const blockId = snapshot.source!.contentBlocks[1].blockId
    expect(assistant.revealSource({ snapshotId: snapshot.snapshotId, blockId, url: location.href })).toMatchObject({ ok: true, blockId })
    expect(scroll).toHaveBeenCalledOnce()
  })
  test('带链接和嵌套字段的重复卡片仍以实体记录采集并精确回源', () => {
    document.body.innerHTML = '<main><div class="players">'
      + '<div class="player" id="first-player"><a href="/player/1"><div><span>Kylian Mbappé</span></div></a>'
      + '<div class="meta"><div>ST</div><div>91</div></div></div>'
      + '<div class="player" id="second-player"><a href="/player/2"><div><span>Aitana Bonmatí</span></div></a>'
      + '<div class="meta"><div>CM</div><div>91</div></div></div></div></main>'
    const assistant = install(), snapshot = assistant.snapshot({ textLimit: 0 })
    expect(snapshot.source?.contentBlocks).toEqual([
      expect.objectContaining({ kind: 'record', text: 'Kylian Mbappé ST 91' }),
      expect.objectContaining({ kind: 'record', text: 'Aitana Bonmatí CM 91' }),
    ])
    const target = document.querySelector('#second-player') as HTMLElement, scroll = vi.fn()
    target.scrollIntoView = scroll
    expect(assistant.revealSource({
      snapshotId: snapshot.snapshotId, blockId: snapshot.source!.contentBlocks[1].blockId, url: location.href,
    }))
      .toMatchObject({ ok: true, text: 'Aitana Bonmatí CM 91' })
    expect(scroll).toHaveBeenCalledOnce()
  })
  test('整张球员卡片是链接时保留每名球员的完整记录', () => {
    document.body.innerHTML = '<main><h1>EA FC 27 Popular Players</h1>'
      + '<a href="/27/popular/evolutions"><span>Popular Evolution Players</span></a><div class="players">'
      + '<div class="slot"><a id="kika" href="/27/player/506/francisca-ramos-nazareth-sousa">'
      + '<div>73K Coin 410 Item Score</div><div>83 CM Kika Nazareth</div><div>85 PAC 82 SHO 82 PAS 84 DRI 60 DEF 80 PHY</div>'
      + '</a></div><div class="slot"><a id="rashford" href="/27/player/810/marcus-rashford">'
      + '<div>72K Coin 340 Item Score</div><div>82 LW Rashford</div><div>92 PAC 83 SHO 78 PAS 81 DRI 33 DEF 68 PHY</div>'
      + '</a></div></div></main>'
    const assistant = install(), snapshot = assistant.snapshot({ textLimit: 0 })
    expect(snapshot.source?.contentBlocks.map(block => block.kind)).toEqual(['heading', 'record', 'record'])
    expect(snapshot.source!.contentBlocks[0].text).toBe('EA FC 27 Popular Players')
    expect(snapshot.source!.contentBlocks[1].text).toContain('Kika Nazareth')
    expect(snapshot.source!.contentBlocks[2].text).toContain('Rashford')
    expect(snapshot.source!.contentBlocks[1].text).toContain('85 PAC 82 SHO')
    expect(snapshot.source!.contentBlocks[2].text).toContain('92 PAC 83 SHO')
    const card = document.querySelector('#rashford') as HTMLElement, scroll = vi.fn()
    card.scrollIntoView = scroll
    expect(assistant.revealSource({
      snapshotId: snapshot.snapshotId, blockId: snapshot.source!.contentBlocks[2].blockId, url: location.href,
    })).toMatchObject({ ok: true, text: snapshot.source!.contentBlocks[2].text })
    expect(scroll).toHaveBeenCalledOnce()
  })
  test('球员卡片保留可访问的图标标签，标签变化时拒绝旧来源定位', () => {
    document.body.innerHTML = '<main><a id="card" href="/27/player/506/francisca-ramos-nazareth-sousa">'
      + '<div><span>73K</span><img alt="Coin"><span>410</span><span role="img" aria-label="Item Score"></span></div>'
      + '<div>83 CM Kika Nazareth 85 PAC 82 SHO 82 PAS 84 DRI 60 DEF 80 PHY</div></a></main>'
    const assistant = install(), snapshot = assistant.snapshot({ textLimit: 0 })
    const block = snapshot.source!.contentBlocks[0]
    expect(block.kind).toBe('record')
    expect(block.text).toContain('73K Coin 410 Item Score')
    expect(block.text).toContain('Kika Nazareth')
    document.querySelector('img')!.alt = 'Tokens'
    expect(assistant.revealSource({ snapshotId: snapshot.snapshotId, blockId: block.blockId, url: location.href }))
      .toMatchObject({ ok: false, reason: 'source_changed' })
  })
  test('球员卡片保留图标 title 中的国籍联赛俱乐部，改值时使来源失效', async () => {
    document.body.innerHTML = '<main><a id="card" href="/27/player/506/francisca-ramos-nazareth-sousa">'
      + '<div>73K<img alt="Coin">410<img alt="Item Score"></div>'
      + '<div>83 CM Kika Nazareth 85 PAC 82 SHO 82 PAS 84 DRI 60 DEF 80 PHY'
      + '<img alt="Nation" title="Portugal"><img alt="League" title="Liga F">'
      + '<img alt="Club" title="FC Barcelona"></div></a></main>'
    const sendMessage = vi.fn(async () => ({}))
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const assistant = install(), snapshot = assistant.snapshot({ textLimit: 0 })
    const block = snapshot.source!.contentBlocks[0]
    expect(block.kind).toBe('record')
    expect(block.text).toContain('Nation: Portugal')
    expect(block.text).toContain('League: Liga F')
    expect(block.text).toContain('Club: FC Barcelona')
    document.querySelector('img[alt="Club"]')!.setAttribute('title', 'Real Madrid')
    await vi.waitFor(() => { expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'dsh-source-position', snapshotId: snapshot.snapshotId, invalidated: true,
    })) })
    expect(assistant.revealSource({ snapshotId: snapshot.snapshotId, blockId: block.blockId, url: location.href }))
      .toMatchObject({ ok: false, reason: 'source_changed' })
  })
  test('单层包装的整卡链接保留图标与字段，短导航链接不变成记录', () => {
    document.body.innerHTML = '<main><a href="/popular/evolutions"><span>Popular Evolution Players</span></a>'
      + '<a id="card" href="/27/player/506/francisca-ramos-nazareth-sousa"><div>'
      + '<span>73K</span><img alt="Coin"><span>410</span><span role="img" aria-label="Item Score"></span>'
      + '<div>83 CM Kika Nazareth 85 PAC 82 SHO 82 PAS 84 DRI 60 DEF 80 PHY</div>'
      + '</div></a></main>'
    const assistant = install(), snapshot = assistant.snapshot({ textLimit: 0 })
    expect(snapshot.source?.contentBlocks).toHaveLength(1)
    expect(snapshot.source?.contentBlocks[0].kind).toBe('record')
    expect(snapshot.source?.contentBlocks[0].text).toContain('73K Coin 410 Item Score')
    const target = document.querySelector('#card') as HTMLElement, scroll = vi.fn()
    target.scrollIntoView = scroll
    expect(assistant.revealSource({ snapshotId: snapshot.snapshotId,
      blockId: snapshot.source!.contentBlocks[0].blockId, url: location.href })).toMatchObject({ ok: true })
    expect(scroll).toHaveBeenCalledOnce()
  })
  test('没有图片的通用重复链接卡片也按独立记录采集', () => {
    document.body.innerHTML = '<main><section class="catalog">'
      + '<a id="alpha" href="/catalog/alpha"><div><span>Alpha Workbench</span><span>2 seats</span>'
      + '<span>Monthly plan includes shared notes and audit history.</span></div></a>'
      + '<a id="beta" href="/catalog/beta"><div><span>Beta Workbench</span><span>5 seats</span>'
      + '<span>Annual plan includes exports and team permissions.</span></div></a>'
      + '</section></main>'
    const assistant = install(), snapshot = assistant.snapshot({ textLimit: 0 })
    expect(snapshot.source?.contentBlocks.map(block => block.kind)).toEqual(['record', 'record'])
    expect(snapshot.source?.contentBlocks[0].text).toContain('Alpha Workbench')
    expect(snapshot.source?.contentBlocks[1].text).toContain('Beta Workbench')
    const target = document.querySelector('#beta') as HTMLElement, scroll = vi.fn()
    target.scrollIntoView = scroll
    expect(assistant.revealSource({ snapshotId: snapshot.snapshotId,
      blockId: snapshot.source!.contentBlocks[1].blockId, url: location.href })).toMatchObject({ ok: true })
    expect(scroll).toHaveBeenCalledOnce()
  })
  test('长球员列表只采集有界的完整记录，并显示其余未采集', () => {
    const cards = Array.from({ length: 90 }, (_, index) => `<div><a href="/player/${index}">`
      + `<div>Player ${index + 1}</div><div>85 CM 91 PAC 82 SHO 83 PAS 84 DRI 60 DEF 80 PHY</div></a></div>`).join('')
    document.body.innerHTML = `<main><h1>Popular Players</h1><div class="players">${cards}</div></main>`
    const source = install().snapshot({ textLimit: 0 }).source!
    expect(source.contentBlocks).toHaveLength(64)
    expect(source.contentBlocks[0].kind).toBe('heading')
    expect(source.contentBlocks.slice(1).every(block => block.kind === 'record')).toBe(true)
    expect(source.contentBlocks[63].text).toContain('Player 63')
    expect(source.contentBlocks.some(block => block.text.includes('Player 64'))).toBe(false)
    expect(source.omissions).toContain('其余正文块未采集')
  })
  test('结构摘要保留章节正文并明确列表位于导航还是正文，不采输入值', () => {
    document.body.innerHTML = '<header><nav><ul><li>登录</li><li>注册</li></ul></nav></header><main><article><h1>电池指南</h1>'
      + '<h2>日常充电</h2><p>保持通风，避免高温。</p><input value="PRIVATE_VALUE"><h2>长期存放</h2><p>保持适中的电量。</p>'
      + '<section><h2>相关阅读</h2><ul><li>充放电循环</li><li>电池温度</li></ul></section></article></main>'
    const structure = install().snapshot().structure
    expect(structure?.regions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'section', label: '日常充电', text: '保持通风，避免高温。' }),
      expect.objectContaining({ kind: 'section', label: '长期存放', text: '保持适中的电量。' }),
    ]))
    expect(structure?.collections).toEqual(expect.arrayContaining([
      expect.objectContaining({ contextRole: 'navigation' }),
      expect.objectContaining({ label: '相关阅读', contextRole: 'main' }),
    ]))
    expect(JSON.stringify(structure)).not.toContain('PRIVATE_VALUE')
  })
  test('同名按钮带所属卡片标题且可以按卡片标题查找', () => {
    document.body.innerHTML = '<article><h2>显卡选购</h2><button>阅读全文</button></article>'
      + '<article><h2>空气炸锅</h2><button>阅读全文</button></article>'
    const assistant = install()
    expect(assistant.snapshot().elements).toMatchObject([
      { label: '阅读全文', context: '显卡选购' }, { label: '阅读全文', context: '空气炸锅' },
    ])
    expect(assistant.snapshot({ query: '空气炸锅' }).elements).toMatchObject([{ context: '空气炸锅' }])
    expect(assistant.snapshot({ query: '空气炸锅' }).elements).toHaveLength(1)
  })
  test('快照提供有界的通用区域和列表条目结构，供 Agent 定位而不绑定站点选择器', () => {
    document.body.innerHTML = '<main><h1>问题流</h1><section role="feed">'
      + '<article><h2>第一个问题</h2><a href="/q1">打开问题</a><button aria-pressed="true">点赞</button></article>'
      + '<article><h2>第二个问题</h2><a href="/q2">打开问题</a></article>'
      + '</section></main>'
    const structure = install().snapshot().structure
    expect(structure?.regions).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'main', label: '问题流' })]))
    const feed = structure?.collections.find(collection => collection.kind === 'feed')
    expect(feed?.itemCount).toBe(2)
    const first = feed?.items.find(item => item.index === 0)
    expect(first?.text).toContain('第一个问题')
    expect(first?.controls.find(control => control.role === 'link')?.label).toBe('打开问题')
    const like = first?.controls.find(control => control.role === 'button' && control.label === '点赞')
    expect(like?.state?.pressed).toBe(true)
  })
  test('控件快照暴露通用选择、忙碌和展开状态，供 Agent 核验动作结果', () => {
    document.body.innerHTML = '<button id="like" aria-pressed="true">点赞</button><button id="save" aria-selected="false">保存</button>'
      + '<button id="comment" aria-busy="true">发送</button><details><summary>展开</summary></details>'
    const elements = install().snapshot().elements
    expect(elements.find(element => element.attributes.id === 'like')?.state).toMatchObject({ pressed: true, busy: false })
    expect(elements.find(element => element.attributes.id === 'save')?.state).toMatchObject({ selected: false })
    expect(elements.find(element => element.attributes.id === 'comment')?.state).toMatchObject({ busy: true })
    expect(elements.find(element => element.label === '展开')?.state).toMatchObject({ expanded: false })
  })
  test('点击改变 aria-pressed 时返回已观察结果，而不是笼统 unknown', async () => {
    document.body.innerHTML = '<button id="like" aria-pressed="false">点赞</button>'
    document.querySelector('#like')?.addEventListener('click', (event) => {
      const node = event.currentTarget as HTMLElement
      node.setAttribute('aria-pressed', 'true')
    })
    const assistant = install(); const element = assistant.snapshot().elements[0]
    await expect(assistant.execute({ ...identity('like'), payload: { kind: 'click', element } })).resolves.toMatchObject({ outcome: 'observed' })
  })
  test('可分页并搜索第 128 个之后的控件，正文预算不读取输入值', () => {
    document.body.innerHTML = Array.from({ length: 140 }, (_, i) => `<button>按钮${i}</button>`).join('')
      + '<label>邮箱<input placeholder="请输入邮箱" value="PRIVATE_VALUE"></label>'
    const assistant = install()
    expect(assistant.snapshot({ offset: 128, limit: 4, textLimit: 80 })).toMatchObject({
      nextOffset: 132, elementsTruncated: true, textTruncated: true,
      elements: [{ label: '按钮128' }, { label: '按钮129' }, { label: '按钮130' }, { label: '按钮131' }],
    })
    const found = assistant.snapshot({ query: '请输入邮箱', textLimit: 80 })
    expect(found.elements).toMatchObject([{ role: 'textbox', label: '邮箱' }])
    expect(found.elements).toHaveLength(1)
    expect(JSON.stringify(found)).not.toContain('PRIVATE_VALUE')
    expect(found.text.length).toBeLessThanOrEqual(80)
  })
  test('语义控件搜索不让普通文本节点耗尽扫描预算', () => {
    document.body.innerHTML = Array.from({ length: 6_000 }, () => '<span>noise</span>').join('')
      + '<button>Pace</button>'
    const snapshot = install().snapshot({ query: 'Pace', textLimit: 0 })
    expect(snapshot.elements).toMatchObject([{ tag: 'button', text: 'Pace' }])
    expect(snapshot.scanTruncated).toBe(false)
  })
  test('无 ARIA 的 pointer 边界作为单个可执行的通用节点', async () => {
    document.body.innerHTML = '<div id="slot" style="cursor:pointer"><span style="cursor:pointer">ST +</span></div><output>Empty</output>'
    document.querySelector('#slot')!.addEventListener('click', () => { document.querySelector('output')!.textContent = 'Opened' })
    const assistant = install(), snapshot = assistant.snapshot({ query: 'ST +' })
    expect(snapshot.elements).toMatchObject([{ tag: 'div', text: 'ST +', role: 'generic' }])
    expect(snapshot.elements).toHaveLength(1)
    await expect(assistant.execute({ ...identity('custom-pointer-click'), payload: {
      kind: 'click', intent: '打开球员槽位', element: { ...snapshot.elements[0],
        page: { tabId: 7, frameId: 0, documentId: 'doc', url: location.href } },
    } })).resolves.toMatchObject({ outcome: 'observed', value: { effect: 'page-changed' } })
    expect(document.querySelector('output')!.textContent).toBe('Opened')
  })
  test('自定义控件的 pointer 或 onclick 移除后旧引用失效', async () => {
    document.body.innerHTML = '<div id="pointer" style="cursor:pointer">Pointer</div><div id="handler" onclick="void 0">Handler</div>'
    const handler = document.querySelector<HTMLElement>('#handler')!
    const assistant = install(), snapshot = assistant.snapshot()
    const pointerElement = snapshot.elements.find(item => item.attributes.id === 'pointer')!
    const handlerElement = snapshot.elements.find(item => item.attributes.id === 'handler')!
    expect(pointerElement).toBeDefined()
    expect(handlerElement).toBeDefined()
    document.querySelector<HTMLElement>('#pointer')!.style.cursor = 'default'
    handler.removeAttribute('onclick')
    const request = (requestId: string, element: BrowserElement) => ({ ...identity(requestId), payload: {
      kind: 'click', intent: '测试自定义控件', element: { ...element,
        page: { tabId: 7, frameId: 0, documentId: 'doc', url: location.href } },
    } })
    await expect(assistant.execute(request('pointer-removed', pointerElement))).resolves.toMatchObject({ outcome: 'failed', reason: 'stale_element' })
    await expect(assistant.execute(request('handler-removed', handlerElement))).resolves.toMatchObject({ outcome: 'failed', reason: 'stale_element' })
  })
  test('自定义控件的可见身份文本变化后旧引用失效', async () => {
    document.body.innerHTML = '<div id="slot" style="cursor:pointer">Delete</div>'
    const assistant = install(), element = assistant.snapshot().elements[0]
    document.querySelector('#slot')!.textContent = 'Save'
    await expect(assistant.execute({ ...identity('custom-label-changed'), payload: {
      kind: 'click', intent: '操作原始快照中的控件', element: { ...element,
        page: { tabId: 7, frameId: 0, documentId: 'doc', url: location.href } },
    } })).resolves.toMatchObject({ outcome: 'failed', reason: 'stale_element' })
  })
  test('初始 aria 或 fieldset 禁用控件不能准备或直接点击', async () => {
    for (const html of ['<div role="button" aria-disabled="true">禁用</div>', '<fieldset disabled><button>禁用</button></fieldset>']) {
      delete (globalThis as BrowserPageGlobal).__dshBrowserAssistant
      document.body.innerHTML = html
      const clicked = vi.fn(); document.querySelector('button,[role="button"]')!.addEventListener('click', clicked)
      const assistant = install(), snapshot = assistant.snapshot()
      const action = { kind: 'click', intent: '点击', element: { ...snapshot.elements[0],
        page: { tabId: 7, frameId: 0, documentId: 'doc', url: location.href } } }
      expect(await assistant.prepare({ ...identity('disabled-prepare'), payload: { kind: 'prepare', action } }))
        .toMatchObject({ outcome: 'failed', reason: 'target_unavailable' })
      expect(await assistant.execute({ ...identity('disabled-direct'), payload: action })).toMatchObject({ outcome: 'failed' })
      expect(clicked).not.toHaveBeenCalled()
    }
  })
  test('隐藏控件及其祖先的正文和 aria 标签不出现在快照中', () => {
    document.body.innerHTML = '<button>公开按钮</button><button style="display:none" aria-label="PRIVATE_LABEL">PRIVATE_TEXT</button>'
      + '<section style="visibility:hidden"><button aria-label="PRIVATE_ANCESTOR">PRIVATE_CHILD</button></section>'
      + '<details><summary>展开</summary><button>PRIVATE_COLLAPSED</button></details>'
    const snapshot = install().snapshot()
    expect(snapshot.elements).toHaveLength(2)
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_')
  })
  test('准备后隐藏目标使旧批准失效', async () => {
    document.body.innerHTML = '<section><button>按钮</button></section>'
    const clicked = vi.fn(); document.querySelector('button')!.addEventListener('click', clicked)
    const assistant = install(), snapshot = assistant.snapshot()
    const action = { kind: 'click', intent: '点击', element: { ...snapshot.elements[0],
      page: { tabId: 7, frameId: 0, documentId: 'doc', url: location.href } } }
    const prepared = await assistant.prepare({ ...identity('visible-prepare'), payload: { kind: 'prepare', action } })
    document.querySelector('section')!.style.display = 'none'
    expect(await assistant.execute({ ...identity('hidden-commit'), payload: { kind: 'commit', action,
      preparationId: prepared.value.preparationId } })).toMatchObject({ outcome: 'failed' })
    expect(clicked).not.toHaveBeenCalled()
  })
  test('fieldset 禁用或 aria 只读变化使已准备填写失效', async () => {
    for (const change of ['fieldset', 'aria']) {
      delete (globalThis as BrowserPageGlobal).__dshBrowserAssistant
      document.body.innerHTML = '<fieldset><label>填写内容<input id="field"></label></fieldset>'
      const assistant = install(), snapshot = assistant.snapshot()
      const input = document.querySelector('input')!
      const action = { kind: 'fill', intent: '填写', value: 'must-not-fill', element: { ...snapshot.elements[0],
        page: { tabId: 7, frameId: 0, documentId: 'doc', url: location.href } } }
      const prepared = await assistant.prepare({ ...identity('prepare-' + change), payload: { kind: 'prepare', action } })
      expect(prepared).toMatchObject({ outcome: 'observed' })
      if (change === 'fieldset') document.querySelector('fieldset')!.disabled = true
      else input.setAttribute('aria-readonly', 'true')
      expect(await assistant.execute({ ...identity('commit-' + change), payload: { kind: 'commit', action,
        preparationId: prepared.value.preparationId } })).toMatchObject({ outcome: 'failed' })
      expect(input.value).toBe('')
    }
  })
  test('快照包含关联标签、角色和必要状态，但不把输入区正文当作标签', async () => {
    document.body.innerHTML = '<label for="notes">备注</label><textarea id="notes" readonly>PRIVATE_DRAFT</textarea>'
      + '<label>嵌套备注<textarea id="nested">PRIVATE_NESTED</textarea></label>'
      + '<span id="select-label">选择</span><select aria-labelledby="select-label"><option>PRIVATE_OPTION</option></select>'
      + '<label for="choice">接收通知</label><input id="choice" type="checkbox" checked required>'
      + '<button id="disabled" disabled>提交</button><details open><summary id="details">更多信息</summary></details>'
      + '<div id="editor" contenteditable="true" role="textbox" aria-label="说明">PRIVATE_EDITOR</div>'
    Object.defineProperty(document.getElementById('editor')!, 'isContentEditable', { value: true })
    const assistant = install(), snapshot = assistant.snapshot()
    expect(snapshot.elements.find(element => element.attributes.id === 'notes')).toMatchObject({
      role: 'textbox', label: '备注', text: '', state: { readOnly: true, disabled: false },
    })
    expect(snapshot.elements.find(element => element.attributes.id === 'nested')).toMatchObject({ label: '嵌套备注', text: '' })
    expect(snapshot.elements.find(element => element.tag === 'select')).toMatchObject({ label: '选择', text: '' })
    expect(snapshot.elements.find(element => element.attributes.id === 'choice')).toMatchObject({
      role: 'checkbox', label: '接收通知', state: { checked: true, required: true },
    })
    expect(snapshot.elements.find(element => element.attributes.id === 'disabled')).toMatchObject({
      role: 'button', label: '提交', state: { disabled: true },
    })
    expect(snapshot.elements.find(element => element.attributes.id === 'details')).toMatchObject({ state: { expanded: true } })
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_')
    const editor = snapshot.elements.find(element => element.attributes.id === 'editor')!
    const prepared = await assistant.prepare({ ...identity('safe-editor-label'), payload: { kind: 'prepare', action: {
      kind: 'fill', element: { ...editor, page: { tabId: 7, frameId: 0, documentId: 'document', url: location.href } },
      value: 'Reviewed replacement', intent: '填写说明',
    } } })
    expect(JSON.stringify(prepared)).not.toContain('PRIVATE_EDITOR')
    expect(prepared).toMatchObject({ outcome: 'observed', value: { description: { target: { label: '说明' } } } })
  })
  test('后台只读采样不淘汰交互快照，过长正文标明截断', async () => {
    document.body.innerHTML = '<details><summary>展开正文</summary><p>正文</p></details>'
    const assistant = install(); const snapshot = assistant.snapshot()
    for (let index = 0; index < 12; index++) {
      expect(assistant.snapshot({ references: false })).toMatchObject({ elements: [], textTruncated: false })
    }
    const action = { kind: 'click', element: { ...snapshot.elements[0],
      page: { tabId: 7, frameId: 0, documentId: 'doc', url: location.href } } }
    expect(await assistant.prepare({ ...identity('after-observation'), payload: { kind: 'prepare', action } }))
      .toMatchObject({ outcome: 'observed' })
    document.body.append(Object.assign(document.createElement('p'), { textContent: 'x'.repeat(50_001) }))
    expect(assistant.snapshot({ references: false })).toMatchObject({ textTruncated: true })
  })

  test('准备只读取目标，提交时复核表单值并把确认固定在原动作', async () => {
    document.body.innerHTML = '<form action="/pay" method="post"><input name="amount" value="10"><button>购买</button></form>'
    const click = vi.fn(); document.querySelector('button')!.addEventListener('click', (event) => { event.preventDefault(); click() })
    const assistant = install(); const snapshot = assistant.snapshot()
    const element = { ...snapshot.elements[1], page: { tabId: 7, frameId: 0, documentId: 'doc', url: location.href } }
    const action = { kind: 'click', element, intent: '购买' }
    const prepared = await assistant.prepare({ ...identity('prepare'), payload: { kind: 'prepare', action } })
    expect(prepared).toMatchObject({ outcome: 'observed', value: { description: { effect: 'form-submit', target: { label: '购买' } } } })
    expect(click).not.toHaveBeenCalled()
    expect(JSON.stringify(prepared)).not.toContain('"amount"')
    document.querySelector('input')!.value = '100'
    await expect(assistant.execute({ ...identity('commit'), payload: { kind: 'commit', action, preparationId: prepared.value.preparationId } }))
      .resolves.toMatchObject({ outcome: 'failed', reason: 'stale_preparation' })
    expect(click).not.toHaveBeenCalled()
  })

  test('原生正文展开有明确语义；不把任意 aria-expanded 按钮视作安全展开', async () => {
    document.body.innerHTML = '<details><summary>展开正文</summary><p>正文</p></details><button aria-expanded="false">购买</button>'
    const assistant = install(); const snapshot = assistant.snapshot()
    const actions = snapshot.elements.map(element => ({ kind: 'click', intent: '展开', element: { ...element,
      page: { tabId: 7, frameId: 0, documentId: 'doc', url: location.href } } }))
    const prepared = await assistant.prepare({ ...identity('details-prepare'), payload: { kind: 'prepare', action: actions[0] } })
    expect(prepared.value.description.effect).toBe('local-disclosure')
    const click = vi.fn(); document.querySelector('summary')!.addEventListener('click', click)
    const request = { ...identity('details-commit'), payload: { kind: 'commit', action: actions[0], preparationId: prepared.value.preparationId } }
    expect(await assistant.execute(request)).toMatchObject({ outcome: 'observed', value: { expanded: true } })
    expect(document.querySelector('details')!.open).toBe(true)
    expect(click).not.toHaveBeenCalled()
    expect(await assistant.execute({ ...request, ...identity('second-commit') })).toMatchObject({ reason: 'preparation_used' })
    expect(document.querySelector('details')!.open).toBe(true)
    const other = await assistant.prepare({ ...identity('fake-disclosure'), payload: { kind: 'prepare', action: actions[1] } })
    expect(other.value.description.effect).toBe('unknown')
  })

  test('确认不能迁移到新参数、会话、授权代次或已经过期的准备', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<input aria-label="备注" value="before">'
    const assistant = install(); const snapshot = assistant.snapshot()
    const action = { kind: 'fill', intent: '修改备注', value: 'after', element: { ...snapshot.elements[0],
      page: { tabId: 7, frameId: 0, documentId: 'doc', url: location.href } } }
    const prepared = await assistant.prepare({ ...identity('fill-prepare', { deadline: Date.now() + 50 }), payload: { kind: 'prepare', action } })
    expect(prepared.value.description).toMatchObject({ effect: 'input-change', valuePreview: 'after' })
    for (const [index, extra] of [{ sessionId: 'other' }, { grantEpoch: 8 }, { payload: { kind: 'commit', action: { ...action, value: 'changed' }, preparationId: prepared.value.preparationId } }].entries()) {
      expect(await assistant.execute({ ...identity(`mismatch-${index}`), payload: { kind: 'commit', action, preparationId: prepared.value.preparationId }, ...extra }))
        .toMatchObject({ outcome: 'failed', reason: 'preparation_mismatch' })
    }
    expect(document.querySelector('input')!.value).toBe('before')
    await vi.advanceTimersByTimeAsync(51)
    expect(await assistant.execute({ ...identity('expired'), payload: { kind: 'commit', action, preparationId: prepared.value.preparationId } }))
      .toMatchObject({ outcome: 'failed', reason: 'preparation_unavailable' })
  })

  test('快照有界且不泄露密码和文件值，重复注入复用同一文档状态', async () => {
    document.body.innerHTML = '<button>继续</button><input type="password" value="secret"><input type="file"><p>正文</p>'
    const first = install(); const snapshot = first.snapshot(); const second = install()
    expect(second).toBe(first)
    expect(snapshot.text).toContain('正文')
    expect(JSON.stringify(snapshot)).not.toContain('secret')
    expect(snapshot.elements).toHaveLength(3)
  })

  test('只使用快照内仍连接且未变化的节点，不会在节点替换或页面改变后重匹配', async () => {
    document.body.innerHTML = '<button id="target">保存</button>'
    const assistant = install(); const snapshot = assistant.snapshot(); const element = snapshot.elements[0]
    const old = document.querySelector('#target')!; old.replaceWith(Object.assign(document.createElement('button'), { id: 'target', textContent: '保存' }))
    await expect(assistant.execute({ ...identity('replace'), payload: { kind: 'click', element } })).resolves.toMatchObject({ outcome: 'failed', reason: 'stale_element' })
    const current = assistant.snapshot(); history.pushState({}, '', '/other')
    await expect(assistant.execute({ ...identity('navigate-away'), payload: { kind: 'click', element: current.elements[0] } })).resolves.toMatchObject({ outcome: 'failed', reason: 'stale_element' })
  })

  test('同一 requestId 重复使用回执，身份或 fingerprint 冲突不会执行第二次', async () => {
    document.body.innerHTML = '<button>提交</button>'
    const click = vi.fn(); document.querySelector('button')!.addEventListener('click', click)
    const assistant = install(); const snapshot = assistant.snapshot(); const request = { ...identity('repeat'), payload: { kind: 'click', element: snapshot.elements[0] } }
    const first = await assistant.execute(request); const duplicate = await assistant.execute(request)
    const conflict = await assistant.execute({ ...request, fingerprint: 'different' })
    expect(first).toMatchObject({ outcome: 'unknown', reason: 'effect_unverified', quiescent: true }); expect(first).toEqual(duplicate); expect(click).toHaveBeenCalledTimes(1)
    expect(conflict).toMatchObject({ outcome: 'failed', reason: 'request_conflict' })
  })

  test('操作页面目标本身，与无关焦点无关；已发送 wait 可取消且 inspect 不伪称未知请求静止', async () => {
    vi.useFakeTimers()
    document.body.innerHTML = '<input id="other"><button id="target">执行</button>'
    const click = vi.fn(); document.querySelector('#target')!.addEventListener('click', click)
    const assistant = install(); const snapshot = assistant.snapshot(); document.querySelector<HTMLInputElement>('#other')!.focus()
    await expect(assistant.execute({ ...identity('focus'), payload: { kind: 'click', element: snapshot.elements.find(item => item.attributes.id === 'target') } })).resolves.toMatchObject({ outcome: 'unknown', reason: 'effect_unverified' })
    expect(click).toHaveBeenCalledOnce()
    const wait = assistant.execute({ ...identity('wait'), payload: { kind: 'wait', milliseconds: 1_000 } })
    expect(assistant.inspect(identity('missing', { deadline: Date.now() + 1_000 }))).toMatchObject({ outcome: 'unknown', quiescent: false })
    expect(assistant.inspect(identity('wait'), { cancel: true })).toMatchObject({ outcome: 'cancelled', quiescent: true })
    await expect(wait).resolves.toMatchObject({ outcome: 'cancelled' })
  })

  test('点击无变化不当作已观察效果；无效表单不声称已提交', async () => {
    document.body.innerHTML = '<form><input required><button type="submit">提交</button></form><button id="noop">无效果</button>'
    document.querySelector('#noop')!.addEventListener('click', (event) => { event.preventDefault() })
    const assistant = install(); const snapshot = assistant.snapshot()
    const noOp = snapshot.elements.find(item => item.attributes.id === 'noop')
    expect(await assistant.execute({ ...identity('no-effect'), payload: { kind: 'click', element: noOp } }))
      .toMatchObject({ outcome: 'unknown', reason: 'effect_unverified', quiescent: true })
    expect(await assistant.execute({ ...identity('invalid-form'), payload: { kind: 'submit', element: snapshot.elements[1] } }))
      .toMatchObject({ outcome: 'failed', reason: 'form_invalid', quiescent: true })
  })

  test('局部页面变化可以核验；填写回执不返回网站改写后的值', async () => {
    document.body.innerHTML = '<input id="input"><button id="change">更新</button><p id="result">before</p>'
    document.querySelector('#change')!.addEventListener('click', () => { document.querySelector('#result')!.textContent = 'after' })
    const assistant = install(); const snapshot = assistant.snapshot()
    expect(await assistant.execute({ ...identity('visible-change'), payload: { kind: 'click', element: snapshot.elements[1] } }))
      .toMatchObject({ outcome: 'observed', value: { effect: 'page-changed', businessOutcome: 'unverified' } })
    const input = document.querySelector('input')!
    input.addEventListener('input', () => { input.value = 'private-site-value' })
    const result = await assistant.execute({ ...identity('rewritten-value'), payload: { kind: 'fill', element: snapshot.elements[0], value: 'new-value' } })
    expect(result).toMatchObject({ outcome: 'unknown', reason: 'field_value_unverified' })
    expect(JSON.stringify(result)).not.toContain('private-site-value')
  })

  test('快照只采集可见正文，旧按钮文本或关联表单变化后不能填充，并拒绝非文本输入', async () => {
    document.body.innerHTML = '<script>window.secret = "leak"</script><p hidden>隐藏</p><p>可见正文</p><form action="/preview" method="get"><button id="pay">预览</button></form><input id="check" type="checkbox"><input id="text">'
    const assistant = install(); const snapshot = assistant.snapshot()
    expect(snapshot.text).toContain('可见正文'); expect(snapshot.text).not.toContain('leak'); expect(snapshot.text).not.toContain('隐藏')
    const button = snapshot.elements.find(item => item.attributes.id === 'pay')
    document.querySelector('#pay')!.textContent = '立即支付'
    await expect(assistant.execute({ ...identity('changed'), payload: { kind: 'click', element: button } })).resolves.toMatchObject({ reason: 'stale_element' })
    const checkbox = snapshot.elements.find(item => item.attributes.id === 'check')
    await expect(assistant.execute({ ...identity('checkbox'), payload: { kind: 'fill', element: checkbox, value: 'on' } })).resolves.toMatchObject({ outcome: 'failed', reason: 'not_editable' })
  })

  test('未知动作不被观察为成功，scroll报告实际位置，wait受页面与deadline约束', async () => {
    vi.useFakeTimers()
    const assistant = install()
    await expect(assistant.execute({ ...identity('unknown'), payload: { kind: 'surprise' } })).resolves.toMatchObject({ outcome: 'failed', reason: 'unsupported_action' })
    Object.defineProperties(window, { scrollX: { value: 12, configurable: true }, scrollY: { value: 34, configurable: true } })
    window.scrollTo = vi.fn()
    await expect(assistant.execute({ ...identity('scroll'), payload: { kind: 'scroll', page: { url: location.href }, x: 99, y: 88 } })).resolves.toMatchObject({ value: { x: 12, y: 34 } })
    await expect(assistant.execute({ ...identity('wrong-page'), payload: { kind: 'wait', page: { url: 'https://example.test/other' }, milliseconds: 10 } })).resolves.toMatchObject({ reason: 'stale_element' })
    const deadline = Date.now() + 10
    const wait = assistant.execute({ ...identity('deadline-wait', { deadline }), payload: { kind: 'wait', page: { url: location.href }, milliseconds: 1_000 } })
    await vi.advanceTimersByTimeAsync(11)
    await expect(wait).resolves.toMatchObject({ outcome: 'cancelled', reason: 'deadline' })
  })
})
