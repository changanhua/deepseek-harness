/** Planning and Delivery keep one linked identity through their real Web composition. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type { PlanningAccess } from '@changanhua/dsh-planning'
import type {} from '@changanhua/dsh-delivery'
import { launchWebScaffold } from './scaffold.ts'
import { newEnglishPage, REPO_ROOT, saveFailureShot } from './support.ts'

it('prepares an exact plan once and displays the real shaping Case after browser reload', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-planning-execution-overlay-'))
  let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const overlay = join(temp, 'cordis.patch.yml')
    const layers = ['personal-planning/cordis.patch.yml', 'personal-delivery/cordis.patch.yml', 'personal-planning/delivery.patch.yml']
    await writeFile(overlay, (await Promise.all(layers.map(path => readFile(join(REPO_ROOT, 'packages/bundle', path), 'utf8')))).join('\n'))
    scaffold = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: ['personal-planning', 'personal-delivery'].map(name => join(REPO_ROOT, 'packages/bundle', name, 'package.json')) })
    const workspace = await scaffold.hostCtx.workspaceRegistry.create(scaffold.workspaceCwd, 'Planning execution')
    const access: PlanningAccess = { workspaceId: workspace.id, actorId: 'acceptance', kind: 'human', authorize() {} }
    const planning = scaffold.hostCtx.get('planning')!
    const created = await planning.execute(access, {
      kind: 'create', requestId: 'browser-handoff-source', expectedBoardVersion: 0, lane: 'next',
      title: 'Carry the discussion into an execution plan', intent: 'Retain the exact scope and acceptance from discussion.',
      scope: ['Current conversation text only'], acceptance: ['The source remains traceable'],
      sources: [{ kind: 'manual', text: 'Synthetic browser acceptance source' }], reviewAt: null,
      estimate: { value: null, urgency: null, reuse: null, compounding: null, timeCost: null, tokenCost: null, risk: null, cognitiveCost: null, rationale: '' },
    })
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    try {
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      const open = async () => {
        const more = page.getByRole('button', { name: 'More', exact: true })
        if (await more.getAttribute('aria-expanded') !== 'true') await more.click()
        await page.getByRole('button', { name: /^Planning(?:\s|$)/u }).first().click()
        await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption(workspace.id)
        await page.getByRole('button', { name: 'Carry the discussion into an execution plan', exact: true }).click()
      }
      await open()
      await page.getByRole('button', { name: 'Prepare execution', exact: true }).click()
      await page.getByText('Shape execution plan', { exact: false }).waitFor()
      const board = await planning.snapshot(access)
      expect(board.handoffs).toHaveLength(1)
      expect(board.handoffs[0]).toMatchObject({ phase: 'linked', itemId: created.itemId, revisionId: created.revisionId })
      const delivery = scaffold.ctx.get('delivery')!
      expect(delivery.snapshot().deliveryCases).toHaveLength(1)
      expect(delivery.snapshot().dispatchBindings).toHaveLength(0)
      await page.reload({ waitUntil: 'load' })
      await open()
      await page.getByText('Shape execution plan', { exact: false }).waitFor()
      expect(await page.getByRole('button', { name: 'Prepare execution', exact: true }).count()).toBe(0)
      expect(delivery.snapshot().deliveryCases).toHaveLength(1)
      await page.screenshot({ path: join(REPO_ROOT, '.artifacts/incremental-planning/execution-workbench.png'), fullPage: true })
    } catch (error) { await saveFailureShot(page, 'planning-execution'); throw error }
  } finally {
    await browser?.close()
    await scaffold?.close()
    await rm(temp, { recursive: true, force: true })
  }
}, 60_000)
