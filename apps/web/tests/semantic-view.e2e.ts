import { readFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..'), extension = resolve(root, 'apps/chrome-extension')
const page = { tabId: 1, frameId: 0, documentId: 'untitled', url: 'http://fixture.test/untitled' }
const block = { blockId: 'block-0', ordinal: 0, kind: 'paragraph', text: '没有标题的段落也应被保留：此建议可能无效。', truncated: false }

it('keeps the overview topic focused after Source then Focus keyboard returns across state refreshes', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const panel = await browser.newPage()
    const state = { assistantV2: { surface: { id: 'semantic-focus-e2e' }, connection: { phase: 'connected' },
      session: { phase: 'live', binding: { sessionId: 'untitled' }, transcript: [], pending: null },
      target: { availability: 'ready', revision: 1, selected: page, candidates: [] }, functions: { availability: 'ready', items: [] },
      cognition: { status: 'ready', pages: [{ id: 'untitled-page', title: '无标题说明', target: { installationId: 'fixture', page },
        documentState: 'current', locatorsValid: true, sourceSnapshot: { version: 1, snapshotId: 'snapshot', current: true, blocks: [block], omissions: [] },
        sourceSnapshots: [{ version: 1, snapshotId: 'snapshot', current: true, blocks: [block], omissions: [] }],
        semanticMap: { version: 1, mapId: 'map', snapshotId: 'snapshot', nodes: [{ nodeId: 'topic', parentId: null, label: '建议的限制', summary: '此建议可能无效。', sourceRefs: ['block-0'], origin: 'ai-summary' }], unorganizedBlockIds: [] }, semanticMaps: [] }] },
    } }
    await panel.addInitScript((initial) => {
      const listeners: Array<(message: { type: string }) => void> = []
      Object.defineProperty(globalThis, 'chrome', { value: { runtime: {
        sendMessage: async () => ({ ok: true, state: initial }),
        onMessage: { addListener: (callback: (message: { type: string }) => void) => { listeners.push(callback) } },
      } } })
      globalThis.__semanticRefresh = () => { listeners.forEach((callback) => { callback({ type: 'dsh-state-changed' }) }) }
    }, state)
    await panel.route('http://127.0.0.1:47654/**', async (route) => {
      const file = resolve(extension, `.${new URL(route.request().url()).pathname}`)
      const contentType = ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(file)] ?? 'application/octet-stream'
      try { await route.fulfill({ body: await readFile(file), contentType }) } catch { await route.fulfill({ status: 404, body: '' }) }
    })
    await panel.goto('http://127.0.0.1:47654/sidebar.html')
    await panel.locator('[data-view="cognition"]').click()
    const topic = panel.locator('[data-semantic-node="topic"]'); await topic.focus(); await panel.keyboard.press('Enter')
    await panel.locator('[data-source-ref="block-0"]').click(); await panel.locator('.semantic-source').waitFor()
    await panel.locator('.semantic-source').evaluate((element) => {
      ;(globalThis as typeof globalThis & { __semanticPrevious?: Element }).__semanticPrevious = element
    })
    await panel.evaluate('globalThis.__semanticRefresh()')
    await expect.poll(async () => panel.locator('.semantic-source').evaluate((element) => {
      return element !== (globalThis as typeof globalThis & { __semanticPrevious?: Element }).__semanticPrevious
    })).toBe(true)
    const sourceBack = panel.locator('.semantic-source [data-semantic-back]'); await sourceBack.focus(); await panel.keyboard.press('Enter')
    expect(await panel.locator('[data-source-ref="block-0"]').evaluate(element => document.activeElement === element)).toBe(true)
    await panel.locator('[data-source-ref="block-0"]').evaluate((element) => {
      ;(globalThis as typeof globalThis & { __semanticPrevious?: Element }).__semanticPrevious = element
    })
    await panel.evaluate('globalThis.__semanticRefresh()')
    await expect.poll(async () => panel.locator('[data-source-ref="block-0"]').evaluate((element) => {
      return element !== (globalThis as typeof globalThis & { __semanticPrevious?: Element }).__semanticPrevious
    })).toBe(true)
    const focusBack = panel.locator('.semantic-focus [data-semantic-back]'); await focusBack.focus(); await panel.keyboard.press('Enter')
    await panel.locator('.semantic-overview').waitFor()
    expect(await topic.evaluate(element => document.activeElement === element)).toBe(true)
  } finally { await browser.close() }
})
