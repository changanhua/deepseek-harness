import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterEach, expect, it } from 'vitest'
import {
  launchWebScaffold, watchConsole, type WebScaffold,
} from './scaffold.ts'
import { ZH_BROWSER_LOCALE } from './support.ts'

let scaffold: WebScaffold | undefined
let browser: Browser | undefined
let page: Page | undefined

afterEach(async () => {
  await browser?.close()
  await scaffold?.close()
  page = undefined
  browser = undefined
  scaffold = undefined
})

function todayRange(): { from: number; to: number } {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
  return { from, to }
}

it('records main-document activity after the retained client-state limit is reached', async () => {
  scaffold = await launchWebScaffold()
  const observatory = scaffold.ctx.workObservatory
  expect(observatory.typertRemote.namespace).toBe('workObservatory')
  for (let index = 0; index < 128; index += 1) {
    await observatory.observeClient({
      clientId: `retained-${index}`,
      seq: 0,
      visible: false,
      active: false,
    })
  }

  browser = await chromium.launch()
  page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: ZH_BROWSER_LOCALE })
  const tripwire = watchConsole(page)
  await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
  await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  await page.bringToFront()
  await page.evaluate(() => {
    window.dispatchEvent(new FocusEvent('focus'))
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }))
  })
  await page.waitForTimeout(1_100)
  await page.evaluate(() => { window.dispatchEvent(new FocusEvent('blur')) })

  await expect.poll(
    async () => (await observatory.readRange(todayRange())).summary.humanActiveMs,
    { timeout: 5_000, interval: 100 },
  ).toBeGreaterThan(0)

  await page.getByRole('button', { name: /^(更多|More)$/u }).click()
  await page.getByRole('button', { name: /^(工作观测|Work Observatory)$/u }).click()
  await page.getByRole('button', { name: /^(刷新|Refresh)$/u }).click()
  const humanActive = page.getByText(/^(人类活跃|Human active)$/u).locator('..').locator('dd')
  await expect.poll(() => humanActive.textContent(), { timeout: 5_000 }).not.toMatch(/^0(?:秒|s)$/u)
  expect(tripwire.pageErrors).toEqual([])
})
