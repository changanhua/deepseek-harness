/** Delegation enters through the built Web UI and returns a proposal through real Planning tools. */
import { mkdir, mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { load, dump } from 'js-yaml'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { loadReplayScript, parseSessionLog, prepareSessionSnapshotFixtureForComparison } from '@deepseek-ai/dsh-llm-replay'
import type {} from '@changanhua/dsh-planning'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, recordFixture, webSnapshotMode } from './scaffold.ts'
import { newEnglishPage, REPO_ROOT, saveFailureShot } from './support.ts'
import { normalizePlanningSessionLog } from './planning-snapshot-support.ts'

const scenario = join(REPO_ROOT, 'snapshots/web/planning-steward')
const fixture = join(scenario, 'session.v3.jsonl')
const replayOverride = join(scenario, 'replay.override.json')
const mode = webSnapshotMode()

function mapText(value: unknown, transform: (text: string) => string): unknown {
  if (typeof value === 'string') return transform(value)
  if (Array.isArray(value)) return value.map(child => mapText(child, transform))
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, mapText(child, transform)]))
  return value
}

function repositoryRoots(root: string): { native: string; msys: string; rejectedMsys: string } {
  const native = root.replace(/[\\/]+$/u, '').replaceAll('\\', '/')
  const msys = native.replace(/^([a-z]):/iu, (_whole, drive: string) => `/${drive.toLowerCase()}`)
  return { native, msys, rejectedMsys: `${native.slice(0, 3)}${msys.slice(1)}` }
}

function normalizeRepositoryText(text: string): string {
  const roots = repositoryRoots(REPO_ROOT)
  const aliases = [[roots.native, '{{sourceRoot}}'], [roots.msys, '{{sourceRootMsys}}'], [roots.rejectedMsys, '{{sourceRootMsys}}']]
    .flatMap(([source, token]) => {
      if (source === undefined || token === undefined) return []
      const windows = source.replaceAll('/', '\\')
      return [[source, token], [windows, token], [windows.replaceAll('\\', '\\\\'), token]] as const
    }).sort(([left], [right]) => right.length - left.length)
  for (const [source, token] of aliases) text = text.replaceAll(source, token)
  text = text.replaceAll('PLANNING_PERSONAL_PACKAGE_ROOT', '{{sourceRoot}}/packages/bundle/personal-planning')
  return text.replace(/\{\{sourceRoot(?:Msys)?\}\}(?:[\\/]+[a-z0-9._-]+)*/giu, path => path.replace(/\\+/gu, '/'))
}

function materializeRepositoryPaths(value: unknown, root: string): unknown {
  const roots = repositoryRoots(root)
  return mapText(value, text => text.replaceAll('{{sourceRootMsys}}', roots.msys).replaceAll('{{sourceRoot}}', roots.native)
    .replaceAll('PLANNING_PERSONAL_PACKAGE_ROOT', `${roots.native}/packages/bundle/personal-planning`))
}

function normalizeStewardshipAria(snapshot: string): string {
  const visit = (value: unknown): unknown => {
    if (typeof value === 'string' && value.startsWith('Source 证据（环境）：工作区 ')) return 'Source 证据（环境）：工作区 {{cwd}}…'
    if (typeof value === 'string' && /^· Captured on \d{4}-\d{2}-\d{2}$/u.test(value)) return '· Captured on {{date}}'
    if (Array.isArray(value)) return value.map(visit)
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]))
    return value
  }
  return dump(visit(load(snapshot)), { lineWidth: -1, noRefs: true }).trimEnd()
}

