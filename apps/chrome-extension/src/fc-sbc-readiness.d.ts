import type { SbcPlan, SbcPlanInput } from './fc-sbc-core.js'
import type { SbcApprovalPreview, SbcApprovalPreviewIdentity } from './fc-sbc-approval-preview.js'
import type { SbcExecutionDryRun } from './fc-sbc-execution-dry-run.js'
import type { SbcFieldAudit } from './fc-sbc-field-audit.js'
import type { SbcInventorySnapshot } from './fc-sbc-inventory-snapshot.js'
import type { SbcQuotePreflight } from './fc-sbc-quote-preflight.js'
import type { SbcRiskPreflight } from './fc-sbc-risk-preflight.js'
import type { SbcTransactionReadback } from './fc-sbc-transaction-readback.js'
import type { FcSbcPageProbe } from './fc-sbc-page-probe.js'

export type SbcReadinessIssue = {
  readonly code: string
  readonly source: 'page' | 'task' | 'inventory' | 'solver' | 'market' | 'quote' | 'execution' | 'risk'
}

export type SbcReadinessReport = {
  readonly status: 'ready-for-approval' | 'draft-only' | 'blocked'
  readonly canApproveExecution: boolean
  readonly nextAction: string
  readonly blockers: readonly SbcReadinessIssue[]
  readonly deferred: readonly SbcReadinessIssue[]
  readonly warnings: readonly string[]
  readonly fieldAudit: SbcFieldAudit
  readonly quotePreflight: SbcQuotePreflight | null
  readonly executionDryRun: SbcExecutionDryRun | null
  readonly riskPreflight: SbcRiskPreflight | null
  readonly approvalPreview: SbcApprovalPreview | null
  readonly variants: readonly SbcPlan[]
  readonly summary: {
    readonly taskType: 'puzzle' | 'item-score' | 'unknown'
    readonly marketAccess: 'visible' | 'blocked' | 'unknown'
    readonly inventoryCoverage: 'visible-only' | 'unread' | 'partial' | 'complete'
    readonly visibleChallengeCount: number
    readonly variantCount: number
    readonly purchaseRange: { readonly min: number; readonly max: number } | null
    readonly maxSpendRange: { readonly min: number; readonly max: number } | null
    readonly planError: string | null
    readonly inventorySnapshot: SbcInventorySnapshot['summary'] | null
    readonly transactionReadback: {
      readonly purchase: string
      readonly submission: string
      readonly issues: readonly string[]
    } | null
    readonly riskExposure: {
      readonly status: string
      readonly plannedSearches: number
      readonly purchaseCount: number
      readonly submitCount: number
      readonly issueCount: number
    } | null
    readonly approvalPreview: {
      readonly status: string
      readonly reviewDigest: string
      readonly maxSpend: number
      readonly reservedIfStarted: number
      readonly purchaseCount: number
      readonly submitCount: number
      readonly issueCount: number
    } | null
    readonly fieldCoverage: SbcFieldAudit['summary']
    readonly quoteCoverage: SbcQuotePreflight['summary'] | null
  }
}

export function createSbcReadinessReport(input?: {
  readonly probe?: FcSbcPageProbe
  readonly inventorySnapshot?: SbcInventorySnapshot
  readonly transactionReadback?: SbcTransactionReadback
  readonly planInput?: SbcPlanInput
  readonly purchaseRequired?: boolean
  readonly maxQuoteAgeMs?: number
  readonly maxMarketSearches?: number
  readonly maxSearchesPerPurchase?: number
  readonly maxPurchases?: number
  readonly maxSubmits?: number
  readonly maxTotalSearches?: number
  readonly now?: number
  readonly startWithinMs?: number
  readonly expiresInMs?: number
  readonly submitChallengeIds?: readonly string[]
  readonly identity?: Partial<SbcApprovalPreviewIdentity>
}): SbcReadinessReport
