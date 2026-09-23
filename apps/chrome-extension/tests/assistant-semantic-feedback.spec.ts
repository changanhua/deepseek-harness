import { describe, expect, it, vi } from 'vitest'
import { createSemanticFeedback } from '../src/assistant-semantic-feedback.js'

const KEY = 'dsh.assistant.semantic-feedback.v1'
type UpdateInput = {
  scope: string
  pageId: string
  mapId: string
  snapshotId: string
  nodeId: string
  sourceRefs: string[]
  expectedRevision: number
  action: 'edit' | 'flag' | 'reset'
  label?: string | null
  summary?: string | null
  flag?: 'meaning' | 'source' | 'other'
  note?: string
}
type Entry = {
  scope: string
  pageId: string
  mapId: string
  snapshotId: string
  nodeId: string
  sourceRefs: string[]
  revision: number
  label: string | null
  summary: string | null
  flag: string | null
  note: string
  updatedAt: number
}
type Navigation = { blockId: string
  outcome: string }
interface Feedback {
  restore(): Promise<void>
  read(scope: string, pageId: string): { entries: Entry[]
    navigations: Navigation[]
    error: string | null
    revision: number }
  update(value: UpdateInput): Promise<Entry>
  recordNavigation(value: { scope: string
    pageId: string
    snapshotId: string
    blockId: string
    outcome: 'located' | 'failed'
    durationMs: number }): Promise<void>
}
const input = (overrides: Partial<UpdateInput> = {}): UpdateInput => ({
  scope: '{"baseUrl":"https://dsh.test","installationId":"install","sessionId":"session"}',
  pageId: 'page-1', mapId: 'map-1', snapshotId: 'snapshot-1', nodeId: 'map-1:0', sourceRefs: ['block-0'],
  expectedRevision: 0, action: 'edit' as const, label: '人工标题', summary: '人工概括', ...overrides,
})

function harness(initial: Record<string, unknown> = {}) {
  const values = structuredClone(initial)
  const storage = {
    get: vi.fn(async (key: string) => ({ [key]: structuredClone(values[key]) })),
    set: vi.fn(async (patch: Record<string, unknown>) => { Object.assign(values, structuredClone(patch)) }),
  }
  const changed = vi.fn()
  const feedback = createSemanticFeedback({ storage, changed }) as unknown as Feedback
  return { feedback, storage, values, changed }
}

