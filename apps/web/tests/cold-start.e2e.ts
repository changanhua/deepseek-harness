/** Real built dsh web: navigate at socket bind, never wait for the ready URL or reload. */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { newEnglishPage, REPO_ROOT, requireDist } from './support.ts'

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const closed = new Promise<void>(resolve => child.once('exit', () => { resolve() }))
  child.kill()
  const timer = setTimeout(() => { child.kill('SIGKILL') }, 5000)
  try { await closed } finally { clearTimeout(timer) }
}

it('keeps BootPage or Hero painted across repeated immediate cold navigations and transient RPC loss', async () => {
  requireDist()
  const home = await mkdtemp(join(tmpdir(), 'dsh-cold-start-'))
  const browser = await chromium.launch()
  try {
    const patch = join(home, 'cold.patch.yml')
    const workspace = join(home, 'workspace')
    await mkdir(workspace)
    await writeFile(patch, [
      '- id: connection', '  config:', '    browserAuth: false',
      '- id: directory-picker', '  disabled: true',
      '- insert:',
      '    - id: directory-picker-browse', "      name: '@deepseek-ai/dsh-host-directory-picker-browse'",
      '    - id: ui-directory-picker-browse', "      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'", '',
    ].join('\n'))
    for (let iteration = 0; iteration < 3; iteration++) {
      const page = await newEnglishPage(browser)
      await page.addLocatorHandler(page.getByRole('button', { name: 'Continue', exact: true }), async (button) => { await button.click() })
      await page.addLocatorHandler(page.getByRole('button', { name: 'Configure later', exact: true }), async (button) => { await button.click() })
      const errors: string[] = []
      const diagnostics: string[] = []
      let navigations = 0
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', (message) => { if (message.text().includes('[dsh startup]')) diagnostics.push(message.text()) })
      page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations++ })
      await page.addInitScript(() => {
        const evidence = { samples: 0, empty: [] as string[], phases: [] as string[] }
        Object.assign(window, { __coldStart: evidence })
        const sample = () => {
          const root = document.getElementById('root')
          if (root !== null) {
            const visible = (element: Element): boolean => {
              const rect = element.getBoundingClientRect()
              const style = getComputedStyle(element)
              return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
            }
            const boot = [...root.querySelectorAll('[data-dsh-boot]')].some(visible)
            const hero = [...root.querySelectorAll('div[data-phase="hero"]')].some(element =>
              visible(element) && [...element.querySelectorAll('[data-composer-input]')].some(visible))
            const phase = boot ? 'boot' : hero ? 'hero' : 'empty'
            evidence.samples++
            if (evidence.phases.at(-1) !== phase) evidence.phases.push(phase)
            if (!boot && !hero && evidence.empty.length < 10) evidence.empty.push(root.innerText.slice(0, 200))
          }
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      let failedRpc = false
      let failedSockets = 0
      if (iteration === 2) {
        await page.routeWebSocket('**/api/remote.mux', async (route) => {
          if (failedSockets < 2) {
            failedSockets++
            await route.close({ code: 1013, reason: 'cold-start test: not ready' })
          } else route.connectToServer()
        })
      }
      if (iteration === 1) {
        await page.route('**/api/**', async (route) => {
          if (!failedRpc && route.request().method() === 'POST') {
            failedRpc = true
            await route.abort('connectionrefused')
          } else await route.continue()
        })
      }
      const launch = resolveExampleLaunch({
        srcBin: join(REPO_ROOT, 'apps/cli/src/bin.ts'), mode: 'lib',
        configArgs: ['web', '--patch', patch, '--no-open', '--port', '0'],
        env: { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
      })
      const probe = pathToFileURL(join(REPO_ROOT, 'apps/web/tests/support/cold-start-listen.mjs')).href
      const child = spawn(launch.command, ['--import', probe, ...launch.args], {
        cwd: REPO_ROOT, env: { ...scrubbedParentEnv(), ...launch.env },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
      })
      let output = ''
      child.stdout?.on('data', (chunk) => { output = (output + String(chunk)).slice(-12000) })
      child.stderr?.on('data', (chunk) => { output = (output + String(chunk)).slice(-12000) })
      try {
        const port = await new Promise<number>((resolve, reject) => {
          const timer = setTimeout(() => { reject(new Error(`cold listener timeout: ${output}`)) }, 90000)
          child.once('message', (message) => { clearTimeout(timer); resolve((message as { port: number }).port) })
          child.once('error', (error) => { clearTimeout(timer); reject(error) })
          child.once('exit', () => { clearTimeout(timer); reject(new Error(`cold process exited: ${output}`)) })
        })
        const response = await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'commit', timeout: 60000 })
        expect(response?.status(), output).toBe(200)
        await page.locator('div[data-phase="hero"]').waitFor({ timeout: 45000 })
        if (iteration === 0) {
          // Persist a real Workspace for the later cold auto-selection runs.
          await page.getByRole('textbox', { name: 'Choose workspace' }).click()
          const picker = page.getByRole('dialog', { name: 'Select Workspace Directory' })
          await picker.getByRole('button', { name: 'Edit path' }).click()
          const path = picker.getByRole('textbox', { name: 'Edit path' })
          await path.fill(workspace)
          await path.press('Enter')
          await picker.getByRole('button', { name: 'Open', exact: true }).click()
        }
        await expect.poll(() => diagnostics.some(text => text.includes('observe/follow snapshot')), {
          timeout: 20000, message: 'selected Session never accepted its opening snapshot',
        }).toBe(true)
        expect(await page.locator('[data-composer-input]').first().isVisible()).toBe(true)
        const evidence = await page.evaluate(() => (window as unknown as {
          __coldStart: { samples: number; empty: string[]; phases: string[] }
        }).__coldStart)
        expect(evidence.samples).toBeGreaterThan(0)
        expect(evidence.empty, JSON.stringify({ evidence, diagnostics, errors })).toEqual([])
        expect(evidence.phases).toContain('hero')
        expect(errors).toEqual([])
        expect(navigations).toBe(1)
        if (iteration === 1) expect(failedRpc).toBe(true)
        if (iteration === 2) expect(failedSockets).toBe(2)
        console.info('[cold-start regression]', { iteration, ...evidence, failedRpc, failedSockets, navigations })
      } finally {
        await page.close()
        await stop(child)
      }
    }
  } finally {
    await browser.close()
    await rm(home, { recursive: true, force: true })
  }
}, 240000)
