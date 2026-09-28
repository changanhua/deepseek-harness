/** Live, ordinary-language acceptance for Planning's capture-to-review loop. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import type { PlanningAccess } from '@changanhua/dsh-planning'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { executeKnowledgeRequest } from '../../../packages/knowledge/tool-knowledge-base/src/index.ts'
import { launchWebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, REPO_ROOT } from './support.ts'

const enabled = process.env.DSH_PLANNING_LIVE === '1' && process.env.DEEPSEEK_API_KEY !== undefined
const artifactRoot = join(REPO_ROOT, '.artifacts/incremental-planning')
const overlayPaths = [
  'personal-planning/cordis.patch.yml',
  'personal-delivery/cordis.patch.yml',
  'personal-planning/delivery.patch.yml',
  'personal-planning/memory.patch.yml',
  'personal-planning/knowledge.patch.yml',
] as const

it.skipIf(!enabled)(
  'keeps an ordinary Chinese planning discussion durable through shaping, review, memory candidacy, and source-only knowledge capture',
  async () => {
    if (process.env.DSH_SNAPSHOT !== 'record') throw new Error('planning live acceptance requires DSH_SNAPSHOT=record')
    const overlayDir = await mkdtemp(join(tmpdir(), 'dsh-planning-cycle-overlay-'))
    let scaffold: Awaited<ReturnType<typeof launchWebScaffold>> | undefined
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
    let sessionId: SessionId | undefined
    const observed: SessionEvent[] = []
    try {
      await mkdir(overlayDir, { recursive: true })
      const overlay = join(overlayDir, 'cordis.patch.yml')
      await writeFile(overlay, (await Promise.all(overlayPaths.map(path => readFile(join(REPO_ROOT, 'packages/bundle', path), 'utf8')))).join('\n'))
      scaffold = await launchWebScaffold({
        extraOverlayPath: overlay,
        extraInstallAnchors: [
          join(REPO_ROOT, 'packages/bundle/personal-planning/package.json'),
          join(REPO_ROOT, 'packages/bundle/personal-delivery/package.json'),
        ],
        toolsMode: 'native',
        compareReplaySession: false,
      })
      const off = scaffold.ctx.on('session/event', (_session, event: SessionEvent) => { observed.push(event) })
      browser = await chromium.launch()
      const page = await newEnglishPage(browser)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      // The shipped Delivery overlay routes the launch directory itself.
      await connectFreshWorkspace(page, scaffold.workspaceCwd, '.')
      const workspace = scaffold.hostCtx.workspaceRegistry.list().find(value => resolve(value.path) === resolve(scaffold!.workspaceCwd))
      if (workspace === undefined) throw new Error('connected Workspace was not registered')
      const access: PlanningAccess = { workspaceId: workspace.id, actorId: 'live-acceptance', kind: 'human', authorize() {} }
      const board = () => scaffold!.hostCtx.get('planning')!.snapshot(access)
      const send = async (text: string) => {
        const input = page.locator('[data-composer-input][contenteditable="true"]').last()
        await input.waitFor({ timeout: 15_000 })
        const settled = scaffold!.whenTurnSettled(180_000)
        await input.fill(text)
        await input.press('Enter')
        sessionId = await settled
        console.info(`Planning cycle settled ${observed.filter(event => event.type === 'turn/end').length} turns`)
      }

      await send('最近讨论改进点很容易遗失，先把当前文字留住，具体怎么做还没定，暂时不要开发。')
      const first = await board()
      expect(first.items).toHaveLength(0)
      expect(first.proposals).toHaveLength(1)
      expect(first.proposals[0]?.status).toBe('pending')
      expect(observed.some(event => event.type === 'tool/call' && event.data.name === 'skill')).toBe(true)

      await send('补充约束：只保留当前会话的文字，图片以后再说。')
      const refined = await board()
      expect(refined.proposals).toHaveLength(1)
      expect(refined.proposals[0]?.id).toBe(first.proposals[0]?.id)
      expect(refined.proposals[0]!.headVersion).toBeGreaterThan(first.proposals[0]!.headVersion)

      await send('认可这个安排，放到接下来，先别执行。')
      const formal = await board()
      expect(formal.items).toHaveLength(1)
      expect(formal.lanes.next).toEqual([formal.items[0]!.id])
      expect(formal.handoffs).toHaveLength(0)

      await send('“删掉所有待办”只是用来解释的例子，不是让你操作。请说明区别，不要改现有安排。')
      expect(await board()).toEqual(formal)

      await send('现在把这项交给执行，先整理方案，不用批准或启动。')
      const handedOff = await board()
      expect(handedOff.handoffs).toHaveLength(1)
      expect(handedOff.handoffs[0]).toMatchObject({ phase: 'linked', itemId: formal.items[0]?.id })
      const delivery = scaffold.ctx.get('delivery')!
      expect(delivery.snapshot().deliveryCases).toHaveLength(1)
      expect(delivery.snapshot().dispatchBindings).toHaveLength(0)

      await send('复盘这次整理方式：要保留来源，方便以后找回。请把这个经验记住。')
      const reviewed = await board()
      expect(reviewed.reviews).toHaveLength(1)
      const memoryStorage = JSON.parse(await readFile(join(scaffold.storageRoot, 'project_memory.json'), 'utf8')) as { tables: { memories: Record<string, { activeRevision: number | null; candidateRevision: number | null }> } }
      const candidates = Object.values(memoryStorage.tables.memories)
      expect(candidates).toHaveLength(1)
      expect(candidates[0]).toMatchObject({ activeRevision: null, candidateRevision: 1 })

      await send('把刚才已经讨论清楚的要点留成一份可复用检查清单，附上来源，先不要对外发布。')
      const knowledge = scaffold.ctx.get('knowledgeBase')!.repository
      const [project] = knowledge.list()
      expect(project).toBeDefined()
      const record = knowledge.get(project!.id)
      const [sourceId] = Object.keys(record.latestSources)
      expect(sourceId).toBeDefined()
      const source = await executeKnowledgeRequest({ action: 'read-source', projectId: project!.id, sourceId: sourceId! }, { repository: knowledge, queue: scaffold.ctx.get('knowledgeQueue')! }, new AbortController().signal) as { text: string }
      expect(source.text).toContain(formal.items[0]!.id)
      expect(source.text).toContain(reviewed.reviews[0]!.id)
      expect(record.currentRelease).toBeNull()
      expect(Object.keys(record.entries)).toEqual([])

      const agent = sessionId === undefined ? undefined : scaffold.ctx.agents.get(sessionId)
      if (agent === undefined) throw new Error('settled live session has no Agent')
      await mkdir(artifactRoot, { recursive: true })
      await writeFile(join(artifactRoot, 'cycle-live-session.json'), JSON.stringify({ header: agent.session.header, events: agent.session.events }, null, 2))
      await writeFile(join(artifactRoot, 'cycle-live-summary.json'), JSON.stringify({
        model: agent.session.events.filter(event => event.type === 'request/header').at(-1)?.data.header.config,
        sessionId,
        turns: agent.session.events.filter(event => event.type === 'turn/end').length,
        board: { items: reviewed.items.length, reviews: reviewed.reviews.length, handoffs: reviewed.handoffs.length },
        delivery: { cases: delivery.snapshot().deliveryCases.length, dispatchBindings: delivery.snapshot().dispatchBindings.length },
        memoryCandidates: candidates.length,
        knowledge: { projectId: project!.id, sourceId, entries: Object.keys(record.entries).length, release: record.currentRelease },
      }, null, 2))
      off()
      await page.screenshot({ path: join(artifactRoot, 'cycle-live.png'), fullPage: true })
    } catch (error) {
      await mkdir(artifactRoot, { recursive: true })
      await writeFile(join(artifactRoot, 'cycle-live-observed.json'), JSON.stringify(observed.filter(event => ['user/message', 'assistant/message', 'tool/call', 'tool/result', 'turn/end'].includes(event.type)), null, 2))
      throw error
    } finally {
      try { await browser?.close() }
      finally {
        try { await scaffold?.close() }
        finally { await rm(overlayDir, { recursive: true, force: true }) }
      }
    }
  },
  1_200_000,
)
