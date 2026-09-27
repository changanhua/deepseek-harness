import type { SbcExecutionDryRun } from './fc-sbc-execution-dry-run.js'
import type { SbcTransactionReadback } from './fc-sbc-transaction-readback.js'

export type SbcRiskPreflight = {
  readonly schemaVersion: 1
  readonly kind: 'fc-sbc-risk-preflight'
  readonly status: 'clear' | 'caution' | 'blocked'
  readonly disclaimer: string
  readonly issues: readonly {
    readonly code: string
    readonly detail: string
  }[]
  readonly summary: {
    readonly purchaseCount: number
    readonly submitCount: number
    readonly plannedSearches: number
    readonly maxSearchesPerPurchase: number
    readonly maxPurchases: number
    readonly maxSubmits: number
    readonly maxTotalSearches: number
    readonly marketAccess: string
    readonly unknownTransactionCount: number
  }
  readonly sideEffects: {
    readonly browserWrites: false
    readonly purchases: false
    readonly submits: false
  }
}

export function createSbcRiskPreflight(input?: {
  readonly executionDryRun?: SbcExecutionDryRun
  readonly transactionReadback?: SbcTransactionReadback | Pick<SbcTransactionReadback, 'summary' | 'issues'>
  readonly marketAccess?: string
  readonly maxPurchases?: number
  readonly maxSubmits?: number
  readonly maxTotalSearches?: number
}): SbcRiskPreflight
