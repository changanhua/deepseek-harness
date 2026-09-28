/** With-key check that two similar plans remain distinct across an ordinary conversation. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type { PlanningAccess, PlanningEstimate } from '@changanhua/dsh-planning'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { launchWebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, REPO_ROOT } from './support.ts'

const enabled = process.env.DSH_PLANNING_RETRIEVAL_LIVE === '1'
  && process.env.DEEPSEEK_API_KEY !== undefined
  && process.env.DSH_SNAPSHOT === 'record'
const artifacts = join(REPO_ROOT, '.artifacts/incremental-planning')
const estimate: PlanningEstimate = {
  value: null, urgency: null, reuse: null, compounding: null,
  timeCost: null, tokenCost: null, risk: null, cognitiveCost: null, rationale: '',
}

it.skipIf(!enabled)('finds two similar candidates and updates only the explicitly selected plan', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: join(REPO_ROOT, 'packages/bundle/personal-planning/cordis.patch.yml'),
    extraInstallAnchors: [join(REPO_ROOT, 'packages/bundle/personal-planning/package.json')],
    toolsMode: 'native',
    compareReplaySession: false,
  })
  const browser = await chromium.launch()
  const page = await newEnglishPage(browser)
  const observed: SessionEvent[] = []
  const off = scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { observed.push(event) })
  try {
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd, '.')
    const workspace = scaffold.hostCtx.workspaceRegistry.list().find(value => resolve(value.path) === resolve(scaffold.workspaceCwd))
    if (workspace === undefined) throw new Error('connected Workspace was not registered')
    const access: PlanningAccess = { workspaceId: workspace.id, actorId: 'acceptance', kind: 'human', authorize() {} }
    const planning = scaffold.hostCtx.get('planning')!
    const add = async (title: string, intent: string) => {
      const board = await planning.snapshot(access)
      await planning.execute(access, {
        kind: 'create', requestId: `create-${board.version}`, expectedBoardVersion: board.version,
        lane: 'next', title, intent, scope: [], acceptance: [],
        sources: [{ kind: 'manual', text: intent }], estimate, reviewAt: null,
      })
    }
    await add('保留讨论想法：离线缓存', '将讨论想法保留在本地离线缓存中。')
    await add('保留讨论想法：跨会话索引', '让讨论想法在不同会话中通过项目索引找回。')
    const initial = await planning.snapshot(access)
    const firstId = initial.items[0]?.id
    const secondId = initial.items[1]?.id
    if (firstId === undefined || secondId === undefined) throw new Error('two distinct plans were not created')
    const send = async (text: string) => {
      const input = page.locator('[data-composer-input][contenteditable="true"]').last()
      const settled = scaffold.whenTurnSettled(180_000)
      await input.fill(text)
      await input.press('Enter')
      await settled
    }

    const input = page.locator('[data-composer-input][contenteditable="true"]').last()
    const disambiguationSettled = scaffold.whenTurnSettled(180_000)
    await input.fill('项目里有两条“保留讨论想法”的计划。我想继续上次那条，先把两个候选及区别告诉我；现在别修改任何一条。')
    await input.press('Enter')
    const composer = page.locator('[data-question-key]')
    await expect.poll(
      async () => (await composer.count()) > 0 || observed.some(event => event.type === 'turn/end'),
      { timeout: 180_000 },
    ).toBe(true)
    if (await composer.count() > 0) {
      await expect.poll(() => composer.getByRole('radio', { name: /离线缓存/u }).count()).toBe(1)
      const choice = composer.getByRole('radio', { name: /跨会话索引/u })
      await expect.poll(() => choice.count()).toBe(1)
      await choice.click()
      await choice.press('Enter')
    } else {
      await expect.poll(() => page.getByText('离线缓存', { exact: false }).count()).toBeGreaterThan(0)
      await expect.poll(() => page.getByText('跨会话索引', { exact: false }).count()).toBeGreaterThan(0)
    }
    await disambiguationSettled
    expect(await planning.snapshot(access)).toEqual(initial)
    const listCalls = observed.filter(event => event.type === 'tool/call' && event.data.name === 'planning_list')
    expect(listCalls.length).toBeGreaterThan(0)

    await send('我选“跨会话索引”那条。请直接在原计划上补充：找回时要能看到原始会话出处；不要创建新计划，也不要改离线缓存那条。')
    const revised = await planning.snapshot(access)
    expect(revised.items).toHaveLength(2)
    expect(revised.items[0]?.id).toBe(firstId)
    expect(revised.items[0]?.headRevisionId).toBe(initial.items[0]?.headRevisionId)
    expect(revised.items[1]?.id).toBe(secondId)
    expect(revised.items[1]?.revisions.length).toBeGreaterThan(initial.items[1]!.revisions.length)
    expect(JSON.stringify(revised.items[1]?.revisions.at(-1))).toContain('原始会话')
    await mkdir(artifacts, { recursive: true })
    await writeFile(join(artifacts, 'task12-retrieval-live-summary.json'), JSON.stringify({
      workspaceId: workspace.id,
      firstId,
      secondId,
      firstRevisionId: revised.items[0]?.headRevisionId,
      secondRevisionId: revised.items[1]?.headRevisionId,
      planningListCalls: listCalls.length,
      boardVersion: revised.version,
    }, null, 2))
  } catch (error) {
    await mkdir(artifacts, { recursive: true })
    await writeFile(join(artifacts, 'task12-retrieval-live-failure.json'), JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      events: observed.map(event => ({
        type: event.type,
        ...(event.type === 'tool/call' ? { tool: event.data.name } : {}),
      })),
    }, null, 2))
    await page.screenshot({ path: join(artifacts, 'task12-retrieval-live-failure.png'), fullPage: true })
    throw error
  } finally {
    off()
    await browser.close()
    await scaffold.close()
  }
}, 720_000)
