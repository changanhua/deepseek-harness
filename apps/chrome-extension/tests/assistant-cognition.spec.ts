import { describe, expect, it } from 'vitest'
import { projectAssistantCognition } from '../src/assistant-cognition.js'
import { atlasPageFixtures } from './fixtures/assistant-atlas.js'

const sessionId = 'session-a'
const installationId = 'chrome-a'
const pageA = { tabId: 7, frameId: 0, documentId: 'doc-a', url: 'https://example.test/a' }
const pageB = { ...pageA, documentId: 'doc-b', url: 'https://example.test/b' }

const call = (seq: number, callId: string, name: string, args: object = {}) => ({ type: 'event', event: {
  type: 'tool/call', seq, time: seq * 10, data: { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) },
} })
const result = (seq: number, callSeq: number, callId: string, value: object, options: {
  readonly sessionId?: string
  readonly outcome?: string
  readonly delivery?: string
  readonly isError?: boolean
} = {}) => ({ type: 'event', event: {
  type: 'tool/result', seq, time: seq * 10, surfaceOp: 'append', sourceEventSeqs: [callSeq], data: {
    turn: 1, step: 1, message: { source: { kind: 'tool', callId }, content: [{
      type: 'tool-result', toolCallId: callId, isError: options.isError ?? false,
      content: [{ type: 'text', text: `Untrusted page content follows:\n${JSON.stringify({
        requestId: `request-${callId}`, sessionId: options.sessionId ?? sessionId, installationId,
        outcome: options.outcome ?? 'observed', delivery: options.delivery ?? 'sent', value,
      })}` }],
    }] },
  },
} })
const taskResult = (seq: number, callSeq: number, callId: string, value: object) => ({ type: 'event', event: {
  type: 'tool/result', seq, time: seq * 10, surfaceOp: 'append', sourceEventSeqs: [callSeq], data: {
    turn: 1, step: 1, message: { source: { kind: 'tool', callId }, content: [{ type: 'tool-result', toolCallId: callId, isError: false,
      content: [{ type: 'text', text: JSON.stringify(value) }] }] },
  },
} })
const receipt = (seq: number, taskId: string, requestId: string, page = pageA) => ({ type: 'event', event: {
  type: 'browser-task/receipt', seq, time: seq * 10, data: { kind: 'browser-task/receipt', version: 1,
    taskId, requestId, actionKind: 'snapshot', target: { installationId, page }, outcome: 'observed', delivery: 'sent', quiescent: true },
} })
const snapshot = (seq: number, id: string, page: object, value: object) => [
  call(seq, id, 'browser_snapshot'), result(seq + 1, seq, id, { page, snapshotId: `snapshot-${id}`, ...value }),
]
const pageMap = (seq: number, id: string, page: object, regions: object[]) => [
  call(seq, id, 'browser_page_map'), result(seq + 1, seq, id, { page, regions }),
]

