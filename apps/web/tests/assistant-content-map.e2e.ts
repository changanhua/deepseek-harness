/** Browser-page collection through the shipped extension renderer; the Session transport is a test boundary. */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { browserObservationMeta } from '../../../packages/browser/tool-browser/src/observation-meta.ts'
import type { BrowserActionResult } from '../../../packages/browser/browser/src/types.ts'

const root = resolve(import.meta.dirname, '../../..')
const extension = resolve(root, 'apps/chrome-extension')
const { projectAssistantCognition } = await import(pathToFileURL(resolve(extension, 'src/assistant-cognition.js')).href) as {
  projectAssistantCognition: (input: { sessionId: string; now: number; records: unknown[] }) => unknown
}
const artifacts = resolve(root, '.artifacts/browser-assistant-v2/semantic-redesign')
const article = `<!doctype html><html lang="zh"><head><meta charset="UTF-8"><title>电池使用指南</title><style>body{font:16px sans-serif;max-width:900px;margin:40px auto}li{margin:12px}</style></head><body>
<header><nav><a href="#account">我的账户</a></nav></header><main><article><h1>电池使用指南</h1>
<h2>日常充电</h2><p>保持通风，避免在高温环境中长时间充电。</p><h3>延长使用寿命</h3><p>减少长时间满电存放，按实际需要充电。</p>
<button>查看充电建议</button><h2>长期存放</h2><p>设备长期不用时，保持适中的电量并放置在阴凉处。</p>
<h2>相关阅读</h2><ul><li><a href="#temperature">温度如何影响电池寿命</a></li><li><a href="#cycles">理解充放电循环</a></li></ul>
</article></main><footer>隐私条款</footer></body></html>`

async function collect(page: Page, tree: boolean): Promise<Record<string, unknown>> {
  await page.addScriptTag({ content: await readFile(resolve(extension, 'src/browser-dom-tree.js'), 'utf8') })
  await page.addScriptTag({ content: await readFile(resolve(extension, 'src/browser-page.js'), 'utf8') })
  return await page.evaluate((withTree) => {
    const runtime = (globalThis as typeof globalThis & {
      __dshBrowserAssistant: { snapshot(options: object): Record<string, unknown> }
    }).__dshBrowserAssistant
    return runtime.snapshot({ tree: withTree, treeLimit: 128, maxText: 4000, limit: 64 })
  }, tree)
}

async function show(panel: Page, snapshot: Record<string, unknown>, url: string): Promise<void> {
  const now = Date.now(), target = { tabId: 7, frameId: 0, documentId: 'content-test-document', url }
  const result = { sessionId: 'content-test', installationId: 'browser', requestId: 'read-request', outcome: 'observed', delivery: 'sent',
    value: { ...snapshot, page: target } } as unknown as BrowserActionResult
  const records = [
    { event: { type: 'tool/call', seq: 1, time: now, data: { callId: 'read', name: 'browser_snapshot', arguments: '{}' } } },
    { event: { type: 'tool/result', seq: 2, time: now + 1, surfaceOp: 'append', sourceEventSeqs: [1], data: { meta: browserObservationMeta(result), message: { source: { callId: 'read' }, content: [{ type: 'tool-result', toolCallId: 'read', isError: false,
      content: [{ type: 'text', text: JSON.stringify(result) }] }] } } } },
  ]
  const cognition = projectAssistantCognition({ sessionId: 'content-test', now: now + 2, records })
  const state = { assistantV2: { surface: { id: 'test-surface' }, connection: { phase: 'connected' },
    session: { phase: 'idle', binding: { sessionId: 'content-test' }, transcript: [], pending: null },
    target: { availability: 'ready', revision: 1, selected: target, candidates: [] }, cognition,
    functions: { availability: 'ready', items: [] } } }
  await panel.addInitScript((initial) => {
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
      sendMessage: async () => ({ ok: true, state: initial }), onMessage: { addListener: () => {} },
    } } })
  }, state)
  await panel.route('http://127.0.0.1:47652/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    const file = resolve(extension, `.${pathname}`)
    if (!file.startsWith(extension + '\\') && !file.startsWith(extension + '/')) { await route.abort(); return }
    const contentType = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' } as Record<string, string>)[extname(file)] ?? 'application/octet-stream'
    try { await route.fulfill({ body: await readFile(file), contentType }) } catch { await route.fulfill({ status: 404, body: '' }) }
  })
  await panel.goto('http://127.0.0.1:47652/sidebar.html')
  await panel.locator('[data-view="cognition"]').click()
  await panel.locator('.atlas-root').waitFor()
  await mkdir(artifacts, { recursive: true })
  await writeFile(resolve(artifacts, url.includes('127.0.0.1') ? 'article-observation.json' : 'live-observation.json'), JSON.stringify({ url, snapshot, cognition }, null, 2))
}

it('renders actual DOM content and heading relationships at wide and narrow widths', async () => {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH } : {}) })
  try {
    const target = await browser.newPage(), panel = await browser.newPage({ viewport: { width: 1280, height: 1080 } })
    await target.route('http://127.0.0.1:47653/guide', route => route.fulfill({ body: article, contentType: 'text/html' }))
    await target.goto('http://127.0.0.1:47653/guide')
    await show(panel, await collect(target, true), target.url())
    expect(await panel.locator('.atlas-map').textContent()).toContain('保持通风')
    expect(await panel.locator('.atlas-map').textContent()).toContain('温度如何影响电池寿命')
    expect(await panel.locator('.atlas-branches .atlas-branches').count()).toBeGreaterThan(0)
    const first = panel.locator('[data-atlas-region-id]').first()
    await first.focus(); await panel.keyboard.press('Enter')
    expect(await first.evaluate(element => document.activeElement === element)).toBe(true)
    expect(await panel.locator('.atlas-inspector').textContent()).toContain('保持通风')
    const mapBox = await panel.locator('.atlas-map').boundingBox(), inspectBox = await panel.locator('.atlas-inspector').boundingBox()
    expect(inspectBox!.x).toBeGreaterThan(mapBox!.x + mapBox!.width)
    await panel.screenshot({ path: resolve(artifacts, 'article-wide.png'), fullPage: true })
    await panel.setViewportSize({ width: 380, height: 1100 })
    expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await panel.locator('.atlas-inspector').evaluate(element => getComputedStyle(element).position)).toBe('static')
    await panel.screenshot({ path: resolve(artifacts, 'article-narrow.png'), fullPage: true })
  } finally { await browser.close() }
})

it.skipIf(!process.env.DSH_ATLAS_LIVE_URL)('renders a public page from a current browser observation', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const target = await browser.newPage(), panel = await browser.newPage({ viewport: { width: 1360, height: 1100 } })
    await target.goto(process.env.DSH_ATLAS_LIVE_URL!, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    const snapshot = await collect(target, false)
    expect(String(snapshot.text).length).toBeGreaterThan(100)
    await show(panel, snapshot, target.url())
    expect(await panel.locator('.semantic-navigation').textContent()).toContain('尚未生成语义解读')
    await panel.locator('.semantic-unorganized').click()
    expect(await panel.locator('[data-source-ref]').count()).toBeGreaterThan(0)
    await panel.screenshot({ path: resolve(artifacts, 'live-page-wide.png'), fullPage: true })
  } finally { await browser.close() }
})
