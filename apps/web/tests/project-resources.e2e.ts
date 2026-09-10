/** Project resources through the real Web Loader, generated Remote and built browser client. */
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, REPO_ROOT } from './support.ts'
import type {} from '@deepseek-ai/dsh-api-workspace-controller'

describe('web: project resources', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let project: string
  let port: number
  let tripwire: ReturnType<typeof watchConsole>

  async function openProject() {
    scaffold = await launchWebScaffold({})
    const recorded = (await readFile(join(REPO_ROOT, 'snapshots/web/message-feedback-protocol/session.jsonl'), 'utf8'))
      .replaceAll('{{cwd}}', JSON.stringify(project).slice(1, -1))
    // The shared seed helper pins cwd from its scaffold argument; this project survives replacement Hosts.
    const sessionId = await seedSession({ ...scaffold, workspaceCwd: project }, recorded, 'resource-existing-conversation')
    const workspace = await scaffold.ctx.workspaceRegistry.create(project)
    await workspace.attachSession(sessionId)
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('heading', { name: 'Pick up where you left off' }).waitFor({ timeout: 30_000 })
    await page.locator('[data-workbench]').getByRole('button', { name: /1 conversations/ }).click()
    await page.getByRole('heading', { name: 'Project resources', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Add resource', exact: true }).waitFor()
  }

  beforeAll(async () => {
    project = await mkdtemp(join(tmpdir(), 'dsh-resource-project-'))
    await writeFile(join(project, 'input.txt'), 'existing project input')
    await writeFile(join(project, 'service.cjs'), `const http = require('node:http'); const fs = require('node:fs');
const server = http.createServer((req, res) => res.end('project resource service'));
server.listen(0, '127.0.0.1', () => { fs.writeFileSync('service-port.txt', String(server.address().port)); console.log('resource ready'); });`)
    browser = await chromium.launch()
    await openProject()
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    if (project !== undefined) await rm(project, { recursive: true, force: true })
  })

  it('uses project notes, files and services across navigation and Host restart', async () => {
    onTestFailed(async () => {
      const artifacts = join(REPO_ROOT, '.artifacts/project-resources')
      await mkdir(artifacts, { recursive: true })
      await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true })
      await writeFile(join(artifacts, 'failure.txt'), JSON.stringify({ body: await page.locator('body').innerText(), errors: tripwire.pageErrors }, null, 2))
    })
    await page.getByRole('button', { name: 'Add resource', exact: true }).click()
    await page.getByLabel('Name', { exact: true }).fill('Working notes')
    await page.getByLabel('Note content', { exact: true }).fill('# Working notes\nUse the project input.')
    await page.getByRole('button', { name: 'Save resource', exact: true }).click()
    await page.getByText('Working notes', { exact: true }).waitFor()
    const configuration = JSON.parse(await readFile(join(project, '.dsh/resources.json'), 'utf8')) as { entries: { path: string }[] }
    const note = configuration.entries[0]
    if (note === undefined) throw new Error('Saved note is missing')
    expect(await readFile(join(project, note.path), 'utf8')).toBe('# Working notes\nUse the project input.')

    await page.getByRole('button', { name: 'Add resource', exact: true }).click()
    await page.getByLabel('Type', { exact: true }).selectOption('file')
    await page.getByLabel('Name', { exact: true }).fill('Input file')
    await page.getByLabel('File path (inside project)', { exact: true }).fill('input.txt')
    await page.getByRole('button', { name: 'Save resource', exact: true }).click()
    await page.getByText('Input file', { exact: true }).waitFor()
    await page.locator('article').filter({ hasText: 'Input file' }).getByRole('button', { name: 'Open content' }).click()
    await page.getByText('existing project input', { exact: true }).waitFor()
    await page.reload({ waitUntil: 'load' })
    await page.locator('[data-workbench]').getByRole('button', { name: /1 conversations/ }).click()
    await page.getByText('Working notes', { exact: true }).waitFor()
    await page.getByText('Input file', { exact: true }).waitFor()
    expect(tripwire.pageErrors).toEqual([])
    await page.getByRole('button', { name: 'Add resource', exact: true }).click()
    await page.getByLabel('Type', { exact: true }).selectOption('service')
    await page.getByLabel('Name', { exact: true }).fill('Query service')
    await page.getByLabel('Start command', { exact: true }).fill('node service.cjs')
    await page.getByRole('button', { name: 'Save resource', exact: true }).click()
    const service = page.locator('article').filter({ hasText: 'Query service' })
    await service.getByRole('button', { name: 'Start', exact: true }).click()
    await expect.poll(async () => {
      try { port = Number(await readFile(join(project, 'service-port.txt'), 'utf8')); return await (await fetch(`http://127.0.0.1:${port}`)).text() } catch { return '' }
    }).toBe('project resource service')
    await page.getByRole('button', { name: 'Overview', exact: true }).click()
    await page.locator('[data-workbench]').getByRole('button', { name: /1 conversations/ }).click()
    await service.getByText('Process running', { exact: true }).waitFor()
    await service.getByText('Logs', { exact: true }).click()
    await service.getByText('resource ready', { exact: false }).waitFor()
    const shots = join(REPO_ROOT, '.artifacts/project-resources')
    await mkdir(shots, { recursive: true })
    await page.screenshot({ path: join(shots, 'resources.png'), fullPage: true })
    await service.getByRole('button', { name: 'Stop', exact: true }).click()
    await service.getByText('Stopped', { exact: true }).waitFor()
    await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow()
    expect(tripwire.pageErrors).toEqual([])
    await writeFile(join(project, 'service-port.txt'), '')
    await service.getByRole('button', { name: 'Start', exact: true }).click()
    await expect.poll(async () => {
      try { port = Number(await readFile(join(project, 'service-port.txt'), 'utf8')); return await (await fetch(`http://127.0.0.1:${port}`)).text() } catch { return '' }
    }).toBe('project resource service')
    await page.close()
    await scaffold.close()
    await expect(fetch(`http://127.0.0.1:${port}`)).rejects.toThrow()
    await openProject()
    await page.getByText('Working notes', { exact: true }).waitFor()
    await page.locator('article').filter({ hasText: 'Query service' }).getByText('Stopped', { exact: true }).waitFor()
    const reopenedConfiguration = JSON.parse(await readFile(join(project, '.dsh/resources.json'), 'utf8')) as { entries: unknown[] }
    expect(reopenedConfiguration.entries).toHaveLength(3)
    expect(tripwire.pageErrors).toEqual([])
  })
})
