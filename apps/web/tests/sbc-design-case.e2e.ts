import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type Planning from '@changanhua/dsh-planning'
import type { PlanningBoardRecord } from '@changanhua/dsh-planning/types'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

let app: WebScaffold
let browser: Browser
let page: Page
let planning: Planning
let workspaceId: string
let planId: string
let title: string
const signal = new AbortController().signal
beforeAll(async () => {
  app = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('../../../packages/bundle/personal-planning/cordis.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('../../../packages/bundle/personal-planning/package.json', import.meta.url))],
  })
  const workspace = await app.hostCtx.workspaceRegistry.create(app.workspaceCwd)
  workspaceId = String(workspace.id)
  const owner = [...app.ctx.loader.entries()].find(entry => entry.options.id === 'planning-local')?.ctx
  if (!owner) throw new Error('Planning provider did not mount')
  planning = owner.get('planning') as Planning
  if (process.env.SBC_ACCEPTANCE_BOARD) {
    // Opt-in local acceptance copies canonical records into the hermetic test home; the original file is read-only.
    const document = JSON.parse(await readFile(process.env.SBC_ACCEPTANCE_BOARD, 'utf8')) as {
      tables: { boards: Record<string, PlanningBoardRecord> }
    }
    const board = Object.values(document.tables.boards).find(value =>
      value.items.some(item => item.revisions.some(revision => /fc27/iu.test(revision.title))))
    if (!board) throw new Error('Acceptance Board contains no FC27 Plan')
    const domain = app.hostCtx.storageDomain.get('planning_boards')
    if (!domain) throw new Error('Planning domain is unavailable')
    await domain.table('boards').put(workspaceId, { ...board, workspaceId })
  } else {
    await planning.execute({ workspaceId, actorId: 'browser-test', kind: 'human', authorize: () => {} }, {
      kind: 'create', requestId: 'sbc-browser-plan', expectedBoardVersion: 0, itemId: 'fc27-sbc', lane: 'now',
      title: 'FC27 SBC 半自动化', intent: '先完成 SBC 的可靠纵切，再扩展其他 FC27 功能。',
      stateEntries: [
        { id: 'goal', kind: 'objective', content: '完成一个需要人工确认提交的 SBC 纵切。' },
        { id: 'owner', kind: 'accepted', content: '正式状态由 Planning 管理' },
        { id: 'approval', kind: 'accepted', content: '购买与提交保留人工确认' },
        { id: 'scope', kind: 'open', content: '首个纵切覆盖哪些步骤？' },
        { id: 'recovery', kind: 'open', content: '失败后如何恢复？' },
      ],
      scope: [], acceptance: [], sources: [{ kind: 'manual', text: 'controlled browser fixture' }],
      estimate: { value: null, urgency: null, reuse: null, compounding: null, timeCost: null,
        tokenCost: null, risk: null, cognitiveCost: null, rationale: '' }, reviewAt: null,
    }, signal)
  }
  const board = await planning.snapshot({ workspaceId, actorId: 'browser-test', kind: 'human', authorize: () => {} }, signal)
  const item = board.items.find(value => value.revisions.some(revision => /fc27/iu.test(revision.title)))
  if (!item) throw new Error('FC27 Plan is missing')
  planId = item.id
  title = item.revisions.find(revision => revision.id === item.headRevisionId)?.title ?? ''
  const caseOwner = app.hostCtx.get('planningRemote') as unknown as import('../../../packages/planning/planning-remote/src/index.ts').PlanningRemoteService
  await caseOwner.sbcDesignCase({ workspaceId, subject: { kind: 'plan', id: planId } }, signal)
  const access = { workspaceId, actorId: 'browser-test', kind: 'human' as const, authorize: () => {} }
  const currentBoard = await planning.snapshot(access, signal)
  await planning.execute(access, { kind: 'create', requestId: 'ordinary-plan', expectedBoardVersion: currentBoard.version,
    itemId: 'architecture-plan', title: 'Browser workflow design', intent: '', lane: 'next', scope: [], acceptance: [],
    sources: [{ kind: 'manual', text: 'Ordinary non-FC27 fixture' }], reviewAt: null,
    estimate: { value: null, urgency: null, reuse: null, compounding: null, timeCost: null,
      tokenCost: null, risk: null, cognitiveCost: null, rationale: '' },
  }, signal)
  browser = await chromium.launch()
  page = await newEnglishPage(browser)
  const consoleState = watchConsole(page)
  await page.goto(app.authenticatedUrl, { waitUntil: 'load' })
  await page.getByText('More', { exact: true }).click()
  await page.getByRole('button', { name: /^Planning/u }).click({ timeout: 10000 }).catch(async (error: unknown) => {
    throw new Error(`${String(error)}\n${await page.locator('body').innerText()}\n${JSON.stringify(consoleState)}`)
  })
  await page.getByRole('combobox', { name: /^Project/u }).selectOption(workspaceId, { timeout: 8000 }).catch(async (error: unknown) => {
    throw new Error(`${String(error)}\n${await page.locator('body').innerText()}\n${JSON.stringify(consoleState)}`)
  })
  await page.getByRole('button', { name: title, exact: true }).click()
}, 120000)
afterAll(async () => { await browser?.close(); await app?.close() })

