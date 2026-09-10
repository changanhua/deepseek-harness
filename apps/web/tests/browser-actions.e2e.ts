import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

interface FixturePage { tabId: number; frameId: number; documentId: string; url: string }
interface FixtureElement { snapshotId: string; elementId: string; attributes: { id?: string } }
interface FixtureSnapshot { page: FixturePage; elements: FixtureElement[] }
interface Receipt { outcome: string; reason?: string; value?: unknown }
interface Payload { kind: string; action?: Payload; [key: string]: unknown }
interface ChromeFacade {
  tabs: { query(options: object): Promise<Array<{ id: number; url: string }>>; get(id: number): Promise<{ status: string }> }
}
type Perform = (kind: string, id?: string, extra?: object, tabId?: number) => Promise<Receipt>
interface FixtureScope {
  chrome: ChromeFacade
  modules: [
    { createBrowserExecutor: (options: object) => { execute(request: object, signal: AbortSignal): Promise<Receipt> } },
    { createPuppeteerDriver: (options: object) => unknown },
    { connect: unknown; ExtensionTransport: unknown },
  ]
  perform: Perform
}

it('runs the extended action set through the loaded extension and checks browser effects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-actions-'))
  const file = join(root, 'fixture.txt'); await writeFile(file, 'upload fixture')
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.end(`<!doctype html><title>${req.url}</title><style>#drag,#drop {width:100px;height:60px;background:#eee;margin:10px}</style>
      <button id="double" ondblclick="this.dataset.done='yes'">Double</button>
      <button id="right" oncontextmenu="event.preventDefault();this.dataset.done='yes'">Right</button>
      <button id="hover" onmouseenter="this.dataset.done='yes'">Hover</button>
      <input id="key" onkeydown="this.dataset.key=event.key"><input id="check" type="checkbox">
      <input id="redirect-focus" onfocus="document.querySelector('#other-focus').focus()"><input id="other-focus" onkeydown="this.dataset.key=event.key">
      <select id="select"><option value="a">A</option><option value="b">B</option></select><input id="upload" type="file">
      <form onsubmit="event.preventDefault();this.dataset.done='yes'"><button id="submit">Submit</button></form>
      <div id="drag" draggable="true" tabindex="0" ondragstart="event.dataTransfer.setData('text/plain','fixture')">Drag</div>
      <div id="drop" tabindex="0" ondragover="event.preventDefault()" ondrop="event.preventDefault();this.dataset.done=event.dataTransfer.getData('text/plain')">Drop</div>
      <div style="height:2000px">Space</div>`)
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('missing server address')
  const base = `http://127.0.0.1:${address.port}`, extension = resolve('apps/chrome-extension')
  let context
  try {
    context = await chromium.launchPersistentContext(join(root, 'chrome'), { channel: 'chromium', headless: true,
      ...(process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH } : {}),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] })
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
    const panel = await context.newPage(); await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidebar.html`)
    const fixture = await context.newPage(); await fixture.goto(base + '/one')
    await panel.evaluate('Promise.all(["src/browser-executor.js","src/browser-puppeteer.js","vendor/puppeteer.js"].map(path=>import(chrome.runtime.getURL(path)))).then(value=>globalThis.modules=value)')
    // Executed in the extension origin against its production driver, not Playwright actions.
    const outcomes = await panel.evaluate(async ({ base, file }) => {
      const scope = globalThis as typeof globalThis & FixtureScope
      const chrome = scope.chrome
      const [{ createBrowserExecutor }, { createPuppeteerDriver }, { connect, ExtensionTransport }] = scope.modules
      const tab = (await chrome.tabs.query({})).find((tab: { url: string }) => tab.url === base + '/one')
      if (!tab) throw new Error('fixture tab missing')
      const grant = { installationId: 'fixture', grantEpoch: 1, scopes: ['browser:read', 'browser:write'], origins: [base] }
      const executor = createBrowserExecutor({ chromeApi: chrome, getGrant: () => grant,
        puppeteer: createPuppeteerDriver({ chromeApi: chrome, connect, ExtensionTransport, actionTimeoutMs: 3000 }) })
      let counter = 0
      const run = (payload: Payload, page?: FixturePage) => executor.execute({ protocolVersion: 1, ...grant,
        requestId: `fixture-${++counter}`, sessionId: 'session', fingerprint: `${counter}`, deadline: Date.now() + 15000,
        mutates: !['prepare', 'snapshot', 'wait', 'screenshot'].includes(payload.kind === 'commit' ? payload.action!.kind : payload.kind),
        payload, ...(page ? { target: { tabId: page.tabId, frameId: page.frameId, documentId: page.documentId } } : {}),
      }, new AbortController().signal)
      const perform = async (kind: string, id?: string, extra = {}, tabId = tab.id) => {
        const snapshot = await run({ kind: 'snapshot', tabId, frameId: 0 })
        const data = snapshot.value as FixtureSnapshot, page = data.page
        const reference = (id: string) => {
          const element = data.elements.find(element => element.attributes.id === id)
          if (!element) throw new Error(`missing element ${id}`)
          return { page, snapshotId: element.snapshotId, elementId: element.elementId }
        }
        const action = { kind, ...(id ? { element: reference(id), intent: 'fixture' } : { page }), ...extra,
          ...(kind === 'drag' ? { target: reference('drop') } : {}) }
        const prepared = await run({ kind: 'prepare', action }, page)
        if (prepared.outcome !== 'observed') return prepared
        return run({ kind: 'commit', action, preparationId: (prepared.value as { preparationId: string }).preparationId }, page)
      }
      const results: Record<string, Receipt> = {}
      scope.perform = perform
      for (const [kind, id, extra] of [
        ['double_click', 'double', {}], ['right_click', 'right', {}], ['hover', 'hover', {}],
        ['press', 'key', { key: 'ArrowDown' }], ['select', 'select', { values: ['b'] }],
        ['check', 'check', { checked: true }], ['upload', 'upload', { files: [file] }],
        ['submit', 'submit', {}], ['drag', 'drag', {}],
      ] as const) results[kind] = await perform(kind, id, extra)
      results.screenshot = await perform('screenshot')
      results.scroll = await perform('scroll', undefined, { x: 0, y: 500 })
      results.wait = await perform('wait', undefined, { milliseconds: 20 })
      return results
    }, { base, file })
    for (const [kind, result] of Object.entries(outcomes)) expect(result.outcome, `${kind}: ${JSON.stringify(result).slice(0, 500)}`).toBe('observed')
    expect(await fixture.locator('#double').getAttribute('data-done')).toBe('yes')
    expect(await fixture.locator('#right').getAttribute('data-done')).toBe('yes')
    expect(await fixture.locator('#hover').getAttribute('data-done')).toBe('yes')
    expect(await fixture.locator('#key').getAttribute('data-key')).toBe('ArrowDown')
    expect(await fixture.locator('#select').inputValue()).toBe('b')
    expect(await fixture.locator('#check').isChecked()).toBe(true)
    expect(await fixture.locator('#upload').evaluate((node: HTMLInputElement) => node.files?.[0]?.name)).toBe('fixture.txt')
    expect(await fixture.locator('form').getAttribute('data-done')).toBe('yes')
    expect(await fixture.locator('#drop').getAttribute('data-done')).toBe('fixture')
    expect(await fixture.evaluate(() => scrollY)).toBe(500)
    expect((outcomes.screenshot?.value as { screenshot: { data: string } }).screenshot.data.length).toBeGreaterThan(100)
    const navigation = await panel.evaluate(async (base) => {
      const { perform, chrome } = globalThis as typeof globalThis & FixtureScope
      const navigate = await perform('navigate', undefined, { url: base + '/two' })
      const back = await perform('back'), forward = await perform('forward'), reload = await perform('reload')
      const opened = await perform('tab_open', undefined, { url: base + '/three' })
      const tabId = (opened.value as { tabId: number }).tabId
      // Wait for Chrome's tab creation navigation to expose its document.
      for (let i = 0; i < 50; i++) {
        if ((await chrome.tabs.get(tabId)).status === 'complete') break
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      const focused = await perform('tab_focus', undefined, {}, tabId)
      const closed = await perform('tab_close', undefined, {}, tabId)
      const absent = !(await chrome.tabs.query({})).some((tab: { id: number }) => tab.id === tabId)
      return { navigate, back, forward, reload, opened, focused, closed, absent }
    }, base)
    expect(navigation).toMatchObject({ navigate: { outcome: 'observed' }, back: { outcome: 'observed' },
      forward: { outcome: 'observed' }, reload: { outcome: 'observed' }, opened: { outcome: 'observed' },
      focused: { outcome: 'observed' }, closed: { outcome: 'observed' }, absent: true })
    expect(fixture.url()).toBe(base + '/two')
    const redirectedFocus = await panel.evaluate(() => (globalThis as typeof globalThis & FixtureScope).perform('press', 'redirect-focus', { key: 'Enter' }))
    expect(redirectedFocus.outcome).toBe('unknown')
    expect(await fixture.locator('#other-focus').getAttribute('data-key')).toBeNull()
    await fixture.goto(base.replace('127.0.0.1', 'localhost') + '/private')
    await fixture.goto(base + '/two')
    const deniedHistory = await panel.evaluate(() => (globalThis as typeof globalThis & FixtureScope).perform('back'))
    expect(deniedHistory).toMatchObject({ outcome: 'failed', reason: 'site_not_authorized' })
    expect(fixture.url()).toBe(base + '/two')
  } finally {
    await context?.close()
    await new Promise<void>(done => server.close(() => { done() }))
    await rm(root, { recursive: true, force: true })
  }
})
