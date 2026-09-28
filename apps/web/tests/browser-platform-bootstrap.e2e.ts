/** REAL Loader composition: scoped browser tools drive a target-free task through the loaded extension. */
import { createServer } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { cp, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createToolResultMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BrowserSnapshotBindings } from '../../../packages/browser/tool-browser/src/types.ts'
import type { BrowserPage, BrowserTabReference } from '@changanhua/dsh-browser'
import { SessionId } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { startBrowserRelay } from '../../../packages/mcp/browser-extension-mcp/src/relay.ts'
import { connectBrowserTestClient } from '../../../packages/mcp/browser-extension-mcp/tests/client.ts'

type ToolResult = {
  requestId?: string
  sessionId?: string
  installationId?: string
  outcome?: string
  taskId?: string
  pluginId?: string
  packageId?: string
  pluginRunId?: string
  status?: string
  value?: Record<string, unknown>
  observation?: Record<string, unknown>
}
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
  const createdIssues: { title: string; body: string }[] = []
  let closeSite: (() => Promise<void>) | undefined
  let setupStage = 'launch DSH scaffold'

  const state = async (): Promise<ExtensionState> => {
    const result = await panel.evaluate< { ok: boolean; state: ExtensionState }>('chrome.runtime.sendMessage({ type: "dsh-assistant-state" })')
    expect(result.ok).toBe(true)
    return result.state
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ deepSeekMissingCredential: true })
    await cp(join(process.cwd(), '.agents/skills/github-issues'), join(scaffold.workspaceCwd, '.agents/skills/github-issues'), { recursive: true })
    setupStage = 'copy extension'
    root = await mkdtemp(join(tmpdir(), 'dsh-browser-platform-bootstrap-'))
    const extension = join(root, 'extension')
    await cp(join(process.cwd(), 'apps/chrome-extension'), extension, { recursive: true })
    const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8')) as Record<string, unknown>
    manifest.host_permissions = ['http://127.0.0.1/*']
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest))
    const site = createServer(async (request, response) => {
      response.setHeader('content-type', 'text/html; charset=utf-8')
      const location = new URL(request.url ?? '/', 'http://fixture.test')
      const issuePath = '/team/repo/issues'
      if (location.pathname.startsWith(issuePath)) {
        if (request.method === 'POST' && location.pathname === `${issuePath}/new`) {
          const chunks: Buffer[] = []
          for await (const chunk of request) chunks.push(Buffer.from(chunk))
          const form = new URLSearchParams(Buffer.concat(chunks).toString())
          createdIssues.push({ title: form.get('title') ?? '', body: (form.get('body') ?? '').replaceAll('\r\n', '\n') })
          response.writeHead(303, { location: `${issuePath}/1` }); response.end(); return
        }
        if (location.pathname === issuePath) {
          const q = location.searchParams.get('q') ?? ''
          response.end(`<!doctype html><title>Issue search</title><main><h1>Issues</h1>${['open', 'closed'].map(state => `<a href="${issuePath}?q=${encodeURIComponent(`${q} state:${state}`)}">${state} (0)</a>`).join('')}<a href="${issuePath}/new">New issue</a></main>`)
          return
        }
        if (location.pathname === `${issuePath}/new`) {
          response.end(`<!doctype html><title>New Issue</title><form method="post" action="${issuePath}/new"><label>Title<input name="title"></label><label>Body<textarea name="body"></textarea></label><button type="submit">Create issue</button></form>`)
          return
        }
        const issue = createdIssues.at(-1)
        const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
        response.end(`<!doctype html><title>Issue detail</title><h1>${escape(issue?.title ?? '')}</h1><article>${escape(issue?.body ?? '')}</article><p>Issue creation verified</p>`)
        return
      }
      if (request.url === '/destination') {
        response.end('<!doctype html><title>Navigation result</title><h1>Navigation arrived</h1>')
        return
      }
      if (request.url === '/navigation') {
        response.end('<!doctype html><title>Navigation source</title><a href="/destination">Continue to destination</a>')
        return
      }
      if (request.url === '/child-source') {
        response.end('<!doctype html><title>Child source</title><a href="/destination?child=1" target="_blank" rel="opener">Open child page</a>')
        return
      }
      if (request.url === '/destination?child=1') {
        response.end('<!doctype html><title>Child result</title><h1>Child page arrived</h1>')
        return
      }
      if (location.pathname === '/scope-source') {
        response.end('<!doctype html><title>Scope source</title><main style="min-height:400px"><h1>Task root</h1><article id="lease">Temporary workspace item</article><a href="/scope-child" target="_blank" rel="opener">Open task child</a></main>')
        return
      }
      if (location.pathname === '/scope-child') {
        response.end('<!doctype html><title>Scope child</title><h1 id="result" data-clicks="0">Child waiting</h1><button onclick="const node=document.querySelector(\'#result\');node.textContent=\'Child verified\';node.dataset.clicks=String(Number(node.dataset.clicks)+1)">Confirm child</button>')
        return
      }
      if (location.pathname === '/handoff-source') {
        response.end('<!doctype html><title>Handoff root</title><main><h1>User-selected root</h1><a href="/handoff-child" target="_blank" rel="opener">Open function page</a></main>')
        return
      }
      if (location.pathname === '/handoff-child') {
        response.end('<!doctype html><title>Handoff child</title><main><h1>Function ready</h1><article><h2>Owned result</h2><a href="/saved-reference">Saved reference</a></article></main>')
        return
      }
      response.end('<!doctype html><title>Bootstrap target</title><main><label>Changed field wording<input name="title" value="Exact draft title"></label><p id="result" data-clicks="0">Before click</p><button id="commit" onclick="const result=document.querySelector(\'#result\');result.textContent=\'After click\';result.dataset.clicks=String(Number(result.dataset.clicks)+1)">Commit change</button></main>')
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
  // Profile healing, Loader activation, and a fresh Chromium extension share this setup budget.
  }, 180_000)

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
      const snapshot = await tool(scaffold, handle.agent, 'browser_snapshot', { installationId, tabId: openedTab.tabId, frameId: 0, expectedTab: openedTab,
        includeValues: true, bindings: [
          { key: 'draft.title', pageUrl: siteUrl, alternatives: [{ role: 'textbox', name: 'title' }] },
          { key: 'draft.commit', pageUrl: siteUrl, alternatives: [{ role: 'button', label: 'Commit change' }] },
        ] })
      const bindings = snapshot.value?.bindings as BrowserSnapshotBindings
      expect(bindings.source).toMatchObject({ requestId: snapshot.requestId, installationId, page: { url: siteUrl } })
      expect(bindings.results.map(binding => [binding.key, binding.status])).toEqual([['draft.title', 'bound'], ['draft.commit', 'bound']])
      const element = bindings.results.find(binding => binding.key === 'draft.commit')!.candidates[0]!
      expect((snapshot.value?.elements as Array<{ value?: string }>).some(control => control.value === 'Exact draft title')).toBe(true)
      expect(tasks.get(handle.agent)?.attempts.some(attempt => attempt.requestId === snapshot.requestId)).toBe(true)
      const page = snapshot.value?.page as { tabId: number; frameId: number; documentId: string; url: string }
      const clicked = await tool(scaffold, handle.agent, 'browser_action', { installationId, action: { kind: 'click', intent: 'Commit the requested change',
        element } })
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

  it('loads Skill attachments and runs its deterministic flow through PTC and the same BrowserTask', async () => {
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId(`browser-application-flow-${randomUUID()}`), meta: { cwd: scaffold.workspaceCwd },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'browser-assistant').then(() => undefined),
    })
    try {
      const repository = `${new URL(siteUrl).origin}/team/repo`
      const title = 'BrowserTask application flow', body = '  First line\n\nSecond line  '
      handle.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text',
        text: `在 ${repository} 查重并创建 Issue，标题为 ${title}，正文为 ${body}。` }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      const installationId = (await state()).connection.grant?.installationId
      if (!installationId) throw new Error('extension grant missing')
      const started = await tool(scaffold, handle.agent, 'browser_task_start', { installationId,
        goal: 'Create the requested issue after duplicate search and exact form readback.', success: { text: 'Issue creation verified' } })
      const opened = await tool(scaffold, handle.agent, 'browser_action', { installationId, action: { kind: 'tab_open', url: repository } })
      const openedTab = opened.value?.tab as { tabId: number; windowId: number; browserSessionId: string }
      await tool(scaffold, handle.agent, 'browser_task_verify', {})
      const first = await tool(scaffold, handle.agent, 'browser_snapshot', { installationId, tabId: openedTab.tabId, frameId: 0, expectedTab: openedTab })
      const taskInput = { repository, title, body, submit: true, page: first.value?.page }
      const execution = await tool(scaffold, handle.agent, 'run_code', { description: 'Run the GitHub Issue Skill through the current BrowserTask', code: `
        const model = await tools.skill({ name: "github-issues", resource: "references/application-model.json" });
        const source = await tools.skill({ name: "github-issues", resource: "scripts/issue-flow.js" });
        const flow = new Function(source.content + "\\nreturn runGitHubIssueFlow")();
        const installationId = ${JSON.stringify(installationId)};
        return await flow({
          read: (page, includeValues) => tools.browser_snapshot({ installationId, tabId: page.tabId, frameId: page.frameId,
            documentId: page.documentId, includeValues, limit: 128, textLimit: 16000 }),
          act: action => tools.browser_action({ installationId, action }),
          afterAction: () => tools.browser_task_verify({}),
          status: requestId => tools.browser_request_status({ installationId, requestId })
        }, JSON.parse(model.content), ${JSON.stringify(taskInput)});
      ` })
      expect(execution, JSON.stringify(execution)).toMatchObject({ result: { status: 'submitted-readback-required', detailUrl: `${repository}/issues/1` } })
      expect(createdIssues).toEqual([{ title, body }])
      const task = scaffold.ctx.browserTasks.get(handle.agent)
      expect(task).toMatchObject({ id: started.taskId, phase: 'terminal', outcome: 'completed' })
      expect(task?.attempts.filter(attempt => attempt.actionKind === 'fill')).toHaveLength(2)
      expect(task?.budget.actionsUsed).toBe(task?.attempts.length)
      expect(scaffold.ctx.browserTasks.readTarget(handle.agent).binding).toBeNull()
      expect(handle.agent.session.events.some(event => event.type === 'tool/ptc-dispatch')).toBe(true)
      const detail = context.pages().find(candidate => candidate.url() === `${repository}/issues/1`)
      expect(await detail?.locator('article').textContent()).toBe(body)
    } finally { await handle.dispose() }
  })

  it('retains a confirmed form-submit acknowledgement across document replacement', async () => {
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId(`browser-submit-feedback-${randomUUID()}`), meta: { cwd: scaffold.workspaceCwd },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'browser-assistant').then(() => undefined),
    })
    try {
      const url = `${new URL(siteUrl).origin}/team/repo/issues/new`
      const title = 'Confirmed submit feedback', body = 'Read the new document independently.'
      const before = createdIssues.length
      const priorPages = new Set(context.pages())
      handle.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text',
        text: `Create one local Issue at ${url}: ${title}; ${body}.` }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      const installationId = (await state()).connection.grant!.installationId
      await tool(scaffold, handle.agent, 'browser_task_start', { installationId, goal: 'Create one local Issue.', success: { text: 'Issue creation verified' } })
      const opened = await tool(scaffold, handle.agent, 'browser_action', { installationId, action: { kind: 'tab_open', url } })
      await tool(scaffold, handle.agent, 'browser_task_verify', {})
      const tab = opened.value!.tab as { tabId: number }
      const read = () => tool(scaffold, handle.agent, 'browser_snapshot', { installationId, tabId: tab.tabId, frameId: 0, includeValues: true })
      const snapshot = (await read()).value as {
        page: BrowserPage
        snapshotId: string
        elements: { elementId: string; label: string; value?: string }[]
      }
      const ref = (label: string) => ({ page: snapshot.page, snapshotId: snapshot.snapshotId,
        elementId: snapshot.elements.find(element => element.label === label)!.elementId })
      await tool(scaffold, handle.agent, 'browser_action', { installationId, action: { kind: 'fill', element: ref('Title'), value: title, intent: 'Fill the requested title' } })
      await tool(scaffold, handle.agent, 'browser_action', { installationId, action: { kind: 'fill', element: ref('Body'), value: body, intent: 'Fill the requested body' } })
      const filled = (await read()).value as typeof snapshot
      expect(filled.elements.find(element => element.label === 'Title')?.value).toBe(title)
      expect(filled.elements.find(element => element.label === 'Body')?.value).toBe(body)
      const result = await tool(scaffold, handle.agent, 'browser_action', { installationId, action: { kind: 'submit', intent: 'Submit the verified local Issue once', element: {
        page: filled.page, snapshotId: filled.snapshotId, elementId: filled.elements.find(element => element.label === 'Create issue')!.elementId } } })
      expect(result).toMatchObject({ outcome: 'observed' })
      expect(createdIssues.slice(before)).toEqual([{ title, body }])
      expect(await tool(scaffold, handle.agent, 'browser_task_verify', {})).toMatchObject({ status: 'verified' })
      const detail = context.pages().find(candidate => !priorPages.has(candidate) && candidate.url() === `${new URL(siteUrl).origin}/team/repo/issues/1`)
      expect(await detail?.locator('article').textContent()).toBe(body)
    } finally { await handle.dispose() }
  })

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

  it('persists real child candidates while keeping the original task target and authority', async () => {
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId(`browser-platform-child-${randomUUID()}`), meta: { cwd: scaffold.workspaceCwd },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'browser-assistant').then(() => undefined),
    })
    try {
      const url = new URL('/child-source', siteUrl).href
      handle.agent.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: `Open ${url} and observe the child-page link.` }], source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      const installationId = (await state()).connection.grant!.installationId
      const tasks = scaffold.ctx.browserTasks
      const started = await tool(scaffold, handle.agent, 'browser_task_start', { installationId,
        goal: 'Observe the child page before choosing a continuation.', success: { text: 'Child adoption verified' } })
      await tool(scaffold, handle.agent, 'browser_action', { installationId, action: { kind: 'tab_open', url } })
      await tool(scaffold, handle.agent, 'browser_task_verify', {})
      const before = tasks.get(handle.agent)!
      const page = before.target!.page
      const snapshot = await tool(scaffold, handle.agent, 'browser_snapshot', { installationId, ...page })
      const element = (snapshot.value?.elements as Array<{ text?: string; snapshotId: string; elementId: string }>)
        .find(value => value.text === 'Open child page')
      if (!element) throw new Error('child link missing')
      const clicked = await tool(scaffold, handle.agent, 'browser_action', { installationId, action: {
        kind: 'click', intent: 'Open the linked child page', element: { page, snapshotId: element.snapshotId, elementId: element.elementId },
      } })
      expect(clicked.outcome).toBe('observed')
      const fact = scaffold.ctx.sessionProjections.stateOf(handle.agent.session, 'browserTask')!.sourceFacts
        .find(item => item.requestId === clicked.requestId && item.kind === 'browser-task-receipt')
      expect(fact?.children?.candidates).toHaveLength(1)
      const candidate = fact!.children!.candidates[0]
      expect(candidate).toMatchObject({ relation: 'opener', attribution: 'candidate', url: new URL('/destination?child=1', siteUrl).href })
      const after = tasks.get(handle.agent)!
      expect(after).toMatchObject({ id: started.taskId, target: before.target, targetReceipt: before.targetReceipt,
        targetRevision: before.targetRevision })
      expect(after.budget.actionsUsed).toBe(after.attempts.length)
      expect(tasks.readTarget(handle.agent).binding).toBeNull()
      const denied = await scaffold.ctx.agents.withInitiator(handle.agent, () => scaffold.ctx.browser.execute({
        sessionId: handle.agent.session.id, installationId, requestId: randomUUID(), action: {
          kind: 'snapshot', tabId: candidate.tab.tabId, frameId: 0, expectedTab: candidate.tab,
        },
      }, new AbortController().signal))
      expect(denied).toMatchObject({ outcome: 'failed', delivery: 'not-sent', reason: 'browser_target_mismatch' })
      const destination = context.pages().find(candidate => candidate.url() === new URL('/destination?child=1', siteUrl).href)
      expect(await destination?.locator('h1').textContent()).toBe('Child page arrived')
    } finally { await handle.dispose() }
  }, 120_000)

  it('selects an observed child and acts there with the original task, budget and user selection', async () => {
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId(`browser-platform-select-${randomUUID()}`), meta: { cwd: scaffold.workspaceCwd },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'browser-assistant').then(() => undefined),
    })
    try {
      const url = new URL('/scope-source', siteUrl).href
      handle.agent.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: `Open ${url}, follow its child link and confirm on the child page.` }], source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      const installationId = (await state()).connection.grant!.installationId
      const tasks = scaffold.ctx.browserTasks
      const started = await tool(scaffold, handle.agent, 'browser_task_start', { installationId,
        scope: { kind: 'descendants' }, goal: 'Confirm on the child page.', success: { text: 'Child verified' } })
      await tool(scaffold, handle.agent, 'browser_action', { installationId, action: { kind: 'tab_open', url } })
      await tool(scaffold, handle.agent, 'browser_task_verify', {})
      const before = tasks.get(handle.agent)!
      const page = before.target!.page
      const snapshot = await tool(scaffold, handle.agent, 'browser_snapshot', { installationId, ...page })
      const link = (snapshot.value?.elements as Array<{ text?: string; snapshotId: string; elementId: string }>)
        .find(value => value.text === 'Open task child')
      if (!link) throw new Error('scope child link missing')
      const mapped = await tool(scaffold, handle.agent, 'browser_page_map', { installationId, page })
      const region = (mapped.value?.regions as Array<{ regionRef: string }>)[0]
      if (!region) throw new Error(`scope root display region missing: ${JSON.stringify(mapped)}`)
      const mounted = await tool(scaffold, handle.agent, 'browser_region_render', { installationId, action: {
        kind: 'region_render', page, mountId: 'scope-lease', regionRef: region.regionRef, mode: 'append',
        presentation: { summary: 'Task cleanup check' },
      } })
      expect(mounted.outcome, JSON.stringify(mounted)).toBe('observed')
      const sourcePage = context.pages().find(candidate => candidate.url() === url)
      expect(await sourcePage?.getByText('Task cleanup check', { exact: true }).count()).toBe(1)
      const clicked = await tool(scaffold, handle.agent, 'browser_action', { installationId, action: {
        kind: 'click', intent: 'Follow the task link', element: { page, snapshotId: link.snapshotId, elementId: link.elementId },
      } })
      const candidates = (clicked.value?.transition as { candidates?: { tab: BrowserTabReference }[] } | undefined)?.candidates
      expect(candidates).toHaveLength(1)
      const selected = await tool(scaffold, handle.agent, 'browser_task_select', { installationId, tab: candidates![0].tab })
      expect(selected).toMatchObject({ status: 'selected', taskId: started.taskId })
      const childPage = selected.observation?.page as BrowserPage
      expect(childPage.url).toBe(new URL('/scope-child', siteUrl).href)
      const button = (selected.observation?.elements as Array<{ text?: string; snapshotId: string; elementId: string }>)
        .find(value => value.text === 'Confirm child')
      if (!button) throw new Error('child control missing after selection')
      expect(tasks.get(handle.agent)).toMatchObject({ id: before.id, targetRevision: before.targetRevision,
        target: { installationId, page: childPage }, scope: { kind: 'descendants' } })
      expect(tasks.get(handle.agent)?.resources).toMatchObject([{ id: 'scope-lease', state: 'active', target: { installationId, page } }])
      const cleared = await tool(scaffold, handle.agent, 'browser_region_clear', { installationId, action: {
        kind: 'region_clear', page, mountId: 'scope-lease',
      } })
      expect(cleared).toMatchObject({ outcome: 'observed', value: { cleared: true } })
      expect(await sourcePage?.getByText('Task cleanup check', { exact: true }).count()).toBe(0)
      const confirmed = await tool(scaffold, handle.agent, 'browser_action', { installationId, action: {
        kind: 'click', intent: 'Confirm once on the selected child',
        element: { page: childPage, snapshotId: button.snapshotId, elementId: button.elementId },
      } })
      expect(confirmed.outcome).toBe('observed')
      expect(await tool(scaffold, handle.agent, 'browser_task_verify', {})).toMatchObject({ status: 'verified' })
      const completed = tasks.get(handle.agent)!
      expect(completed).toMatchObject({ id: started.taskId, phase: 'terminal', outcome: 'completed' })
      expect(completed.attempts.some(item => item.selection !== undefined)).toBe(true)
      // Exact owned cleanup remains admissible after budget exhaustion and has its own retained attempt.
      expect(completed.budget.actionsUsed).toBe(completed.attempts.filter(item => item.actionKind !== 'region_clear').length)
      expect(tasks.readTarget(handle.agent)).toEqual({ binding: null, revision: 0 })
      const destination = context.pages().find(candidate => candidate.url() === childPage.url)
      expect(await destination?.locator('#result').textContent()).toBe('Child verified')
      expect(await destination?.locator('#result').getAttribute('data-clicks')).toBe('1')
    } finally { await handle.dispose() }
  }, 120_000)

  it('rediscovers tabs after stale initial selection and admits a fresh task without manual binding', async () => {
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId(`browser-platform-rediscovery-${randomUUID()}`), meta: { cwd: scaffold.workspaceCwd },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'browser-assistant').then(() => undefined),
    })
    const fixture = await context.newPage()
    try {
      const url = new URL('/scope-child?rediscovery=1', siteUrl).href
      await fixture.goto(url)
      const request = () => handle.agent.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'Read the existing local child page using its current browser identity.' }],
        source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      request()
      const installationId = (await state()).connection.grant!.installationId
      const list = async () => {
        const result = await tool(scaffold, handle.agent, 'browser_tabs', { installationId })
        const found = (result.value?.tabs as Array<BrowserTabReference & { url: string }>).find(tab => tab.url === url)
        if (!found) throw new Error('rediscovery fixture missing')
        return { tabId: found.tabId, windowId: found.windowId, browserSessionId: found.browserSessionId }
      }
      const original = await list()
      const stale = { ...original, browserSessionId: randomUUID() }
      await tool(scaffold, handle.agent, 'browser_task_start', { installationId,
        scope: { kind: 'explicit-set', tabs: [stale] }, goal: 'Read local page', success: { text: 'Child waiting' } })
      const before = scaffold.ctx.browserTasks.get(handle.agent)
      expect(await list()).toEqual(original)
      expect(scaffold.ctx.browserTasks.get(handle.agent)).toEqual(before)
      expect(await tool(scaffold, handle.agent, 'browser_task_select', { installationId, tab: stale }))
        .toMatchObject({ status: 'terminal', outcome: 'failed', reason: 'tab_reference_stale', nextStep: 'list-tabs-and-start-new-task' })
      const fresh = await list()
      request()
      await tool(scaffold, handle.agent, 'browser_task_start', { installationId,
        scope: { kind: 'explicit-set', tabs: [fresh] }, goal: 'Read local page', success: { text: 'Child waiting' } })
      expect(await tool(scaffold, handle.agent, 'browser_task_select', { installationId, tab: fresh }))
        .toMatchObject({ status: 'selected', observation: { page: { url } } })
      expect(scaffold.ctx.browserTasks.readTarget(handle.agent)).toEqual({ binding: null, revision: 0 })
      expect(await tool(scaffold, handle.agent, 'browser_task_verify', {})).toMatchObject({ status: 'verified' })
    } finally {
      await handle.dispose()
      await fixture.close()
    }
  }, 120_000)

  it('selects an explicit set from listed existing tabs without creating an extra tab', async () => {
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId(`browser-platform-set-${randomUUID()}`), meta: { cwd: scaffold.workspaceCwd },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'browser-assistant').then(() => undefined),
    })
    const fixturePages: Page[] = []
    try {
      const urls = [new URL('/scope-source?set=1', siteUrl).href, new URL('/scope-child?set=1', siteUrl).href]
      for (const url of urls) { const page = await context.newPage(); fixturePages.push(page); await page.goto(url) }
      handle.agent.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: 'Inspect the two named existing pages without opening another page.' }], source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      const installationId = (await state()).connection.grant!.installationId
      const listed = await tool(scaffold, handle.agent, 'browser_tabs', { installationId })
      const visible = listed.value?.tabs as Array<BrowserTabReference & { url: string }>
      const tabs = urls.map((url) => {
        const tab = visible.find(item => item.url === url)
        if (!tab) throw new Error('explicit-set tab missing from authorized listing')
        return { tabId: tab.tabId, windowId: tab.windowId, browserSessionId: tab.browserSessionId }
      })
      const pageCount = context.pages().length
      const started = await tool(scaffold, handle.agent, 'browser_task_start', { installationId,
        scope: { kind: 'explicit-set', tabs }, goal: 'Inspect both named pages.', success: { text: 'Child waiting' } })
      const tasks = scaffold.ctx.browserTasks
      expect(tasks.get(handle.agent)?.target).toBeUndefined()
      for (let index = 0; index < tabs.length; index++) {
        const selected = await tool(scaffold, handle.agent, 'browser_task_select', { installationId, tab: tabs[index] })
        expect(selected).toMatchObject({ status: 'selected', taskId: started.taskId, observation: { page: { url: urls[index] } } })
      }
      expect(context.pages()).toHaveLength(pageCount)
      expect(await tool(scaffold, handle.agent, 'browser_task_verify', {})).toMatchObject({ status: 'verified' })
      const completed = tasks.get(handle.agent)!
      expect(completed).toMatchObject({ id: started.taskId, outcome: 'completed', targetRevision: 0 })
      expect(completed.attempts.filter(item => item.selection !== undefined)).toHaveLength(2)
      expect(completed.attempts.some(item => item.actionKind === 'tab_open')).toBe(false)
      expect(completed.budget.actionsUsed).toBe(completed.attempts.length)
      expect(await fixturePages[1].locator('#result').textContent()).toBe('Child waiting')
    } finally {
      await handle.dispose()
      await Promise.all(fixturePages.map(page => page.close()))
    }
  }, 120_000)

  it('keeps task identity and budget when a click replaces its document, then verifies the destination', async () => {
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId(`browser-platform-navigation-${randomUUID()}`), meta: { cwd: scaffold.workspaceCwd },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'browser-assistant').then(() => undefined),
    })
    try {
      const url = new URL('/navigation', siteUrl).href
      handle.agent.session.append('user/message', createUserMessage({
        content: [{ type: 'text', text: `Open ${url} and continue to the destination.` }], source: { kind: 'user' },
      }), { surfaceOp: 'append' })
      const installationId = (await state()).connection.grant?.installationId
      if (!installationId) throw new Error('extension grant missing')
      const started = await tool(scaffold, handle.agent, 'browser_task_start', { installationId,
        goal: 'Continue to destination.', success: { text: 'Navigation arrived' } })
      await tool(scaffold, handle.agent, 'browser_action', { installationId, action: { kind: 'tab_open', url } })
      await tool(scaffold, handle.agent, 'browser_task_verify', {})
      const tasks = scaffold.ctx.browserTasks
      const page = tasks.get(handle.agent)?.target?.page
      if (!page) throw new Error('bootstrap target missing')
      const snapshot = await tool(scaffold, handle.agent, 'browser_snapshot', { installationId, ...page })
      const element = (snapshot.value?.elements as Array<{ text?: string; snapshotId: string; elementId: string }>)
        .find(value => value.text === 'Continue to destination')
      if (!element) throw new Error('navigation link missing')
      const clicked = await tool(scaffold, handle.agent, 'browser_action', { installationId, action: {
        kind: 'click', intent: 'Continue to destination', element: { page, snapshotId: element.snapshotId, elementId: element.elementId },
      } })
      expect(clicked.outcome).toBe('observed')
      const advanced = tasks.get(handle.agent)
      expect(advanced).toMatchObject({ id: started.taskId, target: { page: {
        tabId: page.tabId, url: new URL('/destination', siteUrl).href,
      } } })
      expect(advanced?.target?.page.documentId).not.toBe(page.documentId)
      expect(tasks.readTarget(handle.agent).binding).toBeNull()
      expect(await tool(scaffold, handle.agent, 'browser_task_verify', {})).toMatchObject({ status: 'verified' })
      const completed = tasks.get(handle.agent)
      expect(completed).toMatchObject({ id: started.taskId, phase: 'terminal', outcome: 'completed' })
      expect(completed?.budget.actionsUsed).toBe(completed?.attempts.length)
      const destination = context.pages().find(candidate => candidate.url() === new URL('/destination', siteUrl).href)
      expect(await destination?.locator('h1').textContent()).toBe('Navigation arrived')
    } finally { await handle.dispose() }
  }, 120_000)

  it('hands off the task-selected page without user rebinding and cleans the exact resource after Agent disposal', async () => {
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId(`browser-platform-handoff-${randomUUID()}`), meta: { cwd: scaffold.workspaceCwd },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'browser-assistant').then(() => undefined),
    })
    let disposed = false
    let rootPage: Page | undefined
    let childPage: Page | undefined
    let cleanupFunction: (() => Promise<unknown>) | undefined
    const cleanups: { sessionId: string; installationId: string; page: BrowserPage; mountId: string }[] = []
    const removeObserver = scaffold.ctx.on('browser/operation-intent', (operation, next) => {
      if (operation.operation.action.kind === 'entry_unmount') cleanups.push({
        sessionId: operation.operation.sessionId, installationId: operation.operation.installationId,
        page: operation.operation.action.page, mountId: operation.operation.action.mountId,
      })
      return next()
    })
    try {
      const rootUrl = new URL(`/handoff-source?case=${randomUUID()}`, siteUrl).href
      rootPage = await context.newPage()
      await rootPage.goto(rootUrl)
      const installationId = (await state()).connection.grant!.installationId
      const tabs = (await tool(scaffold, handle.agent, 'browser_tabs', { installationId })).value?.tabs as (BrowserTabReference & { url: string })[]
      const rootTab = tabs.find(tab => tab.url === rootUrl)
      if (!rootTab) throw new Error('handoff root tab missing')
      // The fixture acts as the user selection surface and captures the actual document before binding it.
      const rootIdentity = await panel.evaluate<BrowserPage>(`chrome.webNavigation.getFrame({ tabId: ${rootTab.tabId}, frameId: 0 }).then(frame => ({ tabId: ${rootTab.tabId}, frameId: 0, documentId: frame.documentId, url: frame.url }))`)
      expect(rootIdentity.url).toBe(rootUrl)
      const tasks = scaffold.ctx.browserTasks
      tasks.bindTargetByUser(handle.agent, {
        expectedRevision: tasks.readTarget(handle.agent).revision, installationId, page: rootIdentity,
      })
      handle.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text',
        text: 'Open the linked function page and create a page function for its result.' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      await tool(scaffold, handle.agent, 'browser_task_start', { installationId, page: rootIdentity,
        scope: { kind: 'descendants', root: { tabId: rootTab.tabId, windowId: rootTab.windowId, browserSessionId: rootTab.browserSessionId } },
        goal: 'Deliver the result as a page function.', success: { text: 'Function ready' } })
      const controls = (await tool(scaffold, handle.agent, 'browser_snapshot', { installationId, ...rootIdentity })).value?.elements as
        { text: string; elementId: string; snapshotId: string }[]
      const link = controls.find(control => control.text === 'Open function page')
      if (!link) throw new Error('function page link missing')
      const clicked = await tool(scaffold, handle.agent, 'browser_action', { installationId, action: { kind: 'click', intent: 'Open the function page',
        element: { page: rootIdentity, elementId: link.elementId, snapshotId: link.snapshotId } } })
      const fact = scaffold.ctx.sessionProjections.stateOf(handle.agent.session, 'browserTask')!.sourceFacts
        .find(item => item.kind === 'browser-task-receipt' && item.requestId === clicked.requestId)
      expect(fact?.children?.candidates).toHaveLength(1)
      const selected = await tool(scaffold, handle.agent, 'browser_task_select', { installationId, tab: fact!.children!.candidates[0].tab })
      expect(selected.status).toBe('selected')
      const childIdentity = tasks.get(handle.agent)!.target!.page
      childPage = context.pages().find(page => page.url() === childIdentity.url)
      if (!childPage) throw new Error('function child page missing')
      const definition = await tool(scaffold, handle.agent, 'cordis_define', { plugin: { kind: 'new', idPrefix: 'scope' },
        name: 'Page ownership acceptance', purpose: 'Keep one result control on the selected child page.', code: {
          host: `
            const input = { installationId: ${JSON.stringify(installationId)}, page: ${JSON.stringify(childIdentity)}, slot: 'result',
              regionSelector: 'main', selector: ':scope > article', titleSelector: 'h2', linkSelector: 'a', label: 'Keep result' }
            const inspection = await harness.browser.inspect(input)
            if (inspection.outcome !== 'observed' || inspection.value?.valid !== 1) throw new Error('Entry inspection failed: ' + JSON.stringify(inspection))
            const result = await harness.browser.mount(input)
            if (result.outcome !== 'observed' || result.value?.mounted !== 1) throw new Error('Page mount not observed: ' + JSON.stringify(result))
            return { name: 'page-ownership-acceptance', apply() {} }
          `,
        } })
      const runArguments = { pluginId: definition.pluginId, packageId: definition.packageId, mode: 'run' }
      const runCallId = ToolCallId(`cordis-run-${randomUUID()}`)
      const runCall = handle.agent.session.append('tool/call', {
        turn: 1, step: 1, callId: runCallId, name: 'cordis_run', arguments: JSON.stringify(runArguments),
      })
      const runResult = await scaffold.ctx.agents.withInitiator(handle.agent, () => scaffold.ctx.tools.execute({
        agent: handle.agent, name: 'cordis_run', arguments: runArguments,
        callId: runCallId, signal: new AbortController().signal,
      }))
      handle.agent.session.append('tool/result', {
        turn: 1, step: 1, message: createToolResultMessage({ callId: runCallId, content: runResult.content, isError: runResult.isError }),
        ...(runResult.error?.info ? { error: runResult.error.info } : {}),
        ...(runResult.meta === undefined ? {} : { meta: runResult.meta }),
      }, { surfaceOp: 'append', sourceEventSeqs: [runCall.seq] })
      expect(runResult.isError, JSON.stringify(runResult)).toBe(false)
      const run = runResult.value as ToolResult
      expect(run.status).toBe('running')
      await vi.waitFor(() => expect(tasks.get(handle.agent)?.delegated).toContainEqual(expect.objectContaining({
        callId: runCallId, kind: 'cordis', status: 'running',
        identity: { mode: 'cordis', pluginId: run.pluginId, packageId: run.packageId, pluginRunId: run.pluginRunId },
      })))
      const runner = scaffold.ctx.dynamicCordisRunner
      const plugin = runner.snapshot(handle.agent).find(row => row.pluginId === run.pluginId)!
      const packageId = plugin.currentPackageId!
      const pluginRunId = plugin.activeRun!.pluginRunId
      const mountId = `${plugin.pluginId}:result`
      expect(await childPage.getByRole('button', { name: 'Keep result', exact: true }).count()).toBe(1)
      await tool(scaffold, handle.agent, 'browser_task_verify', {})
      const ready = tasks.get(handle.agent)!
      expect(ready.evaluations.every(evaluation => evaluation.satisfied)).toBe(true)
      expect(ready.evaluations).not.toHaveLength(0)
      expect(ready.resources).toContainEqual(expect.objectContaining({ id: mountId, state: 'active', target: { installationId, page: childIdentity } }))
      const owner = { installationId, grantEpoch: ready.capability!.grantEpoch }
      const handoffArguments = { pluginId: plugin.pluginId, packageId, pluginRunId, scope: 'page' }
      const selectionBeforeHandoff = tasks.readTarget(handle.agent)
      expect(selectionBeforeHandoff.binding?.page).not.toEqual(childIdentity)
      cleanupFunction = () => runner.stopForInstallation(owner, {
        pluginId: plugin.pluginId, expectedPackageId: packageId, expectedPluginRunId: pluginRunId,
      })
      await tool(scaffold, handle.agent, 'cordis_handoff', handoffArguments)
      expect(tasks.readTarget(handle.agent)).toEqual(selectionBeforeHandoff)
      expect(tasks.get(handle.agent)).toMatchObject({ phase: 'terminal', outcome: 'completed', resources: [expect.objectContaining({
        id: mountId, state: 'retained', disposition: 'owner-transfer', owner: expect.objectContaining({ pluginId: plugin.pluginId, pluginRunId }),
      })] })
      expect(runner.inspectForInstallation(owner, plugin.pluginId)).toMatchObject({ openTarget: { kind: 'browser', resource: {
        sessionId: handle.agent.session.id, page: childIdentity, mountId,
      } } })
      expect(runner.inspectForInstallation({ ...owner, grantEpoch: owner.grantEpoch + 1 }, plugin.pluginId)).toBeUndefined()
      expect(runner.listForInstallation({ ...owner, installationId: randomUUID() })).toEqual([])
      await handle.dispose()
      disposed = true
      expect(await childPage.getByRole('button', { name: 'Keep result', exact: true }).count()).toBe(1)
      expect(await cleanupFunction()).toMatchObject({ ok: true })
      cleanupFunction = undefined
      expect(cleanups).toEqual([{ sessionId: handle.agent.session.id, installationId, page: childIdentity, mountId }])
      expect(await childPage.getByRole('button', { name: 'Keep result', exact: true }).count()).toBe(0)
      expect(await childPage.getByRole('heading', { name: 'Owned result', exact: true }).count()).toBe(1)
      expect(runner.inspectForInstallation(owner, plugin.pluginId)).not.toHaveProperty('openTarget')
    } finally {
      try { await cleanupFunction?.() } finally {
        removeObserver()
        try { if (!disposed) await handle.dispose() } finally {
          try { await childPage?.close() } finally { await rootPage?.close() }
        }
      }
    }
  }, 120_000)

  it('isolates DSH and Codex requests on one extension and keeps either channel usable when the other disconnects', async () => {
    const handle = await scaffold.ctx.agents.create({
      sessionId: SessionId(`browser-platform-coexist-${randomUUID()}`), meta: { cwd: scaffold.workspaceCwd },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'browser-assistant').then(() => undefined),
    })
    let client: Awaited<ReturnType<typeof connectBrowserTestClient>> | undefined
    let relay: Awaited<ReturnType<typeof startBrowserRelay>> | undefined
    const message = (value: Record<string, unknown>) => panel.evaluate<{
      ok: boolean
      state: { connection: { phase: string }; codexConnection: { phase: string } }
    }>(`chrome.runtime.sendMessage(${JSON.stringify(value)})`)
    const call = async <T = ToolResult>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
      if (!client) throw new Error('test MCP client missing')
      const result = await client.callTool({ name, arguments: args })
      expect(result.isError, JSON.stringify(result.structuredContent)).not.toBe(true)
      return result.structuredContent?.result as T
    }
    type Snapshot = { page: BrowserPage; text: string; elements: { text: string; snapshotId: string; elementId: string }[] }
    try {
      const extensionId = new URL(panel.url()).host
      const config = { port: 0, secret: randomBytes(32).toString('base64url'), extensionIds: [extensionId] }
      relay = await startBrowserRelay(config)
      const configPath = join(root, `codex-${randomUUID()}.json`)
      await writeFile(configPath, JSON.stringify({ ...config, port: relay.port }))
      expect(await message({ type: 'dsh-codex-browser-configure', baseUrl: `http://127.0.0.1:${relay.port}` })).toMatchObject({ ok: true })
      expect(await message({ type: 'dsh-codex-browser-connect' })).toMatchObject({ ok: true })
      await expect.poll(async () => (await message({ type: 'dsh-assistant-state' })).state).toMatchObject({
        connection: { phase: 'connected' }, codexConnection: { phase: 'connected' },
      })
      client = await connectBrowserTestClient(configPath)
      const status = await call<{ instances: { installationId: string; online: boolean }[] }>('browser_status')
      const codexInstallation = status.instances.find(instance => instance.online)?.installationId
      const dshInstallation = (await state()).connection.grant?.installationId
      if (!codexInstallation || !dshInstallation) throw new Error('both extension grants must be online')
      expect(codexInstallation).not.toBe(dshInstallation)
      const dshUrl = new URL(`/coexist-dsh-${randomUUID()}`, siteUrl).href
      const codexUrl = new URL(`/coexist-codex-${randomUUID()}`, siteUrl).href
      handle.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text',
        text: `Open ${dshUrl} and click Commit change once.` }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      const started = await tool(scaffold, handle.agent, 'browser_task_start', { installationId: dshInstallation,
        goal: 'Commit the DSH change exactly once.', success: { text: 'After click' } })
      const [, codexOpened] = await Promise.all([
        tool(scaffold, handle.agent, 'browser_action', { installationId: dshInstallation, action: { kind: 'tab_open', url: dshUrl } }),
        call('browser_open_tab', { installationId: codexInstallation, requestId: randomUUID(), url: codexUrl }),
      ])
      const codexTab = codexOpened.value?.tab as BrowserTabReference
      expect(codexOpened.outcome).toBe('observed')
      await tool(scaffold, handle.agent, 'browser_task_verify', {})
      const dshPage = scaffold.ctx.browserTasks.get(handle.agent)!.target!.page
      const [dshRead, codexRead] = await Promise.all([
        tool(scaffold, handle.agent, 'browser_snapshot', { installationId: dshInstallation, ...dshPage }),
        call('browser_read_page', { installationId: codexInstallation, tabId: codexTab.tabId, expectedTab: codexTab, url: codexUrl }),
      ])
      const dshSnapshot = dshRead.value as Snapshot
      const codexSnapshot = codexRead.value as Snapshot
      expect(dshSnapshot.page.url).toBe(dshUrl)
      expect(codexSnapshot.page.url).toBe(codexUrl)
      expect(dshRead.sessionId).toBe(handle.agent.session.id)
      expect(codexRead.sessionId).not.toBe(handle.agent.session.id)
      const action = (snapshot: Snapshot) => {
        const element = snapshot.elements.find(control => control.text === 'Commit change')
        if (!element) throw new Error('commit control missing')
        return { kind: 'click', intent: 'Commit this channel change once',
          element: { page: snapshot.page, snapshotId: element.snapshotId, elementId: element.elementId } }
      }
      const [dshClicked, codexClicked] = await Promise.all([
        tool(scaffold, handle.agent, 'browser_action', { installationId: dshInstallation, action: action(dshSnapshot) }),
        call('browser_act', { installationId: codexInstallation, action: action(codexSnapshot) }),
      ])
      expect(dshClicked).toMatchObject({ outcome: 'observed', installationId: dshInstallation, sessionId: handle.agent.session.id })
      expect(codexClicked).toMatchObject({ outcome: 'observed', installationId: codexInstallation, sessionId: codexRead.sessionId })
      for (const url of [dshUrl, codexUrl]) {
        const page = context.pages().find(candidate => candidate.url() === url)
        if (!page) throw new Error('channel target disappeared')
        expect(await page.locator('#result').textContent()).toBe('After click')
        expect(await page.locator('#result').getAttribute('data-clicks')).toBe('1')
      }
      expect(await tool(scaffold, handle.agent, 'browser_request_status', {
        installationId: dshInstallation, requestId: dshClicked.requestId,
      })).toMatchObject({ outcome: 'observed', sessionId: handle.agent.session.id })
      expect(await call('browser_request_status', { installationId: codexInstallation, requestId: codexClicked.requestId }))
        .toMatchObject({ outcome: 'observed', sessionId: codexRead.sessionId })
      const foreignDsh = await tool(scaffold, handle.agent, 'browser_request_status', {
        installationId: dshInstallation, requestId: codexClicked.requestId,
      })
      expect(foreignDsh).toMatchObject({ outcome: 'unknown', sessionId: handle.agent.session.id })
      expect(foreignDsh.value).toBeUndefined()
      const foreignCodex = await client.callTool({ name: 'browser_request_status', arguments: {
        installationId: codexInstallation, requestId: dshClicked.requestId,
      } })
      expect(foreignCodex.isError).toBe(true)
      expect(foreignCodex.structuredContent).toMatchObject({ result: { outcome: 'unknown', sessionId: codexRead.sessionId } })
      expect((foreignCodex.structuredContent?.result as ToolResult).value).toBeUndefined()
      const task = scaffold.ctx.browserTasks.get(handle.agent)!
      expect(task.id).toBe(started.taskId)
      expect(task.attempts.some(attempt => attempt.requestId === dshClicked.requestId)).toBe(true)
      expect(task.attempts.some(attempt => attempt.requestId === codexClicked.requestId)).toBe(false)
      expect(await tool(scaffold, handle.agent, 'browser_task_verify', {})).toMatchObject({ status: 'verified' })

      expect(await message({ type: 'dsh-codex-browser-disconnect' })).toMatchObject({ ok: true })
      expect((await message({ type: 'dsh-assistant-state' })).state).toMatchObject({ connection: { phase: 'connected' } })
      expect((await tool(scaffold, handle.agent, 'browser_snapshot', { installationId: dshInstallation, ...dshPage })).value?.text)
        .toContain('After click')
      expect(await message({ type: 'dsh-codex-browser-connect' })).toMatchObject({ ok: true })
      await expect.poll(async () => (await message({ type: 'dsh-assistant-state' })).state.codexConnection.phase).toBe('connected')
      expect((await call<{ instances: { installationId: string; online: boolean }[] }>('browser_status')).instances)
        .toContainEqual(expect.objectContaining({ installationId: codexInstallation, online: true }))
      expect(await message({ type: 'dsh-assistant-disconnect' })).toMatchObject({ ok: true })
      expect((await message({ type: 'dsh-assistant-state' })).state.codexConnection.phase).toBe('connected')
      expect((await call('browser_read_page', { installationId: codexInstallation, ...codexSnapshot.page })).value?.text)
        .toContain('After click')
    } finally {
      try { await message({ type: 'dsh-codex-browser-disconnect' }) } finally {
        try { await client?.close() } finally {
          try { await relay?.close() } finally { await handle.dispose() }
        }
      }
    }
  }, 120_000)
})
