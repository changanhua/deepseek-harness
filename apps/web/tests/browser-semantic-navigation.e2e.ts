/** Semantic navigation through the built Web Profile and MV3 extension, using a real provider or explicit keyless replay. */
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import { probeFreePort, REPO_ROOT, saveFailureShot } from './support.ts'
import { selectSemanticEvaluationCase } from './fixtures/semantic-evaluation.ts'

const replay = process.env.DSH_SEMANTIC_REPLAY === '1' || process.env.DSH_SNAPSHOT === 'replay'
const workspace = replay && (process.env.DSH_SEMANTIC_CASE === undefined || process.env.DSH_SEMANTIC_CASE === 'article')
const real = process.env.DSH_SEMANTIC_REAL === '1' && Boolean(process.env.DEEPSEEK_API_KEY)
const headful = process.env.DSH_SEMANTIC_HEADFUL === '1'
const videoDir = process.env.DSH_SEMANTIC_VIDEO_DIR
const navigateAfterBind = process.env.DSH_SEMANTIC_NAVIGATE_AFTER_BIND === '1'
const article = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>缓存定位实验</title>
<style>body{max-width:780px;margin:40px auto;font:18px sans-serif;line-height:1.65}section{margin:2em 0}.spacer{height:900px}</style></head><body>
<main><article><h1>缓存定位实验</h1><section><h2>实验结论</h2><p id="limited">在我们测试的三种页面模板中，缓存使平均定位时间缩短了约 14%；其他页面尚未验证。</p>
<p>这项结果仅描述已采集的模板范围，不能推及所有网页。</p></section><section><h2>测量数据</h2><table><thead><tr><th>模板</th><th>改善</th></tr></thead><tbody><tr><td>A</td><td>约 14%</td></tr></tbody></table>
<pre><code>const scope = ['template-a', 'template-b', 'template-c']</code></pre></section><div class="spacer"></div><p>结束。</p></article></main></body></html>`
const playerList = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>合成球员列表</title>
<style>body{max-width:780px;margin:40px auto;font:18px sans-serif;line-height:1.65}td,th{padding:10px;border-bottom:1px solid #ddd}.spacer{height:900px}</style></head><body>
<main><article><h1>合成球员列表</h1><p>这是测试用的合成列表，不是 FUTBIN 实页。</p><table><thead><tr><th>球员</th><th>球队</th><th>位置</th><th>评分</th></tr></thead><tbody>
<tr id="player-target"><td>Kylian Mbappé</td><td>Paris SG</td><td>ST</td><td>91</td></tr><tr><td>Aitana Bonmatí</td><td>Barcelona</td><td>CM</td><td>91</td></tr>
</tbody></table><div class="spacer"></div></article></main></body></html>`
const caseId = process.env.DSH_SEMANTIC_CASE
const fixed = caseId && caseId !== 'article' && caseId !== 'list' && caseId !== 'live-pr'
  && caseId !== 'live-dom-sample'
  ? selectSemanticEvaluationCase(caseId, process.env.DSH_SEMANTIC_SPLIT) : undefined
if (fixed === undefined && process.env.DSH_SEMANTIC_SPLIT !== undefined && process.env.DSH_SEMANTIC_SPLIT !== 'example') {
  throw new Error('semantic evaluation split mismatch for example case')
}
const liveSampleHtml = caseId === 'live-dom-sample'
  ? await readFile(join(REPO_ROOT, '.artifacts/browser-assistant-v2/semantic-redesign/futbin-live-sample.html'), 'utf8') : null
const scenario = fixed === undefined ? caseId === 'live-dom-sample'
  ? { id: 'live-dom-sample', split: 'live-page-sample', html: liveSampleHtml!, title: 'FUTBIN live DOM sample',
    target: 'main a[href*="/27/player/506/"]', identity: 'Kika Nazareth', exact: false, sourceBlockOrdinal: undefined }
  : caseId === 'live-pr'
    ? { id: 'live-pr', split: 'live-site', html: '', title: 'DeepSeek Harness PR #73',
      target: 'body', identity: 'deepseek-harness', exact: false, sourceBlockOrdinal: undefined }
    : process.env.DSH_SEMANTIC_CASE === 'list'
      ? { id: 'list', split: 'example', html: playerList, title: '合成球员列表', target: '#player-target', identity: 'Kylian Mbappé', exact: false, sourceBlockOrdinal: undefined }
      : { id: 'article', split: 'example', html: article, title: '缓存定位实验', target: '#limited', identity: '在我们测试的三种页面模板中，缓存使平均定位时间缩短了约 14%；其他页面尚未验证。', exact: true, sourceBlockOrdinal: undefined }
  : { id: fixed.id, split: fixed.split, html: fixed.html, title: fixed.title, target: fixed.targetSelector,
    identity: fixed.expectedSnapshotText, exact: false, sourceBlockOrdinal: fixed.targetBlockOrdinal }
const fixtureSha256 = createHash('sha256').update(JSON.stringify(scenario)).digest('hex')

interface Host { child: ChildProcess; url: string; diagnostic: () => string }
interface AssistantState {
  connection: { phase: string; grant?: { installationId: string } }
  session: { phase: string; binding: { sessionId: string } | null; records: Array<{ event?: unknown }> }
  target: { revision?: number; selected?: { tabId: number; documentId?: string; url?: string; status?: string } | null }
  cognition?: unknown
}

interface ExtensionChrome {
  runtime: { sendMessage(input: unknown): Promise<unknown> }
  tabs: { query(input: { url: string }): Promise<Array<{ id?: number }>> }
}

async function stop(host: Host | undefined): Promise<void> {
  if (!host || host.child.exitCode !== null || host.child.signalCode !== null) return
  const exited = new Promise<void>((done) => { host.child.once('exit', () => { done() }) })
  host.child.kill('SIGTERM')
  const timer = setTimeout(() => { host.child.kill('SIGKILL') }, 10_000)
  try { await exited } finally { clearTimeout(timer) }
}

