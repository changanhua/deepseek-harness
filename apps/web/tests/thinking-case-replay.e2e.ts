import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { BlockAssembler, createAssistantMessage, createToolResultMessage, ToolCallId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type Planning from '@changanhua/dsh-planning'
import type { PlanningRemoteService } from '../../../packages/planning/planning-remote/src/index.ts'
import { launchWebScaffold } from './scaffold.ts'
import { newEnglishPage, REPO_ROOT } from './support.ts'

/** Controlled model output exercises native composition without any provider request. */
function scriptedTool(name: string, args: unknown, id: string): { kind: 'chunks'; chunks: StreamChunk[] } {
  const argumentsText = JSON.stringify(args)
  return { kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: ToolCallId(id), name, argumentsDelta: argumentsText },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name, arguments: argumentsText } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ] }
}
const stop: ReturnType<typeof scriptedTool> = { kind: 'chunks', chunks: [{ type: 'finish', reason: { kind: 'stop' } }] }

function scriptedSession(id: string, entries: ReturnType<typeof scriptedTool>[]): string {
  const header = { type: 'session', version: SESSION_FORMAT_VERSION, id, createdAt: 0, delegationDepth: 0, isSeeded: false }
  const events = entries.flatMap((entry, index) => {
    const assembler = new BlockAssembler()
    for (const chunk of entry.chunks) assembler.push(chunk)
    const toolEvents = assembler.blocks().flatMap(block => block.type !== 'tool-call' ? [] : [
      { type: 'tool/call', data: { turn: 1, step: index + 1, callId: block.id, name: block.name, arguments: block.arguments } },
      { type: 'tool/result', surfaceOp: 'append', data: { turn: 1, step: index + 1,
        message: createToolResultMessage({ callId: block.id, content: [], isError: false }),
      } },
    ])
    return [{ type: 'step/start', data: { turn: 1, step: index + 1 } }, { type: 'assistant/message', surfaceOp: 'append', data: {
      turn: 1, step: index + 1,
      message: createAssistantMessage({ content: assembler.blocks(), source: { provider: 'mock', model: 'mock' } }),
      stream: entry.chunks.map(chunk => ({ type: 'chunk', time: 0, chunk })),
    } }, ...toolEvents, { type: 'step/end', data: { turn: 1, step: index + 1 } }]
  })
  return [header, { type: 'turn/start', data: { turn: 1 } }, ...events,
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n'
}


it('replays controlled Thinking Agent and retains independent outputs through adoption, drift and a second run', async () => {
  if (process.env.DSH_SNAPSHOT === 'record') throw new Error('Controlled Thinking acceptance requires keyless replay mode')
  const directory = await mkdtemp(join(tmpdir(), 'dsh-thinking-controlled-'))
  const failures: unknown[] = []
  let appToClose: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
  let browserToClose: Awaited<ReturnType<typeof chromium.launch>> | undefined
  let off = () => {}
  try {
    const override = join(directory, 'replay.override.json')
    const secondFixture = join(directory, 'second-session.jsonl')
    const draft = { summary: 'Controlled candidate', findings: ['Review before adoption'], open_questions: ['Verify the boundary'],
      exploration_notes: [{ title: 'Explore the boundary', body: 'A bounded investigation candidate.' }],
      design_context: { title: 'Human adoption boundary', body: 'Preserve independent outputs until explicit human adoption.' },
      planning_delta: { operations: [{ kind: 'add-state-entry', entry: { id: 'controlled-question', kind: 'open', content: 'Verify the first slice boundary' } }], rationale: 'Controlled review fixture' },
    }
    await writeFile(override, JSON.stringify([
      scriptedTool('thinking_context', {}, 'controlled-context-1'),
      scriptedTool('thinking_submit_result', { expected_result_version: 0, request_id: 'controlled-result-1', draft }, 'controlled-submit-1'), stop,
    ]))
    await writeFile(secondFixture, scriptedSession('controlled-second-session', [
      scriptedTool('thinking_context', {}, 'controlled-context-2'),
      scriptedTool('thinking_submit_result', { expected_result_version: 0, request_id: 'controlled-result-2', draft: { summary: 'Controlled second candidate', findings: [], open_questions: ['Check saved context'] } }, 'controlled-submit-2'), stop,
    ]))
    const app = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('../../../packages/bundle/personal-planning/cordis.patch.yml', import.meta.url)),
      extraInstallAnchors: [fileURLToPath(new URL('../../../packages/bundle/personal-planning/package.json', import.meta.url))],
      toolsMode: 'native', compareReplaySession: false, replayFixture: override, replayOverride: override,
      replayChildFixtures: [secondFixture],
    })
    appToClose = app
    const browser = await chromium.launch()
    browserToClose = browser
    const observed: SessionEvent[] = []
    off = app.ctx.on('session/event', (_session, event: SessionEvent) => { observed.push(event) })
    const workspace = await app.hostCtx.workspaceRegistry.create(app.workspaceCwd)
    const workspaceId = String(workspace.id)
    const planning = app.hostCtx.get('planning') as Planning
    const remote = app.hostCtx.get('planningRemote') as PlanningRemoteService
    const signal = new AbortController().signal
    const access = { workspaceId, actorId: 'thinking-live-acceptance', kind: 'human' as const, authorize() {} }
    const created = await planning.execute(access, {
      kind: 'create', requestId: 'thinking-fixture', expectedBoardVersion: 0, itemId: 'fc27-thinking', lane: 'now',
      title: 'FC27 WP4 Agent 闭环', intent: '探索首个可靠纵切；购买与提交必须由人工确认。', scope: [], acceptance: [],
      stateEntries: [{ id: 'goal', kind: 'objective', content: '确定首个可靠纵切的边界与设计理由。' }],
      sources: [{ kind: 'manual', text: 'Controlled FC27 design acceptance' }], reviewAt: null,
      estimate: { value: null, urgency: null, reuse: null, compounding: null, timeCost: null,
        tokenCost: null, risk: null, cognitiveCost: null, rationale: '' },
    }, signal)
    const input = { workspaceId, subject: { kind: 'plan' as const, id: created.itemId! } }
    await remote.sbcDesignCase(input, signal)
    const page = await newEnglishPage(browser)
    await page.goto(app.authenticatedUrl, { waitUntil: 'load' })
    const openCase = async () => {
      const navigation = page.getByRole('button', { name: /^Planning/u })
      if (!await navigation.isVisible()) await page.getByText('More', { exact: true }).click()
      await navigation.click()
      await page.getByRole('combobox', { name: /^Project/u }).selectOption(workspaceId)
      const all = page.getByRole('button', { name: 'All plans', exact: true })
      if (await all.count()) await all.click()
      await page.getByRole('button', { name: 'FC27 WP4 Agent 闭环', exact: true }).click()
      await page.getByRole('tab', { name: 'Thinking desk', exact: true }).click()
      await page.getByRole('button', { name: 'Open design', exact: true }).click()
      await page.getByRole('button', { name: 'Start thinking', exact: true }).waitFor()
    }
    await openCase()
    const settled = app.whenTurnSettled(180_000)
    await page.getByLabel('What would you like to explore?').fill(
      '首个可靠纵切应该止在哪里？请提出一条探索建议，保存用的设计理由，以及一条新增待解决问题作为正式计划变更候选。不要执行任何购买或提交。',
    )
    await page.getByRole('button', { name: 'Start thinking', exact: true }).click()
    const firstSession = await settled
    const before = await planning.snapshot(access, signal)
    expect(before.items[0]?.headRevisionId).toBe(created.revisionId)
    expect(before.proposals).toHaveLength(0)
    let view = await remote.thinkingCase(input, signal)
    const run = view.runs.at(-1)!
    expect(run.sessionId).toBe(firstSession)
    const agent = app.hostCtx.get('agents')!.get(firstSession)!
    const assembled = await app.hostCtx.get('systemPrompt')!.assemble({ scope: agent })
    const artifact = join(REPO_ROOT, '.artifacts/thinking-desk')
    await mkdir(artifact, { recursive: true })
    await writeFile(join(artifact, 'first-run-events.json'), JSON.stringify({ runId: run.id,
      startup: run.startup.phase, registryTools: app.hostCtx.get('tools')!.schemas(agent).map(tool => tool.name),
      assemblyTools: assembled.tools.map(tool => tool.name), events: observed.filter(event =>
        ['request/header', 'tool/call', 'tool/result', 'turn/end'].includes(event.type)),
    }, null, 2))
    const result = run.results.at(-1)!
    expect(result).toBeDefined()
    expect(result.draft.explorationNotes?.length).toBeGreaterThan(0)
    expect(result.draft.designContext?.body).toBeTruthy()
    expect(result.draft.planningDelta?.operations.length).toBeGreaterThan(0)
    expect(observed.some(event => event.type === 'tool/call' && event.data.name === 'thinking_context')).toBe(true)
    expect(observed.some(event => event.type === 'tool/call' && event.data.name === 'thinking_submit_result')).toBe(true)
    expect(observed.filter(event => event.type === 'tool/call').every(event =>
      event.type !== 'tool/call' || ['thinking_context', 'thinking_submit_result'].includes(event.data.name))).toBe(true)
    await openCase()
    await page.getByRole('button', { name: 'Apply to thinking desk', exact: true }).click()
    await page.getByText('Exploration suggestions applied', { exact: true }).waitFor()
    await page.getByLabel('I reviewed the stale input warning and confirm applying this candidate.').check()
    await page.getByRole('button', { name: 'Save design context', exact: true }).click()
    await page.getByText('Design context saved', { exact: true }).waitFor()
    await page.getByLabel('I reviewed the stale input warning and confirm applying this candidate.').check()
    await page.getByRole('button', { name: 'Submit Planning Proposal', exact: true }).click()
    await page.getByText('Proposal submitted. Return to the plan to review it.', { exact: true }).waitFor()
    view = await remote.thinkingCase(input, signal)
    const savedContext = view.designContexts.at(-1)!
    const pending = await planning.snapshot(access, signal)
    expect(pending.items[0]?.headRevisionId).toBe(created.revisionId)
    expect(pending.proposals).toHaveLength(1)
    await page.getByRole('button', { name: 'Close Design Case', exact: true }).click()
    await page.getByRole('button', { name: 'Awaiting my review 1', exact: true }).click()
    await page.getByRole('button', { name: 'Accept draft', exact: true }).click()
    await expect.poll(async () => (await planning.snapshot(access, signal)).items[0]?.headRevisionId).not.toBe(created.revisionId)
    const head = (await planning.snapshot(access, signal)).items[0]!.headRevisionId
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('tab', { name: 'Thinking desk', exact: true }).click()
    await page.getByRole('button', { name: 'Open design', exact: true }).click()
    await page.getByText(/Revision drift:/u).first().waitFor()
    const secondSettled = app.whenTurnSettled(180_000)
    const secondEventStart = observed.length
    await page.getByLabel('What would you like to explore?').fill('基于上次已保存的设计理由，指出一个仍需验证的问题，只提交探索候选，不修改正式计划。')
    await page.getByRole('button', { name: 'Start thinking', exact: true }).click()
    await secondSettled
    const second = (await remote.thinkingCase(input, signal)).runs.at(-1)!
    expect(second.id).not.toBe(run.id)
    expect(second.context.designCase.priorDesignContexts.some(context => context.id === savedContext.id)).toBe(true)
    expect(second.results.length).toBeGreaterThan(0)
    const secondEvents = observed.slice(secondEventStart)
    expect(secondEvents.some(event => event.type === 'tool/call' && event.data.name === 'thinking_context')).toBe(true)
    expect(JSON.stringify(secondEvents.filter(event => event.type === 'tool/result'))).toContain(savedContext.id)
    expect((await planning.snapshot(access, signal)).items[0]?.headRevisionId).toBe(head)
    await writeFile(join(artifact, 'live-result.json'), JSON.stringify({ firstRun: run.id, firstSession,
      resultId: result.id, savedContext: savedContext.id, proposal: pending.proposals[0]!.id,
      adoptedRevision: head, secondRun: second.id, secondSession: second.sessionId,
      toolCalls: observed.filter(event => event.type === 'tool/call').map(event => event.data),
    }, null, 2))
  } catch (error) {
    failures.push(error)
  } finally {
    off()
    await browserToClose?.close().catch((error: unknown) => failures.push(error))
    await appToClose?.close().catch((error: unknown) => failures.push(error))
    await rm(directory, { recursive: true, force: true }).catch((error: unknown) => failures.push(error))
  }
  if (failures.length) throw new AggregateError(failures, 'Thinking acceptance and cleanup failures')
}, 420_000)
