/** Loaded MV3 extension to built DSH, with isolated Chromium site permissions and fixture pages. */
import { spawn, type ChildProcess } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { probeFreePort, REPO_ROOT, saveFailureShot } from './support.ts'

interface Host { child: ChildProcess; url: string; diagnostic?: () => string }
async function stop(host: Host | undefined): Promise<void> {
  if (!host || host.child.exitCode !== null || host.child.signalCode !== null) return
  const exited = new Promise<void>((done) => { host.child.once('exit', () => { done() }) })
  host.child.kill('SIGTERM')
  const timer = setTimeout(() => { host.child.kill('SIGKILL') }, 10_000)
  try { await exited } finally { clearTimeout(timer) }
}
async function start(home: string, port: number, patch: string, seed: boolean): Promise<Host> {
  const launch = resolveExampleLaunch({
    srcBin: resolve(REPO_ROOT, 'apps/cli/src/bin.ts'), libBin: resolve(REPO_ROOT, 'apps/cli/lib/bin.js'),
    configArgs: ['web', '--patch', patch, '--no-open', '--port', String(port)], mode: 'lib',
    env: { DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents'), DSH_TELEMETRY_DISABLED: '1', DSH_ASSISTANT_SEED: seed ? '1' : '0' },
  })
  const child = spawn(launch.command, launch.args, { cwd: REPO_ROOT, env: { ...scrubbedParentEnv(), ...launch.env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let output = ''
  try {
    const url = await new Promise<string>((done, reject) => {
      const timer = setTimeout(() => { reject(new Error('built extension Host readiness timed out')) }, 90_000)
      const append = (chunk: Buffer): void => {
        output = `${output}${String(chunk)}`.slice(-8000)
        const match = /dsh web: (http:\/\/[^\s]+)/u.exec(output)
        if (match?.[1]) { clearTimeout(timer); done(match[1]) }
      }
      child.stdout?.on('data', append)
      child.stderr?.on('data', append)
      child.once('error', (error) => { clearTimeout(timer); reject(error) })
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`built Host exited ${String(code)}: ${output.replace(/https?:\/\/[^\s]+/gu, '[URL]').slice(-3000)}`)) })
    })
    return { child, url, diagnostic: () => output.replace(/https?:\/\/[^\s]+/gu, '[URL]') }
  } catch (error) { await stop({ child, url: '' }); throw error }
}

interface AssistantState {
  connection: { phase: string; grant?: { installationId: string } }
  session: { phase: string
    binding: { sessionId: string } | null
    records: Array<{
      event?: { type: string; data: { source?: { kind: string }; content?: Array<{ type: string; text?: string }> } }
    }> }
  contexts: Array<{ text?: string; mediaType?: string; page: { url: string } }>
}
async function state(panel: Page): Promise<AssistantState> {
  const reply: { ok: boolean; state: AssistantState } = await panel.evaluate('chrome.runtime.sendMessage({type:"dsh-assistant-state"})')
  expect(reply.ok).toBe(true)
  return reply.state
}
async function connected(panel: Page): Promise<void> {
  await expect.poll(async () => (await state(panel)).connection.phase, { timeout: 30_000 }).toBe('connected')
}
async function onboard(page: Page): Promise<void> {
  for (const name of ['Continue', 'Configure later']) {
    const button = page.getByRole('button', { name, exact: true })
    if (await button.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) await button.click()
  }
}
async function previousCapture(page: Page, base: string): Promise<void> {
  await page.goto(base + '/#content-entry=web%3A00000000-0000-4000-8000-000000000001')
  await onboard(page)
  await page.getByRole('button', { name: /Previous extension capture/u }).waitFor({ timeout: 30_000 })
  expect(await page.locator('pre').textContent()).toContain('Previous browser capture remains readable.')
  expect(await page.getByRole('link', { name: 'Previous source page', exact: true }).getAttribute('href'))
    .toBe('https://example.com/previous-capture')
}

