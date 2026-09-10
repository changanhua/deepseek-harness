import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

interface FixturePage { tabId: number; frameId: number; documentId: string; url: string }
interface FixtureElement { snapshotId: string; elementId: string; text: string; attributes: { id?: string } }
interface SnapshotValue { page: FixturePage; elements: FixtureElement[] }
interface Receipt { outcome: string; value?: unknown; reason?: string }
interface ChromeFacade {
  tabs: { query(options: object): Promise<Array<{ id: number; url: string }>> }
  webNavigation: { getAllFrames(options: { tabId: number }): Promise<Array<{ frameId: number; url: string }>> }
  scripting: { executeScript(options: { target: { tabId: number }; func: () => void }): Promise<unknown> }
}
interface Executor { execute(request: object, signal: AbortSignal): Promise<Receipt> }
interface ExecutorModule { createBrowserExecutor: (options: object) => Executor }
interface DriverModule { createPuppeteerDriver: (options: object) => unknown }
interface FixtureTransport { send: (message: string) => void }
interface PuppeteerModule { connect: unknown; ExtensionTransport: { connectTab: (tabId: number) => Promise<FixtureTransport> } }

it('the loaded extension uses Puppeteer trusted input on exact nodes, including open shadow DOM', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-puppeteer-'))
  const extension = resolve('apps/chrome-extension')
  const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html')
    if (req.url === '/frame') { res.end('<button id="frame-button" onclick="this.textContent=event.isTrusted">Frame</button>'); return }
    res.end(`<!doctype html>
    <button id="read">Read</button><output id="result"></output><input id="field"><output id="input-result"></output>
    <input id="number" type="number" value="123"><input id="email" type="email" value="old@example.test">
    <div id="shadow"></div><iframe src="/frame"></iframe><script>
    let clicks = 0;
    read.onclick = e => { clicks++; document.querySelector('#result').textContent = 'clicked:' + e.isTrusted; read.dataset.clicks = clicks };
    read.onmousedown = () => { read.dataset.downs = Number(read.dataset.downs || 0) + 1 };
    read.onmouseup = () => { read.dataset.ups = Number(read.dataset.ups || 0) + 1 };
    field.oninput = e => { document.querySelector('#input-result').textContent = e.target.value + ':' + e.isTrusted };
    const shadow = document.querySelector('#shadow').attachShadow({mode:'open'});
    shadow.innerHTML = '<button>Shadow button</button>';
    shadow.querySelector('button').onclick = e => { document.querySelector('#result').textContent = 'shadow:' + e.isTrusted };
    document.querySelector('iframe').src = location.origin.replace('127.0.0.1', 'localhost') + '/frame';
    </script>`) })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture server did not listen')
  const base = `http://127.0.0.1:${address.port}`
  let context
  try {
    context = await chromium.launchPersistentContext(join(root, 'chrome'), { channel: 'chromium', headless: true,
      ...(process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH } : {}),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--site-per-process'] })
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
    const panel = await context.newPage()
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidebar.html`)
    const initialState: { ok: boolean; state: { browserEngine: string } } = await panel.evaluate('chrome.runtime.sendMessage({type:"dsh-assistant-state"})')
    expect(initialState).toMatchObject({ ok: true, state: { browserEngine: 'puppeteer' } })
    const compatibilityState: { ok: boolean; state: { browserEngine: string } } = await panel.evaluate('chrome.runtime.sendMessage({type:"dsh-assistant-browser-engine",engine:"dom"})')
    expect(compatibilityState).toMatchObject({ ok: true, state: { browserEngine: 'dom' } })
    await panel.evaluate('chrome.runtime.sendMessage({type:"dsh-assistant-browser-engine",engine:"puppeteer"})')
    const fixture = await context.newPage()
    await fixture.goto(base)
    await panel.evaluate(`Promise.all(['src/browser-executor.js', 'src/browser-puppeteer.js', 'vendor/puppeteer.js']
      .map(path => import(chrome.runtime.getURL(path)))).then(modules => { globalThis.driverModules = modules })`)
    // The test grants only its fixture origin. It exercises the production
    // executor and generated Puppeteer bundle, with no DSH/model service.
    const result = await panel.evaluate(async (base) => {
      const { chrome, driverModules } = globalThis as typeof globalThis & {
        chrome: ChromeFacade
        driverModules: [ExecutorModule, DriverModule, PuppeteerModule]
      }
      const [{ createBrowserExecutor }, { createPuppeteerDriver }, { connect, ExtensionTransport }] = driverModules
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === base + '/')
      if (!tab) throw new Error('fixture tab missing')
      const grant = { installationId: 'test-install', grantEpoch: 1, origins: [base, base.replace('127.0.0.1', 'localhost')], scopes: ['browser:read', 'browser:write'] }
      const executor = createBrowserExecutor({ chromeApi: chrome, getGrant: () => grant,
        puppeteer: createPuppeteerDriver({ chromeApi: chrome, connect, ExtensionTransport, actionTimeoutMs: 750 }) })
      let serial = 0
      const request = (payload: { kind: string; [key: string]: unknown }, page?: FixturePage) => ({ protocolVersion: 1, ...grant, requestId: `request-${++serial}`,
        sessionId: 'test-session', fingerprint: `fingerprint-${serial}`, deadline: Date.now() + 15000,
        mutates: !['snapshot', 'prepare'].includes(payload.kind), payload,
        ...(page ? { target: { tabId: page.tabId, frameId: page.frameId, documentId: page.documentId } } : {}) })
      const run = (value: object) => executor.execute(value, new AbortController().signal)
      const perform = async (kind: string, id: string, value?: string, frameId = 0) => {
        const snapshot = await run(request({ kind: 'snapshot', tabId: tab.id, frameId }))
        if (snapshot.outcome !== 'observed') return { snapshot }
        const data = snapshot.value as SnapshotValue
        const page = data.page
        const el = data.elements.find(el => el.attributes.id === id || el.text === id)
        if (!el) return { missing: id, snapshot }
        const action = { kind, intent: 'fixture', element: { page, snapshotId: el.snapshotId, elementId: el.elementId }, ...(value === undefined ? {} : { value }) }
        const prepared = await run(request({ kind: 'prepare', action }, page))
        if (prepared.outcome !== 'observed') return { prepared }
        const committed = request({ kind: 'commit', action, preparationId: (prepared.value as { preparationId: string }).preparationId }, page)
        const first = await run(committed)
        const duplicate = await run(committed)
        return { first, duplicate }
      }
      const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id })
      const child = frames.find(frame => frame.url.endsWith('/frame'))
      if (!child) throw new Error('fixture frame missing')
      const frameId = child.frameId
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
        const feed = document.createElement('section'); feed.id = 'feed'
        feed.innerHTML = Array.from({ length: 140 }, (_, i) => `<article><h2>测评${i}</h2><button>阅读全文</button></article>`).join('')
        feed.addEventListener('click', (event) => {
          if (!(event.target instanceof HTMLButtonElement)) return
          event.target.textContent = '已展开'; feed.dataset.selected = event.target.parentElement?.querySelector('h2')?.textContent ?? ''
        })
        document.body.append(feed)
      } })
      const found = await run(request({ kind: 'snapshot', tabId: tab.id, frameId: 0, query: '测评139', limit: 4, textLimit: 0 }))
      const foundData = found.value as SnapshotValue
      if (foundData.elements.length !== 1) throw new Error('semantic search did not find the unique card')
      const selected = foundData.elements[0]!
      const readingAction = { kind: 'click', intent: '展开测评139', element: { page: foundData.page, snapshotId: selected.snapshotId, elementId: selected.elementId } }
      const readingPrepared = await run(request({ kind: 'prepare', action: readingAction }, foundData.page))
      const reading = await run(request({ kind: 'commit', action: readingAction,
        preparationId: (readingPrepared.value as { preparationId: string }).preparationId }, foundData.page))
      const readingAfter = await run(request({ kind: 'snapshot', tabId: tab.id, frameId: 0, query: '测评139', textLimit: 0 }))
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
        document.body.dataset.selected = document.querySelector<HTMLElement>('#feed')?.dataset.selected
        document.querySelector('#feed')?.remove()
      } })
      const success = { click: await perform('click', 'read'), fill: await perform('fill', 'field', '中文 Puppeteer'),
        shadow: await perform('click', 'Shadow button'), number: await perform('fill', 'number', '42'),
        email: await perform('fill', 'email', 'new@example.test'), frame: await perform('click', 'frame-button', undefined, frameId) }
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
        const overlay = document.createElement('div'); overlay.id = 'test-overlay'
        overlay.style.cssText = 'position:fixed;inset:0;background:white;z-index:999999'
        document.body.append(overlay)
      } })
      const covered = await perform('click', 'read')
      const coveredFrame = await perform('click', 'frame-button', undefined, frameId)
      const snapshot = await run(request({ kind: 'snapshot', tabId: tab.id, frameId: 0 }))
      const data = snapshot.value as SnapshotValue
      const page = data.page, el = data.elements.find(el => el.attributes.id === 'read')
      if (!el) throw new Error('fixture button missing')
      const action = { kind: 'click', intent: 'cancel fixture', element: { page, snapshotId: el.snapshotId, elementId: el.elementId } }
      const prepared = await run(request({ kind: 'prepare', action }, page))
      const controller = new AbortController()
      const timer = setTimeout(() => { controller.abort() }, 200)
      const stopped = await executor.execute(request({ kind: 'commit', action, preparationId: (prepared.value as { preparationId: string }).preparationId }, page), controller.signal)
      clearTimeout(timer)
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { document.querySelector('#test-overlay')?.remove() } })
      const pressedController = new AbortController()
      const pressExecutor = createBrowserExecutor({ chromeApi: chrome, getGrant: () => grant,
        puppeteer: createPuppeteerDriver({ chromeApi: chrome, connect, ExtensionTransport: {
          connectTab: async (tabId: number) => {
            const transport = await ExtensionTransport.connectTab(tabId), send = transport.send.bind(transport)
            transport.send = (message: string) => {
              const packet = JSON.parse(message) as { method: string; params?: { type?: string } }
              send(message)
              if (packet.method === 'Input.dispatchMouseEvent' && packet.params?.type === 'mousePressed') pressedController.abort()
            }
            return transport
          },
        } }),
      })
      const pressPrepared = await run(request({ kind: 'prepare', action }, page))
      const pressed = await pressExecutor.execute(request({ kind: 'commit', action,
        preparationId: (pressPrepared.value as { preparationId: string }).preparationId }, page), pressedController.signal)
      return { ...success, covered, coveredFrame, stopped, pressed, reading, readingAfter }
    }, base)
    expect(result, JSON.stringify(result)).toMatchObject({
      click: { first: { outcome: 'observed', value: { engine: 'puppeteer' } }, duplicate: { outcome: 'observed' } },
      fill: { first: { outcome: 'observed', value: { engine: 'puppeteer' } } },
      shadow: { first: { outcome: 'observed', value: { engine: 'puppeteer' } } },
      number: { first: { outcome: 'observed' } }, email: { first: { outcome: 'observed' } },
      frame: { first: { outcome: 'observed' } },
      covered: { first: { outcome: 'failed', reason: 'target_not_actionable', quiescent: true } },
      coveredFrame: { first: { outcome: 'failed', reason: 'target_not_actionable', quiescent: true } },
      stopped: { outcome: 'cancelled', quiescent: true },
      pressed: { outcome: 'unknown', quiescent: true },
      reading: { outcome: 'observed' },
      readingAfter: { outcome: 'observed', value: { text: '', elements: [{ context: '测评139', label: '已展开' }] } },
    })
    expect(await fixture.locator('body').getAttribute('data-selected')).toBe('测评139')
    expect(await fixture.locator('#result').textContent()).toBe('clicked:true')
    expect(await fixture.locator('#input-result').textContent()).toBe('中文 Puppeteer:true')
    expect(await fixture.locator('#number').inputValue()).toBe('42')
    expect(await fixture.locator('#email').inputValue()).toBe('new@example.test')
    expect(await fixture.frameLocator('iframe').locator('button').textContent()).toBe('true')
    expect(await fixture.locator('#read').getAttribute('data-clicks')).toBe('2')
    expect(await fixture.locator('#read').getAttribute('data-downs')).toBe('2')
    expect(await fixture.locator('#read').getAttribute('data-ups')).toBe('2')
  } finally {
    await context?.close()
    await new Promise<void>((done) => { server.close(() => { done() }) })
    await rm(root, { recursive: true, force: true })
  }
})