it('opens an ordinary Plan without creating a domain-specific exploration', async () => {
  const access = { workspaceId, actorId: 'browser-test', kind: 'human' as const, authorize: () => {} }
  const before = await planning.snapshot(access, signal)
  await page.getByRole('button', { name: 'All plans', exact: true }).click()
  await page.getByRole('button', { name: 'Browser workflow design', exact: true }).click()
  await page.getByRole('tab', { name: 'Thinking desk', exact: true }).click()
  await page.getByText('No design cases yet', { exact: true }).waitFor()
  expect(await page.getByRole('button', { name: 'Open design', exact: true }).count()).toBe(0)
  expect(await planning.snapshot(access, signal)).toEqual(before)
  await page.getByRole('button', { name: 'All plans', exact: true }).click()
  await page.getByRole('button', { name: title, exact: true }).click()
})

it('uses generated Remote for drag, selection, reload, undo and visible revision drift', async () => {
  const access = { workspaceId, actorId: 'browser-test', kind: 'human' as const, authorize: () => {} }
  const before = await planning.snapshot(access, signal)
  await page.getByRole('tab', { name: 'Thinking desk', exact: true }).click()
  await page.getByRole('button', { name: 'Open design', exact: true }).click()
  const surface = page.getByRole('region', { name: 'FC27 SBC Design Case', exact: true })
  const card = surface.getByRole('button', { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u') }).first()
  await card.waitFor()
  const box = await card.boundingBox()
  if (!box) throw new Error('SBC card is not visible')
  await page.mouse.move(box.x + 30, box.y + 20)
  await page.mouse.down()
  await page.mouse.move(box.x + 110, box.y + 80, { steps: 4 })
  await page.mouse.up()
  await expect.poll(async () => (await card.boundingBox())?.x).toBeCloseTo(box.x + 80, 0)
  await expect.poll(async () => card.isEnabled()).toBe(true)
  await card.click()
  await expect.poll(() => card.getAttribute('aria-pressed')).toBe('true')
  expect(await planning.snapshot(access, signal)).toEqual(before)
  await surface.getByRole('button', { name: 'Close Design Case' }).click()
  await page.getByRole('tab', { name: 'Thinking desk', selected: true }).waitFor()
  await page.getByRole('button', { name: 'Open design', exact: true }).click()
  await expect.poll(async () => (await card.boundingBox())?.x).toBeCloseTo(box.x + 80, 0)
  await surface.getByRole('button', { name: 'Reload Design Case' }).click()
  await expect.poll(async () => (await card.boundingBox())?.x).toBeCloseTo(box.x + 80, 0)
  await expect.poll(async () => card.isEnabled()).toBe(true)
  const head = before.items.find(item => item.id === planId)?.headRevisionId
  if (!head) throw new Error('Plan revision missing')
  await planning.execute(access, { kind: 'workspace-change', requestId: 'browser-drift',
    expectedBoardVersion: before.version, subject: { kind: 'plan', id: planId }, baseRevision: head,
    operations: [{ kind: 'add-state-entry', entry: { id: 'browser-new-state', kind: 'open', content: 'New canonical question' } }],
  }, signal)
  await surface.getByRole('button', { name: 'Reload Design Case' }).click()
  await surface.getByRole('status').filter({ hasText: 'Revision drift' }).waitFor()
  expect(await surface.getByText('New canonical question').count()).toBe(0)
  await surface.getByRole('button', { name: 'Close Design Case' }).click()
  await page.getByRole('status').filter({ hasText: 'Revision drift' }).waitFor()
  if (process.env.PUI_ACCEPTANCE_DIR) await page.screenshot({ path: `${process.env.PUI_ACCEPTANCE_DIR}/thinking-desk.png`, fullPage: true })
  await page.getByRole('tab', { name: 'Current state' }).click()
  await page.getByText('New canonical question', { exact: true }).waitFor()
  if (process.env.PUI_ACCEPTANCE_DIR) await page.screenshot({ path: `${process.env.PUI_ACCEPTANCE_DIR}/plan-workspace.png`, fullPage: true })
  const viewport = page.viewportSize()
  await page.setViewportSize({ width: 420, height: 900 })
  expect(await page.getByRole('tabpanel', { name: 'Current state', exact: true }).evaluate(element =>
    element.scrollWidth <= element.clientWidth)).toBe(true)
  if (process.env.PUI_ACCEPTANCE_DIR) await page.screenshot({ path: `${process.env.PUI_ACCEPTANCE_DIR}/planning-narrow.png`, fullPage: true })
  if (viewport) await page.setViewportSize(viewport)
  await page.getByRole('button', { name: 'All plans', exact: true }).click()
  if (process.env.PUI_ACCEPTANCE_DIR) await page.screenshot({ path: `${process.env.PUI_ACCEPTANCE_DIR}/planning-overview.png`, fullPage: true })
  await page.getByRole('button', { name: title, exact: true }).click()
  await page.getByRole('tab', { name: 'Thinking desk', exact: true }).click()
  await page.getByRole('button', { name: 'Open design', exact: true }).click()
  await surface.getByRole('button', { name: 'Undo movement' }).click()
  await expect.poll(async () => (await card.boundingBox())?.x).toBeCloseTo(box.x, 0)
  await expect.poll(async () => card.isEnabled()).toBe(true)
  if (process.env.SBC_ACCEPTANCE_SCREENSHOT) await surface.screenshot({ path: process.env.SBC_ACCEPTANCE_SCREENSHOT })
  await page.reload({ waitUntil: 'load' })
  await page.getByText('More', { exact: true }).click()
  await page.getByRole('button', { name: /^Planning/u }).click()
  await page.getByRole('combobox', { name: /^Project/u }).selectOption(workspaceId)
  await page.getByRole('button', { name: title, exact: true }).click()
  await page.getByRole('tab', { name: 'Thinking desk', exact: true }).click()
  await page.getByRole('button', { name: 'Open design', exact: true }).click()
  await surface.getByRole('status').filter({ hasText: 'Revision drift' }).waitFor()
  await expect.poll(() => card.getAttribute('aria-pressed')).toBe('true')
}, 90000)

it.runIf(Boolean(process.env.PUI_ACCEPTANCE_DIR))('captures the composed Chinese Planning surface', async () => {
  const visual = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1050 } })
  try {
    await visual.goto(app.authenticatedUrl, { waitUntil: 'load' })
    await visual.getByText('更多', { exact: true }).click()
    await visual.getByRole('button', { name: /计划/u }).click()
    await visual.getByRole('combobox', { name: /^项目/u }).selectOption(workspaceId)
    await visual.getByRole('button', { name: title, exact: true }).click()
    await visual.getByRole('tab', { name: '当前状态', selected: true }).waitFor()
    await visual.screenshot({ path: `${process.env.PUI_ACCEPTANCE_DIR}/planning-polished-current.png`, fullPage: true })
    await visual.getByRole('tab', { name: '思考桌面', exact: true }).click()
    await visual.getByRole('button', { name: '打开设计', exact: true }).waitFor()
    await visual.screenshot({ path: `${process.env.PUI_ACCEPTANCE_DIR}/planning-polished-thinking.png`, fullPage: true })
    await visual.getByRole('button', { name: '全部计划', exact: true }).click()
    await visual.screenshot({ path: `${process.env.PUI_ACCEPTANCE_DIR}/planning-polished-overview.png`, fullPage: true })
    await visual.setViewportSize({ width: 760, height: 1000 })
    const planningRegion = visual.getByRole('region', { name: '项目计划池', exact: true })
    expect(await planningRegion.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await visual.screenshot({ path: `${process.env.PUI_ACCEPTANCE_DIR}/planning-polished-narrow.png`, fullPage: true })
  } finally { await visual.close() }
})
