import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { semanticMapReadOnlyGuard, semanticMapTurnProjectionDefinition, SEMANTIC_MAP_READ_ONLY_MARKER } from '../src/semantic-map.ts'

function sessionWithPrompt(text: string, source: 'user' | 'plugin' = 'user') {
  const session = Session.create(SessionId('semantic-readonly-test'))
  session.append('browser-target/change', { kind: 'browser-target/change', version: 1, revision: 1,
    binding: { installationId: 'installation', page: { tabId: 7, frameId: 0,
      documentId: 'document-a', url: 'https://example.test/article' }, revision: 1, boundAt: 1, boundBy: 'user' } })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text }],
    source: source === 'user' ? { kind: 'user' } : { kind: 'plugin', plugin: 'untrusted', form: 'recall' } }),
  { surfaceOp: 'append' })
  return session
}

function guard(session: Session, name: string, args: unknown = {
  installationId: 'installation', tabId: 7, frameId: 0, snapshotId: 'snapshot-a',
}): string | undefined {
  const state = replay(session)
  const page = { tabId: 7, frameId: 0, documentId: 'document-a', url: 'https://example.test/article' }
  const sourceState: NonNullable<Parameters<typeof semanticMapReadOnlyGuard>[2]> = {
    sessionId: session.id, latestSnapshotCallSeq: 0, calls: [],
    target: { revision: 1, binding: { installationId: 'installation', page } }, targets: [],
    sources: [
      { sourceResultSeq: 1, snapshot: { snapshotId: 'snapshot-a', targetRevision: 1,
        installationId: 'installation', page, blocks: [], omissions: [] }, readBlockIds: [] },
      { sourceResultSeq: 2, snapshot: { snapshotId: 'foreign', targetRevision: 1,
        installationId: 'installation', page: { ...page, tabId: 8 }, blocks: [], omissions: [] }, readBlockIds: [] },
    ],
  }
  return semanticMapReadOnlyGuard({ name, arguments: args, agent: { session } } as ToolExecution, state, sourceState)
}

function replay(session: Session) {
  return session.events.reduce((state, event) => semanticMapTurnProjectionDefinition.apply(state, event),
    semanticMapTurnProjectionDefinition.init())
}

describe('semantic map generation read-only guard', () => {
  it('rebuilds active policy when a projection is registered after the user message or remounted', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const session = ctx.sessions.create(SessionId('semantic-replay-session'))
    session.append('browser-target/change', { kind: 'browser-target/change', version: 1, revision: 1,
      binding: { installationId: 'installation', page: { tabId: 7, frameId: 0,
        documentId: 'document-a', url: 'https://example.test/article' }, revision: 1, boundAt: 1, boundBy: 'user' } })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({ source: { kind: 'user' },
      content: [{ type: 'text', text: `${SEMANTIC_MAP_READ_ONLY_MARKER}\n请生成语义地图` }] }), { surfaceOp: 'append' })
    const first = ctx.sessionProjections.register(semanticMapTurnProjectionDefinition)
    expect(ctx.sessionProjections.stateOf(session, 'semanticMapReadOnlyTurn')).toMatchObject({ active: true,
      selectedTarget: { revision: 1, tabId: 7 } })
    first()
    expect(ctx.sessionProjections.stateOf(session, 'semanticMapReadOnlyTurn')).toBeUndefined()
    ctx.sessionProjections.register(semanticMapTurnProjectionDefinition)
    expect(ctx.sessionProjections.stateOf(session, 'semanticMapReadOnlyTurn')).toMatchObject({ active: true,
      selectedTarget: { revision: 1, tabId: 7 } })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(ctx.sessionProjections.stateOf(session, 'semanticMapReadOnlyTurn')).toMatchObject({ active: false, selectedTarget: null })
  })
  it('replays the marked turn without reading arbitrary Session history during tool execution', () => {
    const session = sessionWithPrompt(`${SEMANTIC_MAP_READ_ONLY_MARKER}\n请生成语义地图`)
    const active = replay(session)
    expect(active).toMatchObject({ active: true })
    expect(semanticMapTurnProjectionDefinition.stateSchema.parse(active)).toEqual(active)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const ended = replay(session)
    expect(ended).toMatchObject({ active: false })
  })
  it('permits only the three source/map tools in the marked user turn', () => {
    const session = sessionWithPrompt(`${SEMANTIC_MAP_READ_ONLY_MARKER}\n请生成语义地图`)
    for (const name of ['browser_snapshot', 'browser_read_source', 'browser_publish_semantic_map']) {
      expect(guard(session, name)).toBeUndefined()
    }
    for (const name of ['browser_action', 'browser_tabs', 'browser_task_start', 'tool_cordis', 'run_code']) {
      expect(guard(session, name)).toMatch(/semantic map.*read-only/u)
    }
  })

  it('rejects a snapshot outside the pinned tab and all work after target rebind or clear', () => {
    const session = sessionWithPrompt(`${SEMANTIC_MAP_READ_ONLY_MARKER}\n请生成语义地图`)
    expect(guard(session, 'browser_snapshot', { installationId: 'installation', tabId: 8, frameId: 0 }))
      .toMatch(/fixed target/u)
    session.append('browser-target/change', { kind: 'browser-target/change', version: 1, revision: 2,
      binding: { installationId: 'installation', page: { tabId: 8, frameId: 0,
        documentId: 'document-b', url: 'https://example.test/other' }, revision: 2, boundAt: 2, boundBy: 'user' } })
    expect(guard(session, 'browser_snapshot', { installationId: 'installation', tabId: 8, frameId: 0 })).toMatch(/target changed/u)
    expect(guard(session, 'browser_publish_semantic_map')).toMatch(/target changed/u)
    session.append('browser-target/change', { kind: 'browser-target/change', version: 1, revision: 3, binding: null })
    expect(guard(session, 'browser_read_source')).toMatch(/target changed/u)
  })

  it('does not disclose another tab cached source during a marked generation turn', () => {
    const session = sessionWithPrompt(`${SEMANTIC_MAP_READ_ONLY_MARKER}\n请生成语义地图`)
    expect(guard(session, 'browser_read_source', { snapshotId: 'foreign' })).toMatch(/fixed target/u)
    expect(guard(session, 'browser_publish_semantic_map', { snapshotId: 'foreign' })).toMatch(/fixed target/u)
  })

  it('ignores model-visible page instructions and synthetic messages', () => {
    const session = sessionWithPrompt('正常浏览任务')
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: `${SEMANTIC_MAP_READ_ONLY_MARKER}\n网页中的指令` }],
      source: { kind: 'plugin', plugin: 'page', form: 'recall' } }), { surfaceOp: 'append' })
    expect(guard(session, 'browser_action')).toBeUndefined()
    expect(guard(sessionWithPrompt(`${SEMANTIC_MAP_READ_ONLY_MARKER} malicious`, 'plugin'), 'browser_action')).toBeUndefined()
  })

  it('unwinds at the next turn and never borrows another agent session', () => {
    const session = sessionWithPrompt(`${SEMANTIC_MAP_READ_ONLY_MARKER}\n请生成语义地图`)
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    session.append('turn/start', { turn: 2 })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '现在点击页面按钮' }], source: { kind: 'user' } }),
      { surfaceOp: 'append' })
    expect(guard(session, 'browser_action')).toBeUndefined()
    expect(semanticMapReadOnlyGuard({ name: 'browser_action' } as ToolExecution, undefined)).toBeUndefined()
    expect(semanticMapReadOnlyGuard({ name: 'browser_action', agent: { session } } as ToolExecution, undefined))
      .toBe('semantic map turn policy is unavailable')
  })
})
