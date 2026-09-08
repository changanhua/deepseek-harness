import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-commands'
import {
  formatSystemPromptSnapshot, formatToolSchemasSnapshot, normalizedSystemPrompts, normalizedToolSchemas,
} from '@deepseek-ai/dsh-session-snapshot'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, REPO_ROOT, saveFailureShot } from './support.ts'
import { memoryLiveOptions } from '../../../packages/bundle/personal-memory/tests/live-provider.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/project-memory', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
const BUNDLE = join(REPO_ROOT, 'packages/bundle/personal-memory')
const MODE = webSnapshotMode()
const PROMPT = 'Read README.md and propose exactly one project memory for its validation command. Use topic_key validation.command, kind method, '
  + 'title Project validation, and idempotency_key web-validation-rule. Use the README.md file as the source. '
  + 'Do not run the command or change files. After the proposal succeeds, reply exactly MEMORY_CANDIDATE_READY and stop.'

interface StoredRecord {
  id: string
  recordVersion: number
  activeRevision: number | null
  candidateRevision: number | null
  revisions: Array<{ revision: number; statement: string; sources: Array<{ kind: string; path: string; sha256: string }> }>
  decisions: Array<{ action: string; commandId: string; revision: number; sessionId: string }>
}

describe('Web project memory proposal and human review', () => {
  let scaffold: WebScaffold
  let browser: Browser | undefined
  let page: Page | undefined
  let tripwire: ReturnType<typeof watchConsole>
  let caller: Agent
  let sourceBytes: string
  let memoryId: string

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      ...MODE === 'record' ? await memoryLiveOptions() : {},
      extraOverlayPath: join(BUNDLE, 'cordis.patch.yml'),
      extraInstallAnchors: [join(BUNDLE, 'package.json')],
      toolsMode: 'native',
      // Each run creates new durable Workspace/memory identities. Assertions below
      // check fresh disk state, command evidence, source hashes and request headers.
      compareReplaySession: false,
      ...MODE === 'record' ? {} : { replayFixture: FIXTURE },
    })
    sourceBytes = await readFile(join(BUNDLE, 'tests/fixtures/acceptance-workspace/README.md'), 'utf8')
    await mkdir(join(scaffold.workspaceCwd, 'workspace'))
    await writeFile(join(scaffold.workspaceCwd, 'workspace/README.md'), sourceBytes)
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
    if (failures.length > 0) throw new AggregateError(failures, 'project memory Web teardown failed')
  })

  async function stored(): Promise<StoredRecord> {
    const payload = JSON.parse(await readFile(join(scaffold.storageRoot, 'project_memory.json'), 'utf8')) as {
      tables: { memories: Record<string, StoredRecord> }
    }
    const records = Object.values(payload.tables.memories)
    expect(records).toHaveLength(1)
    return records[0] as StoredRecord
  }

  it('records a real model proposal and accepts it through the browser command plane', async () => {
    if (page === undefined) throw new Error('browser not started')
    onTestFailed(async () => {
      await saveFailureShot(page as Page, 'project-memory-review')
      if (caller !== undefined) {
        await recordFixture(scaffold, caller.session.id, join(REPO_ROOT, '.artifacts/project-memory/web-failed-session.jsonl'))
      }
    })
    if (MODE !== 'record') expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    const input = page.locator('[data-composer-input]').first()
    const settled = scaffold.whenTurnSettled(120_000)
    await input.fill(PROMPT)
    await input.press('Enter')
    const sessionId = await settled
    const active = scaffold.ctx.agents.get(sessionId)
    if (active === undefined) throw new Error('the browser session has no live Agent')
    caller = active
    const failures = caller.session.events.filter(event => event.type === 'turn/end' && event.data.reason.kind === 'error')
    expect(failures, 'the model turn must finish without a Provider/runtime error').toEqual([])
    const calls = caller.session.events.filter(event => event.type === 'tool/call' && event.data.name === 'memory_propose')
    expect(calls).toHaveLength(1)
    await page.getByText('MEMORY_CANDIDATE_READY', { exact: true }).waitFor({ timeout: 10_000 })
    const candidate = await stored()
    memoryId = candidate.id
    expect(candidate).toMatchObject({ activeRevision: null, candidateRevision: 1, recordVersion: 1, decisions: [] })
    expect(candidate.revisions[0]?.statement).toContain('pnpm verify:memory-web')
    expect(candidate.revisions[0]?.sources).toMatchObject([{
      kind: 'file', path: 'README.md', sha256: createHash('sha256').update(sourceBytes).digest('hex'),
    }])
    const turns = caller.session.events.filter(event => event.type === 'turn/start').length

    await input.fill(`/memory show ${memoryId}`)
    await input.press('Enter')
    await page.getByText('版本 1（待确认）：Project validation', { exact: false }).waitFor({ timeout: 10_000 })
    await input.fill(`/memory accept ${memoryId}@1`)
    await input.press('Enter')
    await page.getByText(`已接纳：${memoryId}@1。`, { exact: true }).waitFor({ timeout: 10_000 })
    const accepted = await stored()
    expect(accepted).toMatchObject({ activeRevision: 1, candidateRevision: null, recordVersion: 2 })
    expect(accepted.decisions).toHaveLength(1)
    const decision = accepted.decisions[0]
    expect(decision).toMatchObject({ action: 'accept', revision: 1, sessionId })
    expect(caller.session.events.some(event => event.type === 'command/run'
      && event.data.commandId === decision?.commandId && event.data.args?.trim() === `accept ${memoryId}@1`)).toBe(true)
    expect(caller.session.events.filter(event => event.type === 'turn/start')).toHaveLength(turns)
    expect(await readFile(join(scaffold.workspaceCwd, 'workspace/README.md'), 'utf8')).toBe(sourceBytes)

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
    const aria = (await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd))
      .replaceAll(memoryId, '{{memoryId}}')
      .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z/gu, '{{checkedAt}}')
    if (MODE !== 'record') await compareOrRefreshGolden(join(SNAPSHOT_DIR, 'ui.expected.md'), aria, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    const evidenceDir = join(REPO_ROOT, '.artifacts/project-memory')
    await mkdir(evidenceDir, { recursive: true })
    await writeFile(join(evidenceDir, `web-${MODE}.json`), JSON.stringify({
      mode: MODE, sessionId, memoryId, commandId: decision?.commandId,
      sourceHash: candidate.revisions[0]?.sources[0]?.sha256, modelProposalCalls: calls.length,
      activeRevision: accepted.activeRevision, recordVersion: accepted.recordVersion, humanCommandsAddedTurns: 0,
    }, null, 2))
    await page.screenshot({ path: join(evidenceDir, `web-${MODE}.png`), fullPage: true })
  }, 180_000)

  it.skipIf(MODE === 'record')('keeps the recorded scenario inventory complete', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, [
      'session.jsonl', 'system-prompt.expected.md', 'tool-schemas.expected.json', 'ui.expected.md',
    ])
  })
})
