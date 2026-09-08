/** Workbench navigation through the shipped Loader, controller feeds, and built browser plugins. */
import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SEED = fileURLToPath(new URL('../../../snapshots/web/message-feedback-protocol/session.jsonl', import.meta.url))
const SHOTS = fileURLToPath(new URL('../../../.artifacts/workbench-preview/', import.meta.url))

describe('web e2e: personal workbench', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let sessionId: SessionId

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    // The seed helper substitutes raw paths; escape the JSON string contents before it sees Windows separators.
    const recorded = (await readFile(SEED, 'utf8')).replaceAll('{{cwd}}', JSON.stringify(scaffold.workspaceCwd).slice(1, -1))
    sessionId = await seedSession(scaffold, recorded, 'workbench-existing-work')
    const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    await workspace.attachSession(sessionId)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('heading', { name: 'Pick up where you left off' }).waitFor({ timeout: 30_000 })
    await mkdir(SHOTS, { recursive: true })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens the project and existing conversation without creating another session', async () => {
    onTestFailed(() => saveFailureShot(page, 'personal-workbench-navigation'))
    const initialCount = scaffold.ctx.sessions.list().length
    const surface = page.locator('[data-workbench]')
    await surface.getByRole('button', { name: /1 conversations/ }).waitFor()
    await page.screenshot({ path: join(SHOTS, 'overview.png'), fullPage: true })
    await surface.getByRole('button', { name: /1 conversations/ }).click()
    expect(await surface.getByRole('textbox', { name: 'Filter by title or project' }).isVisible()).toBe(true)
    expect(scaffold.ctx.sessions.list().length).toBe(initialCount)
    await page.screenshot({ path: join(SHOTS, 'project.png'), fullPage: true })
    await surface.locator(`[data-workbench-session="${sessionId}"]`).click()
    await page.locator('[data-composer-input][contenteditable="true"]').waitFor({ timeout: 15_000 })
    expect(await surface.isVisible()).toBe(false)
    expect(scaffold.ctx.sessions.list().every(session => session.id === sessionId)).toBe(true)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('opens tools from the same navigation and restores the project route', async () => {
    await page.getByRole('button', { name: 'Capabilities & tools', exact: true }).click()
    const surface = page.locator('[data-workbench]')
    await surface.getByRole('heading', { name: 'Capabilities & tools', exact: true }).waitFor()
    expect(await surface.getByRole('button', { name: /Background queue/ }).isVisible()).toBe(true)
    await page.screenshot({ path: join(SHOTS, 'tools.png'), fullPage: true })
    await surface.getByRole('button', { name: /Background queue/ }).click()
    await page.getByRole('heading', { name: 'Task Queue', exact: true }).waitFor({ timeout: 15_000 })
    await page.getByRole('button', { name: 'Overview', exact: true }).click()
    await page.getByRole('heading', { name: 'Pick up where you left off' }).waitFor()
    expect(tripwire.pageErrors).toEqual([])
  })

  it('keeps the overview readable at phone width', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('heading', { name: 'Pick up where you left off' }).waitFor()
    await expect.poll(() => page.locator('[data-workbench]').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.screenshot({ path: join(SHOTS, 'mobile.png'), fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
    expect(tripwire.pageErrors).toEqual([])
  })

  it('shows a forked conversation when it is created from the initial workbench', async () => {
    const fresh = await newEnglishPage(browser)
    try {
      await fresh.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await fresh.getByRole('heading', { name: 'Pick up where you left off' }).waitFor()
      const tree = fresh.getByRole('tree', { name: 'Sessions' })
      const project = tree.locator('[role="treeitem"][aria-expanded]').first()
      await project.waitFor()
      if (await project.getAttribute('aria-expanded') === 'false') await project.click()
      await tree.locator('[role="treeitem"]:not([aria-expanded])').first().hover()
      await tree.getByRole('button', { name: /^Session actions for / }).first().click()
      await fresh.getByRole('menuitem', { name: 'Fork session', exact: true }).click()
      await fresh.locator('[data-composer-input][contenteditable="true"]').waitFor({ timeout: 15_000 })
      expect(await fresh.locator('[data-workbench]').isVisible()).toBe(false)
      expect(scaffold.ctx.sessions.list().some(session => session.id !== sessionId)).toBe(true)
    } catch (error) {
      console.error(await fresh.locator('body').ariaSnapshot())
      throw error
    } finally {
      await fresh.close()
    }
  })

  it('renders the Chinese overview and tools from the same live sources', async () => {
    const chinese = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    try {
      await chinese.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await chinese.getByRole('heading', { name: '继续手上的事', exact: true }).waitFor()
      await chinese.screenshot({ path: join(SHOTS, 'overview-zh.png'), fullPage: true })
      await chinese.getByRole('button', { name: '能力与工具', exact: true }).click()
      await chinese.getByRole('heading', { name: '能力与工具', exact: true }).waitFor()
      await chinese.getByRole('button', { name: /查看持久任务/ }).waitFor()
      await chinese.screenshot({ path: join(SHOTS, 'tools-zh.png'), fullPage: true })
    } finally {
      await chinese.close()
    }
  })
})
