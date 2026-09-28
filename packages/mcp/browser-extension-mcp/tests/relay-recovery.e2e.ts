/** Real extension recovery after its isolated relay loses volatile grants. */
import { randomBytes, randomUUID } from 'node:crypto'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { expect, it } from 'vitest'
import { startBrowserRelay } from '../src/relay.ts'

interface TabReference { tabId: number; windowId: number; browserSessionId: string }
interface PageReference { tabId: number; frameId: number; documentId: string; url: string }
interface Result {
  requestId?: string
  instances?: { installationId: string; online: boolean }[]
  outcome?: string
  reason?: string
  value?: {
    tab?: TabReference
    tabs?: Array<TabReference & { url: string }>
    text?: string
    page?: PageReference
    elements?: Array<{ text: string; snapshotId: string; elementId: string }>
  }
}
interface AssistantState {
  ok: boolean
  state: { codexConnection: { phase: string; installationId: string | null } }
}

it('re-pairs one real extension after relay restart, but preserves revocation and unknown-write boundaries', async () => {
  const root = await mkdtemp(join(homedir(), 'browser-relay-recovery-e2e-'))
  const extension = join(root, 'extension')
  const repo = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
  let context: BrowserContext | undefined
  let relay: Awaited<ReturnType<typeof startBrowserRelay>> | undefined
  let panel: Page | undefined
  const client = new Client({ name: 'relay-recovery-proof', version: '1' })
  const site = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<!doctype html><title>Relay recovery proof</title><main><h1>Relay recovery page</h1><p id="count">Clicks: 0</p><button onclick="this.dataset.n=String(Number(this.dataset.n||0)+1);document.querySelector(\'#count\').textContent=\'Clicks: \'+this.dataset.n">Count once</button></main>')
  })
  try {
    await cp(process.env.BROWSER_CONNECTOR_EXTENSION_SOURCE ?? join(repo, 'apps/chrome-extension'), extension, { recursive: true })
    await new Promise<void>((done) => { site.listen(0, '127.0.0.1', done) })
    const address = site.address()
    if (!address || typeof address === 'string') throw new Error('site_listener_missing')
    const url = `http://127.0.0.1:${address.port}/recovery`
    context = await chromium.launchPersistentContext(join(root, 'profile'), {
      channel: 'chromium', headless: true,
      ...(process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH } : {}),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    })
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15_000 })
    const observationKey = `__relayRecoveryObservation_${randomUUID().replaceAll('-', '')}`
    await worker.evaluate((key) => {
      const scope = globalThis as typeof globalThis & Record<string, unknown>
      const observation = { connectorSockets: 0, suppressResults: false, suppressedResults: 0 }
      const WebSocket = globalThis.WebSocket
      class ObservedWebSocket extends WebSocket {
        constructor(...args: ConstructorParameters<typeof WebSocket>) {
          if (new URL(String(args[0])).pathname === '/api/browser-extension/v1/ws') observation.connectorSockets += 1
          super(...args)
        }
      }
      const send = WebSocket.prototype.send
      ObservedWebSocket.prototype.send = function (data: Parameters<typeof send>[0]) {
        try {
          if (observation.suppressResults && JSON.parse(typeof data === 'string' ? data : '')?.type === 'result') {
            observation.suppressedResults += 1
            return
          }
        } catch { /* Non-JSON frames retain their original transport behavior. */ }
        return send.call(this, data)
      }
      globalThis.WebSocket = ObservedWebSocket
      scope[key] = observation
    }, observationKey)
    const observation = () => worker.evaluate((key) => {
      const value = (globalThis as typeof globalThis & Record<string, unknown>)[key]
      if (!value || typeof value !== 'object') throw new Error('worker_observation_missing')
      return structuredClone(value)
    }, observationKey) as Promise<{ connectorSockets: number; suppressResults: boolean; suppressedResults: number }>
    expect(await observation()).toMatchObject({ connectorSockets: 0 })
    const extensionId = new URL(worker.url()).host
    const initial = { port: 0, secret: randomBytes(32).toString('base64url'), extensionIds: [extensionId] }
    relay = await startBrowserRelay(initial)
    const relayPort = relay.port
    const configPath = join(root, 'connector.json')
    await writeFile(configPath, JSON.stringify({ ...initial, port: relayPort }))
    panel = await context.newPage()
    await panel.goto(`chrome-extension://${extensionId}/sidebar.html`)
    const message = (value: Record<string, unknown>) => panel!.evaluate<AssistantState>(`chrome.runtime.sendMessage(${JSON.stringify(value)})`)
    expect(await message({ type: 'dsh-codex-browser-configure', baseUrl: `http://127.0.0.1:${relayPort}` })).toMatchObject({ ok: true })
    await Promise.all(Array.from({ length: 3 }, () => message({ type: 'dsh-codex-browser-connect' })))
    await expect.poll(async () => (await message({ type: 'dsh-assistant-state' })).state.codexConnection.phase).toBe('connected')
    expect(await observation()).toMatchObject({ connectorSockets: 1 })

    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [join(repo, 'packages/mcp/browser-extension-mcp/lib/startup.js')], env: { ...env, BROWSER_CONNECTOR_CONFIG: configPath }, stderr: 'pipe' }))
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const response = await client.callTool({ name, arguments: args })
      expect(response.isError, JSON.stringify(response.structuredContent)).not.toBe(true)
      return (response.structuredContent as { result: Result }).result
    }
    const status = await call('browser_status')
    const installationId = status.instances?.find(instance => instance.online)?.installationId
    if (!installationId) throw new Error('extension_not_connected')
    const opened = await call('browser_open_tab', { installationId, requestId: randomUUID(), url })
    if (!opened.value?.tab) throw new Error('opened_tab_missing')
    await expect.poll(() => context?.pages().some(page => page.url() === url)).toBe(true)
    const beforeRestart = await call('browser_read_page', { installationId, tabId: opened.value.tab.tabId, url, expectedTab: opened.value.tab })
    expect(beforeRestart.value?.text).toContain('Clicks: 0')
    const control = beforeRestart.value?.elements?.find(element => element.text === 'Count once')
    if (!control || !beforeRestart.value?.page) throw new Error('click_control_missing')
    const sitePage = context.pages().find(page => page.url() === url)
    if (!sitePage) throw new Error('fixture_page_missing')
    await worker.evaluate((key) => {
      ((globalThis as typeof globalThis & Record<string, { suppressResults: boolean }>)[key]!).suppressResults = true
    }, observationKey)
    const pendingClick = client.callTool({ name: 'browser_act', arguments: { installationId, action: { kind: 'click', intent: 'Prove one unknown write is not replayed',
      element: { page: beforeRestart.value.page, snapshotId: control.snapshotId, elementId: control.elementId } } } })
    // A failed assertion may close the client before the pending reply is awaited.
    void pendingClick.catch(() => {})
    await expect.poll(() => sitePage.locator('#count').textContent()).toBe('Clicks: 1')
    await expect.poll(async () => (await observation()).suppressedResults).toBeGreaterThanOrEqual(1)
    await relay.close()
    const interrupted = await pendingClick
    expect(interrupted.isError).toBe(true)
    const interruptedReceipt = (interrupted.structuredContent as { result: Result }).result
    expect(interruptedReceipt).toMatchObject({ outcome: 'unknown' })
    expect(['connector_stopped', 'connector_result_unavailable']).toContain(interruptedReceipt.reason)
    const requestId = interruptedReceipt.requestId
    expect(requestId).toBeTypeOf('string')
    relay = await startBrowserRelay({ ...initial, port: relayPort })
    await expect.poll(async () => (await message({ type: 'dsh-assistant-state' })).state.codexConnection.phase, { timeout: 30_000 }).toBe('connected')
    expect(await observation()).toMatchObject({ connectorSockets: 3 })
    await worker.evaluate((key) => {
      ((globalThis as typeof globalThis & Record<string, { suppressResults: boolean }>)[key]!).suppressResults = false
    }, observationKey)
    const recoveredStatus = await call('browser_status')
    expect(recoveredStatus.instances).toContainEqual(expect.objectContaining({ installationId, online: true }))
    const tabs = await call('browser_tabs', { installationId })
    const freshTab = tabs.value?.tabs?.find(tab => tab.tabId === opened.value?.tab?.tabId)
    if (!freshTab) throw new Error('recovered_tab_missing')
    const freshRead = await call('browser_read_page', { installationId, tabId: freshTab.tabId, url })
    expect(freshRead.value?.text).toContain('Relay recovery page')
    expect(freshRead.value?.text).toContain('Clicks: 1')
    const afterRestartStatus = await client.callTool({ name: 'browser_request_status', arguments: { installationId, requestId } })
    const afterRestartReceipt = (afterRestartStatus.structuredContent as { result: Result }).result
    expect(afterRestartReceipt.outcome).toBe('observed')
    const missing = await client.callTool({ name: 'browser_request_status', arguments: { installationId, requestId: randomUUID() } })
    expect((missing.structuredContent as { result: Result }).result).toMatchObject({ outcome: 'unknown', reason: 'receipt_unavailable' })
    expect(await sitePage.locator('#count').textContent()).toBe('Clicks: 1')

    await relay.close()
    relay = await startBrowserRelay({ ...initial, port: relayPort, revokedInstallationIds: [installationId] })
    await expect.poll(async () => (await message({ type: 'dsh-assistant-state' })).state.codexConnection.phase, { timeout: 30_000 }).toBe('unauthorized')
    const revokedStatus = await client.callTool({ name: 'browser_status', arguments: {} })
    expect(revokedStatus.isError).toBe(false)
    expect((revokedStatus.structuredContent as { result: Result }).result).toMatchObject({ issues: [{ component: 'extension', code: 'no_connected_installation' }] })

    const cdp = await context.newCDPSession(panel)
    await cdp.send('ServiceWorker.enable')
    await cdp.send('ServiceWorker.stopAllWorkers')
    await expect.poll(async () => (await message({ type: 'dsh-assistant-state' })).state.codexConnection.phase).toBe('unauthorized')
    expect(await message({ type: 'dsh-codex-browser-connect' })).toMatchObject({ ok: true })
    await expect.poll(async () => (await message({ type: 'dsh-assistant-state' })).state.codexConnection.phase).toBe('unauthorized')
  } finally {
    await client.close()
    await context?.close()
    await relay?.close()
    await new Promise<void>((done) => { site.close(() => done()); site.closeAllConnections() })
    const target = resolve(root)
    if (dirname(target) !== resolve(homedir()) || !basename(target).startsWith('browser-relay-recovery-e2e-')) throw new Error('unsafe_cleanup')
    await rm(target, { recursive: true, force: true })
  }
}, 150_000)
