/** REAL Loader composition: scoped browser tools drive a target-free task through the loaded extension. */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { cp, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

type ToolResult = { outcome?: string; taskId?: string; status?: string; value?: Record<string, unknown> }
type ExtensionState = { connection: { phase: string; grant?: { installationId: string } }; session: { binding: unknown } }

const tool = async (scaffold: WebScaffold, agent: Agent, name: string, arguments_: Record<string, unknown>): Promise<ToolResult> => {
  const result = await scaffold.ctx.agents.withInitiator(agent, () => scaffold.ctx.tools.execute({
    agent, name, arguments: arguments_, callId: ToolCallId(`${name}-${randomUUID()}`), signal: new AbortController().signal,
  }))
  expect(result.isError, JSON.stringify(result)).toBe(false)
  if (result.isError) throw new Error(`Browser tool failed: ${name}`)
  expect(result.value).toBeTypeOf('object')
  return result.value as ToolResult
}

describe('web e2e: browser platform target-free bootstrap', () => {
  let scaffold: WebScaffold
  let context: BrowserContext
  let panel: Page
  let root = ''
  let siteUrl = ''
  let closeSite: (() => Promise<void>) | undefined
  let setupStage = 'launch DSH scaffold'

  const state = async (): Promise<ExtensionState> => {
    const result = await panel.evaluate< { ok: boolean; state: ExtensionState }>('chrome.runtime.sendMessage({ type: "dsh-assistant-state" })')
    expect(result.ok).toBe(true)
    return result.state
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ deepSeekMissingCredential: true })
    setupStage = 'copy extension'
    root = await mkdtemp(join(tmpdir(), 'dsh-browser-platform-bootstrap-'))
    const extension = join(root, 'extension')
    await cp(join(process.cwd(), 'apps/chrome-extension'), extension, { recursive: true })
    const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8')) as Record<string, unknown>
    manifest.host_permissions = ['http://127.0.0.1/*']
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest))
    const site = createServer((_request, response) => {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end('<!doctype html><title>Bootstrap target</title><main><p id="result" data-clicks="0">Before click</p><button id="commit" onclick="const result=document.querySelector(\'#result\');result.textContent=\'After click\';result.dataset.clicks=String(Number(result.dataset.clicks)+1)">Commit change</button></main>')
    })
    await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve))
    const address = site.address()
    if (!address || typeof address === 'string') throw new Error('bootstrap_site_listener_missing')
    siteUrl = `http://127.0.0.1:${address.port}/bootstrap`
    closeSite = async () => new Promise<void>((resolve) => { site.close(() => resolve()); site.closeAllConnections() })
    setupStage = 'launch Chromium'
    context = await chromium.launchPersistentContext(join(root, 'profile'), { channel: 'chromium', headless: true,
      ...(process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH } : {}),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] })
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15_000 })
    setupStage = 'open extension panel'
    panel = await context.newPage()
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidebar.html`)
    await context.request.get(scaffold.authenticatedUrl)
    setupStage = 'connect extension'
    expect((await panel.evaluate('chrome.runtime.sendMessage({ type: "dsh-assistant-configure", baseUrl: ' + JSON.stringify(scaffold.baseUrl) + ' })')).ok).toBe(true)
    const connected = await panel.evaluate('chrome.runtime.sendMessage({ type: "dsh-assistant-connect", origins: [' + JSON.stringify(new URL(siteUrl).origin) + '] })')
    expect(connected.ok, JSON.stringify(connected)).toBe(true)
    if ((await state()).connection.phase === 'pending') {
      setupStage = 'approve extension'
      let owner = context.pages().find(candidate => candidate.url().startsWith(`${scaffold.baseUrl}/browser-assistant?`))
      if (owner === undefined) {
        const approval = context.waitForEvent('page', { timeout: 30_000 })
        expect((await panel.evaluate('chrome.runtime.sendMessage({ type: "dsh-assistant-open-approval" })')).ok).toBe(true)
        owner = await approval
      }
      await owner.getByRole('button', { name: '允许所选权限', exact: true }).click()
    }
    await vi.waitFor(async () => {
      if ((await state()).connection.phase === 'pending') {
        expect((await panel.evaluate('chrome.runtime.sendMessage({ type: "dsh-assistant-poll" })')).ok).toBe(true)
      }
      expect((await state()).connection.phase).toBe('connected')
    }, { timeout: 15_000 })
    setupStage = 'connected'
  }, 120_000)

  afterAll(async () => {
    if (setupStage !== 'connected') process.stdout.write(`Browser bootstrap setup stopped at: ${setupStage}\n`)
    await context?.close()
    await closeSite?.()
    await scaffold?.close()
    if (root) {
      const target = resolve(root)
      if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('dsh-browser-platform-bootstrap-')) throw new Error('unsafe bootstrap cleanup')
      await rm(target, { recursive: true, force: true })
    }
  })

  it('keeps one task and a null user binding through opening, adoption, click, readback, and verified completion', async () => {
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId(`browser-platform-bootstrap-${randomUUID()}`), meta: { cwd: scaffold.workspaceCwd },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'browser-assistant').then(() => undefined),
    })
    try {
      handle.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: `Open ${siteUrl} and click Commit change.` }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      const installationId = (await state()).connection.grant?.installationId
      if (!installationId) throw new Error('extension grant missing')
      const started = await tool(scaffold, handle.agent, 'browser_task_start', { installationId, goal: 'Click Commit change on the supplied page.',
        success: { text: 'After click' } })
      const tasks = scaffold.ctx.browserTasks
      expect(tasks.get(handle.agent)?.target).toBeUndefined()
      expect(tasks.get(handle.agent)?.budget.actionsUsed).toBe(0)
      const opened = await tool(scaffold, handle.agent, 'browser_action', { installationId, action: { kind: 'tab_open', url: siteUrl } })
      expect(opened).toMatchObject({ outcome: 'observed', value: { opened: true, tab: { browserSessionId: expect.any(String) } } })
      const openedTab = opened.value?.tab as { tabId: number; windowId: number; browserSessionId: string }
      await tool(scaffold, handle.agent, 'browser_task_verify', {})
      expect(tasks.get(handle.agent)).toMatchObject({ id: started.taskId,
        target: { installationId, page: { tabId: openedTab.tabId } }, budget: { actionsUsed: 2 } })
      expect(tasks.readTarget(handle.agent).binding).toBeNull()
      const snapshot = await tool(scaffold, handle.agent, 'browser_snapshot', { installationId, tabId: openedTab.tabId, frameId: 0, expectedTab: openedTab })
      const element = (snapshot.value?.elements as Array<{ text?: string; snapshotId: string; elementId: string }>).find(value => value.text === 'Commit change')
      if (!element) throw new Error('commit element missing from fresh snapshot')
      const page = snapshot.value?.page as { tabId: number; frameId: number; documentId: string; url: string }
      const clicked = await tool(scaffold, handle.agent, 'browser_action', { installationId, action: { kind: 'click', intent: 'Commit the requested change',
        element: { page, snapshotId: element.snapshotId, elementId: element.elementId } } })
      expect(clicked.outcome).toBe('observed')
      const readback = await tool(scaffold, handle.agent, 'browser_snapshot', { installationId, tabId: page.tabId, frameId: page.frameId, documentId: page.documentId })
      expect(readback.value?.text).toContain('After click')
      expect(await tool(scaffold, handle.agent, 'browser_task_verify', {})).toMatchObject({ status: 'verified' })
      const task = tasks.get(handle.agent)
      expect(task).toMatchObject({ phase: 'terminal', outcome: 'completed' })
      expect(task?.id).toBe(started.taskId)
      expect(task?.budget.actionsUsed).toBe(task?.attempts.length)
      expect(task?.budget.actionsUsed).toBeGreaterThan(2)
      expect(tasks.readTarget(handle.agent).binding).toBeNull()
      const resultNode = context.pages().find(candidate => candidate.url() === siteUrl)?.locator('#result')
      expect(await resultNode?.textContent()).toBe('After click')
      expect(await resultNode?.getAttribute('data-clicks')).toBe('1')

    } finally {
      await handle.dispose()
    }
  }, 120_000)

  it('refuses input from an adopted task after the user clears the target selection', async () => {
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId(`browser-platform-clear-${randomUUID()}`), meta: { cwd: scaffold.workspaceCwd },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'browser-assistant').then(() => undefined),
    })
    try {
      const url = siteUrl + '?case=clear'
      handle.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: `Open ${url} and click Commit change.` }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      const installationId = (await state()).connection.grant!.installationId
      await tool(scaffold, handle.agent, 'browser_task_start', { installationId, goal: 'Click Commit change.', success: { text: 'After click' } })
      await tool(scaffold, handle.agent, 'browser_action', { installationId, action: { kind: 'tab_open', url } })
      await tool(scaffold, handle.agent, 'browser_task_verify', {})
      const tasks = scaffold.ctx.browserTasks
      const page = tasks.get(handle.agent)!.target!.page
      const snapshot = await tool(scaffold, handle.agent, 'browser_snapshot', { installationId, ...page })
      const element = (snapshot.value?.elements as Array<{ text?: string; snapshotId: string; elementId: string }>).find(value => value.text === 'Commit change')!
      tasks.clearTargetByUser(handle.agent, tasks.readTarget(handle.agent).revision)
      const refused = await tool(scaffold, handle.agent, 'browser_action', { installationId, action: { kind: 'click', intent: 'Input after user cleared target',
        element: { page, snapshotId: element.snapshotId, elementId: element.elementId } } })
      expect(refused).toMatchObject({ outcome: 'failed', delivery: 'not-sent' })
      const resultNode = context.pages().find(candidate => candidate.url() === url)?.locator('#result')
      expect(await resultNode?.getAttribute('data-clicks')).toBe('0')
    } finally { await handle.dispose() }
  }, 120_000)
})
