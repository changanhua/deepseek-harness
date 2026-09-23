import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionLogOffset, type JsonValue, type SessionHeader } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { browserObservationMeta } from '../src/observation-meta.ts'
import { createSemanticMapTool, createSourceReadTool, semanticMapSourceProjectionDefinition } from '../src/semantic-map.ts'

const page = { tabId: 7, frameId: 0, documentId: 'document-a', url: 'https://example.test/article' }
const source = { version: 1, extractorVersion: 'browser-source-v2', blocks: [
  { blockId: 'block-0', ordinal: 0, kind: 'heading', text: 'Heading', truncated: false },
  { blockId: 'block-1', ordinal: 1, kind: 'paragraph', text: 'Evidence', truncated: false },
  { blockId: 'block-2', ordinal: 2, kind: 'paragraph', text: 'Unorganized', truncated: false },
], omissions: ['below-fold'] }

function bind(session: Session, revision: number, nextPage: typeof page | null = page) {
  session.append('browser-target/change', { kind: 'browser-target/change', version: 1, revision,
    binding: nextPage === null ? null : { installationId: 'installation', page: nextPage,
      revision, boundAt: Date.now(), boundBy: 'user' } })
}

interface SnapshotOptions {
  sessionId?: string
  installationId?: string
  snapshotId?: string
  tabId?: number
  frameId?: number
  documentId?: string
  url?: string
  blocks?: typeof source.blocks
  meta?: JsonValue
  includeSource?: boolean
  isError?: boolean
}

