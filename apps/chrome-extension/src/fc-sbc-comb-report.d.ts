import type { FcSbcPageProbe } from './fc-sbc-page-probe.js'
import type { SbcReadinessReport } from './fc-sbc-readiness.js'

export type SbcCombReport = {
  readonly schemaVersion: 1
  readonly kind: 'fc-sbc-comb-report'
  readonly generatedAt: string
  readonly source: {
    readonly url: string
    readonly title: string
    readonly documentIdKnown: boolean
  }
  readonly summary: {
    readonly status: string
    readonly canApproveExecution: boolean
    readonly nextAction: string
    readonly taskType: string
    readonly marketAccess: string
    readonly inventoryCoverage: string
    readonly visibleChallengeCount: number
    readonly visibleCardCount: number
    readonly variantCount: number
    readonly fieldCoverage?: {
      readonly covered: number
      readonly partial: number
      readonly missing: number
    }
    readonly quoteCoverage?: {
      readonly neededCardVersions: number
      readonly freshQuotes: number
      readonly missingQuotes: number
      readonly staleQuotes: number
      readonly invalidQuotes: number
      readonly mismatchedQuotes: number
      readonly maxMarketSearches: number
      readonly purchaseRange: { readonly min: number; readonly max: number } | null
      readonly maxSpendRange: { readonly min: number; readonly max: number } | null
    } | null
    readonly approvalPreview?: {
      readonly status: string
      readonly reviewDigest?: string
      readonly maxSpend: number
      readonly reservedIfStarted: number
      readonly purchaseCount: number
      readonly submitCount: number
      readonly issueCount: number
    } | null
  }
  readonly blockers: readonly string[]
  readonly deferred: readonly string[]
  readonly fieldGaps: readonly string[]
  readonly warnings: readonly string[]
  readonly marketEvidence: readonly string[]
  readonly inventory: {
    readonly sbcStorageVisible: boolean
    readonly coverage: string
    readonly visibleCardCount: number
  }
  readonly challenges: readonly {
    readonly challengeId: string
    readonly title: string
    readonly completed: boolean
    readonly requirementLines: readonly string[]
    readonly rewardLines: readonly string[]
  }[]
}

export function createSbcCombReport(input?: {
  readonly page?: { readonly url?: string; readonly title?: string; readonly documentId?: string }
  readonly probe?: FcSbcPageProbe
  readonly readiness?: SbcReadinessReport
  readonly report?: SbcReadinessReport
  readonly generatedAt?: string
}): SbcCombReport
export function formatSbcCombReport(report: SbcCombReport): string