async function start(home: string, port: number, patch?: string): Promise<Host> {
  // oxlint-disable-next-line typescript/no-unsafe-assignment, typescript/no-unsafe-call
  const launch = resolveExampleLaunch({
    srcBin: resolve(REPO_ROOT, 'apps/cli/src/bin.ts'), libBin: resolve(REPO_ROOT, 'apps/cli/lib/bin.js'),
    configArgs: ['web', ...(patch ? ['--patch', patch] : []), '--no-open', '--port', String(port)], mode: 'lib',
    env: { DSH_HOME: home, DSH_AGENTS_HOME: join(home, 'agents'), DSH_TELEMETRY_DISABLED: '1',
      ...(process.env.DEEPSEEK_API_KEY ? { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY } : {}) },
  })
  // oxlint-disable-next-line typescript/no-unsafe-argument, typescript/no-unsafe-member-access
  const child = spawn(launch.command, launch.args, {
    // oxlint-disable-next-line typescript/no-unsafe-assignment, typescript/no-unsafe-call, typescript/no-unsafe-member-access
    cwd: REPO_ROOT, env: { ...scrubbedParentEnv(), ...launch.env },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  let output = ''
  try {
    const url = await new Promise<string>((done, reject) => {
      const timer = setTimeout(() => { reject(new Error('semantic navigation Host readiness timed out')) }, 90_000)
      const append = (chunk: Buffer): void => {
        output = `${output}${String(chunk)}`.slice(-8000)
        const match = /dsh web: (http:\/\/[^\s]+)/u.exec(output)
        if (match?.[1]) { clearTimeout(timer); done(match[1]) }
      }
      child.stdout?.on('data', append); child.stderr?.on('data', append)
      child.once('error', (error) => { clearTimeout(timer); reject(error) })
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`semantic navigation Host exited ${String(code)}`)) })
    })
    return { child, url, diagnostic: () => output.replace(/https?:\/\/[^\s]+/gu, '[URL]') }
  } catch (error) { await stop({ child, url: '', diagnostic: () => '' }); throw error }
}

async function prepareReplay(root: string, scenarioId: string): Promise<string> {
  const patch = join(root, 'semantic-replay.patch.yml')
  const targetInstallation = '{{fromRequest:"installationId":"([^"]+)"}}'
  const targetTab = '{{fromRequest:"tabId":([0-9]+)}}'
  const snapshotId = '{{fromRequest:"snapshotId":"(snapshot-[^"]+)"}}'
  const call = (id: string, name: string, args: string) => ({ kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } },
    { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ] })
  const answer = '地图已按已读取的来源块生成。'
  const nodes = scenarioId === 'live-dom-sample' ? [
    { parentIndex: -1, label: '热门球员卡片', summary: '前排卡片包括 Kika Nazareth、Álvaro Carreras 和 Rashford。', sourceRefs: ['block-2', 'block-3', 'block-4'] },
    { parentIndex: 0, label: 'Kika Nazareth', summary: '83 CM；国籍 Portugal、联赛 Liga F、俱乐部 FC Barcelona。', sourceRefs: ['block-2'] },
    { parentIndex: -1, label: '卡片可比字段', summary: '卡片列出评分、位置和 PAC、SHO、PAS、DRI、DEF、PHY。', sourceRefs: ['block-2', 'block-3'] },
  ] : [
    { parentIndex: -1, label: '实验结论与限制', summary: '三种页面模板中平均定位时间缩短约 14%，其他页面未验证。', sourceRefs: ['block-2', 'block-3'] },
    { parentIndex: 0, label: '适用范围', summary: '只描述已采集的模板，不能推及所有网页。', sourceRefs: ['block-2', 'block-3'] },
    { parentIndex: -1, label: '测量依据', summary: '表格记录模板 A 的改善约为 14%。', sourceRefs: ['block-5', 'block-6'] },
    { parentIndex: 2, label: '原始数据', summary: '模板 A 约 14%。', sourceRefs: ['block-6'] },
  ]
  const round = (suffix: string) => [
    call(`semantic-snapshot-${suffix}`, 'browser_snapshot', `{"installationId":"${targetInstallation}","tabId":${targetTab},"frameId":0,"tree":false,"structure":true,"textLimit":0,"limit":1}`),
    call(`semantic-read-0-${suffix}`, 'browser_read_source', `{"snapshotId":"${snapshotId}","offset":0}`),
    call(`semantic-read-8-${suffix}`, 'browser_read_source', `{"snapshotId":"${snapshotId}","offset":8}`),
    call(`semantic-publish-${suffix}`, 'browser_publish_semantic_map', JSON.stringify({ snapshotId, nodes })),
    { kind: 'chunks', chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: answer },
      { type: 'block-end', index: 0, block: { type: 'text', text: answer } },
      { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ] },
  ]
  const taskAnswer = { kind: 'chunks', chunks: [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: '已按选入对象和人工修正处理。' },
    { type: 'block-end', index: 0, block: { type: 'text', text: '已按选入对象和人工修正处理。' } },
    { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ] }
  const script = scenarioId === 'live-pr'
    ? [call('live-pr-snapshot', 'browser_snapshot', `{"installationId":"${targetInstallation}","tabId":${targetTab},"frameId":0,"tree":false,"structure":true,"textLimit":5000,"limit":64}`),
      call('live-pr-source', 'browser_read_source', `{"snapshotId":"${snapshotId}","offset":0}`),
      call('live-pr-source-next', 'browser_read_source', `{"snapshotId":"${snapshotId}","offset":8}`),
      call('live-pr-source-more', 'browser_read_source', `{"snapshotId":"${snapshotId}","offset":16}`),
      { kind: 'chunks', chunks: [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: '已读取当前固定网页。' },
        { type: 'block-end', index: 0, block: { type: 'text', text: '已读取当前固定网页。' } },
        { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } },
        { type: 'finish', reason: { kind: 'stop' } },
      ] }, taskAnswer]
    : [...round('first'), ...(process.env.DSH_SEMANTIC_FEEDBACK === '1' ? round('second') : []), ...(workspace ? [taskAnswer] : [])]
  await writeFile(join(root, 'session.jsonl'), JSON.stringify({ type: 'session', version: 3,
    id: 'semantic-replay', createdAt: 1, cwd: root, isSeeded: false, delegationDepth: 0,
    agentPreset: 'browser-assistant' }) + '\n')
  await writeFile(join(root, 'replay.json'), JSON.stringify(script))
  await writeFile(patch, [
    '- id: llm-deepseek\n  disabled: true', '- id: llm-pi-ai\n  disabled: true',
    '- id: session-title-llm\n  disabled: true', '- id: agent-instructions\n  disabled: true',
    '- insert:', '    - id: semantic-replay',
    `      name: ${JSON.stringify(pathToFileURL(join(REPO_ROOT, 'packages/test-support/llm-replay/lib/index.js')).href)}`,
    `      config:\n        file: ${JSON.stringify(join(root, 'session.jsonl'))}\n        overrideFile: ${JSON.stringify(join(root, 'replay.json'))}`,
    '        providers:\n          - id: deepseek-official\n            name: Semantic replay\n            models:',
    '              - id: deepseek-v4-flash\n                contextWindow: 128000\n                inputModalities: [text, image]\n                imageRequestTokens: 64',
  ].join('\n'))
  return patch
}

