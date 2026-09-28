import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadReplayScript, resolveScriptedEntry } from '@deepseek-ai/dsh-llm-replay'
import { normalizePlanningSessionLog } from './planning-snapshot-support.ts'
import { REPO_ROOT } from './support.ts'

const fixture = join(REPO_ROOT, 'snapshots/web/planning-conversation/session.v3.jsonl')
const override = join(REPO_ROOT, 'snapshots/web/planning-conversation/replay.override.json')

describe('planning conversation snapshot support', () => {
  it('normalizes generated planning identities and clocks without changing the recorded Skill body', async () => {
    const raw = await readFile(fixture, 'utf8')
    const normalized = normalizePlanningSessionLog(raw)

    expect(normalizePlanningSessionLog(normalized)).toBe(normalized)
    expect(normalized).toContain('PLANNING_ITEM_1')
    expect(normalized).toContain('PLANNING_REVISION_1')
    expect(normalized).toContain('PLANNING_CREATED_AT_1')
    expect(normalized).toContain('PLANNING_PERSONAL_PACKAGE_ROOT/skills/planning-maintenance')
    expect(normalized).toContain('When the user gives a direct, specific instruction')
    expect(normalized).not.toContain('plan-88caa853-9ada-4805-9a4d-9df1a3bff902')
  })

  it('keeps planning semantics and business review values observable', async () => {
    const raw = await readFile(fixture, 'utf8')
    const normalized = normalizePlanningSessionLog(raw)
    const variants = [
      raw.replace('本提案只固定问题与目标，不预设方案。', '本提案改为预设方案。'),
      raw.replace('方案未定不阻塞记录：允许先留存、后决定处理方式', '方案必须先定才能记录'),
      raw.replace('5b9878e61ebe981970c767c3b339778f4da13abd2c92d0b3306516205efd682e', '0b9878e61ebe981970c767c3b339778f4da13abd2c92d0b3306516205efd682e'),
    ]

    for (const variant of variants) expect(normalizePlanningSessionLog(variant)).not.toBe(normalized)
    const call = JSON.stringify({ type: 'tool/call', data: {
      callId: 'planning-review', name: 'planning_update', arguments: JSON.stringify({ command: {
        itemId: 'plan-01234567-89ab-cdef-0123-456789abcdef',
      } }),
    } })
    const result = JSON.stringify({ type: 'tool/result', data: { message: {
      source: { kind: 'tool', callId: 'planning-review' },
      content: [{ type: 'tool-result', content: [{ type: 'text', text: JSON.stringify({
        item_id: 'plan-01234567-89ab-cdef-0123-456789abcdef',
        createdAt: '2027-01-01T00:00:00.000Z', reviewAt: '2027-01-01T00:00:00.000Z',
        intent: 'Keep the business date 2027-01-01T00:00:00.000Z visible.',
      }) }] }],
    } } })
    expect(normalizePlanningSessionLog(`${call}\n`)).toContain('plan-01234567-89ab-cdef-0123-456789abcdef')
    const reviewNormalized = normalizePlanningSessionLog(`${call}\n${result}\n`)
    expect(reviewNormalized).toContain('PLANNING_CREATED_AT_1')
    expect(reviewNormalized)
      .toContain('2027-01-01T00:00:00.000Z')
  })

  it('binds only the recorded follow-up calls to the live generated plan id', () => {
    const script = loadReplayScript({ file: fixture, overrideFile: override })
    const patched = [10, 11, 15, 16].map(index => script[index]!)
    expect(patched).toHaveLength(4)
    expect(JSON.stringify(patched)).not.toContain('plan-88caa853-9ada-4805-9a4d-9df1a3bff902')

    const itemId = 'plan-01234567-89ab-cdef-0123-456789abcdef'
    const resolved = resolveScriptedEntry(patched[0], [{
      role: 'user', content: [{ type: 'text', text: `{"item_id":"${itemId}"}` }],
    }])
    expect(JSON.stringify(resolved)).toContain(itemId)
    expect(JSON.stringify(resolved)).not.toContain('{{fromRequest:')
  })
})