function normalizeStewardshipLog(raw: string): string {
  const records = parseSessionLog(raw)
  const calls = new Set(records.flatMap(record => record.type === 'tool/call' && record.data.name.startsWith('planning_') ? [record.data.callId] : []))
  const grepCalls = new Set<string>(records.flatMap(record => record.type === 'tool/call' && record.data.name === 'grep' ? [record.data.callId] : []))
  const globCalls = new Set<string>(records.flatMap(record => record.type === 'tool/call' && record.data.name === 'glob' ? [record.data.callId] : []))
  const links = new Map<string, string>()
  const clocks = new Map<string, string>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (value === null || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === 'id' && typeof child === 'string' && /^plan-link-[0-9a-f-]+$/u.test(child) && !links.has(child)) links.set(child, `PLANNING_LINK_${links.size + 1}`)
      if ((key === 'createdAt' || key === 'created_at') && typeof child === 'string' && !clocks.has(child)) clocks.set(child, `PLANNING_CREATED_AT_${clocks.size + 1}`)
      visit(child)
    }
  }
  for (const record of records) {
    if (record.type !== 'tool/result' || !calls.has(record.data.message.source.callId)) continue
    for (const block of record.data.message.content) {
      if (block.type !== 'tool-result') continue
      for (const part of block.content) {
        if (part.type !== 'text') continue
        try { visit(JSON.parse(part.text) as unknown) } catch { /* Tool errors and prose have no Planning identities. */ }
      }
    }
  }
  const replaceClocks = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(replaceClocks)
    if (value === null || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
      (key === 'createdAt' || key === 'created_at') && typeof child === 'string' ? clocks.get(child) ?? child : replaceClocks(child),
    ]))
  }
  const portable = raw.split(/\r?\n/u).map(line => line ? JSON.stringify(mapText(JSON.parse(line) as unknown, normalizeRepositoryText)) : line).join('\n')
  let normalized = normalizePlanningSessionLog(portable)
  for (const [source, target] of links) normalized = normalized.replaceAll(source, target)
  return normalized.split(/\r?\n/u).map((line) => {
    if (!line) return line
    const record = JSON.parse(line) as {
      type: string
      data?: {
        source?: { kind: string; sections?: { name: string; text: string }[] }
        content?: { type: string; text: string }[]
        message?: { source: { callId: string }; content: { content?: { type: string; text: string }[] }[] }
        meta?: { files?: { path: string }[]; paths?: string[]; shape?: string }
      }
    }
    const data = record.data
    if (record.type === 'tool/result' && data?.message !== undefined && globCalls.has(data.message.source.callId)
      && data.meta?.shape === 'paths') {
      for (const block of data.message.content) for (const part of block.content ?? []) {
        if (part.type === 'text') part.text = part.text.split('\n').sort().join('\n')
      }
      data.meta.paths?.sort()
    }
    if (record.type === 'user/message' && data?.source?.kind === 'plugin') {
      for (const section of data.source.sections ?? []) {
        if (section.name !== 'planning-workspace') continue
        const old = section.text
        section.text = JSON.stringify(replaceClocks(JSON.parse(old) as unknown))
        for (const block of data.content ?? []) if (block.type === 'text') block.text = block.text.replaceAll(old, section.text)
      }
    }
    if (record.type === 'tool/result' && data?.message !== undefined && grepCalls.has(data.message.source.callId)) {
      for (const block of data.message.content) for (const part of block.content ?? []) {
        if (part.type !== 'text' || !/^Found \d+ matches\n\n/u.test(part.text)) continue
        const [heading, ...matches] = part.text.split('\n\n')
        part.text = [heading, ...matches.sort()].join('\n\n')
      }
      data.meta?.files?.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    }
    return JSON.stringify(record)
  }).join('\n')
}

async function writeStewardshipReplayOverride(): Promise<void> {
  // Preserve the recorded model output; only bind generated revisions to
  // the current Planning context when the same calls replay without keys.
  const replacements = [
    ['PLANNING_REVISION_1', '{{fromRequest:(plan-revision-[0-9a-f-]+)}}'],
    ['{{cwd}}', '{{fromRequest:session workspace: "([^"]+)"}}'],
  ] as const
  const materialize = (value: unknown): unknown => {
    if (typeof value === 'string') {
      let text = value
      for (const [source, target] of replacements) text = text.replaceAll(source, target)
      return text
    }
    if (Array.isArray(value)) return value.map(materialize)
    if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, materialize(child)]))
    return value
  }
  const patches = loadReplayScript({ file: fixture }).flatMap((entry, at) => {
    const recorded = JSON.stringify(entry)
    return replacements.some(([source]) => recorded.includes(source)) || recorded.includes('{{sourceRoot') || recorded.includes('PLANNING_PERSONAL_PACKAGE_ROOT')
      ? [{ at, entry: materialize(entry) }]
      : []
  })
  await writeFile(replayOverride, `${JSON.stringify({ patches })}\n`)
}

