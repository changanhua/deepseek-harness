/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest'
import { renderSemanticNavigation } from '../src/assistant-semantic-view.js'

const first = { mapId: 'version-1', snapshotId: 'source-1', nodes: [
  { nodeId: 'topic-1', parentId: null, label: '适用范围', summary: '三种模板，其他页面尚未验证。', sourceRefs: ['block-0'] },
], unorganizedBlockIds: ['block-1'] }
const second = { mapId: 'version-2', snapshotId: 'source-2', nodes: [
  { nodeId: 'topic-2', parentId: null, label: '新候选', summary: '这次试验仍有边界。', sourceRefs: ['block-0'] },
], unorganizedBlockIds: [] }
const sources = [
  { snapshotId: 'source-1', current: false, omissions: [], blocks: [
    { blockId: 'block-0', kind: 'paragraph', text: '旧快照：其他页面尚未验证。', truncated: false },
    { blockId: 'block-1', kind: 'paragraph', text: '尚未分组的内容。', truncated: false },
  ] },
  { snapshotId: 'source-2', current: true, omissions: [], blocks: [
    { blockId: 'block-0', kind: 'paragraph', text: '新快照：结论仍有限定。', truncated: false },
  ] },
]
const control = (selector: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(selector)
  if (!element) throw new Error(`Missing control: ${selector}`)
  return element
}
const mount = (id: string, versions = [first]) => {
  const onGenerate = vi.fn(), onReveal = vi.fn()
  document.body.append(renderSemanticNavigation({ id, title: '缓存试验', semanticMap: first,
    semanticMaps: versions, sourceSnapshot: sources[0], sourceSnapshots: sources },
  { canLocate: true, onGenerate, onReveal }) as HTMLElement)
  return { onGenerate, onReveal }
}
afterEach(() => { document.body.replaceChildren(); sessionStorage.clear() })

it('keeps keyboard focus within each reading level and restores the source link on return', () => {
  const callbacks = mount('keyboard')
  control('[data-semantic-node]').click()
  expect(document.activeElement).toBe(control('.semantic-focus h3'))
  control('[data-source-ref="block-0"]').click()
  expect(document.activeElement).toBe(control('.semantic-source h3'))
  control('[data-semantic-back]').click()
  expect(document.activeElement).toBe(control('[data-source-ref="block-0"]'))
  control('[data-semantic-back]').click()
  expect(document.activeElement).toBe(control('[data-semantic-node="topic-1"]'))
  expect(callbacks.onGenerate).not.toHaveBeenCalled()
})

it('switches candidate versions explicitly, retaining each focus and its own source snapshot', () => {
  const callbacks = mount('versions', [first, second])
  control('[data-semantic-node="topic-1"]').click()
  const select = control('select') as HTMLSelectElement
  expect(select.value).toBe('version-1')
  select.value = 'version-2'; select.dispatchEvent(new Event('change'))
  control('[data-semantic-node="topic-2"]').click()
  control('[data-source-ref="block-0"]').click()
  expect(control('.semantic-passage').textContent).toBe('新快照：结论仍有限定。')
  control('[data-source-locate]').click()
  expect(callbacks.onReveal).toHaveBeenCalledWith('block-0', 'source-2')
  const back = control('select') as HTMLSelectElement
  back.value = 'version-1'; back.dispatchEvent(new Event('change'))
  expect(control('.semantic-focus h3').textContent).toBe('适用范围')
  control('[data-source-ref="block-0"]').click()
  expect(control('.semantic-passage').textContent).toBe('旧快照：其他页面尚未验证。')
  expect((control('[data-source-locate]') as HTMLButtonElement).disabled).toBe(true)
  expect(callbacks.onGenerate).not.toHaveBeenCalled()
})

it('shows a human correction separately and submits edits without changing node identity or sources', async () => {
  const onFeedback = vi.fn(async () => ({ ok: true }))
  document.body.append(renderSemanticNavigation({ id: 'correction', title: '缓存试验', semanticMap: first,
    semanticMaps: [first], sourceSnapshot: sources[0], sourceSnapshots: sources,
    semanticFeedback: { entries: [{ mapId: 'version-1', nodeId: 'topic-1', revision: 2,
      label: '修正：仅已测模板', summary: '其他页面未验证。', flag: 'meaning', note: '需要保留限定。' }], navigations: [] } },
  { canLocate: true, onGenerate: vi.fn(), onReveal: vi.fn(), onFeedback }) as HTMLElement)
  expect(control('[data-semantic-node="topic-1"]').textContent).toContain('修正：仅已测模板')
  control('[data-semantic-node="topic-1"]').click()
  expect(control('.semantic-focus').textContent).toContain('你的修正')
  control('[data-edit-node="topic-1"]').click()
  const title = control('[data-edit-label]') as HTMLInputElement
  title.value = '更新后的修正'; title.dispatchEvent(new Event('input'))
  control('[data-save-edit]').click()
  await Promise.resolve(); await Promise.resolve()
  expect(onFeedback).toHaveBeenCalledWith('version-1', 'topic-1', expect.objectContaining({
    action: 'edit', expectedRevision: 2, label: '更新后的修正', summary: '其他页面未验证。',
  }))
  expect(first.nodes[0].label).toBe('适用范围')
  expect(first.nodes[0].sourceRefs).toEqual(['block-0'])
})

