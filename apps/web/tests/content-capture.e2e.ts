// Keyless browser regression for the content-library capture loop. Cold-seeds
// a transcript with one settled pure-text reply (eligible for capture) and one
// mixed reasoning+text reply (ineligible), captures the pure-text reply through
// the real message-action strip, reads the committed original back in the
// library workspace, and proves the entry survives a full page reload. Storage
// durability across a process restart is covered by the HTTP composed lane.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  launchWebScaffold, seedSession, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const MODE = webSnapshotMode()
const SEED_ID = 'content-capture-web-e2e'

/** A settled recording: turn 1 is pure text, turn 2 mixes reasoning with text.
 *  The seed header omits cwd: seedSession stamps the real workspace into the
 *  session meta, and the scaffold's token rewrite is not Windows-safe. */
const SEED = [
  '{"type":"session","version":0,"id":"{{session:1}}","createdAt":1784974100747}',
  '{"type":"turn/start","data":{"turn":1,"trigger":{"kind":"message","source":{"kind":"user","rpcId":"{{rpc:1}}"}}}}',
  '{"type":"user/message","data":{"content":[{"type":"text","text":"Reply with exactly: Capture me please"}],"source":{"kind":"user","rpcId":"{{rpc:1}}"}},"surfaceOp":"append"}',
  '{"type":"step/start","data":{"turn":1,"step":1}}',
  '{"type":"assistant/message","data":{"turn":1,"step":1,"content":[{"type":"text","text":"Capture me please"}],"provenance":{"provider":"deepseek-official","model":"deepseek-v4-flash"},"usage":{"inputTokens":12,"outputTokens":4}},"surfaceOp":"append"}',
  '{"type":"step/end","data":{"turn":1,"step":1}}',
  '{"type":"turn/end","data":{"turn":1,"reason":{"kind":"completed"}}}',
  '{"type":"turn/start","data":{"turn":2,"trigger":{"kind":"message","source":{"kind":"user","rpcId":"{{rpc:2}}"}}}}',
  '{"type":"user/message","data":{"content":[{"type":"text","text":"Think briefly, then reply: Done thinking"}],"source":{"kind":"user","rpcId":"{{rpc:2}}"}},"surfaceOp":"append"}',
  '{"type":"step/start","data":{"turn":2,"step":1}}',
  '{"type":"assistant/message","data":{"turn":2,"step":1,"content":[{"type":"reasoning","text":"The user asked for a short think step."},{"type":"text","text":"Done thinking"}],"provenance":{"provider":"deepseek-official","model":"deepseek-v4-flash"},"usage":{"inputTokens":14,"outputTokens":6}},"surfaceOp":"append"}',
  '{"type":"step/end","data":{"turn":2,"step":1}}',
  '{"type":"turn/end","data":{"turn":2,"reason":{"kind":"completed"}}}',
].join('\n')

describe('web e2e: content library capture', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, SEED, SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /** Open the seeded session from the collapsed-by-default sidebar tree. */
  async function openSeededSession(): Promise<void> {
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    if (await groupRow.getAttribute('aria-expanded') !== 'true') await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 15_000 })
    await sessionRow.click()
  }

  it.skipIf(MODE === 'record')('captures the pure-text reply and reads it back after a reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-content-capture'))
    await openSeededSession()

    // Both finalized replies render action strips, but only the pure-text one
    // offers capture.
    await page.getByText('Capture me please').first().waitFor({ timeout: 30_000 })
    const capture = page.getByRole('button', { name: 'Capture to library' })
    await capture.first().waitFor({ timeout: 30_000 })
    await capture.first().scrollIntoViewIfNeeded()
    expect(await capture.count()).toBe(1)

    // One click commits; the strip settles into the captured state naming the
    // entry, and a repeated click cannot produce a second capture.
    await capture.first().hover()
    await capture.first().click()
    const captured = page.getByRole('button', { name: /^Captured: source_/u })
    await expect.poll(() => captured.count(), { timeout: 15_000 }).toBe(1)
    const entryId = (await captured.getAttribute('aria-label'))?.replace('Captured: ', '')
    expect(entryId).toMatch(/^source_/u)

    // The library workspace lists the committed original. A capture carries
    // no title — the session header has no title field, and the resolver's
    // contract (pinned in content-session.spec.ts) yields '' — so the row is
    // located by its capture badge, and the committed body renders in the
    // detail the row click expands.
    await page.getByRole('button', { name: 'Content Library' }).first().click()
    const entryRow = page.getByRole('button', { name: /Session capture/u })
    await entryRow.waitFor({ timeout: 30_000 })
    await entryRow.click()
    const detailBody = page.locator('li').filter({ has: entryRow }).locator('pre')
    await detailBody.waitFor({ timeout: 10_000 })
    expect(await detailBody.textContent()).toBe('Capture me please')
    await page.getByRole('button', { name: 'Refresh' }).waitFor({ timeout: 10_000 })

    // A full page reload reads the same committed entry back from the Host.
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.getByRole('button', { name: 'Content Library' }).first().click()
    const reloadedRow = page.getByRole('button', { name: /Session capture/u })
    await reloadedRow.waitFor({ timeout: 30_000 })
    await reloadedRow.click()
    const reloadedBody = page.locator('li').filter({ has: reloadedRow }).locator('pre')
    await reloadedBody.waitFor({ timeout: 10_000 })
    expect(await reloadedBody.textContent()).toBe('Capture me please')
  }, 120_000)
})
