/** Browser capture, draft and version durability through a restarted built dsh web process. */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { newEnglishPage, probeFreePort, REPO_ROOT, saveFailureShot } from './support.ts'

interface RunningWeb {
  child: ChildProcess
  url: string
}

async function stop(host: RunningWeb | undefined): Promise<void> {
  if (host === undefined || host.child.exitCode !== null || host.child.signalCode !== null) return
  const exited = new Promise<void>((done) => { host.child.once('exit', () => { done() }) })
  host.child.kill('SIGTERM')
  const timer = setTimeout(() => { host.child.kill('SIGKILL') }, 10_000)
  try { await exited } finally { clearTimeout(timer) }
}

async function start(home: string, patch: string, port: number, seed: boolean): Promise<RunningWeb> {
  const launch = resolveExampleLaunch({
    srcBin: resolve(REPO_ROOT, 'apps/cli/src/bin.ts'),
    libBin: resolve(REPO_ROOT, 'apps/cli/lib/bin.js'),
    configArgs: ['web', '--patch', patch, '--no-open', '--port', String(port)],
    mode: 'lib',
    env: {
      DSH_HOME: home, DSH_AGENTS_HOME: join(REPO_ROOT, '.agents'),
      DSH_TELEMETRY_DISABLED: '1', DSH_CONTENT_RESTART_SEED: seed ? '1' : '0',
    },
  })
  const child = spawn(launch.command, launch.args, {
    cwd: REPO_ROOT, env: { ...scrubbedParentEnv(), ...launch.env },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  let output = ''
  const diagnostic = (): string => output.replace(/http:\/\/[^\s]+/gu, '[launch URL]').slice(-4000)
  try {
    const url = await new Promise<string>((done, reject) => {
      const timer = setTimeout(() => { reject(new Error(`built web readiness timed out: ${diagnostic()}`)) }, 90_000)
      const append = (chunk: Buffer): void => {
        output = `${output}${String(chunk)}`.slice(-12_000)
        const match = /dsh web: (http:\/\/[^\s]+)/u.exec(output)
        if (match?.[1] !== undefined) { clearTimeout(timer); done(match[1]) }
      }
      child.stdout?.on('data', append)
      child.stderr?.on('data', append)
      child.once('error', (error) => { clearTimeout(timer); reject(error) })
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`built web exited: ${String(code)}: ${diagnostic()}`)) })
    })
    return { child, url }
  } catch (error) {
    await stop({ child, url: '' })
    throw error
  }
}

async function openLibrary(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Content Library', exact: true }).first().click()
  const row = page.getByRole('button', { name: /Session capture/u })
  await row.waitFor({ timeout: 30_000 })
  if (await row.getAttribute('aria-expanded') !== 'true') await row.click()
}

it('retains a browser capture, saved draft, versions and metadata across service restarts', async () => {
  const home = await mkdtemp(join(process.platform === 'win32' ? homedir() : tmpdir(), 'dsh-content-browser-'))
  const patch = join(home, 'browser.patch.yml')
  await writeFile(patch, [
    '- insert:', '    - id: content-restart-seed',
    `      name: ${pathToFileURL(resolve(import.meta.dirname, 'fixtures/content-restart-seed.mjs')).href}`,
  ].join('\n'))
  const port = await probeFreePort()
  const browser = await chromium.launch()
  const page = await newEnglishPage(browser)
  let host: RunningWeb | undefined
  try {
    host = await start(home, patch, port, true)
    await page.goto(host.url, { waitUntil: 'load' })
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Configure later', exact: true }).click()
    const group = page.getByRole('treeitem').first()
    await group.waitFor({ timeout: 30_000 })
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
    await page.getByRole('treeitem').nth(1).click()
    await page.getByRole('button', { name: 'Capture to library', exact: true }).click()
    await page.getByRole('button', { name: /^Captured: source_/u }).waitFor({ timeout: 30_000 })
    await openLibrary(page)
    expect(await page.locator('pre').textContent()).toBe('Browser restart original')
    await page.reload({ waitUntil: 'load' })
    await openLibrary(page)
    expect(await page.locator('pre').textContent()).toBe('Browser restart original')
    await stop(host)
    host = await start(home, patch, port, false)
    await page.goto(host.url, { waitUntil: 'load' })
    await openLibrary(page)
    expect(await page.locator('pre').textContent()).toBe('Browser restart original')
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByLabel('Body', { exact: true }).fill('Persisted working draft')
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await page.getByText('Draft saved', { exact: true }).waitFor()
    await stop(host)
    host = await start(home, patch, port, false)
    await page.goto(host.url, { waitUntil: 'load' })
    await openLibrary(page)
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    expect(await page.getByLabel('Body', { exact: true }).inputValue()).toBe('Persisted working draft')
    await page.getByRole('button', { name: 'Commit version', exact: true }).click()
    await page.getByRole('button', { name: /2 versions/u }).waitFor()
    await page.getByRole('button', { name: 'Favorite', exact: true }).click()
    await page.getByRole('button', { name: 'Remove favorite', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Archive', exact: true }).click()
    await page.getByRole('button', { name: 'Unarchive', exact: true }).waitFor()
    await page.getByLabel('Project reference', { exact: true }).fill('browser-project')
    await page.getByRole('button', { name: 'Add project reference', exact: true }).click()
    await page.getByRole('button', { name: 'Remove project reference browser-project', exact: true }).waitFor()
    await stop(host)
    host = await start(home, patch, port, false)
    await page.goto(host.url, { waitUntil: 'load' })
    await openLibrary(page)
    expect(await page.locator('pre').textContent()).toBe('Persisted working draft')
    await page.getByRole('button', { name: /2 versions/u }).waitFor()
    await page.getByRole('button', { name: 'Remove favorite', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Unarchive', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Remove project reference browser-project', exact: true }).waitFor()
  } catch (error) {
    await saveFailureShot(page, 'web-e2e-content-restart')
    throw error
  } finally {
    await browser.close()
    await stop(host)
    await rm(home, { recursive: true, force: true })
  }
}, 180_000)