describe('assistant cognition page-atlas projection', () => {
  it('groups repeated delivered observations into one page and keeps only sanitized evidence', () => {
    const records = [
      ...snapshot(1, 'first', pageA, { title: 'Article', text: 'First paragraph', elements: [{ snapshotId: 'ignored', elementId: 'open', role: 'button', label: 'Open', state: { disabled: false }, selector: '#private', href: 'https://secret.test' }] }),
      ...snapshot(3, 'second', pageA, { title: 'Article', text: 'Second paragraph', elements: [{ elementId: 'next', role: 'link', label: 'Next', context: 'Article', attributes: { href: 'https://secret.test' } }] }),
    ]
    const projection = projectAssistantCognition({ sessionId, records, now: 40 })
    expect(projection).toMatchObject({ status: 'ready', refreshPolicy: 'manual-or-agent-request', pages: [{
      id: JSON.stringify([sessionId, installationId, pageA.tabId, pageA.frameId, pageA.documentId, pageA.url]), sessionId, target: { installationId, page: pageA }, title: 'Article',
      documentState: 'current', coverage: { observationCount: 2, textChars: 16, elementCount: 1, treeNodeCount: 0, regionCount: 0, totalKnown: false },
      observations: [{ id: 'session-a:2', title: 'Article', elements: [{ elementId: 'open', role: 'button', label: 'Open', state: { disabled: false } }] }, { id: 'session-a:4' }],
      unplacedActions: expect.any(Array),
    }] })
    expect(projection.pages[0].unplacedActions).toContainEqual(expect.objectContaining({ id: 'session-a:4:next', observationId: 'session-a:4', snapshotId: 'snapshot-second', elementId: 'next', role: 'link', label: 'Next', locatorsValid: true }))
    expect(JSON.stringify(projection)).not.toMatch(/private|secret\.test|selector|href|attributes/)
  })

  it('projects structured observation metadata when the model-facing result text was spilled', () => {
    const callEvent = call(1, 'spilled', 'browser_snapshot')
    const resultEvent = result(2, 1, 'spilled', { page: pageA })
    resultEvent.event.data.message.content[0]!.content = [{ type: 'text', text:
      'Observed browser action acknowledgement.\n{"requestId":"cut-off"\n\n(Omitted 18307 bytes. Full formatted result stored elsewhere.)' }]
    const records = [callEvent, { ...resultEvent, event: { ...resultEvent.event, data: { ...resultEvent.event.data,
      meta: { browserObservation: { version: 1, result: {
        requestId: 'request-spilled', sessionId, installationId, outcome: 'observed', delivery: 'sent',
        value: { page: pageA, snapshotId: 'snapshot-spilled', title: '知乎热榜', text: '', textTruncated: true,
          elements: [{ elementId: 'topic-1', role: 'link', label: '话题 1', context: '热榜' }],
          structure: { regions: [{ role: 'main', label: '热榜', text: '话题列表' }] } },
      } } },
    } } }]
    expect(projectAssistantCognition({ sessionId, records, now: 20 })).toMatchObject({ status: 'ready', pages: [{
      title: '知乎热榜', observations: [{ source: { toolName: 'browser_snapshot' }, omissions: { textTruncated: true } }],
      regions: [{ label: '热榜', actions: [{ elementId: 'topic-1', label: '话题 1' }] }],
    }] })
  })

  it('keeps prior documents as evidence but expires all their location references', () => {
    const records = [...snapshot(1, 'old', pageA, { text: 'Old' }), ...snapshot(3, 'new', pageB, { text: 'New', elements: [{ elementId: 'new', role: 'button', label: 'Current' }] })]
    const pages = projectAssistantCognition({ sessionId, records, now: 40 }).pages
    expect(pages).toMatchObject([
      { target: { page: pageA }, documentState: 'previous-document', locatorsValid: false, observations: [{ locatorsValid: false }] },
      { target: { page: pageB }, documentState: 'current', locatorsValid: true, observations: [{ locatorsValid: true }] },
    ])
  })

  it('uses the latest map region list, preserves a unique first-seen identity, and never invents geometry', () => {
    const records = [
      ...pageMap(1, 'map-one', pageA, [{ role: 'main', label: 'Article', text: 'Body', importance: 'high', bounds: { x: 10, y: 20, width: 50, height: 40 } }, { role: 'complementary', label: 'Related', text: 'Links', bounds: { x: -1, y: 0, width: 1, height: 1 } }]),
      ...pageMap(3, 'map-two', pageA, [{ role: 'main', label: 'Article', text: 'Updated body', importance: 'high', bounds: { x: 100, y: 100, width: 200, height: 300 } }]),
    ]
    const page = projectAssistantCognition({ sessionId, records, now: 40 }).pages[0]
    expect(page.regions).toEqual([{ id: 'session-a:2:region:0', role: 'main', label: 'Article', text: 'Updated body', bounds: { x: 0, y: 0, width: 1, height: 1 }, importance: 'high', coverage: 'observed', actions: [], collections: [], omissions: [], evidenceIds: ['session-a:4'], anchorActionId: null }])
    expect(page.coverage.regionCount).toBe(1)
  })

  it('assigns actions only through one observation’s unambiguous semantic context and keeps the rest unplaced', () => {
    const records = [...snapshot(1, 'semantic', pageA, { text: 'Question Answer', elements: [
      { elementId: 'answer', role: 'button', label: 'Upvote', context: 'Answer' }, { elementId: 'unknown', role: 'button', label: 'Share', context: 'Toolbar' },
    ], structure: { regions: [{ role: 'main', label: 'Question', text: 'Question' }, { role: 'region', label: 'Answer', text: 'Answer' }] } })]
    const page = projectAssistantCognition({ sessionId, records, now: 20 }).pages[0]
    expect(page.regions.find((region: { label: string }) => region.label === 'Answer')?.actions).toMatchObject([{ elementId: 'answer', label: 'Upvote' }])
    expect(page.unplacedActions).toMatchObject([{ elementId: 'unknown', label: 'Share' }])
  })

  it('marks bounded map and structural-summary caps as omissions without treating their counts as page totals', () => {
    const regions = Array.from({ length: 32 }, (_, index) => ({ role: 'region', label: `R${index}`, text: `R${index}` }))
    const items = Array.from({ length: 24 }, (_, index) => ({ index, text: `Item ${index}` }))
    const records = [...pageMap(1, 'full-map', pageA, regions), ...snapshot(3, 'summary', pageA, { structure: { collections: [{ kind: 'results', itemCount: 24, items }] } })]
    const page = projectAssistantCognition({ sessionId, records, now: 40 }).pages[0]
    expect(page.coverage).toMatchObject({ regionCount: 32, totalKnown: false })
    expect(page.omissions).toContain('页面地图可能截断')
    expect(page.collections).toMatchObject([{ kind: 'results', observedCount: 24, totalCount: null, partial: false }])
  })

  it.each(atlasPageFixtures)('projects a generic %s page type only from delivered structure', (_name, shape, pageType) => {
    const page = projectAssistantCognition({ sessionId, records: snapshot(1, 'type', pageA, shape), now: 20 }).pages[0]
    expect(page.pageType).toBe(pageType)
  })

  it('expires current references after sixty seconds and retains only the newest snapshot as usable', () => {
    const records = [...snapshot(1, 'first', pageA, { elements: [{ elementId: 'old', role: 'button', label: 'Old' }] }), ...snapshot(3, 'last', pageA, { elements: [{ elementId: 'last', role: 'button', label: 'Last' }] })]
    const fresh = projectAssistantCognition({ sessionId, records, now: 40 }).pages[0]
    expect(fresh.unplacedActions).toMatchObject([{ elementId: 'last', locatorsValid: true }])
    const expired = projectAssistantCognition({ sessionId, records, now: 60041 }).pages[0]
    expect(expired.locatorsValid).toBe(false)
    expect(expired.unplacedActions.every((action: { locatorsValid: boolean }) => !action.locatorsValid)).toBe(true)
  })

  it('states when the supplied session history cannot establish complete earlier evidence', () => {
    const projection = projectAssistantCognition({ sessionId, records: snapshot(1, 'partial-history', pageA, { text: 'Visible' }), now: 20, historyIncomplete: true })
    expect(projection.pages[0].omissions).toContain('早期证据不完整')
  })

  it('keeps observed dynamic-DOM feedback but rejects unknown writes and other-session data', () => {
    const feedback = { page: pageA, snapshotId: 'after-expand', text: 'Expanded details', elements: [{ elementId: 'collapse', role: 'button', label: 'Collapse' }] }
    const records = [
      call(1, 'expand', 'browser_action'), result(2, 1, 'expand', { feedback: { status: 'observed', snapshot: feedback } }),
      call(3, 'unknown-write', 'browser_action'), result(4, 3, 'unknown-write', { feedback: { status: 'observed', snapshot: feedback } }, { outcome: 'unknown' }),
      call(5, 'other-session', 'browser_snapshot'), result(6, 5, 'other-session', { page: pageA, snapshotId: 'private', text: 'private' }, { sessionId: 'session-b' }),
    ]
    const projection = projectAssistantCognition({ sessionId, records, now: 30 })
    expect(projection.pages).toHaveLength(1)
    expect(projection.pages[0].observations).toMatchObject([{ readMode: 'feedback-snapshot', preview: { text: 'Expanded details' } }])
  })

  it('does not project live-like counts or guess a region identity after duplicate empty-label keys collide', () => {
    const records = [
      ...pageMap(1, 'collision', pageA, [{ role: 'region', label: '', text: 'Repeated' }, { role: 'region', label: '', text: 'Repeated' }]),
      { type: 'event', event: { type: 'extension/event', seq: 3, time: 30, data: { kind: 'like-count-changed', count: 2 } } },
    ]
    const page = projectAssistantCognition({ sessionId, records, now: 30 }).pages[0]
    expect(page.regions.map((region: { id: string }) => region.id)).toEqual(['session-a:2:region:0', 'session-a:2:region:1'])
    expect(JSON.stringify(page)).not.toContain('like-count-changed')
  })

  it('normalizes one map’s delivered pixel bounds and keeps browser_extract collections and nested controls', () => {
    const regions = [{ role: 'main', label: '正文', text: '内容', importance: 'high', stability: 'medium', bounds: { x: 0, y: -20, width: 1000, height: 800 } }, { role: 'complementary', label: '侧栏', text: '目录', bounds: { x: 1000, y: 0, width: 300, height: 600 } }]
    const records = [
      ...pageMap(1, 'pixel-map', pageA, regions),
      call(3, 'extract', 'browser_extract'), result(4, 3, 'extract', { page: pageA, snapshotId: 'extract-snapshot', items: [{ index: 0, text: '第一项', controls: [{ elementId: 'open-1', role: 'button', label: '打开', state: { disabled: false } }] }], itemCount: 16, itemsTruncated: true }),
    ]
    const page = projectAssistantCognition({ sessionId, records, now: 40 }).pages[0]
    expect(page.regions[0]).toMatchObject({ bounds: { x: 0, y: 0, width: 1000 / 1300, height: 1 }, importance: 'high' })
    expect(page.collections).toEqual([{ kind: 'extract', items: [{ index: 0, text: '第一项' }], observedCount: 1, totalCount: null, partial: true, evidenceIds: ['session-a:4'] }])
    expect(page.unplacedActions).toMatchObject([{ snapshotId: 'extract-snapshot', elementId: 'open-1', label: '打开' }])
  })

  it('marks 24 structural regions as possibly truncated and keeps same-kind collections as separate evidence', () => {
    const regions = Array.from({ length: 24 }, (_, index) => ({ role: 'region', label: `区${index}`, text: `区${index}` }))
    const records = [...snapshot(1, 'structure-regions', pageA, { structure: { regions, collections: [{ kind: 'results', itemCount: 16, items: [{ index: 0, text: 'A' }] }, { kind: 'results', itemCount: 16, items: [{ index: 0, text: 'B' }] }] } })]
    const page = projectAssistantCognition({ sessionId, records, now: 20 }).pages[0]
    expect(page.omissions).toContain('结构区域可能截断')
    expect(page.collections).toHaveLength(2)
  })

  it('keeps all 128 delivered structural items, marks their provider truncation, and never promotes a clamp into a total', () => {
    const items = Array.from({ length: 128 }, (_, index) => ({ index, text: `项目 ${index}` }))
    const records = [...snapshot(1, 'structural-128', pageA, { structure: { collections: [{ kind: 'list', itemCount: 128, items, itemsTruncated: true }] } })]
    const collection = projectAssistantCognition({ sessionId, records, now: 20 }).pages[0].collections[0]
    expect(collection).toMatchObject({ observedCount: 128, totalCount: null, partial: true })
    expect(collection.items).toHaveLength(128)
  })

  it('does not turn browser_extract’s filtered itemCount into a page collection total', () => {
    const records = [call(1, 'filtered', 'browser_extract'), result(2, 1, 'filtered', { page: pageA, snapshotId: 'filtered-snapshot', items: [{ index: 0, text: '匹配项', controls: [] }], itemCount: 16, itemsTruncated: true })]
    expect(projectAssistantCognition({ sessionId, records, now: 20 }).pages[0].collections[0]).toMatchObject({ observedCount: 1, totalCount: null, partial: true })
  })

  it('does not assign a control to a region from a substring-only context match', () => {
    const records = [...snapshot(1, 'short-context', pageA, { elements: [{ elementId: 'share', role: 'button', label: '分享', context: 'ann' }], structure: { regions: [{ role: 'region', label: '公告', text: 'announcement' }] } })]
    const page = projectAssistantCognition({ sessionId, records, now: 20 }).pages[0]
    expect(page.regions[0].actions).toEqual([])
    expect(page.unplacedActions).toMatchObject([{ elementId: 'share' }])
  })

  it('continues to require a delivered observed tool result and task receipt', () => {
    const taskCall = call(1, 'task', 'browser_task_start')
    const gated = taskResult(3, 1, 'task', { taskId: 'task-a', observation: { page: pageA, snapshotId: 'task-snapshot', text: 'Receipt gated' } })
    expect(projectAssistantCognition({ sessionId, records: [taskCall, gated], now: 40 })).toEqual({ status: 'unread', pages: [], refreshPolicy: 'manual-or-agent-request' })
    expect(projectAssistantCognition({ sessionId, records: [taskCall, receipt(2, 'task-a', 'task-request'), gated], now: 40 }).pages).toHaveLength(1)
    expect(projectAssistantCognition({ sessionId, records: [call(4, 'like', 'browser_snapshot'), result(5, 4, 'like', { page: pageA }, { outcome: 'unknown' })], now: 60 }).pages).toEqual([])
  })

  it.each([
    ['failed result', result(2, 1, 'invalid', { page: pageA }, { outcome: 'failed' })],
    ['cross-session result', result(2, 1, 'invalid', { page: pageA }, { sessionId: 'session-b' })],
    ['error result', result(2, 1, 'invalid', { page: pageA }, { isError: true })],
  ])('rejects a %s even when its payload resembles a browser observation', (_label, invalidResult) => {
    expect(projectAssistantCognition({ sessionId, records: [call(1, 'invalid', 'browser_snapshot'), invalidResult], now: 30 })).toEqual({ status: 'unread', pages: [], refreshPolicy: 'manual-or-agent-request' })
  })
})
