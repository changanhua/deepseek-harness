export type SbcTransactionStatus = 'confirmed' | 'not-acquired' | 'completed' | 'rejected' | 'unknown' | 'blocked'

export type SbcTransactionReadback = {
  readonly schemaVersion: 1
  readonly kind: 'fc-sbc-transaction-readback'
  readonly status: 'observed' | 'unknown' | 'blocked'
  readonly issues: readonly {
    readonly code: string
    readonly detail: string
  }[]
  readonly summary: {
    readonly purchase: 'confirmed' | 'not-acquired' | 'unknown' | 'blocked' | 'not-run'
    readonly submission: 'completed' | 'rejected' | 'unknown' | 'blocked' | 'not-run'
    readonly issueCount: number
  }
  readonly purchase: {
    readonly status: 'confirmed' | 'not-acquired' | 'unknown' | 'blocked'
    readonly requestId: string
    readonly planPurchaseId: string
    readonly cardVersionId: string
    readonly actualPrice: number
    readonly maxPrice: number
    readonly balanceDelta: number | null
    readonly observedAt: string
  } | null
  readonly submission: {
    readonly status: 'completed' | 'rejected' | 'unknown' | 'blocked'
    readonly requestId: string
    readonly challengeId: string
    readonly cardPoolDelta: number | null
    readonly observedAt: string
  } | null
  readonly sideEffects: {
    readonly browserWrites: false
    readonly purchases: false
    readonly submits: false
  }
}

export function createSbcTransactionReadback(input?: {
  readonly purchase?: {
    readonly requestId?: string
    readonly planPurchaseId?: string
    readonly cardVersionId?: string
    readonly maxPrice?: number
    readonly observedAt?: string
    readonly acquiredCards?: readonly {
      readonly instanceId?: string
      readonly cardVersionId?: string
      readonly actualPrice?: number
      readonly [key: string]: unknown
    }[]
    readonly balanceBefore?: number
    readonly balanceAfter?: number
    readonly pageStatus?: 'not-acquired' | 'unknown'
  }
  readonly submission?: {
    readonly requestId?: string
    readonly challengeId?: string
    readonly completedBefore?: boolean
    readonly completedAfter?: boolean
    readonly cardCountBefore?: number
    readonly cardCountAfter?: number
    readonly observedAt?: string
    readonly pageStatus?: 'rejected' | 'unknown'
  }
}): SbcTransactionReadback
