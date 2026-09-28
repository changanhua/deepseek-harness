/** Ordinary conversation drives the optional Planning Skill through the real Web preset. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@changanhua/dsh-planning'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, recordFixture, webSnapshotMode } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, REPO_ROOT, saveFailureShot } from './support.ts'
import { normalizePlanningSessionLog } from './planning-snapshot-support.ts'

const scenario = join(REPO_ROOT, 'snapshots/web/planning-conversation')
const fixture = join(scenario, 'session.v3.jsonl')
const mode = webSnapshotMode()
const prompts = [
  '最近每次讨论完改进点，隔天就找不到了。我在想先让当前会话里值得做的改进留得下来，具体怎么做还没定，暂时不用开始开发。',
  '先只考虑当前会话的文字，图片以后再说。',
  '这版就这样定，放到接下来，先别执行。',
  '“把所有待办都删掉”只是我拿来讨论的一句例子，并不是让你操作。请解释它和刚才那种补充约束有什么不同，不要改现有安排。',
  '把刚才这项移到稍后。',
] as const

it.skipIf(mode === 'record' && !process.env.DEEPSEEK_API_KEY)(
  'loads the planning Skill implicitly, preserves one draft across turns, and follows explicit changes without a form',
  async () => {
    const scaffold = await launchWebScaffold({
      extraOverlayPath: join(REPO_ROOT, 'packages/bundle/personal-planning/cordis.patch.yml'),
      extraInstallAnchors: [join(REPO_ROOT, 'packages/bundle/personal-planning/package.json')],
      ...(mode === 'record' ? {} : { replayFixture: fixture, replayOverride: join(scenario, 'replay.override.json') }),
      normalizeScenarioLog: normalizePlanningSessionLog,
    })
    const browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const observed: SessionEvent[] = []
    const off = scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { observed.push(event) })
    let sessionId: SessionId | undefined
    let primaryError: unknown
    try {
      expect(await scaffold.ctx.get('skills')!.list({ cwd: scaffold.workspaceCwd })).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'planning-maintenance' })]))
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      await connectFreshWorkspace(page, scaffold.workspaceCwd)
      const workspace = scaffold.hostCtx.workspaceRegistry.list().find(value => value.path.endsWith('workspace'))
      if (workspace === undefined) throw new Error('connected Workspace was not registered')
      const board = () => scaffold.hostCtx.get('planning')!.snapshot({ workspaceId: workspace.id, actorId: 'acceptance', kind: 'human', authorize() {} })
      const send = async (text: string): Promise<void> => {
        const input = page.locator('[data-composer-input][contenteditable="true"]').last()
        await input.waitFor({ timeout: 15_000 })
        const settled = scaffold.whenTurnSettled(mode === 'record' ? 180_000 : 60_000)
        await input.fill(text)
        await input.press('Enter')
        sessionId = await settled
        console.info(`Planning conversation turn ${prompts.indexOf(text as typeof prompts[number]) + 1} settled`)
      }
      await send(prompts[0])
      const initial = await board()
      expect(observed.some(event => event.type === 'tool/call' && event.data.name === 'skill' && JSON.parse(event.data.arguments).name === 'planning-maintenance')).toBe(true)
      expect(initial.items).toHaveLength(0)
      expect(initial.proposals).toHaveLength(1)
      const draft = initial.proposals[0]!
      expect(draft.status).toBe('pending')
      expect(draft.generations.at(-1)?.draft.sources.some(value => value.kind === 'session-event')).toBe(true)

      await send(prompts[1])
      const revised = await board()
      expect(revised.proposals).toHaveLength(1)
      expect(revised.proposals[0]?.id).toBe(draft.id)
      expect(revised.proposals[0]!.headVersion).toBeGreaterThan(draft.headVersion)
      expect(revised.items).toHaveLength(0)
      expect(JSON.stringify(revised.proposals[0]?.generations.at(-1)?.draft)).toContain('文字')

      await send(prompts[2])
      const confirmed = await board()
      expect(confirmed.items).toHaveLength(1)
      expect(confirmed.proposals[0]?.status).toBe('accepted')
      expect(confirmed.lanes.next).toEqual([confirmed.items[0]!.id])
      expect(confirmed.handoffs).toHaveLength(0)

      await send(prompts[3])
      expect(await board()).toEqual(confirmed)
      await send(prompts[4])
      const later = await board()
      expect(later.items).toHaveLength(1)
      expect(later.lanes.later).toEqual([confirmed.items[0]!.id])
      expect(later.lanes.next).toHaveLength(0)
      expect(later.proposals).toHaveLength(1)

      if (mode === 'record') await recordFixture(scaffold, sessionId!, fixture)
      const more = page.getByRole('button', { name: 'More', exact: true })
      if (await more.getAttribute('aria-expanded') !== 'true') await more.click()
      await page.getByRole('button', { name: /^Planning(?:\s|$)/u }).first().click()
      await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption(workspace.id)
      await page.getByRole('button', { name: later.items[0]!.revisions.at(-1)!.title, exact: true }).waitFor()
      await page.getByRole('button', { name: later.items[0]!.revisions.at(-1)!.title, exact: true }).first().click()
      await page.getByRole('button', { name: 'Open source session' }).first().waitFor()
      await compareOrRefreshGolden(join(scenario, 'ui.expected.md'), await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd), mode)
      await page.screenshot({ path: join(REPO_ROOT, '.artifacts/incremental-planning/conversation-workbench.png'), fullPage: true })
      await page.getByRole('button', { name: 'Open source session' }).first().click()
      await page.locator('[data-composer-input][contenteditable="true"]').last().waitFor()
      expect(await page.getByRole('heading', { name: 'Project planning pool' }).count()).toBe(0)
    } catch (error) {
      primaryError = error
      await saveFailureShot(page, 'planning-conversation')
      const artifact = join(REPO_ROOT, '.artifacts/incremental-planning')
      await mkdir(artifact, { recursive: true })
      await writeFile(join(artifact, 'conversation-observed.json'), JSON.stringify(observed.filter(event => ['user/message', 'assistant/message', 'tool/call', 'tool/result', 'turn/end'].includes(event.type)), null, 2))
      throw error
    } finally {
      off()
      const failures: unknown[] = []
      await browser.close().catch((error: unknown) => failures.push(error))
      await scaffold.close().catch((error: unknown) => failures.push(error))
      if (failures.length > 0) throw new AggregateError(primaryError === undefined ? failures : [primaryError, ...failures], 'Planning conversation and cleanup failures')
    }
  }, 960_000,
)
