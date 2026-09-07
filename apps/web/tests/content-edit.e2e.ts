// Keyless browser regression for the content-library edit loop. Builds on the
// capture e2e: it creates a manual entry from the empty library, saves its
// draft, commits a version, and toggles favorite, proving each step through
// the real Remote and SQLite store and surviving a full page reload. A second
// browser page then races the same entry on a stale base so the UI must render
// the revision-conflict surface, and "keep my edit" retries on the fresh base.
// Storage durability across a process restart is covered by the HTTP composed
// lane and the capture e2e's reload assertion.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, webSnapshotMode, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()

describe('web e2e: content library editing', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /** Reach the library workspace; the sidebar module button is a toggle, so
   *  it is only clicked when the workspace heading is not already shown. */
  async function openLibrary(target: Page): Promise<void> {
    const heading = target.getByRole('heading', { name: 'Content Library' })
    if ((await heading.count()) === 0) {
      await target.getByRole('button', { name: 'Content Library' }).first().click()
    }
    await heading.waitFor({ timeout: 30_000 })
  }

  /** Guarantee one manual entry exists, creating it through the editor when
   *  the library is empty, so each test stands alone. */
  async function ensureEntry(target: Page): Promise<void> {
    await openLibrary(target)
    const row = target.getByRole('button', { name: /Manual entry/u })
    if ((await row.count()) > 0) return
    // A slow render after a remount can still be incoming; give it one beat
    // before minting a duplicate entry.
    try {
      await row.first().waitFor({ timeout: 3_000 })
      return
    } catch {
      // Genuinely empty.
    }
    await target.getByRole('button', { name: 'New entry' }).click()
    await target.getByLabel('Title').fill('Design scratchpad')
    await target.getByLabel('Body').fill('First working text')
    await target.getByRole('button', { name: 'Create' }).click()
    await row.first().waitFor({ timeout: 30_000 })
  }

  /** Expand the entry's detail pane when it is not already open. */
  async function expandEntry(target: Page): Promise<void> {
    const row = target.getByRole('button', { name: /Manual entry/u })
    if (await row.getAttribute('aria-expanded') !== 'true') await row.click()
    await target.getByRole('button', { name: 'Edit' }).waitFor({ timeout: 30_000 })
  }

  it.skipIf(MODE === 'record')('creates an entry, saves its draft, and commits a version that survives a reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-content-edit'))

    // The empty library renders its hint; the header offers the new entry.
    await openLibrary(page)
    await page.getByText('Nothing has been captured yet.').waitFor({ timeout: 30_000 })
    await page.getByRole('button', { name: 'New entry' }).click()

    const title = page.getByLabel('Title')
    const body = page.getByLabel('Body')
    await title.fill('Design scratchpad')
    await body.fill('First working text')
    await page.getByRole('button', { name: 'Create' }).click()

    // The created idea entry lists with a draft badge and stays in the editor.
    const row = page.getByRole('button', { name: /Manual entry/u })
    await row.waitFor({ timeout: 30_000 })
    expect(await row.count()).toBe(1)
    await page.getByLabel('Body').waitFor({ timeout: 10_000 })

    // A draft save lands on the Host and the editor confirms it.
    await page.getByLabel('Body').fill('Second working text')
    await page.getByRole('button', { name: 'Save draft' }).click()
    await page.getByText('Draft saved').waitFor({ timeout: 30_000 })

    // Committing closes the editor and folds the draft into the first version.
    await page.getByLabel('Body').fill('Committed text')
    await page.getByRole('button', { name: /Commit version/ }).click()
    await page.getByRole('button', { name: /1 versions/u }).waitFor({ timeout: 30_000 })

    // A full page reload reads the committed version back from the Host.
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openLibrary(page)
    await expandEntry(page)
    const reloaded = page.getByRole('button', { name: /Manual entry/u })
    await page.locator('li').filter({ has: reloaded }).locator('pre').waitFor({ timeout: 10_000 })
    expect(await page.locator('li').filter({ has: reloaded }).locator('pre').textContent()).toBe('Committed text')
  }, 120_000)

  it.skipIf(MODE === 'record')('toggles favorite through metadata and survives a reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-content-edit-favorite'))
    await ensureEntry(page)
    await expandEntry(page)

    await page.getByRole('button', { name: 'Favorite', exact: true }).click()
    await page.getByRole('button', { name: 'Remove favorite' }).waitFor({ timeout: 30_000 })

    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openLibrary(page)
    // The favorite badge on the row proves the metadata persisted.
    await page.getByText('Favorite', { exact: true }).first().waitFor({ timeout: 30_000 })
  }, 120_000)

  it('renders the revision-conflict surface when another window committed first', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-content-edit-conflict'))
    await ensureEntry(page)
    await expandEntry(page)
    await page.getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel('Body').waitFor({ timeout: 30_000 })

    // The racing window commits a fresh version from the current head while
    // this page still edits against the stale one.
    const second = await newEnglishPage(browser)
    await second.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await second.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await ensureEntry(second)
    await expandEntry(second)
    await second.getByRole('button', { name: 'Edit' }).click()
    await second.getByLabel('Body').fill('Racing window text')
    await second.getByRole('button', { name: /Commit version/ }).click()
    await second.getByRole('button', { name: /2 versions/u }).waitFor({ timeout: 30_000 })
    await second.close()

    // The stale save hits the conflict; the editor shows both sides and the
    // re-read library text, and "keep my edit" retries on the fresh base.
    await page.getByLabel('Body').fill('Stale window text')
    await page.getByRole('button', { name: 'Save draft' }).click()
    const conflict = page.getByRole('alert')
    await conflict.waitFor({ timeout: 30_000 })
    expect(await conflict.textContent()).toContain('This content changed in another window.')
    expect(await conflict.textContent()).toContain('Racing window text')

    await page.getByRole('button', { name: 'Keep my edit' }).click()
    await page.getByRole('button', { name: 'Save draft' }).click()
    await page.getByText('Draft saved').waitFor({ timeout: 30_000 })

    // The kept side is now the persisted draft in the library.
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openLibrary(page)
    const finalRow = page.getByRole('button', { name: /Draft in progress/u })
    await finalRow.first().waitFor({ timeout: 30_000 })
  }, 120_000)
})
