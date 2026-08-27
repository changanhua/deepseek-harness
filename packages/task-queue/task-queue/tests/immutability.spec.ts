import { describe, expect, it } from 'vitest'
import { applyChange, foldChanges, WorkId } from '@deepseek-ai/dsh-task-queue'
import { admitted, work } from './fixtures.ts'

describe('durable projection immutability', () => {
  it('deep-clones and freezes appended input', () => {
    const item = work()
    const change = admitted(1, item)
    const folded = foldChanges([change])
    item.tags.push('mutated')
    item.resolved.model = 'mutated'
    expect(folded.worksById.get(WorkId('work-1'))).toMatchObject({ tags: ['image'], resolved: { model: 'model-1' } })
    expect(Object.isFrozen(folded.worksById.get(WorkId('work-1')))).toBe(true)
  })

  it('returns defensive read-only map snapshots', () => {
    const folded = foldChanges([admitted()])
    const exposed = folded.worksById
    const item = exposed.get(WorkId('work-1'))!
    expect(() => { (item as { title: string }).title = 'mutated' }).toThrow()
    ;(exposed as Map<WorkId, typeof item>).clear()
    expect(exposed.has(WorkId('work-1'))).toBe(false)
    expect(folded.worksById.has(WorkId('work-1'))).toBe(true)
  })

  it('does not partially mutate when a later event in a ChangeSet fails', () => {
    const folded = foldChanges([admitted()])
    expect(() =>{  applyChange(folded, {
      seq: 2, changeId: 'change-2', at: '2026-08-26T00:00:01.000Z', events: [
        { type: 'work/manual-retry-authorized', workId: WorkId('work-1'), at: '2026-08-26T00:00:01.000Z' },
      ],
    }) }).toThrow()
    expect(folded.lastSeq).toBe(1)
    expect(folded.statesByWorkId.get(WorkId('work-1'))?.status).toBe('queued')
  })
})
