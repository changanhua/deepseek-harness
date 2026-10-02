import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@changanhua/dsh-planning'
import type {} from '@changanhua/dsh-requirement-assessment'
import { evaluation } from '../../../packages/requirement-assessment/requirement-assessment/tests/fixtures.ts'
import { launchWebScaffold } from './scaffold.ts'
import { newEnglishPage, REPO_ROOT } from './support.ts'

it('reviews the selected Plan and Focus through the shared action without changing canonical Planning', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'planning-rir-entry-'))
  const failures: unknown[] = []
  let app: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    const bundle = join(REPO_ROOT, 'packages/bundle/personal-planning')
    const overlay = join(directory, 'review.patch.yml')
    const base = await readFile(join(bundle, 'cordis.patch.yml'), 'utf8')
    const review = (await readFile(join(bundle, 'investment-review.patch.yml'), 'utf8'))
      .replace('!!js process.env.DSH_RIR_PROVIDER', 'fixture')
      .replace('!!js process.env.DSH_RIR_MODEL', 'fixture')
    await writeFile(overlay, `${base}\n${review}`)
    app = await launchWebScaffold({ extraOverlayPath: overlay, extraInstallAnchors: [join(bundle, 'package.json')] })
    let calls = 0
    class Adapter extends LlmAdapter {
      async *stream(): AsyncIterable<StreamChunk> {
        calls++
        const text = JSON.stringify(evaluation)
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    app.ctx.llm.registerAdapter(['fixture'], new Adapter())
    browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const workspace = await app.hostCtx.workspaceRegistry.create(app.workspaceCwd, 'RIR entry acceptance')
    const access = { workspaceId: workspace.id, actorId: 'acceptance', kind: 'human' as const, authorize() {} }
    const planning = app.hostCtx.get('planning')!
    const assessments = app.hostCtx.get('requirementAssessment')!
    const created = await planning.execute(access, { kind: 'create', requestId: 'rir-entry-plan', expectedBoardVersion: 0,
      itemId: 'review-plan', title: 'Review integration', intent: 'Check subject ownership', lane: 'now', scope: [], acceptance: [],
      sources: [{ kind: 'manual', text: 'Isolated RIR entry acceptance' }], reviewAt: null,
      estimate: { value: null, urgency: null, reuse: null, compounding: null, timeCost: null, tokenCost: null, risk: null, cognitiveCost: null, rationale: '' },
    })
    await planning.execute(access, { kind: 'workspace-change', requestId: 'rir-entry-focus',
      expectedBoardVersion: (await planning.snapshot(access)).version, subject: { kind: 'plan', id: 'review-plan' }, baseRevision: created.revisionId!,
      operations: [{ kind: 'create-focus', id: 'review-focus', title: 'Focus integration' }],
    })
    const before = await planning.snapshot(access)
    await page.goto(app.authenticatedUrl, { waitUntil: 'load' })
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('button', { name: /^Planning(?:\s|$)/u }).first().click()
    await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption(workspace.id)
    await page.getByRole('button', { name: 'Review integration', exact: true }).click()
    await page.getByRole('tab', { name: 'Current state', exact: true }).click()
    const object = page.getByRole('combobox', { name: 'Focus', exact: true }).locator('..').locator('..')
    await object.getByRole('button', { name: 'Investment review', exact: true }).click()
    await object.getByRole('button', { name: 'Run Quick Review', exact: true }).click()
    await expect.poll(async () => (await assessments.snapshot(access)).assessments.length).toBe(1)
    expect((await assessments.snapshot(access)).assessments[0]!.subject).toEqual({ kind: 'plan', id: 'review-plan' })
    await page.getByRole('combobox', { name: 'Focus', exact: true }).selectOption('review-focus')
    await object.getByRole('button', { name: 'Run Quick Review', exact: true }).click()
    await expect.poll(async () => (await assessments.snapshot(access)).assessments.length).toBe(2)
    expect((await assessments.snapshot(access)).assessments.map(value => value.subject)).toContainEqual({ kind: 'focus', id: 'review-focus', planId: 'review-plan' })
    await object.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('tab', { name: 'Work and discussion', exact: true }).click()
    await object.getByRole('button', { name: 'Investment review', exact: true }).click()
    await object.getByRole('heading', { name: 'Assessment history', exact: true }).waitFor()
    await object.getByText('Gather evidence', { exact: true }).waitFor()
    expect(await planning.snapshot(access)).toEqual(before)
    expect(calls).toBe(2)
  } catch (error) { failures.push(error) }
  finally {
    await browser?.close().catch((error: unknown) => failures.push(error))
    await app?.close().catch((error: unknown) => failures.push(error))
    await rm(directory, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
  }
  if (failures.length) throw new AggregateError(failures, 'RIR entry acceptance and cleanup failures')
})
