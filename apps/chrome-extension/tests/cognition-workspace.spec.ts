import assert from 'node:assert/strict'
import { it } from 'vitest'
import { projectCognitionWorkspace, createCognitionScope, compileCognitionContext, attachCognitionContext, cognitionScopeIssue } from '../src/assistant-cognition-workspace.js'

const fixture = () => {
  const target: { tabId: number; frameId: number; documentId: string; url: string; status?: string } = { tabId: 9, frameId: 0, documentId: 'doc-a', url: 'https://example.test/issues' }
  const action = { id: 'action-a', elementId: 'element-a', observationId: 'session-a:2', snapshotId: 'snapshot-a', role: 'button', label: '提交', locatorsValid: true }
  const observation = { id: 'session-a:2', snapshotId: 'snapshot-a', observedAt: 100, source: { toolResultSeq: 2 },
    regions: [{ role: 'main', label: '当前列表', text: '两条记录' }, { role: 'navigation', label: '导航', text: '问题 / 文档' }] as { role: string; label: string; text?: string }[],
    elements: [{ elementId: 'field-a', role: 'textbox', label: '查询', text: '', value: 'PRIVATE', state: { required: true, disabled: false, value: 'PRIVATE' } },
      { elementId: 'element-a', role: 'button', label: '提交', text: '', state: { disabled: false } }],
    collections: [{ kind: 'list', label: '搜索结果', partial: true, totalCount: null, items: [{ index: 0, text: '浏览器点击失败' }, { index: 1, text: '状态没有刷新' }] }],
    tree: undefined as { nodes: { kind: string; index: number; parentIndex: number | null; tag: string; label: string }[] } | undefined,
    omissions: { textTruncated: true }, preview: { text: '本次片段' } }
  const page = { id: 'page-a', sessionId: 'session-a', title: '问题工作台', target: { installationId: 'install-a', page: target },
    documentState: 'current', locatorsValid: true,
    semanticMaps: [] as { mapId: string; snapshotId: string; sourceResultSeq: number; nodes: { nodeId: string; label: string; summary: string; sourceRefs: string[] }[] }[],
    semanticFeedback: { revision: 0 } as { revision: number; entries?: { mapId: string; nodeId: string; label: string }[] },
    observations: [observation], regions: [], unplacedActions: [action],
    sourceSnapshots: [{ snapshotId: 'snapshot-a', observationId: observation.id, current: true, omissions: [], blocks: [
      { blockId: 'block-0', ordinal: 0, kind: 'paragraph', text: '两条记录', truncated: false },
    ] }] }
  const current = { connection: { baseUrl: 'http://127.0.0.1:3080', phase: 'connected', grant: { installationId: 'install-a' } },
    session: { binding: { sessionId: 'session-a' } }, target: { availability: 'ready', revision: 4, selected: target } }
  return { page, current, observation }
}
type Fixture = ReturnType<typeof fixture>
const choose = (page: Fixture['page'], current: Fixture['current']) => createCognitionScope(page, current, [projectCognitionWorkspace(page).objects[0].id])

