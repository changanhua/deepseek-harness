import type { PlanApproval, SbcPlan } from './fc-sbc-core.js'

export type SbcExecutionDryRun = {
  readonly schemaVersion: 1
  readonly kind: 'fc-sbc-execution-dry-run'
  readonly status: 'ready' | 'blocked' | 'no-purchases'
  readonly issues: readonly {
    readonly code: string
    readonly detail: string
  }[]
  readonly summary: {
    readonly planId: string
    readonly groupId: string
    readonly platform: string
    readonly purchaseCount: number
    readonly submitCount: number
    readonly maxSpend: number
    readonly reservedIfStarted: number
    readonly maxMarketSearches: number
    readonly maxSearchesPerPurchase: number
  }
  readonly purchaseQueue: readonly {
    readonly order: number
    readonly challengeId: string
    readonly planPurchaseId: string
    readonly cardVersionId: string
    readonly maxPrice: number
    readonly maxSearches: number
  }[]
  readonly submitQueue: readonly {
    readonly order: number
    readonly challengeId: string
  }[]
  readonly sideEffects: {
    readonly browserWrites: false
    readonly purchases: false
    readonly squadFill: false
    readonly submits: false
  }
}

export function createSbcExecutionDryRun(input?: {
  readonly plan?: SbcPlan
  readonly approval?: PlanApproval
  readonly maxMarketSearches?: number
  readonly maxSearchesPerPurchase?: number
}): SbcExecutionDryRun