describe('semantic reading feedback', () => {
  it('persists a local correction and restores it without retaining source text', async () => {
    const h = harness(); await h.feedback.restore()
    const saved = await h.feedback.update(input())
    expect(saved).toMatchObject({ revision: 1, label: '人工标题', summary: '人工概括', flag: null, note: '' })
    expect(JSON.stringify(h.values[KEY])).not.toContain('原文正文')
    const restarted = harness(h.values); await restarted.feedback.restore()
    expect(restarted.feedback.read(input().scope, 'page-1').entries).toMatchObject([saved])
  })

  it('isolates feedback by scope and map version', async () => {
    const h = harness(); await h.feedback.restore(); await h.feedback.update(input())
    await h.feedback.update(input({ expectedRevision: h.feedback.read(input().scope, 'page-1').revision,
      mapId: 'map-2', nodeId: 'map-2:0' }))
    expect(h.feedback.read('other-scope', 'page-1').entries).toEqual([])
    expect(h.feedback.read(input().scope, 'page-1').entries).toHaveLength(2)
  })

  it('accepts the full JSON page identity, including a long URL, for feedback and navigation', async () => {
    const h = harness(); await h.feedback.restore()
    const pageId = JSON.stringify({ installationId: 'install', sessionId: 'session', url: `https://example.test/${'path/'.repeat(2000)}` })
    expect(pageId.length).toBeGreaterThan(512)
    await h.feedback.update(input({ pageId }))
    await h.feedback.recordNavigation({ scope: input().scope, pageId, snapshotId: 'snapshot-1', blockId: 'block-0', outcome: 'located', durationMs: 1 })
    expect(h.feedback.read(input().scope, pageId)).toMatchObject({ entries: [{ pageId }], navigations: [{ pageId }] })
  })

  it('does not let a newer map overwrite a prior human correction', async () => {
    const h = harness(); await h.feedback.restore(); await h.feedback.update(input())
    await h.feedback.update(input({ mapId: 'map-2', nodeId: 'map-2:0',
      expectedRevision: h.feedback.read(input().scope, 'page-1').revision, label: '新图人工标题' }))
    expect(h.feedback.read(input().scope, 'page-1').entries.find(entry => entry.mapId === 'map-1')).toMatchObject({ label: '人工标题' })
  })

  it('serializes same-revision updates so only one wins', async () => {
    const h = harness(); await h.feedback.restore()
    const [first, second] = await Promise.allSettled([h.feedback.update(input()), h.feedback.update(input({ label: '另一个' }))])
    expect([first.status, second.status].filter(status => status === 'fulfilled')).toHaveLength(1)
    const rejected = [first, second].find(result => result.status === 'rejected')
    expect(rejected?.status).toBe('rejected')
    if (rejected?.status === 'rejected') expect((rejected.reason as Error).message).toBe('semantic_feedback_conflict')
  })

  it('reset releases correction capacity and an older zero-revision draft cannot revive it', async () => {
    const h = harness(); await h.feedback.restore()
    const saved = await h.feedback.update(input())
    const cleared = await h.feedback.update(input({ action: 'reset', expectedRevision: saved.revision }))
    expect(cleared.revision).toBeGreaterThan(saved.revision)
    expect(h.feedback.read(input().scope, 'page-1').entries).toEqual([])
    await expect(h.feedback.update(input({ label: '陈旧草稿', expectedRevision: 0 }))).rejects.toThrow('semantic_feedback_conflict')
    const currentRevision = h.feedback.read(input().scope, 'page-1').revision
    await expect(h.feedback.update(input({ label: '明确重新修正', expectedRevision: currentRevision })))
      .resolves.toMatchObject({ label: '明确重新修正' })
  })

  it('retains real corrections while upgrading earlier local records and reclaiming their reset tombstones', async () => {
    const original = { scope: input().scope, pageId: 'page-1', mapId: 'map-1', snapshotId: 'snapshot-1',
      nodeId: 'map-1:0', sourceRefs: ['block-0'], revision: 1, label: '人工标题', summary: '人工概括', flag: null, note: '', updatedAt: 1 }
    const tombstone = { ...original, nodeId: 'map-1:1', revision: 4, label: null, summary: null }
    const h = harness({ [KEY]: { version: 1, entries: [original, tombstone], navigations: [] } })
    await h.feedback.restore()
    const restored = h.feedback.read(input().scope, 'page-1')
    expect(restored.entries).toMatchObject([{ nodeId: 'map-1:0', label: '人工标题' }])
    expect(restored.entries[0].revision).toBeGreaterThan(4)
    expect(restored.revision).toBe(restored.entries[0].revision)
    await expect(h.feedback.update(input({ nodeId: 'map-1:1', expectedRevision: 0 }))).rejects.toThrow('semantic_feedback_conflict')
    expect(h.storage.set).not.toHaveBeenCalled()
  })

  it('does not release a correction or revision when the reset write fails', async () => {
    const h = harness(); await h.feedback.restore()
    const saved = await h.feedback.update(input())
    h.storage.set.mockRejectedValueOnce(new Error('unavailable'))
    await expect(h.feedback.update(input({ action: 'reset', expectedRevision: saved.revision })))
      .rejects.toThrow('semantic_feedback_storage_failed')
    expect(h.feedback.read(input().scope, 'page-1')).toMatchObject({ revision: saved.revision,
      entries: [{ label: '人工标题', revision: saved.revision }] })
  })

  it('does not publish memory or notifications when storage rejects a correction', async () => {
    const h = harness(); await h.feedback.restore(); h.storage.set.mockRejectedValueOnce(new Error('offline'))
    await expect(h.feedback.update(input())).rejects.toThrow('semantic_feedback_storage_failed')
    expect(h.feedback.read(input().scope, 'page-1').entries).toEqual([])
    expect(h.changed).not.toHaveBeenCalled()
  })

  it('keeps a committed update when its change observer throws', async () => {
    const h = harness(); await h.feedback.restore(); h.changed.mockImplementationOnce(() => { throw new Error('observer failed') })
    await expect(h.feedback.update(input())).resolves.toMatchObject({ revision: 1 })
    expect(h.feedback.read(input().scope, 'page-1').entries).toHaveLength(1)
  })

  it('queues restore behind an in-flight write so it cannot overwrite the committed feedback', async () => {
    const h = harness(); await h.feedback.restore()
    let release!: () => void
    h.storage.set.mockImplementationOnce((patch: Record<string, unknown>) => new Promise<void>((resolve) => {
      release = () => { Object.assign(h.values, structuredClone(patch)); resolve() }
    }))
    const updating = h.feedback.update(input())
    await vi.waitFor(() => { expect(release).toBeTypeOf('function') })
    const restoring = h.feedback.restore()
    release(); await updating; await restoring
    expect(h.feedback.read(input().scope, 'page-1').entries).toHaveLength(1)
  })

  it('keeps invalid restored storage intact and blocks later writes', async () => {
    const h = harness({ [KEY]: { version: 1, entries: 'invalid', navigations: [] } })
    await h.feedback.restore()
    expect(h.feedback.read(input().scope, 'page-1').error).toBe('semantic_feedback_restore_invalid')
    await expect(h.feedback.update(input())).rejects.toThrow('semantic_feedback_restore_blocked')
    expect(h.storage.set).not.toHaveBeenCalled()
  })

  it('rejects oversized feedback and capacity overflow without eviction', async () => {
    const h = harness(); await h.feedback.restore()
    await expect(h.feedback.update(input({ label: 'x'.repeat(97) }))).rejects.toThrow('semantic_feedback_invalid_input')
    const entries = Array.from({ length: 256 }, (_, index) => ({ scope: input().scope, pageId: 'page-1', mapId: 'map-1', snapshotId: 'snapshot-1',
      nodeId: `map-1:${index}`, sourceRefs: ['block-0'], revision: index + 1, label: `修正 ${index}`, summary: null, flag: null, note: '', updatedAt: 1 }))
    const full = harness({ [KEY]: { version: 1, revision: 256, entries, navigations: [] } }); await full.feedback.restore()
    await expect(full.feedback.update(input({ nodeId: 'map-1:new', expectedRevision: 256 })))
      .rejects.toThrow('semantic_feedback_capacity_exceeded')
    expect(full.feedback.read(input().scope, 'page-1').entries).toHaveLength(256)
    await full.feedback.update(input({ nodeId: 'map-1:0', action: 'reset', expectedRevision: 1 }))
    expect(full.feedback.read(input().scope, 'page-1').entries).toHaveLength(255)
    const availableRevision = full.feedback.read(input().scope, 'page-1').revision
    await expect(full.feedback.update(input({ nodeId: 'map-1:new', expectedRevision: availableRevision })))
      .resolves.toMatchObject({ nodeId: 'map-1:new' })
  })

  it('records only the latest 100 local navigation facts', async () => {
    const h = harness(); await h.feedback.restore()
    for (let index = 0; index < 101; index++) await h.feedback.recordNavigation({ scope: input().scope, pageId: 'page-1', snapshotId: 'snapshot-1',
      blockId: `block-${index}`, outcome: 'located', durationMs: index })
    const navigations = h.feedback.read(input().scope, 'page-1').navigations
    expect(navigations).toHaveLength(100)
    expect(navigations[0]).toMatchObject({ blockId: 'block-100', outcome: 'located' })
    expect(navigations.at(-1)).toMatchObject({ blockId: 'block-1' })
  })
})