async function assistantState(panel: Page): Promise<AssistantState> {
  const reply = await panel.evaluate(async () => {
    const browserGlobal = globalThis as unknown as { chrome: ExtensionChrome }
    return browserGlobal.chrome.runtime.sendMessage({ type: 'dsh-assistant-state', surfaceId: sessionStorage.getItem('dsh.assistant.surface.v2') })
  }) as { ok?: boolean; error?: unknown; state?: AssistantState }
  if (reply.ok !== true) throw new Error(`assistant state failed: ${String(reply.error)}`)
  if (!reply.state) throw new Error('missing assistant state')
  return reply.state
}

async function extensionMessage(panel: Page, message: unknown): Promise<unknown> {
  return panel.evaluate((input) => {
    const browserGlobal = globalThis as typeof globalThis & { chrome: ExtensionChrome }
    return browserGlobal.chrome.runtime.sendMessage({ ...(input as Record<string, unknown>), surfaceId: sessionStorage.getItem('dsh.assistant.surface.v2') })
  }, message)
}

async function tabId(panel: Page, url: string): Promise<number> {
  const id = await panel.evaluate(async (targetUrl) => {
    const browserGlobal = globalThis as typeof globalThis & { chrome: ExtensionChrome }
    return (await browserGlobal.chrome.tabs.query({ url: targetUrl }))[0]?.id ?? null
  }, url)
  if (!Number.isInteger(id)) throw new Error('extension could not resolve fixture tab')
  return id
}

async function connect(panel: Page, context: BrowserContext, base: string): Promise<void> {
  await panel.locator('#show-settings').click()
  await panel.locator('#base-url').fill(base)
  const opening = context.waitForEvent('page', { timeout: 5_000 }).catch(() => undefined)
  await panel.locator('#save-settings').click()
  const approval = await opening
  if (approval) {
    await approval.waitForLoadState('domcontentloaded')
    const grant = approval.getByRole('button', { name: /允许所选权限|allow selected permissions/iu })
    if (await grant.count() !== 1) {
      const location = new URL(approval.url())
      throw new Error(`unexpected connection approval page ${location.origin}${location.pathname}: ${(await approval.locator('body').innerText()).slice(0, 500)}`)
    }
    await grant.click()
    await approval.getByRole('status').getByText(/已授权|authorized/iu).waitFor()
    await approval.close()
  }
  await extensionMessage(panel, { type: 'dsh-assistant-poll' })
  await expect.poll(async () => (await assistantState(panel)).connection.phase, { timeout: 30_000 }).toBe('connected')
  await panel.locator('#hide-settings').click()
}

function semanticPublishCount(records: AssistantState['session']['records']): number {
  const events = records.flatMap(record => record.event && typeof record.event === 'object' ? [record.event as Record<string, unknown>] : [])
  const calls = new Map<number, string>()
  for (const event of events) {
    const data = event.data as Record<string, unknown> | undefined
    if (event.type === 'tool/call' && typeof event.seq === 'number' && data?.name === 'browser_publish_semantic_map') calls.set(event.seq, 'publish')
  }
  return events.filter((event) => {
    if (event.type !== 'tool/result' || !Array.isArray(event.sourceEventSeqs)
      || !event.sourceEventSeqs.some(seq => calls.get(Number(seq)) === 'publish')) return false
    const data = event.data as {
      message?: { content?: Array<{ type?: string; isError?: boolean }> }
      meta?: { semanticMap?: unknown }
    } | undefined
    return data?.meta?.semanticMap !== undefined
      && data.message?.content?.some(block => block.type === 'tool-result' && block.isError === false) === true
  }).length
}

const semanticPublishResult = (records: AssistantState['session']['records']): boolean => semanticPublishCount(records) > 0

function turnEnded(records: AssistantState['session']['records']): boolean {
  return records.some(record => (record.event as { type?: unknown } | undefined)?.type === 'turn/end')
}

function eventTypes(records: AssistantState['session']['records']): string[] {
  return records.flatMap((record) => {
    const type = (record.event as { type?: unknown } | undefined)?.type
    return typeof type === 'string' ? [type] : []
  })
}

interface FocusEvidence {
  readonly label: string
  readonly documentFocused: boolean
  readonly activeElement: string | null
  readonly events: unknown
}

async function recordFocus(panel: Page, locator: ReturnType<Page['locator']>, label: string, evidence: FocusEvidence[]): Promise<void> {
  await panel.bringToFront()
  const documentFocused = await panel.evaluate(() => document.hasFocus())
  expect(documentFocused, `${label}: sidebar document must own keyboard focus`).toBe(true)
  await locator.focus()
  const activeElement = await locator.evaluate(() => {
    const active = document.activeElement
    return active instanceof HTMLElement ? active.outerHTML.slice(0, 240) : null
  })
  expect(await locator.evaluate(element => document.activeElement === element), `${label}: expected focused control`).toBe(true)
  const events = await panel.evaluate(() => {
    return (globalThis as typeof globalThis & { __semanticFocusEvents?: unknown }).__semanticFocusEvents ?? []
  })
  evidence.push({ label, documentFocused, activeElement, events })
}

