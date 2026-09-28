import type { SbcInventoryCard } from './fc-sbc-core.js'

export type SbcInventorySnapshotCard = {
  readonly instanceId: string
  readonly cardVersionId: string
  readonly source: 'club' | 'sbc-storage' | 'visible'
  readonly locked: boolean
  readonly tradeable: boolean
  readonly reserveValue: number
  readonly rating?: number
}

export type SbcInventorySnapshot = {
  readonly schemaVersion: 1
  readonly kind: 'fc-sbc-inventory-snapshot'
  readonly status: 'complete' | 'partial' | 'invalid'
  readonly capturedAt: string
  readonly issues: readonly {
    readonly code: string
    readonly detail: string
  }[]
  readonly summary: {
    readonly coverage: 'complete' | 'visible-only' | 'partial' | 'unread'
    readonly cardCount: number
    readonly clubCount: number
    readonly sbcStorageCount: number
    readonly visibleCount: number
    readonly lockedCount: number
    readonly tradeableCount: number
    readonly duplicateInstanceCount: number
    readonly invalidRowCount: number
    readonly uniqueCardVersionCount: number
  }
  readonly cards: readonly SbcInventorySnapshotCard[]
  readonly solverInventory: readonly SbcInventoryCard[]
}

export function createSbcInventorySnapshot(input?: {
  readonly coverage?: 'complete' | 'visible-only' | 'partial' | 'unread'
  readonly capturedAt?: string
  readonly cards?: readonly {
    readonly instanceId?: string
    readonly cardVersionId?: string
    readonly source?: 'club' | 'sbc-storage' | 'visible'
    readonly locked?: boolean
    readonly tradeable?: boolean
    readonly reserveValue?: number
    readonly rating?: number
    readonly [key: string]: unknown
  }[]
}): SbcInventorySnapshot
