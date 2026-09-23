import { describe, expect, it } from 'vitest'
import { projectAssistantCognition } from '../src/assistant-cognition.js'

const page = { tabId: 17, frameId: 0, documentId: 'players-document', url: 'https://example.test/players' }
const observe = (seq: number, value: object) => [
  { event: { type: 'tool/call', seq, time: seq, data: { callId: `read-${seq}`, name: 'browser_snapshot', arguments: '{}' } } },
  { event: { type: 'tool/result', seq: seq + 1, time: seq + 1, surfaceOp: 'append', sourceEventSeqs: [seq], data: {
    message: { source: { callId: `read-${seq}` }, content: [{ type: 'tool-result', toolCallId: `read-${seq}`, isError: false,
      content: [{ type: 'text', text: JSON.stringify({ sessionId: 'content-map', installationId: 'browser', requestId: `request-${seq}`, outcome: 'observed', delivery: 'sent',
        value: { page, snapshotId: `snapshot-${seq}`, ...value } }) }] }] },
  } } },
]
const project = (...values: object[]) => projectAssistantCognition({ sessionId: 'content-map', now: 100,
  records: values.flatMap((value, index) => observe(index * 2 + 1, value)) }).pages[0]

describe('content-first page map', () => {
  it('keeps the delivered page content visible when landmarks have no names or geometry', () => {
    const result = project({ title: 'EA FC 27 Popular Players | FUTBIN', text: 'Popular Players\nKylian Mbappé 91 ST\nAitana Bonmatí 91 CM', textTruncated: true,
      structure: { regions: [{ role: 'header' }, { role: 'nav' }, { role: 'main' }, { role: 'main' }, { role: 'footer' }] } })
    expect(result.content).toMatchObject({ groups: [expect.objectContaining({
      title: '已读页面片段', excerpt: 'Popular Players\nKylian Mbappé 91 ST\nAitana Bonmatí 91 CM', evidenceIds: ['content-map:2'],
    })] })
    expect(result.content.gaps).toContain('正文超出本次读取范围')
    expect(result.content.groups.map((group: { title: string }) => group.title)).not.toContain('main')
  })

  it('preserves heading hierarchy without inventing actions for tree-only observations', () => {
    const result = project({ title: 'Battery guide', tree: [
      { index: 0, parentIndex: null, kind: 'element', tag: 'article' },
      { index: 1, parentIndex: 0, kind: 'element', tag: 'h1', text: 'Battery guide' },
      { index: 2, parentIndex: 0, kind: 'element', tag: 'h2', text: 'Charging' },
      { index: 3, parentIndex: 0, kind: 'text', text: 'Keep the battery cool.' },
      { index: 4, parentIndex: 0, kind: 'element', tag: 'h3', text: 'Daily use' },
      { index: 5, parentIndex: 0, kind: 'text', text: 'Avoid prolonged heat.' },
      { index: 6, parentIndex: 0, kind: 'element', tag: 'button', label: 'Show charging table', elementId: 'charging-table' },
      { index: 7, parentIndex: 0, kind: 'element', tag: 'h2', text: 'Storage' },
      { index: 8, parentIndex: 0, kind: 'text', text: 'Store partly charged.' },
    ] })
    expect(result.content?.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Charging', parentId: null, excerpt: 'Keep the battery cool.' }),
      expect.objectContaining({ title: 'Daily use', parentId: expect.any(String), excerpt: 'Avoid prolonged heat.', actionIds: [] }),
      expect.objectContaining({ title: 'Storage', parentId: null, excerpt: 'Store partly charged.' }),
    ]))
  })

  it('shows collection members without inventing a total or merging repeated observations', () => {
    const result = project({ text: 'Old content', structure: { collections: [{ kind: 'list', items: [{ index: 0, text: 'Old item' }] }] } },
      { title: 'Popular players', text: 'Updated players', structure: { collections: [{ kind: 'list', itemCount: 128,
        items: [{ index: 0, text: 'Kylian Mbappé · 91 · ST' }, { index: 1, text: 'Aitana Bonmatí · 91 · CM' }] }] } })
    expect(result.content?.groups).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'collection', totalCount: null,
      items: [{ index: 0, text: 'Kylian Mbappé · 91 · ST' }, { index: 1, text: 'Aitana Bonmatí · 91 · CM' }], evidenceIds: ['content-map:4'] })]))
    expect(JSON.stringify(result.content)).not.toContain('Old item')
  })

  it('does not turn empty landmarks or unlabeled controls into semantic knowledge', () => {
    const result = project({ title: 'Canvas dashboard', text: '', structure: { regions: [{ role: 'main' }, { role: 'footer' }] } })
    expect(result.content).toMatchObject({ groups: [], status: 'insufficient' })
    expect(result.content.gaps.length).toBeGreaterThan(0)
  })

  it('keeps page-wide controls outside an unrelated named content branch', () => {
    const result = project({ title: 'Question', structure: { regions: [{ role: 'main', label: 'Answer by Lin', text: 'Use a small bounded queue.' }] },
      elements: [{ elementId: 'vote', role: 'button', label: 'Upvote', context: 'Answer by Lin' }, { elementId: 'account', role: 'button', label: 'Account' }] })
    expect(result.content?.groups).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Answer by Lin',
      actionIds: ['content-map:2:vote'] })]))
    expect(result.content.unplacedActionIds).toContain('content-map:2:account:1')
  })

  it('reads real heading text children and excludes following navigation from the last section', () => {
    const result = project({ title: 'Guide', tree: [
      { index: 0, parentIndex: null, kind: 'element', tag: 'article' },
      { index: 1, parentIndex: 0, kind: 'element', tag: 'h2' },
      { index: 2, parentIndex: 1, kind: 'text', text: 'Storage' },
      { index: 3, parentIndex: 0, kind: 'element', tag: 'p' },
      { index: 4, parentIndex: 3, kind: 'text', text: 'Keep it cool.' },
      { index: 5, parentIndex: null, kind: 'element', tag: 'footer' },
      { index: 6, parentIndex: 5, kind: 'text', text: 'Privacy policy' },
    ] })
    expect(result.content.groups).toEqual([expect.objectContaining({ title: 'Storage', excerpt: 'Keep it cool.' })])
  })

  it('retains collection control membership even when a separate map supplied the visible regions', () => {
    const result = project({ title: 'Queue guide', text: 'Queue patterns', elements: [{ elementId: 'read', role: 'link', label: 'Read queue guide' }],
      structure: { collections: [{ kind: 'ul', items: [{ index: 0, text: 'Bounded queues', controls: [{ elementId: 'read', role: 'link', label: 'Read queue guide' }] }] }] } })
    expect(result.content.groups.find((group: { kind: string }) => group.kind === 'collection').actionIds).toEqual(['content-map:2:read'])
  })

  it('joins delivered pages of one tree snapshot and preserves both source references', () => {
    const result = project({ snapshotId: 'paged-tree', title: 'Guide', treeCursor: 'paged-tree:2', tree: [
      { index: 0, parentIndex: null, kind: 'element', tag: 'article' },
      { index: 1, parentIndex: 0, kind: 'element', tag: 'h2', text: 'Charging' },
    ] }, { snapshotId: 'paged-tree', title: 'Guide', treeComplete: true, tree: [
      { index: 2, parentIndex: 0, kind: 'text', text: 'Keep it cool.' },
    ] })
    expect(result.content.groups).toEqual([expect.objectContaining({ title: 'Charging', excerpt: 'Keep it cool.', evidenceIds: ['content-map:2', 'content-map:4'] })])
  })

  it('does not attribute another article or a sidebar to the previous heading', () => {
    const result = project({ title: 'Guide', tree: [
      { index: 0, parentIndex: null, kind: 'element', tag: 'main' },
      { index: 1, parentIndex: 0, kind: 'element', tag: 'article' },
      { index: 2, parentIndex: 1, kind: 'element', tag: 'h2', text: 'Charging' },
      { index: 3, parentIndex: 1, kind: 'text', text: 'Keep it cool.' },
      { index: 4, parentIndex: 0, kind: 'element', tag: 'aside' },
      { index: 5, parentIndex: 4, kind: 'text', text: 'Related products' },
      { index: 6, parentIndex: 0, kind: 'element', tag: 'article' },
      { index: 7, parentIndex: 6, kind: 'text', text: 'Second article without heading' },
    ] })
    expect(result.content.groups.find((group: { title: string }) => group.title === 'Charging').excerpt).toBe('Keep it cool.')
    expect(JSON.stringify(result.content)).toContain('Second article without heading')
  })
})
