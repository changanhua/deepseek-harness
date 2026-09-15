/** The shipped MV3 extension and an attached MCP client share one real Host and Session. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'
import { expect, it } from 'vitest'
import { startManagedDshHost, type ManagedHost } from '../src/lifecycle.ts'

async function binding(panel: Page) {
  return panel.evaluate(async () => {
    type AssistantState = { state: { session: { phase: string; binding?: { sessionId?: string } }
      connection: { phase: string; grant?: { installationId?: string } } } }
    const chrome = (globalThis as unknown as { chrome: { runtime: { sendMessage(value: unknown): Promise<AssistantState> } } }).chrome
    const { state } = await chrome.runtime.sendMessage({ type: 'dsh-assistant-state' })
    return { phase: state.session.phase, sessionId: state.session.binding?.sessionId,
      connected: state.connection.phase, installationId: state.connection.grant?.installationId }
  })
}

it('attaches to the extension Session, diagnoses selectors, answers and steers, and leaves the Host running', { timeout: 90_000 }, async () => {
  const repository = resolve(import.meta.dirname, '../../../..')
  const root = await mkdtemp(join(homedir(), 'dsh-mcp-extension-'))
  const hostHome = join(root, 'host')
  const profile = join(hostHome, 'profiles', 'web')
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'cordis.patch.yml'), '- id: session-title-llm\n  disabled: true\n')
  const model = await startMockLlmServer({ sequence: ['tool_call_success', 'success'], repeatLast: false,
    toolName: 'ask_user_question', toolArguments: JSON.stringify({ questions: [{ id: 'selector', question: 'Which selector matches the page entries?' }] }),
    successText: 'Continued with the selector observed by Codex.', chunkDelayMs: 80 })
  let host: ManagedHost | undefined, browser: BrowserContext | undefined, client: Client | undefined
  const env = Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => item[1] !== undefined))
  const runId = 'extension-mcp-integration'
  try {
    host = await startManagedDshHost({ runId, hostHome, cwd: root,
      cliEntry: join(repository, 'apps/cli/lib/bin.js'), startupTimeoutMs: 45_000,
      env: { DEEPSEEK_API_KEY: 'local-scripted-model', DEEPSEEK_BASE_URL: model.baseURL, DSH_TELEMETRY_DISABLED: '1' } })
    const origin = host.origin
    client = new Client({ name: 'extension-development-verifier', version: '1' })
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [join(repository, 'apps/cli/lib/bin.js'), '--profile', 'control-mcp'], cwd: root, stderr: 'pipe',
      env: { ...env, DSH_HOME: join(root, 'connector'), DSH_CONTROL_AUTOSTART: 'false',
        DSH_CONTROL_ORIGIN: origin, DSH_CONTROL_TOKEN: host.token, DSH_CONTROL_RUN_ID: runId } }))
    const call = async <T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
      const result = await client!.callTool({ name, arguments: args })
      expect(result.isError, JSON.stringify(result.content)).toBe(false)
      return (result.structuredContent as { result: T }).result
    }
    const runtime = await call('dsh_runtime_status')
    expect(runtime.identity).toMatchObject({ dshHome: hostHome, checkout: { root: repository.replaceAll('\\', '/') } })
    await expect(call('dsh_runtime_inspect', { view: 'plugins', query: 'browser-extension' }))
      .resolves.toMatchObject({ matched: 1, entries: [{ enabled: true, fiberPhase: 'active' }] })

    browser = await chromium.launchPersistentContext(join(root, 'chrome'), {
      channel: 'chromium', headless: true, locale: 'en-US', viewport: { width: 1000, height: 800 },
      args: [`--disable-extensions-except=${join(repository, 'apps/chrome-extension')}`, `--load-extension=${join(repository, 'apps/chrome-extension')}`],
    })
    const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker')
    const panel = await browser.newPage()
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidebar.html`)
    await browser.request.get(`${origin}/?token=${encodeURIComponent(host.token)}`)
    await panel.locator('#show-settings').click()
    await panel.locator('#base-url').fill(origin)
    const approvalPage = browser.waitForEvent('page')
    await panel.locator('#save-settings').click()
    const approval = await approvalPage
    await approval.getByRole('button', { name: '允许所选权限', exact: true }).click()
    await expect.poll(() => approval.locator('#status').textContent(), { timeout: 5000 }).toContain('已授权')
    // The sidebar exchanges approved grants on a two-second poll, then opens its channel.
    await expect.poll(async () => (await binding(panel)).connected, { timeout: 30_000 }).toBe('connected')
    await approval.close()
    await panel.getByRole('button', { name: '会话', exact: true }).click()
    await panel.getByRole('button', { name: '新建会话', exact: true }).click()
    await expect.poll(async () => (await binding(panel)).phase).toBe('live')
    const { sessionId, installationId } = await binding(panel)
    expect(sessionId).toBeTruthy()
    await expect(call('dsh_session_open', { requestId: 'adopt-extension-session', sessionId, cwd: root }))
      .resolves.toMatchObject({ sessionId, runId })
    const source = await browser.newPage()
    await source.route('https://example.com/mcp-selector-fixture', route => route.fulfill({
      contentType: 'text/html', body: '<title>Selector diagnostic</title><main><article><a class="u-url" href="https://example.com/item">Observed entry title</a></article></main>',
    }))
    await source.goto('https://example.com/mcp-selector-fixture')
    const instances = await call('dsh_browser_instances', { sessionId })
    expect(instances.instances).toEqual(expect.arrayContaining([expect.objectContaining({ installationId, online: true })]))
    const tabs = await call<{ value: { tabs: Array<{ tabId: number; url: string }> } }>('dsh_browser_tabs', { sessionId, installationId })
    const target = tabs.value.tabs.find(tab => tab.url === source.url())
    expect(target).toBeDefined()
    const snapshot = await call('dsh_browser_snapshot', { sessionId, installationId, tabId: target!.tabId, frameId: 0, textLimit: 2000 })
    expect(snapshot.outcome).toBe('observed')
    const selectors = { sessionId, installationId, regionSelector: 'main', selector: ':scope article', linkSelector: 'a.u-url' }
    const wrong = await call('dsh_browser_entry_inspect', { ...selectors, titleSelector: 'a.title' })
    expect(wrong).toMatchObject({ outcome: 'observed', value: { matched: 1, valid: 0, missingTitle: 1 } })
    const corrected = await call('dsh_browser_entry_inspect', { ...selectors, titleSelector: 'a.u-url' })
    expect(corrected).toMatchObject({ outcome: 'observed', value: { matched: 1, valid: 1, samples: [{ title: 'Observed entry title' }] } })

    await panel.locator('#composer').fill('Inspect the entry selector and ask for the observed correction.')
    await panel.getByRole('button', { name: '发送', exact: true }).click()
    await expect.poll(async () => (await call('dsh_session_observe', { sessionId })).phase).toBe('waiting_for_attention')
    const waiting = await call<{ attention: Array<{ attentionId: string }>; cursor: number }>('dsh_session_wait', { sessionId, timeoutMs: 10_000 })
    const steering = 'Use a.u-url: the independent browser observation found one valid entry.'
    await call('dsh_session_prompt', { requestId: 'selector-steer', sessionId, mode: 'steer', text: steering })
    await call('dsh_session_attention_answer', { requestId: 'selector-answer', sessionId,
      attentionId: waiting.attention[0]!.attentionId, answers: [{ id: 'selector', selected: [], custom: 'a.u-url' }] })
    await expect(call('dsh_session_wait', { sessionId, afterSeq: waiting.cursor, timeoutMs: 15_000 }))
      .resolves.toMatchObject({ phase: 'completed', attention: [] })
    await panel.getByText('Continued with the selector observed by Codex.', { exact: true }).waitFor()
    expect(JSON.stringify(model.requests[1])).toContain(steering)
    expect((await binding(panel)).sessionId).toBe(sessionId)
    const evidence = await call<{ binding: unknown; observation: { phase: unknown } }>('dsh_evidence_export', { sessionId })
    expect(evidence.binding).toEqual({ sessionId, installationId })
    const artifactRoot = join(repository, '.artifacts/control-mcp-integration')
    await mkdir(artifactRoot, { recursive: true })
    await panel.screenshot({ path: join(artifactRoot, 'shared-session.png') })
    await writeFile(join(artifactRoot, 'browser-roundtrip.json'), JSON.stringify({ runId, runtime, sessionId, installationId,
      diagnosis: { wrong, corrected }, phase: evidence.observation.phase, model: 'local-scripted-response', sameSession: true }, null, 2))
    await call('dsh_control_close')
    await client.close(); client = undefined
    expect((await browser.request.get(origin)).status()).toBe(200)
    expect((await binding(panel)).connected).toBe('connected')
  } finally {
    await client?.close()
    await browser?.close()
    await host?.stop()
    await model.close()
    await rm(root, { recursive: true, force: true })
  }
})
