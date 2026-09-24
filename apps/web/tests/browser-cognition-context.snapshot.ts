import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import {
  assertSessionFixtureVersion, redactSessionSnapshotIds, scrubSystemPrompts, scrubToolSchemas,
} from '@deepseek-ai/dsh-session-snapshot'
import {
  projectCognitionWorkspace as rawProject,
  createCognitionScope as rawScope,
  compileCognitionContext as rawCompile,
  attachCognitionContext as rawAttach,
  // @ts-expect-error The shipped extension module is plain JavaScript without declarations.
} from '../../chrome-extension/src/assistant-cognition-workspace.js'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts, launchWebScaffold, recordFixture,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/browser-cognition-context', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.v3.jsonl')
const MODE = webSnapshotMode()
const CORRECTION = '人工修正：结论只适用于三种已测模板，其他网页未知。'
const SOURCE = '在我们测试的三种页面模板中，缓存使平均定位时间缩短了约 14%；其他页面尚未验证。'
const RESPONSE = '认知任务上下文已送达'

// The extension's shipped compiler is plain JavaScript. Keep the test-side type boundary local.
const project = rawProject as (page: object) => { objects: Array<{ id: string; kind: string }> }
const scope = rawScope as (page: object, current: object, ids: string[], corrections: Record<string, string>) => object
const compile = rawCompile as (selected: object, page: object, current: object) => {
  json: string
  packet: { provenance: string; scopeMeaning: string; objects: Array<{ observed: string; userCorrection: string; sourceRefs: string[] }> }
}
const attach = rawAttach as (instruction: string, context: { json: string }) => string

function submittedPrompt(): string {
  const target = { tabId: 7, frameId: 0, documentId: 'recorded-document', url: 'https://browser-fixture.test/article' }
  const observation = { id: 'recorded-session:2', snapshotId: 'recorded-snapshot', observedAt: 1,
    source: { toolResultSeq: 2 }, regions: [], elements: [], collections: [], omissions: {}, preview: { text: SOURCE } }
  const page = { id: 'recorded-page', sessionId: 'recorded-session', documentState: 'current',
    target: { installationId: 'recorded-installation', page: target }, observations: [observation],
    regions: [], unplacedActions: [], semanticMaps: [], semanticFeedback: { revision: 0 },
    sourceSnapshots: [{ observationId: observation.id, snapshotId: observation.snapshotId, omissions: [],
      blocks: [{ blockId: 'block-0', ordinal: 0, kind: 'paragraph', text: SOURCE, truncated: false }] }] }
  const current = { connection: { phase: 'connected', baseUrl: 'http://127.0.0.1:3080',
    grant: { installationId: 'recorded-installation' } }, session: { binding: { sessionId: 'recorded-session' } },
  target: { availability: 'ready', revision: 1, selected: target } }
  const selectedId = project(page).objects.find(object => object.kind === 'passage')?.id
  if (!selectedId) throw new Error('the delivered observation has no source passage')
  const context = compile(scope(page, current, [selectedId], { [selectedId]: CORRECTION }), page, current)
  expect(context.packet).toMatchObject({ provenance: 'delivered-browser-observation',
    scopeMeaning: '用户选择的任务对象；不扩展页面读取或操作权限',
    objects: [{ observed: SOURCE, sourceRefs: ['block-0'], userCorrection: CORRECTION }] })
  return attach(`依据明确选入的来源和人工修正，回复“${RESPONSE}”。不要调用工具。`, context)
}

describe('browser cognition context in a recorded Web Session', () => {
  let scaffold: WebScaffold
  let agentHandle: AgentHandle
  let browser: Browser | undefined
  let page: Page | undefined

  beforeAll(async () => {
    const prompt = submittedPrompt()
    if (MODE !== 'record') expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([prompt])
    scaffold = await launchWebScaffold({ paceMs: 10,
      replayProviders: [{ id: 'deepseek-official', name: 'DeepSeek', models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 1_000_000,
          reasoningEfforts: ['high'] },
      ] }],
      ...MODE === 'record' ? {} : { replayFixture: FIXTURE } })
    agentHandle = await scaffold.ctx.agents.create({
      sessionId: SessionId('browser-cognition-context-snapshot'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'browser-assistant' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash',
        reasoningEffort: ReasoningEffortId('high'), maxTokens: 256_000 },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'browser-assistant').then(() => undefined),
    })
    agentHandle.agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }))
    await agentHandle.agent.whenIdle()
    if (MODE === 'record') await recordFixture(scaffold, agentHandle.agent.session.id, FIXTURE)
  }, 180_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    await agentHandle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'browser cognition snapshot teardown failed')
  })

  it('persists the selected source and correction in the actual model request and Web conversation', async () => {
    const session = agentHandle.agent.session
    const user = session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')
    if (user?.type !== 'user/message') {
      throw new Error(`missing submitted user message: ${JSON.stringify(session.snapshotEvents().map(event => event.type === 'turn/end'
        ? { type: event.type, reason: event.data.reason } : { type: event.type }))}`)
    }
    const content = user.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
    expect(content).toBe(submittedPrompt())
    expect(content).toContain(SOURCE)
    expect(content).toContain(CORRECTION)
    expect(content).toContain('不扩展页面读取或操作权限')
    expect(session.requestHeader()).toBeDefined()
    expect(session.snapshotEvents().filter(event => event.type === 'turn/end' && event.data.reason.kind === 'error')).toEqual([])
    expect(session.snapshotEvents().filter(event => event.type === 'tool/call')).toEqual([])
    const answer = session.deriveMessages().filter(message => message.role === 'assistant')
      .flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : []))
      .join('')
    expect(answer).toContain(RESPONSE)

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.locator('[role="treeitem"]').first().click()
    await page.locator('[role="treeitem"]').nth(1).click()
    await page.getByText(RESPONSE, { exact: false }).first().waitFor({ timeout: 15_000 })
    const rendered = await page.locator('[class*="centerCol"]').innerText()
    expect(rendered).toContain(SOURCE)
    expect(rendered).toContain(CORRECTION)
    expect(rendered).toContain(RESPONSE)
    if (MODE !== 'record') {
      const aria = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
      await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'ui.expected.md'), aria, MODE)
    }
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the canonical session inventory complete', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.v3.jsonl', 'ui.expected.md'])
    const fixture = await readFile(FIXTURE, 'utf8')
    assertSessionFixtureVersion('session.v3.jsonl', fixture)
    expect(redactSessionSnapshotIds([fixture])).toEqual([fixture])
    expect(scrubSystemPrompts(fixture)).toBe(fixture)
    expect(scrubToolSchemas(fixture)).toBe(fixture)
  })
})