// This real-provider recording includes Windows PowerShell shell behavior.
it.skipIf(process.platform !== 'win32' || mode === 'record' && !process.env.DEEPSEEK_API_KEY)(
  'delegates the whole goal and retains an evidence-backed next step without adopting or executing it',
  async () => {
    if (mode === 'refresh') {
      await writeFile(fixture, prepareSessionSnapshotFixtureForComparison(normalizeStewardshipLog(await readFile(fixture, 'utf8'))))
      await writeStewardshipReplayOverride()
    }
    const replayDirectory = mode === 'record' ? undefined : await mkdtemp(join(tmpdir(), 'dsh-steward-replay-'))
    const runtimeOverride = replayDirectory === undefined ? undefined : join(replayDirectory, 'replay.override.json')
    if (runtimeOverride !== undefined) {
      const recorded = JSON.parse(await readFile(replayOverride, 'utf8')) as unknown
      // A distinct root proves this binding uses the supplied checkout, rather
      // than retaining the recording machine's path or an ambient constant.
      const alternateRoot = join(tmpdir(), 'dsh-steward-alternate-checkout')
      const alternate = JSON.stringify(materializeRepositoryPaths(recorded, alternateRoot))
      expect(alternate).toContain(repositoryRoots(alternateRoot).native)
      expect(alternate).not.toContain(repositoryRoots(REPO_ROOT).native)
      await writeFile(runtimeOverride, JSON.stringify(materializeRepositoryPaths(recorded, REPO_ROOT)))
    }
    const scaffold = await launchWebScaffold({
      extraOverlayPath: join(REPO_ROOT, 'packages/bundle/personal-planning/cordis.patch.yml'),
      extraInstallAnchors: [join(REPO_ROOT, 'packages/bundle/personal-planning/package.json')],
      toolsMode: 'native',
      ...(runtimeOverride === undefined ? {} : { replayFixture: fixture, replayOverride: runtimeOverride }),
      normalizeScenarioLog: normalizeStewardshipLog,
    })
    const browser = await chromium.launch()
    const page = await newEnglishPage(browser)
    const observed: SessionEvent[] = []
    const off = scaffold.ctx.on('session/event', (_session, event) => { observed.push(event) })
    const artifacts = join(REPO_ROOT, '.artifacts/project-delegation')
    let primaryError: unknown
    let cancelWait = () => {}
    try {
      const workspace = await scaffold.hostCtx.workspaceRegistry.create(scaffold.workspaceCwd, 'Delegation acceptance')
      const access = { workspaceId: workspace.id, actorId: 'acceptance', kind: 'human' as const, authorize() {} }
      const planning = scaffold.hostCtx.get('planning')!
      await planning.execute(access, {
        kind: 'create', requestId: 'steward-goal', expectedBoardVersion: 0, itemId: 'coordination-goal',
        title: '减少项目推进中的人工协调负担',
        intent: '我不想每件事都自己想方向、拆技术方案、催进度和纠偏。服务器日志要自己盯只是一个例子，不是本轮完整需求。请根据保留的用户报告调查并给出一个有限投入建议，说明证据、未知与停止条件，把建议和下一步留在同一个计划。当前只允许调查与提案，不开发、不执行、不采纳。',
        lane: 'now', scope: [], acceptance: [], reviewAt: null,
        sources: [{ kind: 'manual', text: '用户报告：三个任务都需要重新解释背景；交付后需要主动询问是否真正可用；提到服务器日志的例子时，讨论被缩成单一监控功能。这里只是用户报告，尚无运行测量。' }],
        estimate: { value: null, urgency: null, reuse: null, compounding: null, timeCost: null, tokenCost: null, risk: null, cognitiveCost: null, rationale: '' },
      })
      const originalPlan = (await planning.snapshot(access)).items[0]!
      const base = originalPlan.headRevisionId
      const openPlanning = async () => {
        const more = page.getByRole('button', { name: 'More', exact: true })
        if (await more.getAttribute('aria-expanded') !== 'true') await more.click()
        await page.getByRole('button', { name: /^Planning(?:\s|$)/u }).first().click()
        await page.getByRole('combobox', { name: 'Project', exact: true }).selectOption(workspace.id)
        await page.getByRole('button', { name: '减少项目推进中的人工协调负担', exact: true }).first().click()
      }
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await openPlanning()
      const settled = new Promise<SessionId>((resolve, reject) => {
        const timeoutMs = mode === 'record' ? 180_000 : 60_000
        const timer = setTimeout(() => { fail(new Error(`no stewardship turn/end within ${timeoutMs}ms`)) }, timeoutMs)
        const stop = scaffold.ctx.on('session/event', (session, event) => {
          if (event.type === 'tool/call' && event.data.name === 'ask_user_question') {
            fail(new Error('initial stewardship must save its recommendation and finish without ask_user_question'))
          } else if (event.type === 'turn/end') {
            if (event.data.reason.kind !== 'completed') {
              fail(new Error(`stewardship ended abnormally: ${JSON.stringify(event.data.reason)}`))
              return
            }
            cancelWait()
            scaffold.ctx.sessions.flush(session).then(() => { resolve(session.id) }, reject)
          }
        })
        cancelWait = () => { clearTimeout(timer); stop() }
        function fail(error: Error): void { cancelWait(); reject(error) }
      })
      // Attach the rejection before the browser click can start a fast replay.
      void settled.catch(() => {})
      await page.getByRole('tab', { name: 'Work and discussion', exact: true }).click()
      await page.getByRole('button', { name: 'Delegate stewardship', exact: true }).click()
      const sessionId = await settled
      const result = await planning.snapshot(access)
      expect(result.sessionBindings).toMatchObject([{ sessionId: String(sessionId), subject: { kind: 'plan', id: 'coordination-goal' }, baseRevision: base }])
      expect(observed.some(event => event.type === 'tool/call' && event.data.name === 'skill'
        && (JSON.parse(event.data.arguments) as { name?: string }).name === 'project-steward')).toBe(true)
      expect(observed.some(event => event.type === 'tool/call' && event.data.name === 'planning_context')).toBe(true)
      expect(observed.some(event => event.type === 'tool/call' && event.data.name === 'ask_user_question')).toBe(false)
      expect(observed.filter(event => event.type === 'turn/end').map(event => event.type === 'turn/end' ? event.data.reason : undefined))
        .toEqual([{ kind: 'completed' }])
      expect(observed.filter(event => event.type === 'tool/call' && /^(?:bash|pwsh|read|glob|grep)$/u.test(event.data.name))
        .some(event => event.type === 'tool/call' && /\.dsh-storages|session_projcache/u.test(event.data.arguments))).toBe(false)
      const proposal = result.proposals.find(value => value.status === 'pending' && value.targetItemId === 'coordination-goal')
      expect(proposal).toBeDefined()
      expect(proposal!.generations.at(-1)?.delta?.subject).toEqual({ kind: 'plan', id: 'coordination-goal' })
      expect(proposal!.generations.at(-1)?.delta?.operations.length).toBeGreaterThan(0)
      expect(result.proposals).toHaveLength(1)
      expect(result.items).toHaveLength(1)
      expect(result.items[0]!.headRevisionId).toBe(base)
      expect(result.items[0]!.revisions.at(-1)!.intent).toBe(originalPlan.revisions.at(-1)!.intent)
      expect(result.handoffs).toHaveLength(0)
      await mkdir(artifacts, { recursive: true })
      await writeFile(join(artifacts, 'steward-evidence.json'), JSON.stringify({ binding: result.sessionBindings, proposal,
        events: observed.filter(event => ['user/message', 'tool/call', 'tool/result', 'assistant/message', 'turn/end'].includes(event.type)),
      }, null, 2))
      if (mode === 'record') {
        await recordFixture(scaffold, sessionId, fixture)
        await writeStewardshipReplayOverride()
      }
      await page.reload({ waitUntil: 'load' })
      await openPlanning()
      await page.getByRole('button', { name: /^Awaiting my review/u }).click()
      await page.getByRole('heading', { name: 'Drafts to review', exact: true }).waitFor()
      await compareOrRefreshGolden(join(scenario, 'ui.expected.md'), normalizeStewardshipAria(await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)), mode === 'record' ? 'refresh' : mode)
      await page.getByRole('heading', { name: 'Drafts to review', exact: true }).scrollIntoViewIfNeeded()
      await page.screenshot({ path: join(artifacts, 'steward-proposal.png'), fullPage: true })
    } catch (error) {
      primaryError = error
      await mkdir(artifacts, { recursive: true })
      await writeFile(join(artifacts, 'steward-failure-events.json'), JSON.stringify(observed, null, 2))
      await saveFailureShot(page, 'planning-steward')
      throw error
    } finally {
      cancelWait()
      off()
      const failures: unknown[] = []
      await browser.close().catch((error: unknown) => failures.push(error))
      await scaffold.close().catch(async (error: unknown) => {
        failures.push(error)
        const details = (failure: unknown): unknown => failure instanceof AggregateError ? (failure.errors as unknown[]).map(details)
          : failure instanceof Error ? { message: failure.message, ...Object.fromEntries(Object.entries(failure)) } : String(failure)
        await writeFile(join(artifacts, 'steward-cleanup-errors.json'), JSON.stringify(details(error), null, 2))
      })
      if (runtimeOverride !== undefined && replayDirectory !== undefined) {
        await unlink(runtimeOverride).catch((error: unknown) => failures.push(error))
        await rmdir(replayDirectory).catch((error: unknown) => failures.push(error))
      }
      if (failures.length) throw new AggregateError(primaryError === undefined ? failures : [primaryError, ...failures], 'Stewardship acceptance and cleanup failures')
    }
  }, 300_000,
)
