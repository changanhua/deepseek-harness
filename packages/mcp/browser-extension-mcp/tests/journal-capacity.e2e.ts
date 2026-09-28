/** Capacity recovery through the shipping worker and MCP, without replacing its browser profile. */
import { randomBytes, randomUUID } from 'node:crypto'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { chromium, type BrowserContext } from 'playwright'
import { expect, it } from 'vitest'
import { startBrowserRelay } from '../src/relay.ts'

type PageRef = { tabId: number; frameId: number; documentId: string; url: string }
type Result = { outcome?: string
  reason?: string
  value: {
    tab?: { tabId: number; windowId: number; browserSessionId: string }
    page?: PageRef
    text?: string
    elements?: { text: string; elementId: string; snapshotId: string }[]
    admission?: { executed: boolean; recheckAt: number | null }
  }
}

it('rejects a full journal before input and resumes after retention in the same installation', async () => {
  const root = await mkdtemp(join(homedir(), 'browser-capacity-e2e-'))
  const extension = join(root, 'extension')
  const repo = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
  let context: BrowserContext | undefined
  let relay: Awaited<ReturnType<typeof startBrowserRelay>> | undefined
  const client = new Client({ name: 'capacity-proof', version: '1' })
  const site = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<!doctype html><title>Capacity proof</title><p id="count">0</p><button onclick="const n=document.querySelector(\'#count\');n.textContent=String(Number(n.textContent)+1)">Count once</button>')
  })
  try {
    await cp(join(repo, 'apps/chrome-extension'), extension, { recursive: true })
    await new Promise<void>((resolve) => { site.listen(0, '127.0.0.1', resolve) })
    const address = site.address()
    if (!address || typeof address === 'string') throw new Error('site_not_listening')
    const url = `http://127.0.0.1:${address.port}/capacity`
    context = await chromium.launchPersistentContext(join(root, 'profile'), { channel: 'chromium', headless: true,
      ...(process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH } : {}),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    })
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15000 })
    const config = { port: 0, secret: randomBytes(32).toString('base64url'), extensionIds: [new URL(worker.url()).host] }
    relay = await startBrowserRelay(config)
    const configPath = join(root, 'connector.json')
    await writeFile(configPath, JSON.stringify({ ...config, port: relay.port }))
    const panel = await context.newPage()
    await panel.goto(`chrome-extension://${config.extensionIds[0]}/sidebar.html`)
    const message = (value: Record<string, unknown>) => panel.evaluate<{ ok: boolean; state: { codexConnection: { phase: string } } }>(
      `chrome.runtime.sendMessage(${JSON.stringify(value)})`,
    )
    expect(await message({ type: 'dsh-codex-browser-configure', baseUrl: `http://127.0.0.1:${relay.port}` })).toMatchObject({ ok: true })
    expect(await message({ type: 'dsh-codex-browser-connect' })).toMatchObject({ ok: true })
    await expect.poll(async () => (await message({ type: 'dsh-assistant-state' })).state.codexConnection.phase).toBe('connected')
    const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [join(repo, 'packages/mcp/browser-extension-mcp/lib/startup.js')], env: { ...env, BROWSER_CONNECTOR_CONFIG: configPath }, stderr: 'pipe' }))
    const status = await client.callTool({ name: 'browser_status', arguments: {} })
    const installationId = ((status.structuredContent as { result?: unknown } | undefined)?.result as {
      instances: { installationId: string; online: boolean }[]
    })
      .instances.find(item => item.online)?.installationId
    if (!installationId) throw new Error('installation_missing')
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await client.callTool({ name, arguments: { installationId, ...args } })
      expect(response.isError, JSON.stringify(response.structuredContent)).not.toBe(true)
      return (response.structuredContent as { result?: unknown } | undefined)?.result as Result
    }
    const opened = await call('browser_open_tab', { requestId: randomUUID(), url })
    if (!opened.value.tab) throw new Error('tab_missing')
    await expect.poll(() => context?.pages().some(page => page.url() === url)).toBe(true)
    const actualPage = context.pages().find(page => page.url() === url)
    if (!actualPage) throw new Error('page_missing')
    const read = await call('browser_read_page', { tabId: opened.value.tab.tabId, url, expectedTab: opened.value.tab })
    const control = read.value.elements?.find(element => element.text === 'Count once')
    if (!control || !read.value.page) throw new Error('control_missing')
    const action = { kind: 'click', intent: 'Count one controlled test effect',
      element: { page: read.value.page, elementId: control.elementId, snapshotId: control.snapshotId } }
    // One open plus 63 clicks fills the production limit with unexpired write receipts.
    for (let count = 0; count < 63; count++) await call('browser_act', { action })
    expect(await actualPage.locator('#count').textContent()).toBe('63')
    const denied = await client.callTool({ name: 'browser_act', arguments: { installationId, action } })
    const rejection = (denied.structuredContent as { result?: unknown } | undefined)?.result as Result
    expect(denied.isError).toBe(true)
    expect(rejection).toMatchObject({ outcome: 'failed', reason: 'journal_capacity',
      value: { admission: { executed: false, recheckAt: expect.any(Number) } } })
    expect(await actualPage.locator('#count').textContent()).toBe('63')
    const checkAt = rejection.value.admission?.recheckAt
    if (typeof checkAt !== 'number' || checkAt <= Date.now() || checkAt - Date.now() > 80_000) throw new Error('invalid_recheck_time')
    await new Promise(resolve => setTimeout(resolve, checkAt - Date.now() + 100))
    const after = await call('browser_read_page', { tabId: read.value.page.tabId, url, documentId: read.value.page.documentId })
    expect(after.value.text).toContain('63')
    expect(await actualPage.locator('#count').textContent()).toBe('63')
    expect((await message({ type: 'dsh-assistant-state' })).state.codexConnection.phase).toBe('connected')
  } finally {
    await client.close()
    await context?.close()
    await relay?.close()
    await new Promise<void>((resolve) => { site.close(() => { resolve() }); site.closeAllConnections() })
    const target = resolve(root)
    if (dirname(target) !== resolve(homedir()) || !basename(target).startsWith('browser-capacity-e2e-')) throw new Error('unsafe_cleanup')
    await rm(target, { recursive: true, force: true })
  }
}, 130_000)
