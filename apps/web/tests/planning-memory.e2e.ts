/** A reviewed Planning item can become an explicitly accepted, restart-safe project memory. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { PlanningAccess } from '@changanhua/dsh-planning'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { REPO_ROOT } from './support.ts'
import { restoreSessionPersistence } from './planning-memory-support.ts'

const planningBundle = join(REPO_ROOT, 'packages/bundle/personal-planning')
const memoryBundle = join(REPO_ROOT, 'packages/bundle/personal-memory')
const sourceText = '复盘：规划项完成后，要保留其原始会话来源，并在人工确认后供下次会话检索。'

function estimate() {
  return { value: 3, urgency: 1, reuse: 4, compounding: 3, timeCost: 1, tokenCost: 1, risk: 1, cognitiveCost: 1, rationale: '跨会话复盘验收' }
}

async function createSession(scaffold: WebScaffold, workspaceId: string) {
  const created = await scaffold.hostCtx.sessionController.create({ workspaceId })
  const agent = scaffold.ctx.agents.get(created.sessionId)
  if (agent === undefined) throw new Error('Session Controller did not activate its Agent')
  return agent
}

it('requires human acceptance before a reviewed planning memory recalls after a real Host restart', { retry: 0, timeout: 180_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-planning-memory-e2e-'))
  const project = join(root, 'project-a')
  const otherProject = join(root, 'project-b')
  const home = join(root, '.dsh')
  const storageRoot = join(home, 'storages')
  let first: WebScaffold | undefined
  let second: WebScaffold | undefined
  try {
    await Promise.all([mkdir(project), mkdir(otherProject)])
    // The production Profile applies the two bundle patches at one include
    // boundary. The shared Web scaffold accepts one overlay file, so materialize
    // that same ordered patch stack in this owned, per-test home.
    const overlay = join(root, 'personal-planning-memory.patch.yml')
    await writeFile(overlay, [
      await readFile(join(planningBundle, 'cordis.patch.yml'), 'utf8'),
      await readFile(join(planningBundle, 'memory.patch.yml'), 'utf8'),
    ].join('\n'))
    const options = {
      harnessHome: home,
      storageRoot,
      toolsMode: 'native' as const,
      extraOverlayPath: overlay,
      extraInstallAnchors: [join(planningBundle, 'package.json'), join(memoryBundle, 'package.json')],
    }
    first = await launchWebScaffold(options)
    const workspace = await first.hostCtx.workspaceRegistry.create(project, 'Planning memory acceptance')
    const author = await createSession(first, workspace.id)
    const source = author.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: sourceText }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    expect(await first.ctx.sessions.flush(author.session)).toBe(true)

    const access: PlanningAccess = {
      workspaceId: workspace.id, actorId: String(author.id), kind: 'human',
      userMessage: { sessionId: String(author.session.id), seq: source.seq }, authorize() {},
    }
    const created = await first.hostCtx.get('planning')!.execute(access, {
      kind: 'create', requestId: randomUUID(), expectedBoardVersion: 0, lane: 'next',
      title: '保留复盘来源', intent: '让后续会话能追溯已验证的规划结论。', scope: [], acceptance: ['人工确认后可检索'],
      sources: [{ kind: 'session-event', sessionId: String(author.session.id), seq: source.seq }], estimate: estimate(), reviewAt: null,
    })
    const reviewed = await first.hostCtx.get('planning')!.execute(access, {
      kind: 'review', requestId: randomUUID(), expectedBoardVersion: created.boardVersion,
      itemId: created.itemId!, expectedRevisionId: created.revisionId!, outcome: 'learned',
      summary: '来源和人工接纳必须共同保留。', lessons: ['用原始用户复盘事件作为记忆来源。'], followUpItemIds: [], acceptanceRef: null,
    })
    const board = await first.hostCtx.get('planning')!.snapshot(access)
    expect(board.events.at(-1)).toMatchObject({
      kind: 'reviewed', reviewId: reviewed.reviewId,
      actor: { kind: 'human', id: String(author.id), userMessage: { sessionId: String(author.session.id), seq: source.seq } },
    })

    const proposal = await first.hostCtx.get('projectMemory')!.propose(author, {
      topicKey: 'planning.review.recall', kind: 'method', title: '接纳已复盘的规划记忆',
      statement: '复盘后，以原始用户事件作为来源；人工接纳后才允许新会话召回。',
      sources: [{ kind: 'session-event', sessionId: String(author.session.id), seq: source.seq }],
      tags: [`planning:${created.itemId}`, `review:${reviewed.reviewId}`],
      conditions: `Plan revision ${created.revisionId}`, idempotencyKey: `planning-memory-${created.itemId}`,
    })
    const beforeAcceptance = await first.hostCtx.get('projectMemory')!.search(author, { query: '人工接纳 复盘', limit: 5 })
    expect(beforeAcceptance.items.some(item => item.id === proposal.id)).toBe(false)

    const show = await first.ctx.commands.execute(author, `/memory show ${proposal.id}@1`, [], new AbortController().signal)
    expect(show?.result.kind).toBe('success')
    const accept = await first.ctx.commands.execute(author, `/memory accept ${proposal.id}@1`, [], new AbortController().signal)
    expect(accept?.result.kind).toBe('success')
    await first.ctx.sessions.flush(author.session)
    // launchWebScaffold rotates its owned temp persistence root at every boot.
    // Preserve the real JSONL corpus before it performs its normal cleanup.
    const sessionArchive = join(root, 'session-persistence')
    await restoreSessionPersistence(first.persistenceRoot, sessionArchive)
    await first.close()
    first = undefined

    second = await launchWebScaffold(options)
    await restoreSessionPersistence(sessionArchive, second.persistenceRoot)
    const restartedWorkspace = await second.hostCtx.workspaceRegistry.create(project, 'Planning memory acceptance')
    expect(restartedWorkspace.id).toBe(workspace.id)
    const reader = await createSession(second, restartedWorkspace.id)
    const recalled = await second.hostCtx.get('projectMemory')!.search(reader, { query: '人工接纳 复盘', limit: 5 })
    const hit = recalled.items.find(item => item.id === proposal.id)
    expect(hit).toMatchObject({
      eligibility: 'usable', revision: 1,
      memory: {
        statement: '复盘后，以原始用户事件作为来源；人工接纳后才允许新会话召回。',
        tags: [`planning:${created.itemId}`, `review:${reviewed.reviewId}`],
        conditions: `Plan revision ${created.revisionId}`,
        sources: [expect.objectContaining({ kind: 'session-event', sessionId: String(author.session.id), seq: source.seq })],
      },
    })
    expect(hit?.sources).toEqual([expect.objectContaining({
      status: 'current', source: expect.objectContaining({ kind: 'session-event', sessionId: String(author.session.id), seq: source.seq, sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) }),
    })])
    const read = await second.hostCtx.get('projectMemory')!.read(reader, proposal.id)
    expect(read).toMatchObject({
      id: proposal.id, eligibility: 'usable', revision: 1,
      memory: {
        tags: [`planning:${created.itemId}`, `review:${reviewed.reviewId}`],
        conditions: `Plan revision ${created.revisionId}`,
        sources: [expect.objectContaining({ kind: 'session-event', sessionId: String(author.session.id), seq: source.seq })],
      },
    })
    expect(reader.session.events.some(event => event.type === 'turn/start')).toBe(false)

    const foreignWorkspace = await second.hostCtx.workspaceRegistry.create(otherProject, 'Foreign planning memory acceptance')
    const foreign = await createSession(second, foreignWorkspace.id)
    const foreignRecall = await second.hostCtx.get('projectMemory')!.search(foreign, { query: '人工接纳 复盘', limit: 5 })
    expect(foreignRecall.items.some(item => item.id === proposal.id)).toBe(false)
    await expect(second.hostCtx.get('projectMemory')!.read(foreign, proposal.id)).rejects.toMatchObject({ code: 'not-found' })
  } finally {
    await first?.close()
    await second?.close()
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !root.includes('dsh-planning-memory-e2e-')) throw new Error('refusing unrelated acceptance cleanup')
    await rm(root, { recursive: true, force: true })
  }
})
