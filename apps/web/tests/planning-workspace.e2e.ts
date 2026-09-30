/** Isolated SBC object page using the real Web composition and native Session creation. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@changanhua/dsh-planning'
import { launchWebScaffold } from './scaffold.ts'
import { newEnglishPage, REPO_ROOT, saveFailureShot } from './support.ts'

it('works on a Focus through a native Session and explicitly adopts its SBC evidence delta', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: join(REPO_ROOT, 'packages/bundle/personal-planning/cordis.patch.yml'),
    extraInstallAnchors: [join(REPO_ROOT, 'packages/bundle/personal-planning/package.json')],
  })
  const browser = await chromium.launch()
  const page = await newEnglishPage(browser)
  const observed: SessionEvent[] = []
  const off = scaffold.ctx.on('session/event', (_session, event) => { observed.push(event) })
  try {
    const workspace = await scaffold.hostCtx.workspaceRegistry.create(scaffold.workspaceCwd, 'SBC isolated workspace')
    const access = { workspaceId: workspace.id, actorId: 'pilot', kind: 'human' as const, authorize() {} }
    const planning = scaffold.hostCtx.get('planning')!
    await planning.execute(access, { kind: 'create', requestId: 'sbc-root', expectedBoardVersion: 0,
      itemId: 'sbc-plan', title: 'FC27 SBC pilot', intent: '', lane: 'inbox', scope: [], acceptance: [],
      sources: [{ kind: 'manual', text: 'Isolated SBC fixture, no real Submit' }], reviewAt: null,
      estimate: { value: null, urgency: null, reuse: null, compounding: null, timeCost: null, tokenCost: null, risk: null, cognitiveCost: null, rationale: '' },
    })
    const openPlanning = async () => {
      const more = page.getByRole('button', { name: 'More', exact: true })
      if (await more.getAttribute('aria-expanded') !== 'true') await more.click()
      await page.getByRole('button', { name: /^Planning(?:\s|$)/u }).first().click()
      await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption(workspace.id)
      await page.getByRole('button', { name: /FC27 SBC pilot/u }).first().click()
    }
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await openPlanning()
    const object = page.getByRole('region', { name: 'Object workspace' })
    await object.getByRole('textbox', { name: 'Focus title' }).fill('Fill + validation')
    await object.getByRole('button', { name: 'Create focus', exact: true }).click()
    await expect.poll(async () => (await planning.snapshot(access)).focuses?.length).toBe(1)
    const focus = (await planning.snapshot(access)).focuses![0]!
    await object.getByRole('combobox', { name: 'Focus', exact: true }).selectOption(focus.id)
    const base = (await planning.snapshot(access)).items[0]!.headRevisionId
    await object.getByRole('button', { name: 'Start session', exact: true }).click()
    await expect.poll(async () => (await planning.snapshot(access)).sessionBindings?.length).toBe(1)
    const binding = (await planning.snapshot(access)).sessionBindings![0]!
    expect(binding.subject).toEqual({ kind: 'focus', id: focus.id })
    expect(binding.baseRevision).toBe(base)
    expect(workspace.sessionIds.map(String)).toContain(binding.sessionId)
    await page.getByText(`Working on: ${focus.title}`, { exact: false }).waitFor()
    await page.getByText(`Based on revision: ${base}`, { exact: false }).waitFor()
    if (process.env.DSH_PLANNING_WORKSPACE_LIVE === '1') {
      const prompt = '这是隔离的 FC27 SBC 试验，不要访问网站或执行任何 Submit。Browser Run #42 发现 solver-result #19 的一个 item identity 与页面不一致。请基于此会话绑定的 Focus 和当前 canonical state，把“Submit 前必须重读并逐项核对 item identity”提出为 accepted 状态条目的候选变更，附上 browser-run 42 和 solver-result 19 的 evidence refs。请通过现有 Planning Proposal 保存，保留来源，不要采纳，也不要直接修改正式状态。'
      const settled = scaffold.whenTurnSettled(180_000)
      const input = page.locator('[data-composer-input][contenteditable="true"]').last()
      await input.fill(prompt)
      await input.press('Enter')
      const sessionId = await settled
      expect(String(sessionId)).toBe(binding.sessionId)
      expect(JSON.stringify(observed.filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin'))).toContain(base)
      const result = await planning.snapshot(access)
      const generated = result.proposals.find(value => value.status === 'pending' && value.generations.at(-1)?.delta !== undefined)
      expect(generated?.generations.at(-1)?.delta?.subject).toEqual(binding.subject)
      expect(result.items[0]!.headRevisionId).toBe(base)
      expect(generated?.generations.at(-1)?.delta?.operations.some(value => value.kind === 'add-state-entry')).toBe(true)
      await openPlanning()
      await page.getByRole('button', { name: 'Accept draft', exact: true }).click()
      await expect.poll(async () => (await planning.snapshot(access)).proposals.find(value => value.id === generated!.id)?.status).toBe('accepted')
      const afterAdoption = await planning.snapshot(access)
      expect(afterAdoption.items[0]!.headRevisionId).not.toBe(base)
      expect(afterAdoption.items[0]!.revisions.at(-1)!.stateEntries?.some(entry => entry.kind === 'accepted')).toBe(true)
      expect(afterAdoption.handoffs).toEqual([])
      const artifactRoot = join(REPO_ROOT, '.artifacts/planning-workspace-v0')
      await mkdir(artifactRoot, { recursive: true })
      await writeFile(join(artifactRoot, 'live-agent-evidence.json'), JSON.stringify({ binding, generated, afterAdoption,
        events: observed.filter(value =>
          ['user/message', 'request/context', 'tool/call', 'tool/result', 'assistant/message', 'turn/end'].includes(value.type)),
      }, null, 2))
      await page.screenshot({ path: join(artifactRoot, 'live-agent.png'), fullPage: true })
      return
    }
    await openPlanning()
    const before = await planning.snapshot(access)
    const head = before.items[0]!.revisions.at(-1)!
    await planning.execute(access, { kind: 'propose', requestId: 'sbc-findings', expectedBoardVersion: before.version,
      proposalId: 'sbc-proposal', expectedProposalVersion: null, targetItemId: 'sbc-plan', baseRevisionId: base,
      draft: { title: 'Check item identity', intent: '', scope: [], acceptance: [], sources: [{ kind: 'manual', text: 'Fixture Browser/Solver evidence' }], estimate: head.estimate, reviewAt: null },
      suggestedLane: 'inbox', assumptions: [], delta: { subject: binding.subject, baseRevision: base,
        originRef: { kind: 'session', id: binding.sessionId }, evidenceRefs: [{ kind: 'browser-run', id: '42' }],
        operations: [{ kind: 'add-state-entry', entry: { id: 'identity-check', kind: 'accepted', content: 'Read back item identity before Submit' } },
          { kind: 'add-resource-link', id: 'solver', resource: { kind: 'solver-result', id: '19' } }],
      },
    })
    expect((await planning.snapshot(access)).items[0]!.headRevisionId).toBe(base)
    await page.reload({ waitUntil: 'load' })
    await openPlanning()
    await page.getByRole('heading', { name: 'Proposed changes' }).waitFor()
    await page.getByRole('button', { name: 'Accept draft', exact: true }).click()
    await expect.poll(async () => (await planning.snapshot(access)).items[0]!.revisions.at(-1)!.stateEntries?.[0]?.id).toBe('identity-check')
    await page.getByRole('region', { name: 'Object workspace' }).getByText('Read back item identity before Submit', { exact: true }).waitFor()
    expect((await planning.snapshot(access)).sessionBindings![0]).toEqual(binding)
    const artifacts = join(REPO_ROOT, '.artifacts/planning-workspace-v0')
    await mkdir(artifacts, { recursive: true })
    await page.screenshot({ path: join(artifacts, 'sbc-workspace.png'), fullPage: true })
  } catch (error) { await saveFailureShot(page, 'planning-workspace'); throw error }
  finally { off(); await browser.close(); await scaffold.close() }
})
