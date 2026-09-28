/** The MCP input path causes navigation; independent browser reads verify its result. */
import { randomBytes, randomUUID } from 'node:crypto'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type BrowserContext } from 'playwright'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { expect, it } from 'vitest'
import { startBrowserRelay } from '../src/relay.ts'

interface PageRef { tabId: number; frameId: number; documentId: string; url: string }
interface TabRef { tabId: number; windowId: number; browserSessionId: string }
interface Result {
  requestId: string
  outcome: string
  instances?: { installationId: string; online: boolean }[]
  value: {
    tab: TabRef
    tabs: (TabRef & { url: string })[]
    page: PageRef
    text: string
    elements: { text: string; snapshotId: string; elementId: string }[]
    transition?: {
      source: { page: PageRef; tab: TabRef }
      sameTab: { kind: string; page?: PageRef }
      candidates: { tab: TabRef; url?: string; relation: string; attribution: string }[]
      truncated: boolean
    }
  }
}

it('reports navigation and child candidates without replaying or choosing a foreground tab', async () => {
  const root = await mkdtemp(join(homedir(), 'browser-transitions-e2e-'))
  const repo = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
  const extension = join(root, 'extension')
  let context: BrowserContext | undefined
  let relay: Awaited<ReturnType<typeof startBrowserRelay>> | undefined
  const client = new Client({ name: 'transition-proof', version: '1' })
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    if (req.url === '/redirect') { res.writeHead(302, { location: '/destination' }); res.end(); return }
    res.end(req.url === '/source'
      ? `<!doctype html><title>Transition source</title><main>
        <a href="/redirect">Navigate once</a>
        <button onclick="window.open('/child-a');window.open('/child-b')">Open two children</button>
        <button onclick="history.pushState({},'', '/route');document.querySelector('h1').textContent='Route updated'">Change route</button>
        <h1>Source document</h1></main>`
      : `<!doctype html><title>Transition result</title><h1>${req.url === '/destination' ? 'Destination reached' : 'Child page'}</h1>`)
  })
  try {
    await cp(join(repo, 'apps/chrome-extension'), extension, { recursive: true })
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('listener_missing')
    const base = `http://127.0.0.1:${address.port}`
    context = await chromium.launchPersistentContext(join(root, 'profile'), {
      channel: 'chromium', headless: true,
      ...(process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH } : {}),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-popup-blocking'],
    })
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15000 })
    const extensionId = new URL(worker.url()).host
    const config = { port: 0, secret: randomBytes(32).toString('base64url'), extensionIds: [extensionId] }
    relay = await startBrowserRelay(config)
    const configPath = join(root, 'config.json')
    await writeFile(configPath, JSON.stringify({ ...config, port: relay.port }))
    const panel = await context.newPage()
    await panel.goto(`chrome-extension://${extensionId}/sidebar.html`)
    const message = (input: Record<string, unknown>) => panel.evaluate<{
      ok: boolean
      state: { codexConnection: { phase: string } }
    }>(`chrome.runtime.sendMessage(${JSON.stringify(input)})`)
    expect(await message({ type: 'dsh-codex-browser-configure', baseUrl: `http://127.0.0.1:${relay.port}` })).toMatchObject({ ok: true })
    expect(await message({ type: 'dsh-codex-browser-connect' })).toMatchObject({ ok: true })
    await expect.poll(async () => (await message({ type: 'dsh-assistant-state' })).state.codexConnection.phase).toBe('connected')
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    env.BROWSER_CONNECTOR_CONFIG = configPath
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [join(repo, 'packages/mcp/browser-extension-mcp/lib/startup.js')], env, stderr: 'pipe' }))
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const response = await client.callTool({ name, arguments: args })
      expect(response.isError, JSON.stringify(response.structuredContent)).not.toBe(true)
      return (response.structuredContent as { result?: unknown } | undefined)?.result as Result
    }
    const installationId = (await call('browser_status')).instances?.find(item => item.online)?.installationId
    if (!installationId) throw new Error('extension_offline')
    const openSource = async () => {
      const opened = (await call('browser_open_tab', { installationId, requestId: randomUUID(), url: `${base}/source` })).value.tab
      await expect.poll(async () => (await call('browser_tabs', { installationId })).value.tabs.find(tab => tab.tabId === opened.tabId)?.url).toBe(`${base}/source`)
      return (await call('browser_read_page', { installationId, tabId: opened.tabId, url: `${base}/source`, expectedTab: opened })).value
    }
    const click = (read: Result['value'], label: string) => {
      const element = read.elements.find(item => item.text === label)
      if (!element) throw new Error(`missing_control:${label}`)
      return call('browser_act', { installationId, action: { kind: 'click', intent: label,
        element: { page: read.page, snapshotId: element.snapshotId, elementId: element.elementId } } })
    }
    const navigationSource = await openSource()
    const navigation = await click(navigationSource, 'Navigate once')
    expect(navigation.value.transition).toMatchObject({ source: { page: navigationSource.page },
      sameTab: { kind: 'document-replaced', page: { tabId: navigationSource.page.tabId, url: `${base}/destination` } }, candidates: [] })
    const destination = (await call('browser_read_page', { installationId, tabId: navigationSource.page.tabId, url: `${base}/destination` })).value
    expect(destination.text).toContain('Destination reached')
    expect(destination.page.documentId).not.toBe(navigationSource.page.documentId)
    expect(await context.pages().find(page => page.url() === `${base}/destination`)?.locator('h1').textContent()).toBe('Destination reached')
    const oldElement = navigationSource.elements.find(item => item.text === 'Navigate once')!
    const stale = await client.callTool({ name: 'browser_act', arguments: { installationId, action: {
      kind: 'click', intent: 'Reject old document', element: { page: navigationSource.page, snapshotId: oldElement.snapshotId, elementId: oldElement.elementId },
    } } })
    expect(stale.isError).toBe(true)

    const routeSource = await openSource()
    const route = await click(routeSource, 'Change route')
    expect(route.value.transition).toMatchObject({ sameTab: { kind: 'same-document', page: {
      tabId: routeSource.page.tabId, documentId: routeSource.page.documentId, url: `${base}/route`,
    } } })
    expect((await call('browser_read_page', { installationId, tabId: routeSource.page.tabId, url: `${base}/route` })).value.text).toContain('Route updated')

    const popupSource = await openSource()
    const popup = await click(popupSource, 'Open two children')
    const candidates = popup.value.transition?.candidates ?? []
    expect(candidates).toHaveLength(2)
    expect(candidates.map(item => item.url).sort()).toEqual([`${base}/child-a`, `${base}/child-b`])
    for (const candidate of candidates) {
      expect(candidate).toMatchObject({ relation: 'opener', attribution: 'candidate', tab: { browserSessionId: expect.any(String), windowId: expect.any(Number) } })
      expect((await call('browser_read_page', { installationId, tabId: candidate.tab.tabId, url: candidate.url, expectedTab: candidate.tab })).value.text).toContain('Child page')
    }
    const recovery = await call('browser_request_status', { installationId, requestId: popup.requestId })
    expect(recovery.value.transition).toEqual(popup.value.transition)
    expect(context.pages().filter(page => /^\/child-[ab]$/u.test(new URL(page.url()).pathname))).toHaveLength(2)
  } finally {
    await client.close()
    await context?.close()
    await relay?.close()
    await new Promise<void>((done) => { server.close(() => done()); server.closeAllConnections() })
    if (dirname(resolve(root)) !== resolve(homedir()) || !basename(root).startsWith('browser-transitions-e2e-')) throw new Error('unsafe_cleanup')
    await rm(root, { recursive: true, force: true })
  }
}, 90000)
