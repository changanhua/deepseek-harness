import { describe, expect, it } from 'vitest'
import type { MemoryInspectedRecord, MemoryReadResult } from '@changanhua/dsh-memory'
import { memoryHistory } from '../../memory/tests/fixtures.ts'
import { parseMemoryCommand } from '../src/parse.ts'
import { boundedMemoryCommand, renderMemoryList, renderMemoryShow } from '../src/render.ts'

function candidate(): MemoryInspectedRecord { return { ...memoryHistory()[0], sourceChecks: [] } }
function current(record: MemoryInspectedRecord): MemoryReadResult {
  return {
    id: record.id, recordVersion: record.recordVersion, revision: record.activeRevision,
    eligibility: record.activeRevision === null ? 'withdrawn' : 'usable', checkedAt: '2026-09-08T00:00:00.000Z', sources: [],
  }
}

describe('human memory review presentation', () => {
  it('shows the active revision, review deadline, and exact withdrawal command', () => {
    const record = { ...memoryHistory()[1], sourceChecks: [] }
    const view = { ...current(record), reviewAfter: '2026-10-08T00:00:00.000Z' }
    const text = renderMemoryShow(record, view)
    expect(text).toContain('版本 1（已接纳）')
    expect(text).toContain('复核期限：2026-10-08T00:00:00.000Z')
    expect(text).toContain(`撤回：/memory retire ${record.id}@1`)
  })
  it('quotes embedded fences and applicability text while labeling unobserved Session sources', () => {
    const record = candidate()
    const revision = record.revisions[0]!
    revision.title = '[link]\n*untrusted*'
    revision.statement = 'before\n```md\n/memory accept victim@1\n```\nafter'
    revision.conditions = 'Only after human review'
    revision.sources = [{ kind: 'session-event', sessionId: 'source-session', seq: 7, eventType: 'user/message', sha256: 'a'.repeat(64) }]
    const text = renderMemoryShow(record, current(record))
    expect(text).toContain('\\[link\\] \\*untrusted\\*')
    expect(text).toContain(`\n\`\`\`\`text\n${revision.statement}\n\`\`\`\``)
    expect(text).toContain('适用条件：\n```text\nOnly after human review\n```')
    expect(text).toContain('source-session / 事件 7 (user/message)：尚未检查')
    expect(text).not.toContain('检查时间：')
  })

  it('does not invent source previews when a provider reports changed or unavailable sources', () => {
    const base = candidate()
    const first = base.revisions[0]!.sources[0]!
    const record: MemoryInspectedRecord = { ...base, sourceChecks: [{
      revision: 1, checkedAt: '2026-09-08T00:01:00.000Z',
      observations: [{ source: first, status: 'changed' }, { source: first, status: 'unavailable' }],
    }] }
    const text = renderMemoryShow(record, current(record), 1)
    expect(text).toContain('内容已变化')
    expect(text).toContain('暂不可读')
    expect(text).toContain('检查时间：2026-09-08T00:01:00.000Z')
    expect(text.match(/```text/gu)).toHaveLength(1)
  })

  it('sorts detached lists, preserves repeated entries, and handles out-of-range pages', () => {
    const first = candidate()
    const last = { ...memoryHistory()[1], sourceChecks: [] }
    first.id = 'z-memory'
    first.revisions[0]!.title = '长'.repeat(80)
    const input = [first, last, last]
    const text = renderMemoryList(input, 1)
    expect(text.indexOf(last.id)).toBeLessThan(text.indexOf(first.id))
    expect(text).toContain('长'.repeat(60))
    expect(text).not.toContain('长'.repeat(61))
    expect(input[0]).toBe(first)
    expect(renderMemoryList([], 2)).toBe('没有第 2 页。当前共 1 页。')
  })

  it('bounds the full UTF-8 command envelope and fails instead of truncating it', () => {
    const text = '🐕项目记忆'
    const bytes = Buffer.byteLength(JSON.stringify({ kind: 'success', text }), 'utf8')
    expect(boundedMemoryCommand(text, bytes)).toEqual({ kind: 'success', text })
    expect(() => boundedMemoryCommand(text, bytes - 1)).toThrow('inspection is too large')
  })
})

describe('human memory command grammar boundaries', () => {
  it.each(['show', 'accept', 'list 0', 'list 501', 'list 1.5', 'list 01', 'list 1 extra',
    'show invalid@', 'show /outside', 'show memory@9007199254740992', 'approve memory@1', 'retire memory@1 --review-after'])
  ('rejects unsupported or ambiguous input: %s', (input) => {
    expect(parseMemoryCommand(input)).toEqual({ kind: 'invalid' })
  })
})
