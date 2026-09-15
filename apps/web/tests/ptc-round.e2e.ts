// PTC mode browser round trip with nested sub-calls and details selection.
// Record: DSH_SNAPSHOT=record writes session.v3.jsonl, then a keyless
// DSH_SNAPSHOT=refresh regenerates ui.expected.md.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  acknowledgeReloadConnectionLoss, captureExpandedTurnProcessAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, expandOwningTurnProcess, newEnglishPage, saveFailureShot } from './support.ts'

const PTC_PLATFORM = process.platform === 'win32'
  ? {
    tool: 'pwsh',
    command: 'Write-Output CODE_ROUND_OK',
    fixtureDir: 'ptc-round-pwsh',
  }
  : {
    tool: 'bash',
    command: 'echo CODE_ROUND_OK',
    fixtureDir: 'ptc-round',
  }
const PTC_ROW_ROOT_SELECTOR = process.platform === 'win32'
  ? `[data-tool="${PTC_PLATFORM.tool}"]`
  : '[data-sample="bash"]'
const PTC_ROW_CONTROL_SELECTOR = process.platform === 'win32'
  ? `${PTC_ROW_ROOT_SELECTOR} [data-disclosure-row]`
  : PTC_ROW_ROOT_SELECTOR
const FIXTURE = fileURLToPath(new URL(
  `../../../snapshots/web/${PTC_PLATFORM.fixtureDir}/session.v3.jsonl`,
  import.meta.url,
))
const UI_EXPECTED = fileURLToPath(new URL(
  `../../../snapshots/web/${PTC_PLATFORM.fixtureDir}/ui.expected.md`,
  import.meta.url,
))
const MODE = webSnapshotMode()

// Elicits the successful and failed sub-rows this scenario asserts.
const PROMPT = `Using ONE run_code program: run ${PTC_PLATFORM.tool} \`${PTC_PLATFORM.command}\`, then read the file missing.txt `
  + 'catching its error in the program. Return an object with both outcomes. Then reply DONE and stop.'