function toolEvidence(records: AssistantState['session']['records']): Array<Record<string, unknown>> {
  return records.flatMap((record) => {
    const event = record.event as Record<string, unknown> | undefined
    const data = event?.data !== null && typeof event?.data === 'object' ? event.data as Record<string, unknown> : undefined
    if (event?.type === 'tool/call') return [{
      kind: 'call', seq: event.seq, callId: data?.callId, name: data?.name,
      arguments: typeof data?.arguments === 'string' ? data.arguments.slice(0, 4000) : undefined,
    }]
    if (event?.type !== 'tool/result') return []
    const message = data?.message !== null && typeof data?.message === 'object' ? data.message as Record<string, unknown> : undefined
    const content: unknown = Array.isArray(message?.content) ? (message.content as unknown[])[0] : undefined
    const block = content !== null && typeof content === 'object' ? content as Record<string, unknown> : undefined
    const resultContent: unknown[] = Array.isArray(block?.content) ? block.content as unknown[] : []
    return [{
      kind: 'result', seq: event.seq, sourceEventSeqs: event.sourceEventSeqs,
      isError: block?.isError === true,
      content: resultContent.flatMap((entry) => {
        const value = entry !== null && typeof entry === 'object' ? entry as Record<string, unknown> : undefined
        return typeof value?.text === 'string' ? [value.text.slice(0, 2000)] : []
      }),
      meta: data?.meta,
    }]
  })
}

function semanticReference(state: AssistantState, expectedSource: string, exact: boolean, sourceBlockOrdinal?: number): {
  nodeId: string | null
  blockId: string
  text: string
} {
  const cognition = state.cognition as { pages?: Array<Record<string, unknown>> } | undefined
  const page = cognition?.pages?.find(entry => entry.semanticMap !== null && entry.semanticMap !== undefined)
  const map = page?.semanticMap as { nodes?: Array<{ nodeId?: unknown; parentId?: unknown; sourceRefs?: unknown }> } | undefined
  const source = page?.sourceSnapshot as { blocks?: Array<{ blockId?: unknown; ordinal?: unknown; text?: unknown }> } | undefined
  const matches = source?.blocks?.filter(entry => typeof entry.blockId === 'string' && typeof entry.text === 'string'
    && (exact ? entry.text === expectedSource : entry.text.includes(expectedSource))) ?? []
  const block = matches.find(entry => entry.ordinal === sourceBlockOrdinal) ?? matches[0]
  if (!block || typeof block.blockId !== 'string' || typeof block.text !== 'string') {
    throw new Error('semantic map has no source block for the target content')
  }
  const node = map?.nodes?.find(entry => typeof entry.nodeId === 'string'
    && Array.isArray(entry.sourceRefs) && entry.sourceRefs.includes(block.blockId))
  if (!node || typeof node.nodeId !== 'string') return { nodeId: null, blockId: block.blockId, text: block.text }
  const topic = typeof node.parentId === 'string' ? map?.nodes?.find(entry => entry.nodeId === node.parentId) : node
  if (!topic || typeof topic.nodeId !== 'string') throw new Error('semantic map has no overview topic for the limited conclusion')
  return { nodeId: topic.nodeId, blockId: block.blockId, text: block.text }
}