it('shares captured context across assistant surfaces, restores the Session, and preserves previous Content captures', async () => {
  const parent = resolve(homedir())
  const root = await mkdtemp(join(parent, 'dsh-browser-assistant-'))
  const home = join(root, 'home'), extension = join(root, 'extension'), patch = join(root, 'assistant.patch.yml')
  const resultText = 'Assistant fixture received the selected text, page body and screenshot.'
  await cp(join(REPO_ROOT, 'apps/chrome-extension'), extension, { recursive: true })
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8')) as Record<string, unknown>
  // Only native site permission UI is substituted in this isolated extension copy.
  manifest.host_permissions = ['http://127.0.0.1/*', '<all_urls>']
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(join(root, 'session.jsonl'), JSON.stringify({ version: 0, id: 'assistant-replay', createdAt: 1 }) + '\n')
  await writeFile(join(root, 'replay.json'), JSON.stringify([{ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text: resultText },
    { type: 'block-end', index: 0, block: { type: 'text', text: resultText } },
    { type: 'usage', usage: { inputTokens: 20, outputTokens: 8 } }, { type: 'finish', reason: { kind: 'stop' } },
  ] }]))
  await writeFile(patch, [
    '- id: llm-deepseek\n  disabled: true', '- id: llm-pi-ai\n  disabled: true',
    '- id: session-title-llm\n  disabled: true', '- id: agent-instructions\n  disabled: true',
    '- insert:', '    - id: assistant-replay',
    `      name: ${JSON.stringify(pathToFileURL(join(REPO_ROOT, 'packages/test-support/llm-replay/lib/index.js')).href)}`,
    `      config:\n        file: ${JSON.stringify(join(root, 'session.jsonl'))}\n        overrideFile: ${JSON.stringify(join(root, 'replay.json'))}`,
    '        providers:\n          - id: deepseek-official\n            name: Assistant replay\n            models:',
    '              - id: deepseek-v4-flash\n                contextWindow: 128000\n                inputModalities: [text, image]\n                imageRequestTokens: 64',
    '    - id: browser-assistant-seed',
    `      name: ${JSON.stringify(pathToFileURL(join(import.meta.dirname, 'fixtures/browser-assistant-seed.mjs')).href)}`,
  ].join('\n'))
  const port = await probeFreePort(), base = `http://127.0.0.1:${port}`
  let host: Host | undefined, context: BrowserContext | undefined, panel: Page | undefined
  const bootChrome = async (): Promise<Page> => {
    context = await chromium.launchPersistentContext(join(root, 'browser'), {
      channel: 'chromium', headless: true, locale: 'en-US', viewport: { width: 1200, height: 900 }, timeout: 30_000,
      ...(process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH === undefined ? {} : { executablePath: process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH }),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    })
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15_000 })
    const page = await context.newPage()
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/sidebar.html`)
    return page
  }
  try {
    host = await start(home, port, patch, true)
    panel = await bootChrome()
    if (!context) throw new Error('missing browser context')
    await context.request.get(host.url)
    const library = await context.newPage()
    await previousCapture(library, base)
    await panel.locator('#show-settings').click()
    await panel.locator('#base-url').fill(base)
    const opening = context.waitForEvent('page')
    await panel.locator('#save-settings').click()
    const approval = await opening
    await approval.getByRole('button', { name: '允许所选权限', exact: true }).click()
    await connected(panel)
    await approval.close()
    await panel.getByRole('button', { name: '会话', exact: true }).click()
    await panel.getByRole('button', { name: '新建会话', exact: true }).click()
    await expect.poll(async () => (await state(panel!)).session.phase).toBe('live')
    const bound = await state(panel), sessionId = bound.session.binding!.sessionId
    const installationId = bound.connection.grant!.installationId
    const source = await context.newPage()
    await source.route('https://example.com/assistant-fixture', route => route.fulfill({
      contentType: 'text/html', body: '<title>Assistant source</title><nav>Unrelated navigation</nav>'
        + '<main><h1 id="material">Selected assistant fixture text</h1><p>Body-only paragraph from the article.</p>'
        + '<textarea>Private editor text must not enter body capture.</textarea><p hidden>Hidden body text.</p></main>',
    }))
    await source.goto('https://example.com/assistant-fixture')
    await source.locator('#material').evaluate((node) => {
      const range = document.createRange(); range.selectNodeContents(node)
      getSelection()?.removeAllRanges(); getSelection()?.addRange(range)
    })
    await source.bringToFront()
    // Keep the source foreground while driving the shipped extension page as a side panel.
    await panel.locator('#capture-selection').evaluate((node: HTMLButtonElement) => { node.click() })
    await expect.poll(async () => (await state(panel!)).contexts.length).toBe(1)
    await panel.locator('#capture-body').evaluate((node: HTMLButtonElement) => { node.click() })
    await expect.poll(async () => (await state(panel!)).contexts.length).toBe(2)
    const body = (await state(panel)).contexts[1]!
    expect(body.text).toContain('Body-only paragraph from the article.')
    expect(body.text).not.toMatch(/Private editor|Hidden body|Unrelated navigation/u)
    await panel.locator('#capture-screenshot').evaluate((node: HTMLButtonElement) => { node.click() })
    await expect.poll(async () => (await state(panel!)).contexts.length).toBe(3)
    expect((await state(panel)).contexts).toMatchObject([
      { text: 'Selected assistant fixture text', page: { url: source.url() } },
      { text: body.text, page: { url: source.url() } },
      { mediaType: 'image/jpeg', page: { url: source.url() } },
    ])
    await panel.locator('#composer').fill('Explain this captured page.')
    await panel.getByRole('button', { name: '发送', exact: true }).click()
    await panel.getByText(resultText, { exact: true }).waitFor({ timeout: 30_000 })
    const submitted = (await state(panel)).session.records.find(record => record.event?.type === 'user/message'
      && record.event.data.source?.kind === 'user')
    expect(submitted?.event?.data.content?.filter(part => part.type === 'text').map(part => part.text).join('\n'))
      .toContain('Body-only paragraph from the article.')
    const webOpened = context.waitForEvent('page')
    await panel.locator('#open-session').click()
    const web = await webOpened; await onboard(web)
    await web.getByText(resultText, { exact: true }).first().waitFor({ timeout: 30_000 })
    expect(web.url()).toContain(encodeURIComponent(sessionId))
    await panel.locator('#show-settings').click()
    const popupOpened = context.waitForEvent('page')
    await panel.locator('#open-assistant-window').click()
    const popup = await popupOpened
    await popup.getByText(resultText, { exact: true }).waitFor()
    expect((await state(popup)).session.binding?.sessionId).toBe(sessionId)
    await popup.close()
    await panel.close()
    panel = await context.newPage(); await panel.goto(popup.url())
    await panel.getByText(resultText, { exact: true }).waitFor()
    expect((await state(panel)).session.binding?.sessionId).toBe(sessionId)
    await panel.setViewportSize({ width: 380, height: 840 })
    expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await panel.screenshot({ path: join(REPO_ROOT, '.artifacts/browser-assistant.png') })
    await context.close(); context = undefined
    await stop(host); host = await start(home, port, patch, false)
    panel = await bootChrome(); await connected(panel)
    await panel.getByText(resultText, { exact: true }).waitFor({ timeout: 30_000 })
    const recovered = await state(panel)
    expect(recovered.connection.grant?.installationId).toBe(installationId)
    expect(recovered.session.binding?.sessionId).toBe(sessionId)
    expect(recovered.session.records.filter(record => record.event?.type === 'user/message'
      && record.event.data.source?.kind === 'user')).toHaveLength(1)
    expect(recovered.session.records.find(record => record.event?.type === 'user/message')?.event?.data.content
      ?.filter(part => part.type === 'text').map(part => part.text).join('\n')).toContain('Body-only paragraph from the article.')
    const restarted = panel.context()
    await restarted.request.get(host.url)
    await previousCapture(await restarted.newPage(), base)
  } catch (error) {
    console.error('Assistant Host:', host?.diagnostic?.())
    if (panel && !panel.isClosed()) await saveFailureShot(panel, 'browser-assistant')
    throw error
  } finally {
    await context?.close()
    await stop(host)
    const target = resolve(root)
    if (dirname(target) !== parent || !basename(target).startsWith('dsh-browser-assistant-')) throw new Error('Refusing unexpected cleanup target')
    await rm(target, { recursive: true, force: true })
  }
}, 240_000)
