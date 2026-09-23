import { expect, it } from 'vitest'
import { projectAssistantCognition } from '../src/assistant-cognition.js'

const page = { tabId: 1, frameId: 0, documentId: 'doc', url: 'https://example.test/article' }
const blocks = [{ blockId: 'block-0', ordinal: 0, kind: 'paragraph', text: '仅对三种模板测试，平均约 14%。', truncated: false },
  { blockId: 'block-1', ordinal: 1, kind: 'paragraph', text: '其他页面没有验证。', truncated: false }]
const record = (seq: number, name: string, meta: object) => [
  { event: { type: 'tool/call', seq, time: seq, data: { callId: `call-${seq}`, name } } },
  { event: { type: 'tool/result', seq: seq + 1, time: seq + 1, surfaceOp: 'append', sourceEventSeqs: [seq], data: { meta,
    message: { source: { kind: 'tool', callId: `call-${seq}` }, content: [{ type: 'tool-result', toolCallId: `call-${seq}`, isError: false,
      content: [{ type: 'text', text: 'Model-facing text may be spilled.' }] }] } } } },
]
const source = (seq = 1, snapshotId = 'snapshot-1') => record(seq, 'browser_snapshot', { browserObservation: { version: 1, result: {
  installationId: 'install', sessionId: 'session', requestId: 'read', outcome: 'observed', delivery: 'sent',
  value: { page, snapshotId, title: '缓存试验', source: { version: 1, extractorVersion: 'browser-source-v2', blocks, omissions: ['仅取得正文片段'] } },
} } })
const map = { version: 1, mapId: 'map-1', installationId: 'install', page, snapshotId: 'snapshot-1', sourceResultSeq: 2,
  nodes: [{ nodeId: 'map-1:0', parentId: null, label: '有限范围内的性能改善', summary: '三种模板中的平均改善约为 14%，其他页面未验证。', sourceRefs: ['block-0', 'block-1'], origin: 'ai-summary' }], unorganizedBlockIds: [] }
const project = (records: unknown[]) => projectAssistantCognition({ sessionId: 'session', records, now: 100 }).pages[0]

it('separates source facts from an AI map and retains source identity across view changes', () => {
  const result = project([...source(), ...record(3, 'browser_publish_semantic_map', { semanticMap: map })])
  expect(result.sourceSnapshot).toMatchObject({ snapshotId: 'snapshot-1', current: true, blocks })
  expect(result.semanticMap).toMatchObject({ mapId: 'map-1', nodes: [{ origin: 'ai-summary', sourceRefs: ['block-0', 'block-1'] }] })
})

it('rejects an invented source even in apparently successful map metadata', () => {
  const invalid = { ...map, nodes: [{ ...map.nodes[0], sourceRefs: ['block-invented'] }] }
  const result = project([...source(), ...record(3, 'browser_publish_semantic_map', { semanticMap: invalid })])
  expect(result.semanticMap).toBeNull()
  expect(result.sourceSnapshot).toMatchObject({ blocks })
})

it('keeps a prior map readable but withdraws current-page source claims after a newer snapshot', () => {
  const result = project([...source(), ...record(3, 'browser_publish_semantic_map', { semanticMap: map }), ...source(5, 'snapshot-2')])
  expect(result.semanticMap?.mapId).toBe('map-1')
  expect(result.sourceSnapshot).toMatchObject({ snapshotId: 'snapshot-1', current: false })
})

it('retains candidate versions without replacing the first reading map automatically', () => {
  const next = { ...map, mapId: 'map-2', nodes: [{ ...map.nodes[0], nodeId: 'map-2:0', label: '新候选标题' }] }
  const result = project([...source(), ...record(3, 'browser_publish_semantic_map', { semanticMap: map }),
    ...record(5, 'browser_publish_semantic_map', { semanticMap: next })])
  expect(result.semanticMap?.mapId).toBe('map-1')
  expect(result.semanticMaps).toHaveLength(2)
})