it('retains an unsaved draft through state refresh and closes it after the authoritative save refresh', async () => {
  const page = { id: 'draft-refresh', title: '缓存试验', semanticMap: first, semanticMaps: [first], sourceSnapshot: sources[0], sourceSnapshots: sources }
  const render = (entries: object[] = []) => renderSemanticNavigation({ ...page, semanticFeedback: { entries, navigations: [] } }, {
    canLocate: true, onGenerate: vi.fn(), onReveal: vi.fn(),
    onFeedback: async (_mapId: string, nodeId: string, update: { label: string; summary: string }) => {
      document.body.replaceChildren(render([{ mapId: 'version-1', nodeId, revision: 1, label: update.label,
        summary: update.summary, flag: null }]))
      return { ok: true }
    },
  }) as HTMLElement
  document.body.append(render())
  control('[data-semantic-node]').click(); control('[data-edit-node]').click()
  const input = control('[data-edit-label]') as HTMLInputElement
  input.value = '仍须核对范围'; input.dispatchEvent(new Event('input'))
  document.body.replaceChildren(render())
  expect((control('[data-edit-label]') as HTMLInputElement).value).toBe('仍须核对范围')
  control('[data-save-edit]').click()
  await vi.waitFor(() => { expect(document.querySelector('[data-edit-label]')).toBeNull() })
  expect(control('.semantic-focus h3').textContent).toBe('仍须核对范围')
  expect(control('.semantic-human-label').textContent).toContain('你的修正')
})

it('keeps a draft when its revision is stale and requires explicit renewal before saving', () => {
  const onFeedback = vi.fn(async () => ({ ok: true }))
  const render = (revision: number) => renderSemanticNavigation({ id: 'revision-conflict', title: '缓存试验', semanticMap: first,
    semanticMaps: [first], sourceSnapshot: sources[0], sourceSnapshots: sources,
    semanticFeedback: { revision, entries: [], navigations: [] } },
  { canLocate: true, onGenerate: vi.fn(), onReveal: vi.fn(), onFeedback }) as HTMLElement
  document.body.append(render(4))
  control('[data-semantic-node]').click(); control('[data-edit-node]').click()
  const input = control('[data-edit-label]') as HTMLInputElement
  input.value = '仍有适用范围'; input.dispatchEvent(new Event('input'))
  document.body.replaceChildren(render(5))
  expect((control('[data-edit-label]') as HTMLInputElement).value).toBe('仍有适用范围')
  expect(control('.semantic-edit-form').textContent).toContain('核对当前版本后继续')
  control('[data-review-action="retry"]').click()
  control('[data-save-edit]').click()
  expect(onFeedback).toHaveBeenCalledWith('version-1', 'topic-1', expect.objectContaining({
    action: 'edit', expectedRevision: 5, label: '仍有适用范围',
  }))
})

it('shows live reading position at every level but never marks an old snapshot as current', () => {
  const live = { ...sources[1], snapshotId: 'source-1', current: true, readingBlockId: 'block-0' }
  const map = { ...first, nodes: [...first.nodes, { nodeId: 'detail-1', parentId: 'topic-1', label: '范围限定',
    summary: '只在已测模板中适用。', sourceRefs: ['block-0'] }] }
  const page = { id: 'reading-position', title: '缓存试验', semanticMap: map, semanticMaps: [map],
    sourceSnapshot: live, sourceSnapshots: [live] }
  const render = value => renderSemanticNavigation(value, { canLocate: true, onGenerate: vi.fn(), onReveal: vi.fn() }) as HTMLElement
  document.body.append(render(page))
  expect(control('[data-semantic-node="topic-1"]').getAttribute('aria-current')).toBe('location')
  control('[data-semantic-node="topic-1"]').click()
  expect(control('.semantic-focus').textContent).toContain('当前阅读区域')
  expect(control('.semantic-detail-card').getAttribute('aria-current')).toBe('location')
  control('[data-source-ref="block-0"]').click()
  expect(control('.semantic-source').textContent).toContain('当前阅读位置')
  const old = { ...live, current: false }
  document.body.replaceChildren(render({ ...page, sourceSnapshot: old, sourceSnapshots: [old] }))
  expect(document.querySelector('[aria-current="location"]')).toBeNull()
  expect(document.body.textContent).not.toContain('当前阅读位置')
})

it('keeps a long uncategorized player list navigable while stating the capture limit', () => {
  const blocks = Array.from({ length: 63 }, (_, index) => ({
    blockId: `block-${index}`, kind: 'record', text: `Player ${index + 1} · 85 CM · 91 PAC`, truncated: false,
  }))
  const source = { snapshotId: 'list-source', current: true, blocks, omissions: ['其余正文块未采集'] }
  document.body.append(renderSemanticNavigation({ id: 'long-list', title: 'Popular Players', semanticMap: null,
    semanticMaps: [], sourceSnapshot: source, sourceSnapshots: [source] },
  { canLocate: true, onGenerate: vi.fn(), onReveal: vi.fn() }) as HTMLElement)
  expect(control('.semantic-header').textContent).toContain('原文导航')
  expect(control('.semantic-provenance').textContent).toContain('尚未生成语义解读')
  expect(control('.semantic-unorganized').textContent).toContain('63 块')
  expect(control('.semantic-gaps').textContent).toContain('其余正文块未采集')
  control('.semantic-unorganized').click()
  expect(document.querySelectorAll('[data-source-ref]')).toHaveLength(63)
  control('[data-source-ref="block-62"]').click()
  expect(control('.semantic-passage').textContent).toBe('Player 63 · 85 CM · 91 PAC')
})
