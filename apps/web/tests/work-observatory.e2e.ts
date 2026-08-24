// Work Observatory W1-W4 acceptance over the shipped Web composition. Browser
// interaction reaches the Host through the real tracker and BFF, and Settings
// reads the resulting range through the same BFF. Client fiber HMR cleanup and
// Host replay idempotence are pinned in the package suites that own those
// lifecycles; this file covers their assembled browser/reload consequences.

import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acknowledgeReloadConnectionLoss, launchWebScaffold, watchConsole, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

/** Minimum active sample that renders as a non-zero whole-second KPI. */
const ACTIVE_SAMPLE_MS = 1_100

/** Today's local-midnight half-open epoch range, matching the section's own resolver. */
function todayRange(): { from: number; to: number } {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  return { from, to }
}

/** Drive a real interaction the tracker's document listener records. Focus is
 * re-dispatched in the same tick so the `focused` gate is true at `keydown`. */
async function interact(p: Page): Promise<void> {
  await p.evaluate(() => {
    window.dispatchEvent(new FocusEvent('focus'))
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }))
  })
}

/** Close a measurable active interval, then restore focus for later UI actions. */
async function recordActiveInterval(scaffold: WebScaffold, p: Page): Promise<number> {
  const before = woRange(scaffold).summary.humanActiveMs
  await interact(p)
  await p.waitForTimeout(ACTIVE_SAMPLE_MS)
  await p.evaluate(() => { window.dispatchEvent(new FocusEvent('blur')) })
  await expect.poll(
    () => woRange(scaffold).summary.humanActiveMs,
    { timeout: 5_000, interval: 100 },
  ).toBeGreaterThan(before)
  await p.evaluate(() => { window.dispatchEvent(new FocusEvent('focus')) })
  return woRange(scaffold).summary.humanActiveMs
}

/** Read the Host Work Observatory range through a typed cast: the e2e lane is
 * a host-side program, but `scaffold.ctx` carries the client program's Context
 * type, so the service is reached structurally. */
function woRange(scaffold: WebScaffold): {
  summary: { humanActiveMs: number; pageVisibleMs: number }
  timeline: { humanActive: Array<{ start: number; end: number }> }
} {
  return (scaffold.ctx as unknown as {
    workObservatory: { range(input: { from: number; to: number }): ReturnType<typeof woRange> }
  }).workObservatory.range(todayRange())
}

/** Open Settings → Work Observatory and wait for the section body. */
async function openObservatorySection(page: Page): Promise<void> {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '设置' })
  await dialog.waitFor({ timeout: 10_000 })
  await dialog.getByRole('button', { name: '工作观测' }).click()
  await expect.poll(() => page.getByText('人类活跃').count(), { timeout: 10_000 }).toBeGreaterThan(0)
}

describe('web e2e: Work Observatory vertical (W1–W4)', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.bringToFront()
    await page.evaluate(() => { window.dispatchEvent(new FocusEvent('focus')) })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('W1: records Human Active from main-document activity without opening Observatory', async () => {
    // Activity is recorded before the first visit to Settings/Observatory.
    const activityAt = Date.now()
    await recordActiveInterval(scaffold, page)
    const result = woRange(scaffold)
    const covers = result.timeline.humanActive.some(
      interval => interval.start <= activityAt + 5_000 && interval.end >= activityAt,
    )
    expect(covers).toBe(true)

    await openObservatorySection(page)
    const humanActiveKpi = page.getByText('人类活跃', { exact: true }).locator('..').locator('span').first()
    await expect.poll(() => humanActiveKpi.textContent(), { timeout: 5_000 }).not.toBe('0s')
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 15_000)

  it('W2: opening and closing Observatory does not control the tracker', async () => {
    await openObservatorySection(page)
    await page.keyboard.press('Escape')
    const dialog = page.getByRole('dialog', { name: '设置' })
    await expect.poll(() => dialog.isVisible(), { timeout: 5_000 }).toBe(false)

    const before = woRange(scaffold).summary.humanActiveMs
    const after = await recordActiveInterval(scaffold, page)
    expect(after).toBeGreaterThan(before)
    expect(tripwire.pageErrors).toEqual([])
  }, 15_000)

  it('W4: the section reads the range through the real BFF, not a mock', async () => {
    await page.getByRole('button', { name: '设置', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.waitFor({ timeout: 10_000 })
    let rangeCalls = 0
    await page.route('**/api/workObservatory/range*', async (route) => {
      rangeCalls += 1
      await route.continue()
    })
    await dialog.getByRole('button', { name: '工作观测' }).click()
    await expect.poll(() => page.getByText('人类活跃').count(), { timeout: 10_000 }).toBeGreaterThan(0)
    await expect.poll(() => rangeCalls, { timeout: 10_000 }).toBeGreaterThanOrEqual(1)
    await page.unroute('**/api/workObservatory/range*')
    await page.keyboard.press('Escape')
    expect(tripwire.pageErrors).toEqual([])
  }, 30_000)

  it('W3: a reloaded document resumes producing observations', async () => {
    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.bringToFront()
    await page.evaluate(() => { window.dispatchEvent(new FocusEvent('focus')) })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)

    const before = woRange(scaffold).summary.humanActiveMs
    const after = await recordActiveInterval(scaffold, page)
    expect(after).toBeGreaterThan(before)
    expect(tripwire.pageErrors).toEqual([])
  }, 15_000)
})
