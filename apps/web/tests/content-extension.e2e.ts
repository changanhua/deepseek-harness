/** Loaded MV3 extension to built DSH, with isolated Chromium site permissions and fixture pages. */
import { spawn, type ChildProcess } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { probeFreePort, REPO_ROOT, saveFailureShot } from './support.ts'

interface Host { child: ChildProcess; url: string }
async function stop(host: Host | undefined): Promise<void> {
  if (!host || host.child.exitCode !== null || host.child.signalCode !== null) return
  const exited = new Promise<void>((done) => { host.child.once('exit', () => { done() }) })
  host.child.kill('SIGTERM')
  const timer = setTimeout(() => { host.child.kill('SIGKILL') }, 10_000)
  try { await exited } finally { clearTimeout(timer) }
}
async function start(home: string, port: number): Promise<Host> {
  const launch = resolveExampleLaunch({
    srcBin: resolve(REPO_ROOT, 'apps/cli/src/bin.ts'), libBin: resolve(REPO_ROOT, 'apps/cli/lib/bin.js'),
    configArgs: ['web', '--no-open', '--port', String(port)], mode: 'lib',
    env: { DSH_HOME: home, DSH_AGENTS_HOME: join(REPO_ROOT, '.agents'), DSH_TELEMETRY_DISABLED: '1' },
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
    return { child, url }
  } catch (error) { await stop({ child, url: '' }); throw error }
}

async function selectText(source: Page, sidebar: Page): Promise<void> {
  await source.bringToFront()
  await source.locator('#material').evaluate((node) => {
    const range = document.createRange()
    range.selectNodeContents(node)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  })
  // Chromium's native side-panel chrome is not a Playwright Page. Drive the shipped
  // extension page while keeping the source tab active, as a real side panel does.
  await sidebar.locator('#capture-selection').evaluate((node: HTMLButtonElement) => { node.click() })
  await expect.poll(() => sidebar.locator('#markdown').textContent()).toContain('Extension fixture original')
}

async function selectReply(source: Page, sidebar: Page): Promise<void> {
  await source.bringToFront()
  await sidebar.locator('#choose-reply').evaluate((node: HTMLButtonElement) => { node.click() })
  await source.locator('[data-message-id="msg_fixture"] h2').click()
  await expect.poll(() => sidebar.locator('#markdown').textContent()).toContain('Fixture assistant reply')
}

it('approves a loaded extension, saves and edits its capture, and retains content and grants after restart', async () => {
  const parent = resolve(homedir())
  const root = await mkdtemp(join(parent, 'dsh-content-extension-'))
  const home = join(root, 'home')
  const extension = join(root, 'extension')
  await cp(join(REPO_ROOT, 'apps/chrome-extension'), extension, { recursive: true })
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8')) as Record<string, unknown>
  // Only native Chrome site-grant UI is substituted. Extension code, Host auth,
  // approval, transport and storage are the shipped implementation.
  manifest.host_permissions = ['http://127.0.0.1/*', 'https://example.com/*', 'https://chatgpt.com/*', 'https://www.zhihu.com/*']
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest))
  const port = await probeFreePort()
  let host: Host | undefined
  let context: BrowserContext | undefined
  let library: Page | undefined
  let sidebar: Page | undefined
  try {
    host = await start(home, port)
    const serviceUrl = `http://127.0.0.1:${port}`
    context = await chromium.launchPersistentContext(join(root, 'browser'), {
      channel: 'chromium', headless: true, locale: 'en-US', viewport: { width: 1440, height: 1000 },
      ...(process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH === undefined ? {} : { executablePath: process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH }),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    })
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
    const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`
    const app = await context.newPage()
    await app.goto(host.url)
    await app.getByRole('button', { name: 'Continue', exact: true }).click()
    await app.getByRole('button', { name: 'Configure later', exact: true }).click()
    await app.getByRole('button', { name: 'Content Library', exact: true }).first().waitFor({ timeout: 30_000 })

    sidebar = await context.newPage()
    await sidebar.goto(`${extensionOrigin}/sidebar.html`)
    await sidebar.locator('#show-settings').click()
    expect(await sidebar.locator('#base-url').inputValue()).toBe('http://127.0.0.1:3080')
    await sidebar.locator('#base-url').fill(serviceUrl)
    const approvalOpened = context.waitForEvent('page')
    await sidebar.getByRole('button', { name: '连接此服务', exact: true }).click()
    const approval = await approvalOpened
    await approval.getByRole('button', { name: 'Allow content imports', exact: true }).waitFor({ timeout: 30_000 })
    await approval.getByRole('button', { name: 'Allow content imports', exact: true }).click()
    await expect.poll(() => sidebar!.locator('#connection-status').getAttribute('title'), { timeout: 30_000 }).toContain('已连接')
    await approval.close()
    await sidebar.locator('#hide-settings').click()

    const source = await context.newPage()
    await source.route('https://example.com/dsh-extension-fixture', route => route.fulfill({
      contentType: 'text/html', body: '<title>Extension fixture source</title><article><p id="material">Extension fixture original: preserve this selected text.</p></article>',
    }))
    await source.goto('https://example.com/dsh-extension-fixture')
    await selectText(source, sidebar)
    await sidebar.locator('#edit-title').click()
    await sidebar.locator('#title').fill('Extension durable original')
    await sidebar.locator('#title').press('Tab')
    await expect.poll(() => sidebar!.locator('#title').getAttribute('readonly')).toBe('')
    await sidebar.getByRole('button', { name: '保存到内容库', exact: true }).click()
    await sidebar.getByRole('button', { name: '在 DSH 中打开 ↗', exact: true }).waitFor({ timeout: 30_000 })
    const libraryOpened = context.waitForEvent('page')
    await sidebar.getByRole('button', { name: '在 DSH 中打开 ↗', exact: true }).click()
    library = await libraryOpened
    await library.getByRole('button', { name: 'Configure later', exact: true }).click()
    await library.getByRole('button', { name: /Extension durable original/u }).waitFor({ timeout: 30_000 })
    expect(await library.locator('pre').textContent()).toContain('Extension fixture original')
    expect(await library.getByRole('link', { name: 'Extension fixture source' }).getAttribute('href')).toBe('https://example.com/dsh-extension-fixture')
    await library.getByRole('button', { name: 'Edit', exact: true }).click()
    await library.getByLabel('Body', { exact: true }).fill('Edited extension draft')
    await library.getByRole('button', { name: 'Save draft', exact: true }).click()
    await library.getByText('Draft saved', { exact: true }).waitFor()
    const entryUrl = library.url()
    await stop(host)
    host = await start(home, port)
    await library.goto(entryUrl)
    const bodyEditor = library.getByLabel('Body', { exact: true })
    await expect.poll(async () => await bodyEditor.isVisible() || await library.getByRole('button', { name: 'Edit', exact: true }).isVisible()).toBe(true)
    if (!await bodyEditor.isVisible()) await library.getByRole('button', { name: 'Edit', exact: true }).click()
    expect(await library.getByLabel('Body', { exact: true }).inputValue()).toBe('Edited extension draft')
    await library.screenshot({ path: join(REPO_ROOT, '.artifacts/chrome-extension-library.png') })

    // Use the still-loaded extension after the Host restart; its durable grant must survive.
    // The routed fixture exercises the shipped dynamically injected content script on a
    // ChatGPT URL. A live ChatGPT DOM remains a separate compatibility observation.
    await source.route('https://chatgpt.com/c/dsh-extension-fixture', route => route.fulfill({
      contentType: 'text/html', body: '<title>ChatGPT fixture</title><article data-message-author-role="assistant" data-message-id="msg_fixture"><h2>Fixture assistant reply</h2><p>Only this completed response is captured.</p><button>Copy</button></article>',
    }))
    await sidebar.getByRole('button', { name: '继续采集', exact: true }).click()
    await source.goto('https://chatgpt.com/c/dsh-extension-fixture')
    await selectReply(source, sidebar)
    await sidebar.locator('#edit-title').click()
    await sidebar.locator('#title').fill('GPT reply after restart')
    await sidebar.locator('#title').press('Tab')
    await expect.poll(() => sidebar!.locator('#title').getAttribute('readonly')).toBe('')
    await sidebar.getByRole('button', { name: '保存到内容库', exact: true }).click()
    await sidebar.getByRole('button', { name: '在 DSH 中打开 ↗', exact: true }).waitFor({ timeout: 30_000 })
    const gptLibraryOpened = context.waitForEvent('page')
    await sidebar.getByRole('button', { name: '在 DSH 中打开 ↗', exact: true }).click()
    library = await gptLibraryOpened
    const configureLater = library.getByRole('button', { name: 'Configure later', exact: true })
    if (await configureLater.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false)) await configureLater.click()
    await library.getByRole('button', { name: /GPT reply after restart/u }).waitFor({ timeout: 30_000 })
    expect(await library.locator('pre').textContent()).toContain('Only this completed response is captured')
    // Site quick action saves in place without requiring the sidebar save form.
    await source.route('https://www.zhihu.com/question/10001/answer/20002', route => route.fulfill({
      contentType: 'text/html; charset=utf-8', body: '<meta charset="utf-8"><title>知乎 fixture</title><h1>怎样让收藏真正有用？</h1><article class="AnswerItem"><a class="AuthorInfo-name">林间笔记</a><a href="/question/10001/answer/20002">回答链接</a><div class="RichContent-inner"><p>知乎完整回答 fixture。只保存正文。</p></div><div class="ContentItem-actions"></div><div class="Comments-container">不要保存这条评论</div></article>',
    }))
    await source.goto('https://www.zhihu.com/question/10001/answer/20002')
    await source.bringToFront()
    await sidebar.getByRole('button', { name: '继续采集', exact: true }).evaluate((node: HTMLButtonElement) => { node.click() })
    await source.getByRole('button', { name: '收藏这条知乎回答到 DSH', exact: true }).waitFor()
    await source.getByRole('button', { name: '收藏这条知乎回答到 DSH', exact: true }).click()
    await expect.poll(() => source.locator('[data-dsh-quick-capture]').textContent(), { timeout: 30_000 }).toContain('已收藏')
    await expect.poll(() => sidebar!.locator('#title').inputValue()).toBe('怎样让收藏真正有用？ · 林间笔记')
    expect(await sidebar.locator('#markdown').textContent()).not.toContain('不要保存这条评论')
    await sidebar.setViewportSize({ width: 380, height: 840 })
    await sidebar.screenshot({ path: join(REPO_ROOT, '.artifacts/chrome-extension-ux.png') })
    const zhihuLibraryOpened = context.waitForEvent('page')
    await source.locator('[data-dsh-quick-capture]').click()
    const zhihuLibrary = await zhihuLibraryOpened
    await zhihuLibrary.waitForURL(/#content-entry=web/u)
    await zhihuLibrary.close()
    await library.getByRole('button', { name: 'Browser connections', exact: true }).click()
    await library.getByRole('button', { name: 'Revoke connection', exact: true }).click()
    await library.getByText('No browser connections are authorized.', { exact: true }).waitFor()
    await library.getByRole('button', { name: 'Close', exact: true }).click()
    await sidebar.getByRole('button', { name: '继续采集', exact: true }).click()
    await source.goto('https://chatgpt.com/c/dsh-extension-fixture')
    await selectReply(source, sidebar)
    await sidebar.getByRole('button', { name: '保存到内容库', exact: true }).click()
    await expect.poll(() => sidebar!.locator('#notice').textContent(), { timeout: 30_000 }).toMatch(/授权|失败/u)
  } catch (error) {
    if (sidebar !== undefined) console.error('Extension status:', await sidebar.locator('#connection-status').textContent())
    if (library !== undefined) await saveFailureShot(library, 'content-extension')
    throw error
  } finally {
    await context?.close()
    await stop(host)
    const target = resolve(root)
    if (dirname(target) !== parent || !basename(target).startsWith('dsh-content-extension-')) throw new Error('Refusing unexpected test cleanup target')
    await rm(target, { recursive: true, force: true })
  }
}, 240_000)
