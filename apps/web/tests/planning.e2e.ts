/** Real browser interaction with the optional project planning composition. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type {} from '@changanhua/dsh-planning'
import { launchWebScaffold } from './scaffold.ts'
import { newEnglishPage, REPO_ROOT, saveFailureShot } from './support.ts'

it('refines a captured idea into one plan, changes its lane, and preserves its evolution after reload', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: join(REPO_ROOT, 'packages/bundle/personal-planning/cordis.patch.yml'),
    extraInstallAnchors: [join(REPO_ROOT, 'packages/bundle/personal-planning/package.json')],
  })
  const browser = await chromium.launch()
  const page = await newEnglishPage(browser)
  try {
    expect(await scaffold.ctx.get('skills')!.list({ cwd: scaffold.workspaceCwd })).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'planning-maintenance' })]))
    const workspace = await scaffold.hostCtx.workspaceRegistry.create(scaffold.workspaceCwd, 'Planning acceptance')
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    const openPlanning = async () => {
      const more = page.getByRole('button', { name: 'More', exact: true })
      if (await more.getAttribute('aria-expanded') !== 'true') await more.click()
      await page.getByRole('button', { name: /^Planning(?:\s|$)/u }).first().click()
      await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption(workspace.id)
    }
    await openPlanning()
    await page.locator('summary').filter({ hasText: 'Capture idea' }).click()
    await page.getByRole('textbox', { name: 'Idea', exact: true }).fill('Keep tomorrow’s improvement connected to its original source.')
    await page.getByRole('button', { name: 'Capture idea', exact: true }).click()
    await expect.poll(() => page.getByRole('status').filter({ hasText: 'Captured as an idea to refine' }).count()).toBe(1)
    const access = { workspaceId: workspace.id, actorId: 'acceptance', kind: 'human' as const, authorize() {} }
    await expect.poll(async () => {
      const board = await scaffold.hostCtx.get('planning')!.snapshot(access)
      return { itemCount: board.items.length, proposalCount: board.proposals.length }
    }).toEqual({ itemCount: 0, proposalCount: 1 })
    const captured = await scaffold.hostCtx.get('planning')!.snapshot(access)
    const capturedProposal = captured.proposals[0]
    expect(capturedProposal?.targetItemId).toBeNull()
    expect(capturedProposal?.status).toBe('pending')
    expect(capturedProposal?.generations).toHaveLength(1)
    expect(capturedProposal?.generations[0]?.draft.scope).toEqual([])
    expect(capturedProposal?.generations[0]?.draft.acceptance).toEqual([])
    expect(capturedProposal?.generations[0]?.draft.sources).toEqual([
      expect.objectContaining({
        kind: 'manual',
        text: 'Keep tomorrow’s improvement connected to its original source.',
      }),
    ])
    await page.getByRole('button', { name: 'Accept draft', exact: true }).click()
    await page.getByRole('button', { name: /Keep tomorrow/u }).first().waitFor()
    await page.getByRole('button', { name: /Keep tomorrow/u }).first().click()
    const original = await scaffold.hostCtx.get('planning')!.snapshot(access)
    const originalItemId = original.items[0]?.id
    await page.getByRole('textbox', { name: 'Continue this idea' }).fill('Add one more constraint to this idea.')
    await page.getByRole('button', { name: 'Save addition' }).click()
    await expect.poll(async () => {
      const board = await scaffold.hostCtx.get('planning')!.snapshot(access)
      return board.items[0]?.revisions.length
    }).toBe(2)
    await expect.poll(() => page.getByRole('status').filter({ hasText: 'Saved' }).count()).toBe(1)
    await page.locator('summary').filter({ hasText: 'Revise plan' }).click()
    for (const width of [1280, 800, 640]) {
      await page.setViewportSize({ width, height: 900 })
      const [title, intent, scope] = await page.getByRole('textbox', {
        name: /^(Revision title|Revision intent|Scope)$/u,
      }).evaluateAll(elements => elements.map((element) => {
        const rect = element.getBoundingClientRect()
        return { width: rect.width, y: rect.y, height: rect.height }
      }))
      if (title === undefined || intent === undefined || scope === undefined) throw new Error('planning edit fields are not visible')
      expect(title.width).toBeGreaterThan(180)
      expect(intent.y).toBeGreaterThanOrEqual(title.y + title.height)
      expect(scope.y).toBeGreaterThanOrEqual(intent.y + intent.height)
      const planningOverflow = await page.getByRole('region', { name: 'Project planning pool' })
        .evaluate(element => element.scrollWidth > element.clientWidth + 1)
      expect(planningOverflow).toBe(false)
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByRole('combobox', { name: 'Move to', exact: true }).selectOption('next')
    await page.getByRole('button', { name: 'Move plan', exact: true }).click()
    await expect.poll(async () => {
      const board = await scaffold.hostCtx.get('planning')!.snapshot(access)
      return board.lanes.next.length
    }).toBe(1)
    await expect.poll(async () => {
      const stored = JSON.parse(await readFile(join(scaffold.storageRoot, 'planning_boards.json'), 'utf8')) as unknown
      return JSON.stringify(stored).includes('Keep tomorrow')
    }).toBe(true)
    const evolutionBeforeReload = await page
      .getByRole('group', { name: 'Plan evolution graph', exact: true })
      .locator('g')
      .evaluateAll(nodes => nodes.map(node => node.textContent))
    await page.reload({ waitUntil: 'load' })
    await openPlanning()
    await page.getByRole('button', { name: /Keep tomorrow/u }).first().waitFor()
    const board = await scaffold.hostCtx.get('planning')!.snapshot(access)
    expect(board.items).toHaveLength(1)
    expect(board.items[0]?.id).toBe(originalItemId)
    expect(board.items[0]?.revisions).toHaveLength(2)
    expect(board.items[0]?.revisions.at(-1)?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'manual', text: 'Keep tomorrow’s improvement connected to its original source.' }),
      expect.objectContaining({ kind: 'manual', text: 'Add one more constraint to this idea.' }),
    ]))
    expect(board.lanes.next).toEqual([board.items[0]!.id])
    expect(board.events.map(event => event.kind)).toEqual(['proposed', 'proposal-accepted', 'revised', 'moved'])
    await page.getByRole('button', { name: /Keep tomorrow/u }).first().click()
    const evolutionGraph = page.getByRole('group', { name: 'Plan evolution graph', exact: true })
    await expect.poll(() => evolutionGraph.count()).toBe(1)
    const evolutionAfterReload = await evolutionGraph.locator('g').evaluateAll(nodes => nodes.map(node => node.textContent))
    expect(evolutionAfterReload).toEqual(evolutionBeforeReload)
    expect(evolutionAfterReload).toEqual(expect.arrayContaining([
      expect.stringContaining('Plan'),
      expect.stringContaining('Candidate understanding'),
      expect.stringContaining('revision'),
    ]))
    await page.locator('summary').filter({ hasText: 'Revise plan' }).click()
    await page.getByRole('textbox', { name: 'Continue this idea' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(REPO_ROOT, '.artifacts/incremental-planning/planning-workbench-detail.png'), fullPage: true })
    await page.getByRole('heading', { name: 'Project planning pool' }).evaluate((element) => {
      element.scrollIntoView({ block: 'start' })
    })
    await page.screenshot({ path: join(REPO_ROOT, '.artifacts/incremental-planning/planning-workbench.png'), fullPage: true })
  } catch (error) {
    await saveFailureShot(page, 'web-e2e-planning')
    throw error
  } finally {
    await browser.close()
    await scaffold.close()
  }
})
