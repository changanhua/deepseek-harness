import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas,
} from '@deepseek-ai/dsh-session-snapshot'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, selectedSessionFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, REPO_ROOT, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/knowledge-base', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
const BUNDLE = join(REPO_ROOT, 'packages/knowledge/tool-knowledge-base')
const MODE = webSnapshotMode()
const PROJECT_ID = 'snapshot-knowledge'
const PROMPT = 'Call knowledge_base exactly once with this request JSON string: '
  + '{"action":"create","spec":{"id":"snapshot-knowledge","title":"Snapshot Knowledge",'
  + '"readerTask":"Explain the validation rule","language":"en","seeds":[]}}. '
  + 'Do not call another tool or change files. After the tool succeeds, reply exactly KNOWLEDGE_PROJECT_READY and stop.'

interface StoredProject {
  spec: { id: string; title: string; readerTask: string; language: string; seeds: unknown[] }
  approvedHash: string | null
}

describe('Web knowledge project creation', () => {
  let scaffold: WebScaffold
  let browser: Browser | undefined
  let page: Page | undefined
  let tripwire: ReturnType<typeof watchConsole>
  let caller: Agent

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: join(BUNDLE, 'cordis.patch.yml'),
      extraInstallAnchors: [join(BUNDLE, 'package.json')],
      toolsMode: 'native',
      compareReplaySession: false,
      ...MODE === 'record' ? {} : { replayFixture: FIXTURE },
    })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    const failures: unknown[] = []
    await browser?.close().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    vi.unstubAllEnvs()
    if (failures.length > 0) throw new AggregateError(failures, 'knowledge-base Web teardown failed')
  })

  async function stored(): Promise<StoredProject> {
    const payload = JSON.parse(await readFile(join(scaffold.storageRoot, 'knowledge_base.json'), 'utf8')) as {
      tables: { projects: Record<string, StoredProject> }
    }
    return payload.tables.projects[PROJECT_ID] as StoredProject
  }

  it('records one model tool call and verifies the durable project independently', async () => {
    if (page === undefined) throw new Error('browser not started')
    onTestFailed(async () => {
      await saveFailureShot(page as Page, 'knowledge-base-create')
      if (caller !== undefined) {
        await mkdir(join(REPO_ROOT, '.artifacts/knowledge-base'), { recursive: true })
        await recordFixture(scaffold, caller.session.id, join(REPO_ROOT, '.artifacts/knowledge-base/web-failed-session.jsonl'))
      }
    })
    if (MODE !== 'record') {
      expect(fixtureUserPrompts(await readFile(await selectedSessionFixture(FIXTURE), 'utf8'))).toEqual([PROMPT])
    }
    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled(120_000)
    await input.fill(PROMPT)
    await input.press('Enter')
    const sessionId = await settled
    const active = scaffold.ctx.agents.get(sessionId)
    if (active === undefined) throw new Error('the browser session has no live Agent')
    caller = active
    expect(caller.session.events.filter(event => event.type === 'turn/end'
      && event.data.reason.kind === 'error')).toEqual([])
    expect(caller.session.events.filter(event => event.type === 'tool/call'
      && event.data.name === 'knowledge_base')).toHaveLength(1)
    await page.getByText('KNOWLEDGE_PROJECT_READY', { exact: true }).waitFor({ timeout: 10_000 })
    await expect(stored()).resolves.toMatchObject({
      spec: { id: PROJECT_ID, title: 'Snapshot Knowledge', readerTask: 'Explain the validation rule', language: 'en', seeds: [] },
      approvedHash: null,
    })

    if (MODE === 'record') await recordFixture(scaffold, sessionId, FIXTURE)
    const raw = [JSON.stringify({ type: 'session', ...caller.session.header }),
      ...caller.session.events.map(event => JSON.stringify(event)), ''].join('\n')
    const context = { cwd: scaffold.workspaceCwd, sessionIds: [sessionId] }
    const prompts = normalizedSystemPrompts(raw, context).map(value => value
      .split(REPO_ROOT).join('{{sourceRoot}}').split(scaffold.baseUrl).join('{{webUrl}}'))
    const schemas = normalizedToolSchemas(raw, context)
    const pins = [
      ['system-prompt.expected.md', formatSystemPromptSnapshot(prompts[0] as string, prompts.slice(1))],
      ['tool-schemas.expected.json', formatToolSchemasSnapshot(schemas[0] as unknown[], schemas.slice(1))],
    ] as const
    for (const [name, content] of pins) {
      if (MODE === 'record' || MODE === 'refresh') await writeFile(join(SNAPSHOT_DIR, name), content)
      else expect(content).toBe(await readFile(join(SNAPSHOT_DIR, name), 'utf8'))
    }
    const aria = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    if (MODE !== 'record') await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'ui.expected.md'), aria, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 180_000)

  it.skipIf(MODE === 'record')('keeps the recorded scenario inventory complete', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'session.jsonl', 'system-prompt.expected.md', 'tool-schemas.expected.json', 'ui.expected.md',
    ])
  })
})