it.skipIf(!real && !replay)('generates, navigates, and verifies a source-grounded semantic map in the loaded extension', async () => {
  if (replay && !['article', 'live-dom-sample', 'live-pr'].includes(scenario.id)) throw new Error('keyless semantic replay only covers article, live DOM and live PR cases')
  const parent = resolve(homedir()), root = await mkdtemp(join(parent, 'dsh-semantic-navigation-'))
  const home = join(root, 'home'), extension = join(root, 'extension')
  const port = await probeFreePort(), fixturePort = await probeFreePort()
  const base = `http://127.0.0.1:${port}`, fixture = `http://127.0.0.1:${fixturePort}`
  const replayArtifact = scenario.id === 'live-pr' ? 'replay-live-pr'
    : scenario.id === 'live-dom-sample' ? 'replay-futbin-live-dom-sample'
      : navigateAfterBind ? 'replay-navigation-article'
        : process.env.DSH_SEMANTIC_FEEDBACK === '1' ? 'replay-feedback-article' : 'replay-article'
  const artifact = join(REPO_ROOT, '.artifacts/browser-assistant-v2/semantic-navigation', replay ? replayArtifact : scenario.id)
  let host: Host | undefined, context: BrowserContext | undefined, panel: Page | undefined
  const focusEvidence: FocusEvidence[] = []
  let feedbackEvidence: Record<string, unknown> | null = null
  let navigationEvidence: Record<string, unknown> | null = null
  try {
    if (videoDir) await mkdir(videoDir, { recursive: true })
    await cp(join(REPO_ROOT, 'apps/chrome-extension'), extension, { recursive: true })
    const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8')) as Record<string, unknown>
    manifest.host_permissions = ['http://127.0.0.1/*', 'http://*/*', 'https://*/*']
    manifest.optional_host_permissions = []
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest))
    host = await start(home, port, replay ? await prepareReplay(root, scenario.id) : undefined)
    context = await chromium.launchPersistentContext(join(root, 'browser'), {
      channel: 'chromium', headless: !headful, locale: 'zh-CN', viewport: { width: 1200, height: 900 }, timeout: 30_000,
      ...(headful ? { slowMo: 80 } : {}),
      ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: 1200, height: 900 } } } : {}),
      ...(process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH === undefined ? {} : { executablePath: process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH }),
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    })
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15_000 })
    await context.request.get(host.url)
    const target = await context.newPage()
    if (scenario.id !== 'live-pr') await target.route(`${fixture}/article`, route => route.fulfill({ body: scenario.html, contentType: 'text/html' }))
    if (scenario.id === 'live-dom-sample') await target.route('https://**', route => route.abort())
    await target.goto(scenario.id === 'live-pr' ? 'https://github.com/changanhua/deepseek-harness/pull/73' : `${fixture}/article`,
      { waitUntil: 'domcontentloaded' })
    const unrelated = await context.newPage()
    await unrelated.route(`${fixture}/other`, route => route.fulfill({ body: '<h1>无关标签</h1>', contentType: 'text/html' }))
    await unrelated.goto(`${fixture}/other`)
    panel = await context.newPage()
    await panel.goto(`chrome-extension://${new URL(worker.url()).host}/sidebar.html`)
    await panel.evaluate(() => { sessionStorage.setItem('dsh.assistant.surface.v2', 'semantic-navigation') })
    await panel.reload()
    await panel.evaluate(() => {
      const events: Array<{ type: string; at: number; activeElement: string | null }> = []
      const view = globalThis as typeof globalThis & { __semanticFocusEvents?: typeof events }
      view.__semanticFocusEvents = events
      for (const type of ['focusin', 'focusout'] as const) document.addEventListener(type, () => {
        const active = document.activeElement
        events.push({ type, at: performance.now(), activeElement: active instanceof HTMLElement ? active.outerHTML.slice(0, 240) : null })
      })
    })
    await connect(panel, context, base)
    await panel.locator('#new-session').click()
    await expect.poll(async () => (await assistantState(panel!)).session.binding?.sessionId, { timeout: 30_000 }).toBeTruthy()
    await expect.poll(async () => (await assistantState(panel!)).session.phase, { timeout: 30_000 }).toBe('live')
    await target.bringToFront()
    const targetTabId = await tabId(panel, target.url())
    const unrelatedTabId = await tabId(panel, unrelated.url())
    const initial = await assistantState(panel)
    const bound = await extensionMessage(panel, {
      type: 'dsh-assistant-target-bind', expectedRevision: initial.target.revision ?? 0, tabId: targetTabId,
    })
    const boundReply = bound as { ok?: boolean; error?: unknown }
    if (boundReply.ok !== true) throw new Error(`target bind failed: ${String(boundReply.error)}`)
    await expect.poll(async () => (await assistantState(panel!)).target.selected?.tabId).toBe(targetTabId)
    if (scenario.id === 'live-pr' && replay) {
      await panel.locator('[data-view="cognition"]').click()
      const beforeRead = await assistantState(panel)
      const reading = await extensionMessage(panel, { type: 'dsh-assistant-cognition-refresh',
        expectedSessionId: beforeRead.session.binding?.sessionId,
        expectedTargetRevision: beforeRead.target.revision }) as { ok?: boolean; error?: unknown }
      if (reading.ok !== true) throw new Error(`live PR read failed: ${String(reading.error)}`)
      await expect.poll(async () => {
        const current = await assistantState(panel!)
        const calls = toolEvidence(current.session.records).filter(entry => entry.kind === 'call').map(entry => entry.name)
        return calls.includes('browser_snapshot') && calls.includes('browser_read_source') && turnEnded(current.session.records)
      }, { timeout: 90_000 }).toBe(true)
      await panel.locator('.cog-object-open').first().waitFor({ state: 'visible', timeout: 15_000 })
      const readState = await assistantState(panel)
      const cognition = readState.cognition as { pages?: Array<{
        documentState?: string
        target?: { page?: { url?: string } }
        observations?: unknown[]
        sourceSnapshots?: unknown[]
      }> } | undefined
      const page = cognition?.pages?.find(item => item.documentState === 'current')
      expect(page?.target?.page?.url).toBe('https://github.com/changanhua/deepseek-harness/pull/73')
      expect(page?.observations?.length).toBeGreaterThan(0)
      await mkdir(artifact, { recursive: true })
      await panel.screenshot({ path: join(artifact, '01-live-pr-overview.png'), fullPage: true })
      const sourceCollection = panel.locator('.cog-object-open').filter({ hasText: '本次原文与论据' })
      if (await sourceCollection.count()) {
        await sourceCollection.click()
        const prContent = panel.locator('.cog-child-open').filter({ hasText: /WIP|语义阅读地图/u })
        await (await prContent.count() ? prContent.first() : panel.locator('.cog-child-open').first()).click()
      } else await panel.locator('.cog-object-open').first().click()
      await panel.getByRole('button', { name: '核对来源 →' }).click()
      await panel.locator('.cog-source').waitFor({ state: 'visible' })
      const exactSource = await panel.locator('[data-cognition-reveal-source]').count() > 0
      if (exactSource) {
        await panel.locator('[data-cognition-reveal-source]').first().click()
        await expect.poll(async () => panel.locator('.cog-source [role="status"]').textContent()).toContain('定位请求已返回')
      }
      await panel.screenshot({ path: join(artifact, '02-live-pr-source.png'), fullPage: true })
      await panel.getByRole('button', { name: '← 返回聚焦' }).click()
      await panel.locator('.cog-focus [data-cognition-use]').click()
      const correction = '人工修正：这只是 PR #73 当前页面的已读内容，不能代表整个仓库状态。'
      await panel.locator('[data-cognition-correction]').fill(correction)
      await panel.getByRole('button', { name: '将修正加入任务上下文' }).click()
      await panel.locator('#composer').fill('根据明确选入的页面对象，概括已读部分')
      await panel.locator('#send-queue').click()
      await expect.poll(async () => (await assistantState(panel!)).session.records.some((record) => {
        const event = record.event as {
          type?: string
          data?: { source?: { kind?: string }; content?: Array<{ text?: string }> }
        } | undefined
        return event?.type === 'user/message' && event.data?.source?.kind === 'user'
          && event.data.content?.some(part => part.text?.includes(correction))
      }), { timeout: 30_000 }).toBe(true)
      const sourceBlocks = page?.sourceSnapshots?.flatMap((source) => {
        const blocks = (source as { blocks?: Array<{ text?: string }> }).blocks
        return blocks ?? []
      }) ?? []
      await writeFile(join(artifact, 'live-pr-evidence.json'), JSON.stringify({
        modelMode: 'keyless-replay', livePageUrl: target.url(), pageTitle: await target.title(),
        sessionId: readState.session.binding?.sessionId, observationCount: page?.observations?.length,
        sourceSnapshotCount: page?.sourceSnapshots?.length, sourceBlockCount: sourceBlocks.length,
        prTextObserved: sourceBlocks.some(block => /WIP|语义阅读地图/u.test(block.text ?? '')), exactSource,
        toolCalls: toolEvidence((await assistantState(panel)).session.records)
          .filter(entry => entry.kind === 'call').map(entry => entry.name),
        hostReceivedCorrection: true,
      }, null, 2))
      await panel.screenshot({ path: join(artifact, '03-live-pr-submitted.png'), fullPage: true })
      return
    }
    if (navigateAfterBind) {
      const fixedPage = (await assistantState(panel)).target.selected
      if (!fixedPage?.documentId || !fixedPage.url) throw new Error('fixed target did not expose its binding document')
      await target.route(`${fixture}/navigated`, route => route.fulfill({ body: scenario.html, contentType: 'text/html' }))
      await target.goto(`${fixture}/navigated`)
      await expect.poll(async () => (await assistantState(panel!)).target.selected?.status).toBe('navigated')
      navigationEvidence = { boundDocumentId: fixedPage.documentId, boundUrl: fixedPage.url, currentUrl: target.url() }
    }
    await panel.locator('[data-view="cognition"]').click()
    // The cognition workspace is the default view; semantic reading is now explicit.
    const generating = await assistantState(panel)
    const generated = await extensionMessage(panel, { type: 'dsh-assistant-cognition-generate',
      expectedSessionId: generating.session.binding?.sessionId,
      expectedTargetRevision: generating.target.revision }) as { ok?: boolean; error?: unknown }
    if (generated.ok !== true) throw new Error(`semantic generation failed: ${String(generated.error)}`)
    await unrelated.bringToFront()
    await expect.poll(async () => {
      const current = await assistantState(panel!)
      if (semanticPublishResult(current.session.records)) return 'published'
      if (turnEnded(current.session.records)) throw new Error('semantic generation ended without browser_publish_semantic_map')
      return 'pending'
    }, { timeout: 180_000 }).toBe('published')
    await expect.poll(async () => turnEnded((await assistantState(panel!)).session.records), { timeout: 30_000 }).toBe(true)
    await panel.getByRole('button', { name: '阅读', exact: true }).click()
    await panel.locator('.semantic-overview').waitFor({ state: 'visible', timeout: 10_000 })
    const after = await assistantState(panel)
    expect(after.target.selected?.tabId).not.toBe(unrelatedTabId)
    expect(semanticPublishResult(after.session.records)).toBe(true)
    if (navigationEvidence) {
      const cognition = after.cognition as {
        pages?: Array<{ target?: { page?: { documentId?: string; url?: string } }; semanticMap?: unknown }>
      } | undefined
      const pages = cognition?.pages ?? []
      const sourcePage = pages.find(page => page.semanticMap)
      expect(sourcePage?.target?.page?.documentId).toBeTruthy()
      expect(sourcePage?.target?.page?.documentId).not.toBe(navigationEvidence.boundDocumentId)
      expect(sourcePage?.target?.page?.url).toBe(navigationEvidence.currentUrl)
      navigationEvidence = { ...navigationEvidence, observedDocumentId: sourcePage?.target?.page?.documentId }
    }
    const browserCalls = toolEvidence(after.session.records).filter(entry => entry.kind === 'call').map(entry => entry.name)
    expect(browserCalls).toEqual(expect.arrayContaining(['browser_snapshot', 'browser_read_source', 'browser_publish_semantic_map']))
    expect(browserCalls.every(name => ['browser_snapshot', 'browser_read_source', 'browser_publish_semantic_map'].includes(String(name)))).toBe(true)
    await mkdir(artifact, { recursive: true })
    await panel.screenshot({ path: join(artifact, '01-overview.png'), fullPage: true })
    const reference = semanticReference(after, scenario.identity, scenario.exact, scenario.sourceBlockOrdinal)
    const eventsBefore = eventTypes(after.session.records)
    const topic = reference.nodeId === null ? panel.locator('.semantic-unorganized')
      : panel.locator(`[data-semantic-node="${reference.nodeId}"]`)
    await topic.click()
    await panel.locator('.semantic-focus').waitFor({ state: 'visible' })
    await panel.screenshot({ path: join(artifact, '02-focus.png'), fullPage: true })
    await panel.locator(`[data-source-ref="${reference.blockId}"]`).first().click()
    const source = panel.locator('.semantic-source')
    await expect.poll(async () => source.textContent()).toContain(scenario.identity)
    const sourceText = await source.textContent()
    await panel.screenshot({ path: join(artifact, '03-source.png'), fullPage: true })
    const sourceBack = panel.locator('.semantic-source [data-semantic-back]')
    await recordFocus(panel, sourceBack, 'source-back', focusEvidence); await panel.keyboard.press('Enter')
    await panel.locator('.semantic-focus').waitFor({ state: 'visible' })
    await expect.poll(async () => panel.locator(`[data-source-ref="${reference.blockId}"]`).first()
      .evaluate(element => document.activeElement === element)).toBe(true)
    const focusBack = panel.locator('.semantic-focus [data-semantic-back]')
    await recordFocus(panel, focusBack, 'focus-back', focusEvidence); await panel.keyboard.press('Enter')
    await panel.locator('.semantic-overview').waitFor({ state: 'visible' })
    if (reference.nodeId !== null) await expect.poll(async () => topic.evaluate(element => document.activeElement === element),
      'overview topic must regain focus after keyboard return').toBe(true)
    await topic.click(); await panel.locator('.semantic-focus').waitFor({ state: 'visible' })
    await panel.locator(`[data-source-ref="${reference.blockId}"]`).first().click()
    await source.waitFor({ state: 'visible' })
    await target.evaluate(() => { scrollTo(0, document.body.scrollHeight) })
    await expect.poll(async () => target.evaluate(() => scrollY)).toBeGreaterThan(0)
    const scrollBeforeLocation = await target.evaluate(() => scrollY)
    await panel.locator('[data-source-locate]').first().click()
    if (scenario.id === 'live-pr') {
      await expect.poll(async () => target.evaluate(() => scrollY), { timeout: 10_000 }).toBeLessThan(scrollBeforeLocation)
    } else {
      await expect.poll(async () => target.locator(scenario.target).evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return { top: bounds.top, bottom: bounds.bottom, height: innerHeight,
          highlighting: document.getAnimations().some(animation => animation.effect?.target === element) }
      }), { timeout: 10_000 }).toMatchObject({ highlighting: true })
      const located = await target.locator(scenario.target).boundingBox()
      expect(located).not.toBeNull()
      expect(located!.y).toBeGreaterThanOrEqual(0)
      expect(located!.y + located!.height).toBeLessThanOrEqual(900)
    }
    expect(sourceText).toContain(reference.text)
    const targetText = await target.locator(scenario.target).textContent()
    const tabularTarget = await target.locator(scenario.target).evaluate(element => element.tagName === 'TR')
    const normalizeTable = (text: string | null) => text?.replace(/[\s|]/gu, '')
    if (scenario.id === 'live-dom-sample') {
      expect(targetText).toContain('Kika Nazareth')
      expect(await target.locator(`${scenario.target} img[alt="Nation"]`).getAttribute('title')).toBe('Portugal')
      expect(await target.locator(`${scenario.target} img[alt="League"]`).getAttribute('title')).toBe('Liga F')
      expect(await target.locator(`${scenario.target} img[alt="Club"]`).getAttribute('title')).toBe('FC Barcelona')
    } else {
      expect(tabularTarget ? normalizeTable(targetText) : targetText)
        .toBe(tabularTarget ? normalizeTable(reference.text) : reference.text)
    }
    if (scenario.id === 'list') {
      await target.locator(scenario.target).evaluate((element) => { element.parentElement!.hidden = true })
      await expect.poll(async () => panel.locator('[data-source-locate]').first().isDisabled()).toBe(true)
      expect(await source.textContent()).toContain(reference.text)
    }
    const eventsAfter = eventTypes((await assistantState(panel)).session.records)
    expect(eventsAfter.slice(eventsBefore.length).filter(type => type === 'step/start' || type === 'tool/call')).toEqual([])
    if (process.env.DSH_SEMANTIC_FEEDBACK === '1' && scenario.id === 'article' && reference.nodeId !== null) {
      const humanLabel = '人工修正：仅限已测模板'
      const mapId = reference.nodeId.replace(/:\d+$/u, '')
      await panel.locator('.semantic-source [data-semantic-back]').click()
      await panel.locator('.semantic-focus').waitFor({ state: 'visible' })
      await panel.locator(`[data-edit-node="${reference.nodeId}"]`).click()
      await panel.locator(`[data-edit-label="${reference.nodeId}"]`).fill(humanLabel)
      await panel.locator(`[data-edit-summary="${reference.nodeId}"]`).fill('人工确认：其他页面尚未验证。')
      await panel.locator(`[data-save-edit="${reference.nodeId}"]`).click()
      await expect.poll(async () => panel.locator('.semantic-focus').textContent()).toContain(humanLabel)
      const viewBeforeReload = await panel.evaluate(() => Object.fromEntries(Object.keys(sessionStorage)
        .filter(key => key.startsWith('dsh.semantic-view:') || key.startsWith('dsh.semantic-version:'))
        .map(key => [key, sessionStorage.getItem(key)])))
      await panel.reload()
      await panel.locator('[data-view="cognition"]').click()
      await panel.getByRole('button', { name: '阅读', exact: true }).click()
      const currentLayer = async () => panel.evaluate(() => {
        if ([...document.querySelectorAll('.semantic-focus')].some(element => element.checkVisibility())) return 'focus'
        if ([...document.querySelectorAll('.semantic-overview')].some(element => element.checkVisibility())) return 'overview'
        return null
      })
      await expect.poll(currentLayer).not.toBeNull()
      const restoredLayer = await currentLayer()
      if (restoredLayer === 'overview') { await topic.click(); await panel.locator('.semantic-focus').waitFor({ state: 'visible' }) }
      await expect.poll(async () => panel.locator('.semantic-focus').textContent()).toContain(humanLabel)
      feedbackEvidence = { mapId, viewBeforeReload,
        viewAfterReload: await panel.evaluate(() => Object.fromEntries(Object.keys(sessionStorage)
          .filter(key => key.startsWith('dsh.semantic-view:') || key.startsWith('dsh.semantic-version:'))
          .map(key => [key, sessionStorage.getItem(key)]))), restoredLayer }
      await panel.locator(`[data-source-ref="${reference.blockId}"]`).first().click()
      await expect.poll(async () => source.textContent()).toContain(reference.text)
      await panel.locator('.semantic-source [data-semantic-back]').click()
      await panel.locator('.semantic-focus').waitFor({ state: 'visible' })
      const beforeCandidate = (await assistantState(panel)).session.records
      const publishBefore = semanticPublishCount(beforeCandidate)
      const turnEndsBefore = beforeCandidate.filter(record => (record.event as { type?: unknown } | undefined)?.type === 'turn/end').length
      await panel.locator('.semantic-generate').click()
      await expect.poll(async () => {
        const current = await assistantState(panel!)
        return semanticPublishCount(current.session.records) > publishBefore
          && current.session.records.filter(record => (record.event as { type?: unknown } | undefined)?.type === 'turn/end').length > turnEndsBefore
      }, { timeout: 180_000 }).toBe(true)
      await expect.poll(async () => panel.getByLabel('地图版本').locator('option').count()).toBeGreaterThan(1)
      await panel.getByLabel('地图版本').selectOption(mapId)
      await expect.poll(async () => panel.locator('.semantic-focus').textContent()).toContain(humanLabel)
      expect((await assistantState(panel)).session.records.length).toBeGreaterThan(beforeCandidate.length)
      feedbackEvidence = { ...feedbackEvidence, finalMapVersions: await panel.getByLabel('地图版本').locator('option').count(),
        oldVersionSelected: await panel.getByLabel('地图版本').inputValue(), restoredHumanLabel: humanLabel }
    }
    let workspaceEvidence: Record<string, unknown> | null = null
    if (workspace) {
      await panel.getByRole('button', { name: '认知', exact: true }).click()
      await panel.locator('.cog-objects').waitFor({ state: 'visible' })
      expect(await panel.locator('.cog-header h3').textContent()).toContain('Overview')
      const beforeFocus = (await assistantState(panel)).session.records.length
      await panel.locator('.cog-object-open').filter({ hasText: '本次原文与论据' }).click()
      expect(await panel.locator('.cog-header h3').textContent()).toContain('Focus')
      expect((await assistantState(panel)).session.records).toHaveLength(beforeFocus)
      await panel.locator('.cog-child-open').filter({ hasText: scenario.identity.slice(0, 18) }).first().click()
      await panel.getByRole('button', { name: '核对来源 →' }).click()
      await expect.poll(async () => panel.locator('.cog-source').textContent()).toContain(scenario.identity)
      expect(await panel.locator('.cog-header h3').textContent()).toContain('Source')
      await panel.screenshot({ path: join(artifact, '06-workspace-source.png'), fullPage: true })
      await panel.getByRole('button', { name: '← 返回聚焦' }).click()
      await panel.locator('.cog-focus [data-cognition-use]').click()
      const correction = '人工修正：结论仅限三种已测模板，不能推广到所有网页。'
      await panel.locator('[data-cognition-correction]').fill(correction)
      await panel.getByRole('button', { name: '将修正加入任务上下文' }).click()
      await expect.poll(async () => panel.locator('[data-cognition-scope] pre').textContent()).toContain(correction)
      await panel.locator('#composer').fill('请分析选入的实验结论')
      await panel.locator('#send-queue').click()
      await expect.poll(async () => {
        const current = await assistantState(panel!)
        return current.session.records.find((record) => {
          const event = record.event as {
            type?: string
            data?: { source?: { kind?: string }; content?: Array<{ type?: string; text?: string }> }
          } | undefined
          return event?.type === 'user/message' && event.data?.source?.kind === 'user'
            && event.data.content?.some(part => part.text?.includes('请分析选入的实验结论'))
        })
      }, { timeout: 30_000 }).toBeTruthy()
      const submitted = (await assistantState(panel)).session.records.find((record) => {
        const event = record.event as { type?: string; data?: { content?: Array<{ text?: string }> } } | undefined
        return event?.type === 'user/message' && event.data?.content?.some(part => part.text?.includes('请分析选入的实验结论'))
      })
      const submittedText = (submitted?.event as { data?: { content?: Array<{ text?: string }> } } | undefined)?.data?.content
        ?.map(part => part.text ?? '').join('\n') ?? ''
      expect(submittedText).toContain(correction)
      expect(submittedText).toContain(scenario.identity)
      expect(submittedText).toContain('用户选择的任务对象；不扩展页面读取或操作权限')
      await panel.getByText('已按选入对象和人工修正处理。', { exact: true }).waitFor({ state: 'attached', timeout: 30_000 })
      await panel.locator('.cog-focus [data-cognition-use]').click()
      await panel.locator('#composer').fill('目标变化后保留的草稿')
      const beforeSwitch = await assistantState(panel)
      const switched = await extensionMessage(panel, { type: 'dsh-assistant-target-bind',
        expectedRevision: beforeSwitch.target.revision, tabId: unrelatedTabId }) as { ok?: boolean; error?: unknown }
      if (switched.ok !== true) throw new Error(`target switch failed: ${String(switched.error)}`)
      await expect.poll(async () => (await assistantState(panel!)).target.selected?.tabId).toBe(unrelatedTabId)
      await expect.poll(async () => panel.locator('[data-cognition-scope]').textContent()).toContain('任务范围待重新确认')
      const userMessageCount = (await assistantState(panel)).session.records.filter((record) => {
        const event = record.event as { type?: string; data?: { source?: { kind?: string } } } | undefined
        return event?.type === 'user/message' && event.data?.source?.kind === 'user'
      }).length
      await panel.locator('#send-queue').click()
      expect(await panel.locator('#composer').inputValue()).toBe('目标变化后保留的草稿')
      expect((await assistantState(panel)).session.records.filter((record) => {
        const event = record.event as { type?: string; data?: { source?: { kind?: string } } } | undefined
        return event?.type === 'user/message' && event.data?.source?.kind === 'user'
      })).toHaveLength(userMessageCount)
      workspaceEvidence = { sessionId: (await assistantState(panel)).session.binding?.sessionId,
        submittedText, recordCountBeforeFocus: beforeFocus, recordCountAfterSubmit: (await assistantState(panel)).session.records.length,
        staleScopeAfterTargetSwitch: await panel.locator('[data-cognition-scope]').textContent(),
        retainedDraftAfterTargetSwitch: await panel.locator('#composer').inputValue() }
      await panel.screenshot({ path: join(artifact, '07-workspace-submitted.png'), fullPage: true })
    }
    const completed = await assistantState(panel)
    await writeFile(join(artifact, 'semantic-evidence.json'), JSON.stringify({
      caseId: scenario.id, split: scenario.split, fixtureSha256, modelMode: replay ? 'keyless-replay' : 'real-provider',
      tools: toolEvidence(completed.session.records), cognition: completed.cognition,
      eventsBefore, eventsAfter: eventTypes(completed.session.records),
      focusEvidence,
      feedbackEvidence,
      navigationEvidence,
      workspaceEvidence,
      focusEvents: await panel.evaluate(() => {
        return (globalThis as typeof globalThis & { __semanticFocusEvents?: unknown }).__semanticFocusEvents ?? []
      }),
    }, null, 2))
    await panel.screenshot({ path: join(artifact, '04-located.png'), fullPage: true })
    await panel.setViewportSize({ width: 380, height: 900 })
    expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await panel.screenshot({ path: join(artifact, '05-narrow.png'), fullPage: true })
    await rm(join(artifact, 'failure-state.json'), { force: true })
  } catch (error) {
    if (panel && !panel.isClosed()) {
      await saveFailureShot(panel, 'semantic-navigation')
      await mkdir(artifact, { recursive: true })
      const current = await assistantState(panel).catch(() => undefined)
      await writeFile(join(artifact, 'failure-state.json'), JSON.stringify({
        caseId: scenario.id, split: scenario.split, fixtureSha256, modelMode: replay ? 'keyless-replay' : 'real-provider',
        error: error instanceof Error ? error.message : String(error),
        connection: current?.connection.phase, session: current?.session.phase,
        sessionState: current?.session, connectionState: current?.connection,
        sidebarNotice: await panel.locator('#notice').textContent().catch(() => null),
        surfaceId: await panel.evaluate(() => sessionStorage.getItem('dsh.assistant.surface.v2')).catch(() => null),
        target: current?.target, eventTypes: current?.session.records.map((record) => {
          const event = record.event as { type?: unknown } | undefined
          return typeof event?.type === 'string' ? event.type : null
        }),
        tools: current === undefined ? [] : toolEvidence(current.session.records),
        cognition: current?.cognition, focusEvidence,
        focusEvents: await panel.evaluate(() => {
          return (globalThis as typeof globalThis & { __semanticFocusEvents?: unknown }).__semanticFocusEvents ?? []
        }),
      }, null, 2))
    }
    console.error('Semantic navigation Host:', host?.diagnostic())
    throw error
  } finally {
    await context?.close(); await stop(host)
    const target = resolve(root)
    if (dirname(target) !== parent || !basename(target).startsWith('dsh-semantic-navigation-')) throw new Error('Refusing unexpected cleanup target')
    await rm(target, { recursive: true, force: true })
  }
}, 300_000)