describe('web e2e: PTC mode round renders nested sub-calls', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  const sessionEvents: SessionEvent[] = []

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      agentPresets: { roots: [], default: 'ptc' },
      compareReplaySession: true,
      ...(MODE === 'record' ? {} : { replayFixture: FIXTURE, paceMs: 15 }),
    })
    scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { sessionEvents.push(event) })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('drives the recorded prompt to a settled turn (all modes)', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-ptc-drive'))
    if (MODE !== 'record') {
      expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    }
    const input = page.locator('[data-composer-input]').first()
    await input.waitFor({ timeout: 10_000 })
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    const sessionId = await settled
    if (MODE === 'record') {
      await recordFixture(scaffold, sessionId, FIXTURE)
    }
  }, 200_000)

  it.skipIf(MODE === 'record')('the durable log carries run_code with full-content sub-dispatches', () => {
    const calls = sessionEvents.filter(event => event.type === 'tool/call')
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(new Set(calls.map(call => (call.data as { name: string }).name))).toEqual(new Set(['run_code']))
    const starts = sessionEvents.filter(event => event.type === 'tool/ptc-dispatch-start')
    const dispatches = sessionEvents.filter(event => event.type === 'tool/ptc-dispatch')
    expect(dispatches.length).toBeGreaterThanOrEqual(2)
    for (const dispatch of dispatches) {
      const data = dispatch.data
      expect(calls.some(call => call.data.callId === data.rootCallId)).toBe(true)
      expect(data.parentCallId).toBe(data.rootCallId)
      expect(starts.filter(start => start.data.subCallId === data.subCallId)).toMatchObject([{
        data: {
          rootCallId: data.rootCallId,
          parentCallId: data.parentCallId,
          subCallId: data.subCallId,
          name: data.name,
          arguments: data.arguments,
        },
      }])
      expect(Array.isArray(data.content)).toBe(true)
      expect(typeof data.isError).toBe('boolean')
    }
    const shell = dispatches.find(dispatch => (dispatch.data as { name: string }).name === PTC_PLATFORM.tool)
    expect(shell).toBeDefined()
    const shellContent = (shell!.data as { content: { type: string; text?: string }[] }).content
    expect(shellContent.filter(block => block.type === 'text').map(block => block.text).join('')).toContain('CODE_ROUND_OK')
  })

  it.skipIf(MODE === 'record')('renders the code parent row with always-visible nested sub-rows', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-ptc-rows'))
    await expect.poll(() => page.getByText('DONE', { exact: true }).count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1)
    // The parent run_code row wears the code variant with the model-authored
    // description as its summary (the presentCall contract).
    const codeRow = page.locator('[data-variant="code"]').first()
    await expandOwningTurnProcess(page, codeRow)
    await codeRow.waitFor({ timeout: 10_000 })
    const nest = page.locator('[data-subcalls]').first()
    await nest.waitFor({ timeout: 10_000 })
    expect(await nest.locator(PTC_ROW_ROOT_SELECTOR).count()).toBeGreaterThanOrEqual(1)
    expect(await nest.locator('[data-state="error"]').count()).toBeGreaterThanOrEqual(1)
  }, 60_000)

  it.skipIf(MODE === 'record')('expands the nested bash terminal inline before and after reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-ptc-rightbar'))
    let liveTerminalAria: string | undefined
    for (const reloaded of [false, true]) {
      if (reloaded) {
        const warningStart = tripwire.warnings.length
        await page.reload({ waitUntil: 'load' })
        acknowledgeReloadConnectionLoss(tripwire, warningStart)
        await page.getByText('DONE', { exact: true }).waitFor({ timeout: 15_000 })
      }
      const nest = page.locator('[data-subcalls]').first()
      const frame = page.locator('[style*="grid-template-columns"]').first()
      // The current official AppFrame names the details/rightbar state with
      // `data-details-collapsed`; the old rightbar-specific marker belonged to
      // the pre-merge shell and is not part of the shipped contract.
      expect(await frame.getAttribute('data-details-collapsed')).toBe('true')
      await expandOwningTurnProcess(page, nest)
      const rowRoot = nest.locator(PTC_ROW_ROOT_SELECTOR).first()
      const row = nest.locator(PTC_ROW_CONTROL_SELECTOR).first()
      await expect.poll(() => rowRoot.getAttribute('data-state')).toBe('ok')
      await expect.poll(() => row.getAttribute('aria-expanded')).toBe('false')
      await row.click()
      await expect.poll(() => row.getAttribute('aria-expanded')).toBe('true')
      const terminal = rowRoot.locator('[data-terminal]')
      await terminal.waitFor()
      await terminal.getByText(PTC_PLATFORM.command, { exact: true }).waitFor()
      await terminal.getByText('CODE_ROUND_OK', { exact: true }).waitFor()
      await expect.poll(() => terminal.locator('[data-state]').getAttribute('data-state')).toBe('done')
      await expect.poll(() => frame.getAttribute('data-details-collapsed'), { timeout: 5_000 }).toBe('true')
      const aria = await terminal.ariaSnapshot()
      if (reloaded) expect(aria).toBe(liveTerminalAria)
      else liveTerminalAria = aria
    }
  })

  it.skipIf(MODE === 'record')('matches the expanded conversation aria golden with stable anchors', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-ptc-aria'))
    const row = page.locator(`[data-subcalls] ${PTC_ROW_CONTROL_SELECTOR}`).first()
    await expandOwningTurnProcess(page, row)
    if (await row.getAttribute('aria-expanded') !== 'true') await row.click()
    const snapshot = await captureExpandedTurnProcessAria(
      page,
      '[class*="centerCol"]',
      scaffold.workspaceCwd,
    )
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
  })

  it.skipIf(MODE === 'record')('stayed clean: no page errors, no reconnect churn', () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})