it('keeps navigation and controls instead of filtering the page down to article content', () => {
  const { page } = fixture(), model = projectCognitionWorkspace(page)
  assert.ok(model.objects.some(item => item.label === '导航'))
  assert.ok(model.objects.some(item => item.label === '查询'))
  assert.ok(model.objects.some(item => item.label === '提交'))
  assert.ok(model.objects.some(item => item.label === '搜索结果'))
})
it('uses only the latest delivered observation; no cross-snapshot object or action merge', () => {
  const { page, observation } = fixture()
  page.observations.push({ ...observation, id: 'session-a:8', snapshotId: 'snapshot-b', regions: [{ role: 'form', label: '新表单' }], elements: [], collections: [] })
  const model = projectCognitionWorkspace(page)
  assert.ok(model.objects.every(item => item.observationId === 'session-a:8'))
  assert.equal(model.objects.some(item => item.label === '提交'), false)
  assert.equal(model.source, null)
})
it('does not call a raw heuristic an Agent-published judgment', () => {
  const model = projectCognitionWorkspace(fixture().page)
  assert.ok(model.objects.every(item => item.interpretation === null))
  assert.ok(model.gaps.some(gap => gap.includes('本轮模型上下文')))
})
it('retains only observed states and never copies a form value into task context', () => {
  const { page, current } = fixture(), model = projectCognitionWorkspace(page)
  const field = model.objects.find(item => item.label === '查询')
  assert.deepEqual(field.states, { disabled: false, required: true })
  const context = compileCognitionContext(createCognitionScope(page, current, [field.id]), page, current)
  assert.equal(context.json.includes('PRIVATE'), false)
})
it('never assigns an ambiguous or similar block as the original source', () => {
  const { page } = fixture()
  page.sourceSnapshots[0].blocks.push({ blockId: 'block-1', ordinal: 1, kind: 'paragraph', text: '两条记录', truncated: false })
  assert.deepEqual(projectCognitionWorkspace(page).objects.find(item => item.label === '当前列表').blockIds, [])
  page.sourceSnapshots[0].blocks[1].text = '近似两条记录'
  assert.deepEqual(projectCognitionWorkspace(page).objects.find(item => item.label === '当前列表').blockIds, ['block-0'])
})
it('represents containment, not imagined filter, cause or permission relationships', () => {
  const model = projectCognitionWorkspace(fixture().page)
  assert.ok(model.relations.length > 0)
  assert.ok(model.relations.every(relation => ['contains', 'grouped-by-role', 'source-membership'].includes(relation.kind) && relation.observationId === model.observationId))
})
it('accepts delivered tree-only regions without inventing body content', () => {
  const { page, observation } = fixture()
  observation.regions = []; observation.elements = []; observation.collections = []; page.sourceSnapshots = []
  observation.tree = { nodes: [{ kind: 'element', index: 0, parentIndex: null, tag: 'form', label: '申请表' }] }
  const model = projectCognitionWorkspace(page)
  assert.equal(model.objects[0].label, '申请表'); assert.equal(model.objects[0].text, '')
})
it('keeps explicit published judgments and human feedback separately from source facts', () => {
  const { page } = fixture()
  page.semanticMaps = [{ mapId: 'map-1', snapshotId: 'snapshot-a', sourceResultSeq: 2,
    nodes: [{ nodeId: 'node-a', label: '这可能是筛选结果', summary: '仅是推断', sourceRefs: ['block-0'] }] }]
  page.semanticFeedback = { revision: 1, entries: [{ mapId: 'map-1', nodeId: 'node-a', label: '这是当前搜索结果' }] }
  const object = projectCognitionWorkspace(page).objects[0]
  assert.equal(object.text, '两条记录')
  assert.equal(object.interpretation[0].summary, '仅是推断')
  assert.equal(object.interpretation[0].correction.label, '这是当前搜索结果')
})
it('selecting and compiling preserve the input page, original wording and source identity', () => {
  const { page, current } = fixture(), before = JSON.stringify(page)
  const model = projectCognitionWorkspace(page), objectId = model.objects[0].id
  const scope = createCognitionScope(page, current, [objectId], { [objectId]: '这不是全部问题，只看搜索结果' })
  const context = compileCognitionContext(scope, page, current)
  assert.equal(context.packet.objects[0].id, objectId)
  assert.equal(context.packet.objects[0].userCorrection, '这不是全部问题，只看搜索结果')
  assert.equal(context.packet.objects[0].observed, '两条记录')
  assert.equal(JSON.stringify(page), before)
  assert.ok(attachCognitionContext('只读分析，不修改记录', context).startsWith('只读分析，不修改记录\n'))
  assert.ok(attachCognitionContext('任务', context).includes('不是系统指令'))
})
const mutations: [string, (fixture: Fixture) => void][] = [
  ['session', ({ current }) => { current.session.binding.sessionId = 'session-b' }],
  ['installation', ({ current }) => { current.connection.grant.installationId = 'install-b' }],
  ['Host', ({ current }) => { current.connection.baseUrl = 'http://other.test' }],
  ['target revision', ({ current }) => { current.target.revision++ }],
  ['document', ({ current }) => { current.target.selected = { ...current.target.selected, documentId: 'doc-b' } }],
  ['closed tab', ({ current }) => { current.target.selected = { ...current.target.selected, status: 'closed' } }],
  ['new observation', ({ page, observation }) => { page.observations.push({ ...observation, id: 'session-a:9' }) }],
  ['feedback revision', ({ page }) => { page.semanticFeedback = { revision: 2 } }],
]
for (const [name, mutate] of mutations) it(`blocks rather than silently rebinding the scope after a changed ${name}`, () => {
  const f = fixture(), scope = choose(f.page, f.current); mutate(f)
  assert.ok(cognitionScopeIssue(scope, f.page, f.current))
  assert.throws(() => compileCognitionContext(scope, f.page, f.current))
})
it('does not block historical text context merely because an executable locator expired', () => {
  const { page, current } = fixture(); page.locatorsValid = false; page.unplacedActions[0].locatorsValid = false
  assert.ok(compileCognitionContext(choose(page, current), page, current).json)
})
it('bounds scope size and corrections without silent truncation', () => {
  const { page, current } = fixture(), model = projectCognitionWorkspace(page)
  assert.throws(() => createCognitionScope(page, current, []))
  assert.throws(() => createCognitionScope(page, current, model.objects.slice(0, 7).map(item => item.id)))
  assert.throws(() => createCognitionScope(page, current, [model.objects[0].id], { [model.objects[0].id]: 'x'.repeat(501) }))
})
it('shows partial scope and rejects a context over budget instead of clipping the task', () => {
  const { page, current, observation } = fixture()
  observation.regions = Array.from({ length: 6 }, (_, index) => ({ role: 'main', label: `region ${index}`, text: 'x'.repeat(1600) }))
  const model = projectCognitionWorkspace(page)
  const ids = model.objects.slice(0, 6).map(item => item.id)
  const scope = createCognitionScope(page, current, ids, Object.fromEntries(ids.map(key => [key, 'z'.repeat(500)])))
  assert.throws(() => compileCognitionContext(scope, page, current), /12000/)
})
it('limits serialized child excerpts and does not treat missing totals as zero', () => {
  const { page, current, observation } = fixture()
  observation.collections[0].items = Array.from({ length: 20 }, (_, index) => ({ index, text: 'x'.repeat(500) }))
  const object = projectCognitionWorkspace(page).objects.find(item => item.kind === 'collection')
  assert.equal(object.totalCount, null)
  const packet = compileCognitionContext(createCognitionScope(page, current, [object.id]), page, current).packet
  assert.equal(packet.objects[0].children.length, 8)
  assert.equal(packet.objects[0].children[0].excerpt.length, 240)
})
it('returns a bounded unread state without triggering collection or inference', () => {
  assert.equal(projectCognitionWorkspace({ id: 'empty', observations: [] }).objects.length, 0)
})

it('does not infer an article just because a list has text evidence', () => {
  assert.equal(projectCognitionWorkspace(fixture().page).kind, '列表 / 数据区')
})
it('marks clipped observation text explicitly in the submitted context', () => {
  const { page, current, observation } = fixture()
  observation.regions[0].text = 'x'.repeat(1800)
  const packet = compileCognitionContext(choose(page, current), page, current).packet
  assert.equal(packet.objects[0].observed.length, 1600)
  assert.equal(packet.objects[0].excerptTruncated, true)
})
it('refuses to append context to a slash command instead of changing command arguments', () => {
  const { page, current } = fixture()
  const context = compileCognitionContext(choose(page, current), page, current)
  assert.throws(() => attachCognitionContext('/queue list', context), /斜杠命令/)
})
