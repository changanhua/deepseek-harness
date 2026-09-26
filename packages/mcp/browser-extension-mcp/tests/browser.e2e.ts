/** Real extension + built stdio MCP. No DSH Host is started in this test. */
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

interface TestPage { tabId: number; frameId: number; documentId: string; url: string }
interface TestResult {
  instances: { installationId: string; online: boolean }[]
  value: { tabs: TestPage[]; text: string; page: TestPage; elements: { text: string; snapshotId: string; elementId: string }[] }
}

it('reads, clicks and reads back through Codex while DSH is absent', async () => {
  const root = await mkdtemp(join(homedir(), 'browser-connector-e2e-'))
  const extension = join(root, 'extension')
  const repo = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
  const source = process.env.BROWSER_CONNECTOR_EXTENSION_SOURCE ?? join(repo, 'apps/chrome-extension')
  let context: BrowserContext | undefined
  let relay: Awaited<ReturnType<typeof startBrowserRelay>> | undefined
  const client = new Client({ name: 'real-browser-test', version: '1' })
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<!doctype html><title>Independent connector proof</title><main><h1>Original page evidence</h1><p id="count">Clicks: 0</p><button onclick="this.dataset.n=String(Number(this.dataset.n||0)+1);document.querySelector(\'#count\').textContent=\'Clicks: \'+this.dataset.n">Count once</button><p style="margin-top:1400px">End of page</p></main>')
  })
  try {
    await cp(source, extension, { recursive: true })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('site_listener_missing')
    const url = `http://127.0.0.1:${address.port}/proof`
    context = await chromium.launchPersistentContext(join(root, 'profile'), {
      channel: 'chromium', headless: true,
      ...(process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH } : {}),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    })
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15000 })
    const extensionId = new URL(worker.url()).host
    const config = { port: 0, secret: randomBytes(32).toString('base64url'), extensionIds: [extensionId] }
    relay = await startBrowserRelay(config)
    const configPath = join(root, 'config.json')
    await writeFile(configPath, JSON.stringify({ ...config, port: relay.port }))
    const panel = await context.newPage()
    await panel.goto(`chrome-extension://${extensionId}/sidebar.html`)
    const message = (value: Record<string, unknown>) => panel.evaluate<{
      ok: boolean
      state: { codexConnection: { phase: string }; connection: { phase: string } }
    }>(`chrome.runtime.sendMessage(${JSON.stringify(value)})`)
    expect(await message({ type: 'dsh-codex-browser-configure', baseUrl: `http://127.0.0.1:${relay.port}` })).toMatchObject({ ok: true })
    expect(await message({ type: 'dsh-codex-browser-connect' })).toMatchObject({ ok: true })
    await expect.poll(async () => (await message({ type: 'dsh-assistant-state' })).state.codexConnection.phase).toBe('connected')
    expect((await message({ type: 'dsh-assistant-state' })).state.connection.phase).not.toBe('connected')
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    env.BROWSER_CONNECTOR_CONFIG = configPath
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [join(repo, 'packages/mcp/browser-extension-mcp/lib/startup.js')], env, stderr: 'pipe' }))
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const response = await client.callTool({ name, arguments: args })
      expect(response.isError, JSON.stringify(response.structuredContent)).not.toBe(true)
      return response.structuredContent?.result as unknown as TestResult
    }
    const status = await call('browser_status')
    const installationId = status.instances.find(entry => entry.online)?.installationId
    if (!installationId) throw new Error('No online extension')
    const opened = await call('browser_open_tab', { installationId, requestId: randomUUID(), url })
    expect(opened.value).toMatchObject({ opened: true, tab: { tabId: expect.any(Number), windowId: expect.any(Number) } })
    const openedTab = (opened.value as unknown as { tab: { tabId: number; windowId: number; browserSessionId: string } }).tab
    const openedTabId = openedTab.tabId
    await expect.poll(async () => {
      const response = await client.callTool({ name: 'browser_tabs', arguments: { installationId } })
      if (response.isError) return false
      const result = response.structuredContent?.result as unknown as TestResult
      return result.value.tabs.some(candidate => candidate.tabId === openedTabId && candidate.url === url)
    }).toBe(true)
    const tabs = await call('browser_tabs', { installationId })
    const tab = tabs.value.tabs.find(tab => tab.tabId === openedTabId)
    if (!tab) throw new Error('Opened test page missing from tabs')
    expect(tab.url).toBe(url)
    await expect.poll(() => context?.pages().some(page => page.url() === url)).toBe(true)
    const site = context.pages().find(page => page.url() === url)
    if (!site) throw new Error('Opened test page is unavailable to Playwright')
    const read = await call('browser_read_page', { installationId, tabId: tab.tabId, url, expectedTab: openedTab })
    expect(read.value.text).toContain('Original page evidence')
    expect(read.value.text).toContain('Clicks: 0')
    const button = read.value.elements.find(element => element.text === 'Count once')
    if (!button) throw new Error('Test button missing from snapshot')
    const page = read.value.page
    await call('browser_act', { installationId, action: { kind: 'click', intent: 'Verify one test-page click',
      element: { page, snapshotId: button.snapshotId, elementId: button.elementId } } })
    await expect.poll(() => site.locator('#count').textContent()).toBe('Clicks: 1')
    const after = await call('browser_read_page', { installationId, tabId: tab.tabId, url, documentId: page.documentId })
    expect(after.value.text).toContain('Clicks: 1')
    const interruptedUrl = `http://127.0.0.1:${address.port}/open-recovery-${randomUUID()}`
    const interruptedRequestId = randomUUID()
    const pauseKey = `__browserConnectorPause_${randomUUID().replaceAll('-', '')}`
    await worker.evaluate((key) => {
      const tabs = (globalThis as unknown as { chrome: { tabs: { create: (...args: unknown[]) => Promise<unknown> } } }).chrome.tabs
      const create = tabs.create.bind(tabs)
      const state: { release?: () => void } = {}
      ;(globalThis as unknown as Record<string, unknown>)[key] = state
      tabs.create = async (...args: unknown[]) => {
        const tab = await create(...args)
        await new Promise<void>((resolve) => { state.release = resolve })
        return tab
      }
    }, pauseKey)
    const interruptedOpen = client.callTool({ name: 'browser_open_tab', arguments: {
      installationId, requestId: interruptedRequestId, url: interruptedUrl,
    } })
    await expect.poll(() => context?.pages().filter(candidate => candidate.url() === interruptedUrl).length).toBe(1)
    const cdp = await context.newCDPSession(panel)
    await cdp.send('ServiceWorker.enable')
    await cdp.send('ServiceWorker.stopAllWorkers')
    const interrupted = await interruptedOpen
    const interruptedResult = interrupted.structuredContent?.result as unknown as { outcome: string; reason?: string }
    expect(interrupted.isError).toBe(true)
    expect(interruptedResult).toMatchObject({ outcome: 'unknown' })
    await expect.poll(async () => (await message({ type: 'dsh-assistant-state' })).state.codexConnection.phase).toBe('connected')
    const recoveredStatus = await client.callTool({ name: 'browser_request_status', arguments: { installationId, requestId: interruptedRequestId } })
    const recoveredStatusResult = recoveredStatus.structuredContent?.result as unknown as { outcome: string; reason?: string }
    expect(recoveredStatus.isError).toBe(true)
    expect(recoveredStatusResult).toMatchObject({ outcome: 'unknown' })
    const retriedOpen = await client.callTool({ name: 'browser_open_tab', arguments: {
      installationId, requestId: interruptedRequestId, url: interruptedUrl,
    } })
    const retriedResult = retriedOpen.structuredContent?.result as unknown as { outcome: string; reason?: string }
    expect(retriedOpen.isError).toBe(true)
    expect(retriedResult).toMatchObject({ outcome: 'unknown' })
    expect(context.pages().filter(candidate => candidate.url() === interruptedUrl)).toHaveLength(1)
    expect((await call('browser_read_page', { installationId, tabId: tab.tabId, url, expectedTab: openedTab })).value.text).toContain('Clicks: 1')
    await message({ type: 'dsh-assistant-cancel' })
    expect((await call('browser_read_page', { installationId, tabId: tab.tabId, url })).value.text).toContain('Clicks: 1')
    await panel.screenshot({ path: join(repo, '.artifacts/browser-connector-panel.png'), fullPage: true })
  } finally {
    await client.close()
    await context?.close()
    await relay?.close()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }); server.closeAllConnections() })
    const target = resolve(root)
    if (dirname(target) !== resolve(homedir()) || !basename(target).startsWith('browser-connector-e2e-')) throw new Error('unsafe_cleanup')
    await rm(target, { recursive: true, force: true })
  }
}, 90000)