function snapshot(session: Session, options: SnapshotOptions = {}) {
  const callId = ToolCallId(`snapshot-${session.events.length}`)
  const call = session.append('tool/call', { turn: 1, step: 1, callId, name: 'browser_snapshot', arguments: '{}' })
  return session.append('tool/result', {
    turn: 1, step: 1, message: createToolResultMessage({ callId, content: [], isError: options.isError ?? false }),
    meta: options.meta ?? { browserObservation: { version: 1, result: {
      sessionId: options.sessionId ?? session.id, installationId: options.installationId ?? 'installation', outcome: 'observed', delivery: 'sent',
      value: { snapshotId: options.snapshotId ?? 'snapshot-a', page: {
        ...page, ...(options.tabId === undefined ? {} : { tabId: options.tabId }),
        ...(options.frameId === undefined ? {} : { frameId: options.frameId }),
        ...(options.documentId === undefined ? {} : { documentId: options.documentId }),
        ...(options.url === undefined ? {} : { url: options.url }),
      },
      ...(options.includeSource === false ? {} : {
        source: { ...source, ...(options.blocks === undefined ? {} : { blocks: options.blocks }) },
      }) },
    } } },
  }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
}

function sourceState(session: Session) {
  return session.events.reduce((state, event) => semanticMapSourceProjectionDefinition.apply(state, event),
    semanticMapSourceProjectionDefinition.init({ id: session.id } as SessionHeader))
}

function setup(read = true) {
  const session = Session.create(SessionId('semantic-map-session'))
  bind(session, 1)
  const event = snapshot(session)
  const tool = createSemanticMapTool(() => sourceState(session))
  const args = { snapshotId: 'snapshot-a', nodes: [
    { parentIndex: -1, label: 'Overview', summary: 'A navigable summary', sourceRefs: ['block-0'] },
    { parentIndex: 0, label: 'Evidence', summary: '', sourceRefs: ['block-1', 'block-1'] },
  ] }
  if (read) {
    const callId = ToolCallId('read-source')
    const call = session.append('tool/call', { turn: 1, step: 2, callId, name: 'browser_read_source', arguments: '{}' })
    session.append('tool/result', { turn: 1, step: 2, message: createToolResultMessage({ callId, content: [], isError: false }),
      meta: { semanticSourceRead: { version: 1, sourceResultSeq: event.seq, snapshotId: 'snapshot-a', blockIds: ['block-0', 'block-1'] } },
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  }
  return { session, event, tool, args }
}

function execute(tool: ReturnType<typeof createSemanticMapTool>, args: unknown) {
  return tool.execute(args, { signal: new AbortController().signal } as ToolRunContext)
}

function executeRead(tool: ReturnType<typeof createSourceReadTool>, args: unknown) {
  return tool.execute(args, { signal: new AbortController().signal } as ToolRunContext)
}

describe('browser_publish_semantic_map', () => {
  it('accepts a real Browser observation metadata projection from contentBlocks', () => {
    const session = Session.create(SessionId('real-observation-metadata'))
    bind(session, 1)
    const callId = ToolCallId('captured-source')
    const call = session.append('tool/call', { turn: 1, step: 1, callId, name: 'browser_snapshot', arguments: '{}' })
    session.append('tool/result', { turn: 1, step: 1,
      message: createToolResultMessage({ callId, content: [], isError: false }),
      meta: browserObservationMeta({ requestId: 'request', sessionId: session.id, installationId: 'installation',
        outcome: 'observed', delivery: 'sent', value: { page, snapshotId: 'actual-shape', source: {
          version: 1, extractorVersion: 'browser-source-v2', contentBlocks: source.blocks, omissions: [],
        } } }),
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    const state = sourceState(session)
    expect(state.sources).toHaveLength(1)
    expect(state.sources[0]?.snapshot.blocks).toEqual(source.blocks)
    expect(semanticMapSourceProjectionDefinition.stateSchema.parse(state)).toEqual(state)
  })
  it('replays bounded authenticated source and read receipts into a host projection', () => {
    const { session, event } = setup()
    const state = sourceState(session)
    expect(state.sources).toHaveLength(1)
    expect(state.sources[0]).toMatchObject({ sourceResultSeq: event.seq,
      snapshot: { snapshotId: 'snapshot-a' }, readBlockIds: ['block-0', 'block-1'] })
    expect(semanticMapSourceProjectionDefinition.stateSchema.parse(state)).toEqual(state)
  })
  it('rejects malformed cached source evidence and read receipts', () => {
    const state = sourceState(setup().session)
    const sourceEntry = state.sources[0]!
    const invalid = [
      { ...state, targets: state.targets.map(target => ({ ...target, snapshotId: 'fabricated' })) },
      { ...state, sources: [{ ...sourceEntry, readBlockIds: ['invented'] }] },
      { ...state, sources: [{ ...sourceEntry, snapshot: { ...sourceEntry.snapshot,
        blocks: [sourceEntry.snapshot.blocks[0], sourceEntry.snapshot.blocks[0]] } }] },
      { ...state, sources: [{ ...sourceEntry, snapshot: { ...sourceEntry.snapshot,
        blocks: [{ ...sourceEntry.snapshot.blocks[0], blockId: 'forged' }] } }] },
      { ...state, sources: [{ ...sourceEntry, snapshot: { ...sourceEntry.snapshot,
        blocks: [{ ...sourceEntry.snapshot.blocks[0], text: 'x'.repeat(1200) },
          ...Array.from({ length: 14 }, (_, ordinal) => ({ ...sourceEntry.snapshot.blocks[0],
            blockId: `block-${ordinal + 1}`, ordinal: ordinal + 1, text: 'x'.repeat(1200) }))] } }] },
    ]
    for (const candidate of invalid) expect(semanticMapSourceProjectionDefinition.stateSchema.safeParse(candidate).success).toBe(false)
  })
  it('rejects an invalid source checkpoint during projection restore', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionProjectionRegistry)
    ctx.sessionProjections.register(semanticMapSourceProjectionDefinition)
    const { session } = setup()
    const state = sourceState(session), last = session.events.at(-1)
    if (last === undefined) throw new Error('expected source events')
    const poisoned = { ...state, sources: state.sources.map(source => ({ ...source, readBlockIds: ['invented'] })) }
    expect(() => ctx.sessionProjections.restore({ semanticMapSource: {
      ver: semanticMapSourceProjectionDefinition.stateVersion, seq: last.seq, val: poisoned,
    } }, session.events, SessionLogOffset(0), session.header, session.inheritedEventCount)).toThrow('read receipt')
  })
  it('rejects a projection belonging to another Session', async () => {
    const { session, args } = setup()
    const tool = createSemanticMapTool(() => sourceState(session))
    await expect(tool.execute(args, { agent: { session: { id: SessionId('other-session') } },
      signal: new AbortController().signal } as ToolRunContext)).rejects.toThrow('session mismatch')
  })
  it('uses projected evidence after recovery without reading the complete Session log', async () => {
    const { session, args } = setup()
    const state = sourceState(session)
    Object.defineProperty(session, 'events', { get: () => { throw new Error('synchronous history read forbidden') } })
    const tool = createSemanticMapTool(() => state)
    await expect(execute(tool, args)).resolves.toMatchObject({ snapshotId: 'snapshot-a' })
  })
  it('marks a source stale after a later control-only observation of the same frame', async () => {
    const { session, args } = setup()
    snapshot(session, { snapshotId: 'controls-only', includeSource: false })
    const tool = createSemanticMapTool(() => sourceState(session))
    await expect(execute(tool, args)).rejects.toThrow('source snapshot is stale')
  })
  it('rejects publishing after a fixed-target rebind, clear, or new document in the same tab', async () => {
    const switched = setup()
    bind(switched.session, 2, { ...page, tabId: 8, documentId: 'document-b' })
    await expect(execute(switched.tool, switched.args)).rejects.toThrow('target_changed')
    const cleared = setup()
    bind(cleared.session, 2, null)
    await expect(execute(cleared.tool, cleared.args)).rejects.toThrow('target_changed')
    const replaced = setup()
    bind(replaced.session, 2, { ...page, documentId: 'document-b', url: 'https://example.test/new' })
    await expect(execute(replaced.tool, replaced.args)).rejects.toThrow('target_changed')
  })
  it('reads and publishes a fresh same-tab document after navigation without rebinding', async () => {
    const session = Session.create(SessionId('same-tab-navigation'))
    bind(session, 1)
    const captured = snapshot(session, { snapshotId: 'new-document', documentId: 'document-b', url: 'https://example.test/new' })
    const state = sourceState(session)
    expect(state.sources).toHaveLength(1)
    const read = createSourceReadTool(() => sourceState(session))
    await expect(executeRead(read, { snapshotId: 'new-document' })).resolves.toMatchObject({
      sourceResultSeq: captured.seq, snapshotId: 'new-document', blocks: source.blocks,
    })
    const callId = ToolCallId('read-new-document')
    const call = session.append('tool/call', { turn: 1, step: 2, callId, name: 'browser_read_source', arguments: '{}' })
    session.append('tool/result', { turn: 1, step: 2,
      message: createToolResultMessage({ callId, content: [], isError: false }),
      meta: { semanticSourceRead: { version: 1, sourceResultSeq: captured.seq,
        snapshotId: 'new-document', blockIds: source.blocks.map(block => block.blockId) } },
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    const publish = createSemanticMapTool(() => sourceState(session))
    await expect(execute(publish, { snapshotId: 'new-document', nodes: [
      { parentIndex: -1, label: 'New page', sourceRefs: ['block-0'] },
    ] })).resolves.toMatchObject({ page: { ...page, documentId: 'document-b', url: 'https://example.test/new' } })
  })
  it('does not register a delivered snapshot from another installation, tab, or frame', () => {
    for (const [index, options] of [{ installationId: 'other' }, { tabId: 8 }, { frameId: 1 }].entries()) {
      const session = Session.create(SessionId(`wrong-target-${index}`))
      bind(session, 1)
      snapshot(session, { snapshotId: 'foreign', documentId: 'document-b', url: 'https://example.test/new', ...options })
      expect(sourceState(session).sources).toHaveLength(0)
    }
  })
  it('bounds retained source history and refuses an evicted snapshot', async () => {
    const session = Session.create(SessionId('bounded-semantic-source'))
    bind(session, 1)
    for (let index = 0; index < 6; index++) snapshot(session, { snapshotId: `snapshot-${index}` })
    const state = sourceState(session)
    expect(state.sources.map(item => item.snapshot.snapshotId)).toEqual([
      'snapshot-2', 'snapshot-3', 'snapshot-4', 'snapshot-5',
    ])
    expect(state.targets).toHaveLength(6)
    const tool = createSourceReadTool(() => state)
    await expect(executeRead(tool, { snapshotId: 'snapshot-0' })).rejects.toThrow('valid browser source snapshot')
  })
  it('evicts a source when later control observations evict its provenance target', () => {
    const session = Session.create(SessionId('bounded-target-observations'))
    bind(session, 1)
    snapshot(session, { snapshotId: 'first-source' })
    for (let index = 0; index < 17; index++) snapshot(session, { snapshotId: `controls-${index}`, includeSource: false })
    const state = sourceState(session)
    expect(state.targets).toHaveLength(16)
    expect(state.sources).toHaveLength(0)
    expect(semanticMapSourceProjectionDefinition.stateSchema.parse(state)).toEqual(state)
  })
  it('rejects semantic references that were never delivered through source reading', async () => {
    const { tool, args } = setup(false)
    await expect(execute(tool, args)).rejects.toThrow('not read')
  })
  it('publishes stable hierarchy with durable evidence and preserves unorganized blocks', async () => {
    const { tool, args, event } = setup()
    const value = await execute(tool, args)
    expect(value).toMatchObject({ version: 1, sourceResultSeq: event.seq, snapshotId: 'snapshot-a', installationId: 'installation', page,
      nodes: [
        { parentId: null, label: 'Overview', sourceRefs: ['block-0'], origin: 'ai-summary' },
        // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matcher.
        { parentId: expect.stringMatching(/:0$/u), label: 'Evidence', sourceRefs: ['block-1'], origin: 'ai-summary' },
      ],
      unorganizedBlockIds: ['block-2'],
    })
    expect(value).toMatchObject({
      // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matcher.
      mapId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u),
      nodes: [
        // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matcher.
        { nodeId: expect.stringMatching(/:0$/u) },
        // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matcher.
        { nodeId: expect.stringMatching(/:1$/u) },
      ],
    })
    expect(tool.output.presentationMeta!(args, value as JsonValue)).toEqual({ semanticMap: value })
  })

  it('resolves source identity from snapshotId without exposing an event-sequence input', async () => {
    const { tool, args, event } = setup()
    await expect(execute(tool, args)).resolves.toMatchObject({ sourceResultSeq: event.seq, snapshotId: 'snapshot-a' })
    expect(tool.parameters).not.toHaveProperty('sourceResultSeq')
  })

  it('rejects ambiguous snapshot identities instead of guessing a source', async () => {
    const { session, tool, args } = setup()
    snapshot(session, { snapshotId: 'snapshot-a' })
    await expect(execute(tool, args)).rejects.toThrow('snapshotId is ambiguous')
  })

  it('rejects source references absent from the exact snapshot', async () => {
    const { tool, args } = setup()
    await expect(execute(tool, { ...args, nodes: [{ ...args.nodes[0], sourceRefs: ['invented'] }] }))
      .rejects.toThrow('source reference "invented" is not in the source snapshot')
  })

  it('rejects a snapshot delivered for another session', async () => {
    const { session, tool, args } = setup()
    snapshot(session, { sessionId: 'other-session', snapshotId: 'foreign' })
    await expect(execute(tool, { ...args, snapshotId: 'foreign' }))
      .rejects.toThrow('valid browser source snapshot delivered for the initiating session')
  })

  it('rejects an older snapshot after a later delivered snapshot of the same document', async () => {
    const { session, tool, args } = setup()
    snapshot(session, { snapshotId: 'snapshot-b' })
    await expect(execute(tool, args)).rejects.toThrow('source snapshot is stale')
  })

  it('rejects a previous candidate after a later control-only snapshot or URL change on the same frame', async () => {
    const { session, tool, args } = setup()
    snapshot(session, { snapshotId: 'controls-only', includeSource: false })
    await expect(execute(tool, args)).rejects.toThrow('source snapshot is stale')
    const another = setup()
    snapshot(another.session, { snapshotId: 'url-change', url: 'https://example.test/article?updated=1' })
    await expect(execute(another.tool, another.args)).rejects.toThrow('source snapshot is stale')
  })

  it('does not publish an old source after a later snapshot attempt with unknown outcome', async () => {
    const { session, tool, args } = setup()
    const callId = ToolCallId('later-unknown-snapshot')
    const call = session.append('tool/call', { turn: 1, step: 3, callId, name: 'browser_snapshot', arguments: '{}' })
    session.append('tool/result', { turn: 1, step: 3,
      message: createToolResultMessage({ callId, content: [], isError: false }),
      meta: { browserObservation: { version: 1, result: { sessionId: session.id, installationId: 'installation',
        outcome: 'unknown', delivery: 'sent', value: { snapshotId: 'unknown', page } } } },
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    await expect(execute(tool, args)).rejects.toThrow('source snapshot is stale')
  })

  it('rejects source candidates whose successful result is not appended or whose tool block reports an error', async () => {
    const { session, tool, args, event } = setup()
    const altered = { id: session.id, events: session.events.map(candidate => candidate.seq === event.seq
      ? { ...candidate, surfaceOp: { op: 'replace' } } : candidate) } as unknown as Session
    await expect(execute(createSemanticMapTool(() => sourceState(altered)), args)).rejects.toThrow('valid browser source snapshot')
    snapshot(session, { snapshotId: 'error-result', isError: true })
    await expect(execute(tool, { ...args, snapshotId: 'error-result' })).rejects.toThrow('valid browser source snapshot')
  })

  it('rejects a snapshot after a later delivered document on the same frame', async () => {
    const { session, tool, args } = setup()
    snapshot(session, { snapshotId: 'snapshot-b', documentId: 'document-b' })
    await expect(execute(tool, args)).rejects.toThrow('source snapshot is stale')
  })

  it('rejects malformed hierarchy and size bounds before publishing', async () => {
    const { tool, args } = setup()
    await expect(execute(tool, { ...args, nodes: [{ ...args.nodes[0], parentIndex: 0 }] })).rejects.toThrow('parentIndex')
    await expect(execute(tool, { ...args, nodes: [{ ...args.nodes[0] }, { ...args.nodes[1] }, { ...args.nodes[1], parentIndex: 1 }] }))
      .rejects.toThrow('two levels')
    await expect(execute(tool, { ...args, nodes: [] })).rejects.toThrow('at least one')
    await expect(execute(tool, { ...args, nodes: Array.from({ length: 65 }, () => args.nodes[0]) })).rejects.toThrow('at most 64')
  })

  it('does not accept forged source text when the browser-observation metadata lacks a valid source', async () => {
    const session = Session.create(SessionId('forged-meta-session'))
    snapshot(session, { meta: { browserObservation: { version: 1, result: {
      sessionId: session.id, installationId: 'installation', outcome: 'observed', delivery: 'sent',
      value: { snapshotId: 'snapshot-a', page, text: 'Heading Evidence', source: { blocks: source.blocks } },
    } } } })
    const tool = createSemanticMapTool(() => sourceState(session))
    await expect(execute(tool, { snapshotId: 'snapshot-a', nodes: [
      { parentIndex: -1, label: 'Forged', summary: '', sourceRefs: ['block-0'] },
    ] })).rejects.toThrow('valid browser source snapshot')
  })
})

describe('browser_read_source', () => {
  it('pages escaped code by its rendered size without dropping complete blocks', async () => {
    const session = Session.create(SessionId('escaped-source-session'))
    bind(session, 1)
    const blocks = Array.from({ length: 6 }, (_, ordinal) => ({
      blockId: `block-${ordinal}`, ordinal, kind: 'code', text: '"\\'.repeat(600), truncated: false,
    }))
    snapshot(session, { blocks })
    const tool = createSourceReadTool(() => sourceState(session))
    const first = await executeRead(tool, { snapshotId: 'snapshot-a' }) as { blocks: typeof blocks; nextOffset: number }
    expect(first.blocks.length).toBeGreaterThan(0)
    expect(first.blocks.length).toBeLessThan(4)
    expect(first.nextOffset).toBe(first.blocks.length)
    const [rendered] = tool.output.render({ snapshotId: 'snapshot-a' }, first)
    if (rendered?.type !== 'text') throw new Error('expected source text')
    expect(rendered.text.length).toBeLessThanOrEqual(7500)
    const next = await executeRead(tool, { snapshotId: 'snapshot-a', offset: first.nextOffset }) as { blocks: typeof blocks }
    expect(next.blocks[0]).toEqual(blocks[first.nextOffset])
  })
  it('returns complete ordered blocks without reading the webpage and exposes the next offset', async () => {
    const session = Session.create(SessionId('source-read-session'))
    bind(session, 1)
    const blocks = Array.from({ length: 9 }, (_, ordinal) => ({
      blockId: `block-${ordinal}`, ordinal, kind: 'paragraph', text: 'x'.repeat(1200), truncated: false,
    }))
    const event = snapshot(session, { blocks })
    const tool = createSourceReadTool(() => sourceState(session))
    const first = await executeRead(tool, { snapshotId: 'snapshot-a' })
    expect(first).toMatchObject({ sourceResultSeq: event.seq, snapshotId: 'snapshot-a', nextOffset: 4, blocks: blocks.slice(0, 4), omissions: ['below-fold'] })
    const second = await executeRead(tool, { snapshotId: 'snapshot-a', offset: 4 })
    expect(second).toMatchObject({ nextOffset: 8, blocks: blocks.slice(4, 8) })
    const last = await executeRead(tool, { snapshotId: 'snapshot-a', offset: 8 })
    expect(last).toMatchObject({ nextOffset: null, blocks: blocks.slice(8) })
    const [rendered] = tool.output.render({ snapshotId: 'snapshot-a' }, first as JsonValue)
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matcher.
    expect(rendered).toMatchObject({ type: 'text', text: expect.stringContaining('Untrusted webpage source') })
    if (rendered?.type !== 'text') throw new Error('expected a text render')
    expect(rendered.text.length).toBeLessThanOrEqual(7500)
  })

  it('shares source authenticity and snapshot ambiguity checks with publishing', async () => {
    const session = Session.create(SessionId('source-read-invalid-session'))
    bind(session, 1)
    snapshot(session, { snapshotId: 'same' })
    snapshot(session, { snapshotId: 'same' })
    const tool = createSourceReadTool(() => sourceState(session))
    await expect(executeRead(tool, { snapshotId: 'same' })).rejects.toThrow('snapshotId is ambiguous')
    await expect(executeRead(tool, { snapshotId: 'missing' })).rejects.toThrow('valid browser source snapshot')
    expect(tool.parameters).not.toHaveProperty('sourceResultSeq')
  })
})
