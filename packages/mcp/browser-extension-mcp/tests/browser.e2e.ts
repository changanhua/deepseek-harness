/** Real extension + built stdio MCP. No DSH Host is started in this test. */
import { randomBytes, randomUUID } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  value: {
    tabs: TestPage[]
    text: string
    textScope?: string
    structure?: unknown
    page: TestPage
    elements: {
      text: string
      label: string
      value?: string
      valueTruncated?: boolean
      valueRedacted?: boolean
      snapshotId: string
      elementId: string
    }[]
  }
}

it('reads, clicks and reads back through Codex while DSH is absent', async () => {
  const root = await mkdtemp(join(homedir(), 'browser-connector-e2e-'))
  const extension = join(root, 'extension')
  const repo = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
  const source = process.env.BROWSER_CONNECTOR_EXTENSION_SOURCE ?? join(repo, 'apps/chrome-extension')
  let context: BrowserContext | undefined
  let relay: Awaited<ReturnType<typeof startBrowserRelay>> | undefined
  const client = new Client({ name: 'real-browser-test', version: '1' })
  const createdIssues: { title: string; body: string }[] = []
  const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    const location = new URL(req.url ?? '/', 'http://fixture.test')
    const issuePath = '/team/repo/issues'
    if (location.pathname.startsWith(issuePath)) {
      if (req.method === 'POST' && location.pathname === `${issuePath}/new`) {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const form = new URLSearchParams(Buffer.concat(chunks).toString())
        createdIssues.push({ title: form.get('title') ?? '', body: (form.get('body') ?? '').replaceAll('\r\n', '\n') })
        res.writeHead(303, { location: `${issuePath}/1` }); res.end(); return
      }
      if (location.pathname === issuePath) {
        const q = location.searchParams.get('q') ?? ''
        res.end(`<!doctype html><title>Issue search</title><main><h1>Issues</h1>${['open', 'closed'].map(state => `<a href="${issuePath}?q=${encodeURIComponent(`${q} state:${state}`)}">${state} (0)</a>`).join('')}<a href="${issuePath}/new">New issue</a></main>`)
        return
      }
      if (location.pathname === `${issuePath}/new`) {
        res.end(`<!doctype html><title>New Issue</title><form method="post" action="${issuePath}/new"><label>Title<input name="title"></label><label>Body<textarea name="body"></textarea></label><button type="submit">Create issue</button></form>`)
        return
      }
      const issue = createdIssues.at(-1)
      res.end(`<!doctype html><title>Issue detail</title><h1>${escape(issue?.title ?? '')}</h1><article>${escape(issue?.body ?? '')}</article>`)
      return
    }
    if (req.url?.startsWith('/enter-proof')) {
      res.end('<!doctype html><title>Enter navigation proof</title><form action="/enter-proof"><input name="q" aria-label="Search"></form><p>Search page</p>')
      return
    }
    res.end('<!doctype html><title>Independent connector proof</title><nav>Unrelated navigation</nav><main><h1>Original page evidence</h1><p id="count">Clicks: 0</p><button onclick="this.dataset.n=String(Number(this.dataset.n||0)+1);document.querySelector(\'#count\').textContent=\'Clicks: \'+this.dataset.n">Count once</button><form><h2>Issue draft</h2><input aria-label="Title"><textarea aria-label="Body"></textarea><input aria-label="Password" type="password" value="NEVER_EXPOSE_PASSWORD"></form><p style="margin-top:1400px">End of page</p></main>')
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
      return (response.structuredContent as { result?: unknown } | undefined)?.result as TestResult
    }
    const status = await call('browser_status')
    expect(status).toMatchObject({ connector: { mcp: { version: '0.3.1', modulePath: expect.stringContaining('lib'), processId: expect.any(Number) },
      relay: { version: '0.3.1' } }, instances: [{ online: true, runtime: { version: '0.6.1' } }], issues: [] })
    const installationId = status.instances.find(entry => entry.online)?.installationId
    if (!installationId) throw new Error('No online extension')
    const opened = await call('browser_open_tab', { installationId, requestId: randomUUID(), url })
    expect(opened.value).toMatchObject({ opened: true, tab: { tabId: expect.any(Number), windowId: expect.any(Number) } })
    const openedTab = (opened.value as unknown as { tab: { tabId: number; windowId: number; browserSessionId: string } }).tab
    const openedTabId = openedTab.tabId
    await expect.poll(async () => {
      const response = await client.callTool({ name: 'browser_tabs', arguments: { installationId } })
      if (response.isError) return false
      const result = (response.structuredContent as { result?: unknown } | undefined)?.result as TestResult
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
    const observerKey = `__suspendedViewport_${randomUUID().replaceAll('-', '')}`
    // A background renderer can withhold viewport observer callbacks while ordinary DOM reads work.
    await worker.evaluate((key) => {
      const api = (globalThis as unknown as { chrome: { debugger: {
        sendCommand: (target: object, method: string, params?: { functionDeclaration?: string }) => Promise<unknown>
      } } }).chrome.debugger
      const original = api.sendCommand.bind(api)
      ;(globalThis as unknown as Record<string, unknown>)[key] = () => { api.sendCommand = original }
      api.sendCommand = (target, method, params) => method === 'Runtime.callFunctionOn'
        && params?.functionDeclaration?.includes('IntersectionObserver')
        ? new Promise(() => {}) : original(target, method, params)
    }, observerKey)
    try {
      await call('browser_act', { installationId, action: { kind: 'click', intent: 'Verify one test-page click',
        element: { page, snapshotId: button.snapshotId, elementId: button.elementId } } })
    } finally {
      await worker.evaluate((key) => {
        const scope = globalThis as unknown as Record<string, unknown>
        const restore = scope[key]
        if (typeof restore === 'function') restore()
        Reflect.deleteProperty(scope, key)
      }, observerKey)
    }
    await expect.poll(() => site.locator('#count').textContent()).toBe('Clicks: 1')
    const after = await call('browser_read_page', { installationId, tabId: tab.tabId, url, documentId: page.documentId })
    expect(after.value.text).toContain('Clicks: 1')
    const title = after.value.elements.find(element => element.label === 'Title')!
    const body = after.value.elements.find(element => element.label === 'Body')!
    const formTitle = '浏览器平台：子页面接续与显式多页面任务范围'
    const formBody = '  扩展已经能报告子页面候选。\n\n验收要求：\n- Agent 明确选择。\n- 读取后接纳。  '
    for (const [field, value] of [[title, formTitle], [body, formBody]] as const) {
      await call('browser_act', { installationId, action: { kind: 'fill', intent: '填写本地测试草稿', value,
        element: { page: after.value.page, snapshotId: field.snapshotId, elementId: field.elementId } } })
    }
    const form = await call('browser_read_page', { installationId, tabId: tab.tabId, url, documentId: page.documentId,
      query: 'Issue draft', includeValues: true, structure: false })
    expect(form.value).toMatchObject({ textScope: 'matched-controls' })
    expect(form.value.structure).toBeUndefined()
    expect(form.value.elements.find(element => element.label === 'Title')).toMatchObject({ value: formTitle, valueTruncated: false })
    expect(form.value.elements.find(element => element.label === 'Body')).toMatchObject({ value: formBody, valueTruncated: false })
    expect(form.value.elements.find(element => element.label === 'Password')).toMatchObject({ valueRedacted: true })
    expect(JSON.stringify(form)).not.toContain('Unrelated navigation')
    expect(JSON.stringify(form)).not.toContain('NEVER_EXPOSE_PASSWORD')
    await expect(site.locator('input[aria-label="Title"]').inputValue()).resolves.toBe(formTitle)
    await expect(site.locator('textarea').inputValue()).resolves.toBe(formBody)
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
    const interruptedResult = (interrupted.structuredContent as { result?: unknown } | undefined)?.result as {
      outcome: string
      reason?: string
    }
    expect(interrupted.isError).toBe(true)
    expect(interruptedResult).toMatchObject({ outcome: 'unknown' })
    await expect.poll(async () => (await message({ type: 'dsh-assistant-state' })).state.codexConnection.phase).toBe('connected')
    const recoveredStatus = await client.callTool({ name: 'browser_request_status', arguments: { installationId, requestId: interruptedRequestId } })
    const recoveredStatusResult = (recoveredStatus.structuredContent as { result?: unknown } | undefined)?.result as {
      outcome: string
      reason?: string
    }
    expect(recoveredStatus.isError).toBe(true)
    expect(recoveredStatusResult).toMatchObject({ outcome: 'unknown' })
    const retriedOpen = await client.callTool({ name: 'browser_open_tab', arguments: {
      installationId, requestId: interruptedRequestId, url: interruptedUrl,
    } })
    const retriedResult = (retriedOpen.structuredContent as { result?: unknown } | undefined)?.result as {
      outcome: string
      reason?: string
    }
    expect(retriedOpen.isError).toBe(true)
    expect(retriedResult).toMatchObject({ outcome: 'unknown' })
    expect(context.pages().filter(candidate => candidate.url() === interruptedUrl)).toHaveLength(1)
    expect((await call('browser_read_page', { installationId, tabId: tab.tabId, url, expectedTab: openedTab })).value.text).toContain('Clicks: 1')
    await message({ type: 'dsh-assistant-cancel' })
    expect((await call('browser_read_page', { installationId, tabId: tab.tabId, url })).value.text).toContain('Clicks: 1')
    const searchUrl = `http://127.0.0.1:${address.port}/enter-proof`
    await call('browser_act', { installationId, action: { kind: 'navigate', page, url: searchUrl } })
    const searchPage = (await call('browser_read_page', { installationId, tabId: tab.tabId, url: searchUrl })).value
    const searchInput = searchPage.elements.find(element => element.label === 'Search')!
    const reference = { page: searchPage.page, snapshotId: searchInput.snapshotId, elementId: searchInput.elementId }
    await call('browser_act', { installationId, action: { kind: 'fill', element: reference, value: 'needle', intent: '填写搜索' } })
    const pressed = await call('browser_act', { installationId, action: {
      kind: 'press', element: reference, key: 'Enter', intent: '搜索后读取新文档',
    } })
    expect(pressed).toMatchObject({ outcome: 'observed', quiescent: true, value: {
      input: 'press', businessOutcome: 'unverified', transition: { sameTab: { kind: 'document-replaced' } },
    } })
    expect(site.url()).toBe(`${searchUrl}?q=needle`)
    const replacement = (await call('browser_read_page', { installationId, tabId: tab.tabId, url: `${searchUrl}?q=needle` })).value
    expect(replacement.page.documentId).not.toBe(searchPage.page.documentId)
    expect(replacement.text).toContain('Search page')
    const flowSource = await readFile(join(repo, '.agents/skills/github-issues/scripts/issue-flow.js'), 'utf8')
    const flowModel = JSON.parse(await readFile(join(repo, '.agents/skills/github-issues/references/application-model.json'), 'utf8'))
    const flow = new Function(`${flowSource}\nreturn runGitHubIssueFlow`)()
    const flowResult = await flow({
      read: (target: TestPage, includeValues: boolean) => call('browser_read_page', { installationId, ...target, includeValues, limit: 128, textLimit: 16000 }),
      act: (action: unknown) => call('browser_act', { installationId, action }),
      status: (requestId: string) => call('browser_request_status', { installationId, requestId }),
    }, flowModel, { repository: `http://127.0.0.1:${address.port}/team/repo`, page: replacement.page,
      title: 'Callable application flow', body: '  First line\n\nSecond line  ', submit: true })
    expect(flowResult, JSON.stringify(flowResult)).toMatchObject({ status: 'submitted-readback-required',
      detailUrl: `http://127.0.0.1:${address.port}/team/repo/issues/1` })
    expect(createdIssues).toEqual([{ title: 'Callable application flow', body: '  First line\n\nSecond line  ' }])
    await expect(site.locator('h1').textContent()).resolves.toBe('Callable application flow')
    await expect(site.locator('article').textContent()).resolves.toBe('  First line\n\nSecond line  ')
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
