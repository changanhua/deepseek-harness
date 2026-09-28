import type { SbcPlan, SbcPlanInput } from './fc-sbc-core.js'

export type SbcQuotePreflightIssue = {
  readonly code: string
  readonly severity: 'blocker'
  readonly detail: string
}

export type SbcQuotePreflight = {
  readonly schemaVersion: 1
  readonly kind: 'fc-sbc-quote-preflight'
  readonly status: 'ready' | 'blocked' | 'not-needed'
  readonly issues: readonly SbcQuotePreflightIssue[]
  readonly summary: {
    readonly neededCardVersions: number
    readonly freshQuotes: number
    readonly missingQuotes: number
    readonly staleQuotes: number
    readonly invalidQuotes: number
    readonly mismatchedQuotes: number
    readonly maxMarketSearches: number
    readonly purchaseRange: { readonly min: number; readonly max: number } | null
    readonly maxSpendRange: { readonly min: number; readonly max: number } | null
  }
}

export function createSbcQuotePreflight(input?: {
  readonly planInput?: SbcPlanInput
  readonly variants?: readonly SbcPlan[]
  readonly now?: number
  readonly maxQuoteAgeMs?: number
  readonly maxMarketSearches?: number
} | SbcPlanInput): SbcQuotePreflight
