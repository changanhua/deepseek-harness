import { describe, expect, test } from 'vitest'
import { createSbcInventorySnapshot } from '../src/fc-sbc-inventory-snapshot.js'

const codes = (rows: readonly { readonly code: string }[]) => rows.map(row => row.code)

describe('FC SBC 完整库存快照', () => {
  test('把完整俱乐部与 SBC Storage 库存规整成可交给求解器的卡实例', () => {
    const snapshot = createSbcInventorySnapshot({
      coverage: 'complete',
      capturedAt: '2026-09-25T07:05:00.000Z',
      cards: [
        { instanceId: 'club-a', cardVersionId: 'gold-a', source: 'club', rating: 84,
          tradeable: true, locked: false, reserveValue: 550, textSample: 'private card text' },
        { instanceId: 'storage-a', cardVersionId: 'gold-a', source: 'sbc-storage', rating: 84,
          tradeable: false, locked: true },
        { instanceId: 'club-b', cardVersionId: 'gold-b', source: 'club', rating: 82,
          tradeable: false },
      ],
    })

    expect(snapshot.status).toBe('complete')
    expect(snapshot.summary).toMatchObject({
      coverage: 'complete',
      cardCount: 3,
      clubCount: 2,
      sbcStorageCount: 1,
      lockedCount: 1,
      tradeableCount: 1,
      duplicateInstanceCount: 0,
      invalidRowCount: 0,
      uniqueCardVersionCount: 2,
    })
    expect(snapshot.solverInventory).toEqual([
      { instanceId: 'club-a', cardVersionId: 'gold-a', reserveValue: 550, locked: false },
      { instanceId: 'storage-a', cardVersionId: 'gold-a', reserveValue: 0, locked: true },
      { instanceId: 'club-b', cardVersionId: 'gold-b', reserveValue: 0, locked: false },
    ])
    expect(JSON.stringify(snapshot)).not.toContain('private card text')
  })

  test('重复实例或缺少身份时保持 invalid，且不把坏行交给求解器', () => {
    const snapshot = createSbcInventorySnapshot({
      coverage: 'complete',
      cards: [
        { instanceId: 'dup-a', cardVersionId: 'gold-a', source: 'club' },
        { instanceId: 'dup-a', cardVersionId: 'gold-b', source: 'club' },
        { instanceId: '', cardVersionId: 'gold-c', source: 'club' },
        { instanceId: 'missing-version', source: 'sbc-storage' },
      ],
    })

    expect(snapshot.status).toBe('invalid')
    expect(codes(snapshot.issues)).toContain('duplicate-card-instance')
    expect(codes(snapshot.issues)).toContain('inventory-row-missing-identity')
    expect(snapshot.summary).toMatchObject({ duplicateInstanceCount: 1, invalidRowCount: 2 })
    expect(snapshot.solverInventory).toEqual([
      { instanceId: 'dup-a', cardVersionId: 'gold-a', reserveValue: 0, locked: false },
    ])
  })

  test('未证明完整覆盖时只作为 partial 证据，不能解除完整库存前置条件', () => {
    const snapshot = createSbcInventorySnapshot({
      coverage: 'visible-only',
      cards: [{ instanceId: 'visible-a', cardVersionId: 'gold-a', source: 'visible', rating: 80 }],
    })

    expect(snapshot.status).toBe('partial')
    expect(codes(snapshot.issues)).toContain('inventory-coverage-unverified')
    expect(snapshot.summary.coverage).toBe('visible-only')
  })
})
