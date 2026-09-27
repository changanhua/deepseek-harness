import type { SbcCombReport } from './fc-sbc-comb-report.js'
import type { SbcExecutionDryRun } from './fc-sbc-execution-dry-run.js'
import type { SbcApprovalPreview } from './fc-sbc-approval-preview.js'
import type { FcSbcPageProbe } from './fc-sbc-page-probe.js'
import type { FcSbcPageModel } from './fc-sbc-page-model.js'
import type { SbcInventorySnapshot } from './fc-sbc-inventory-snapshot.js'
import type { SbcReadinessReport } from './fc-sbc-readiness.js'
import type { SbcRiskPreflight } from './fc-sbc-risk-preflight.js'
import type { SbcTransactionReadback } from './fc-sbc-transaction-readback.js'

export type SbcRedactedSample = {
  readonly schemaVersion: 1
  readonly kind: 'fc-sbc-redacted-sample'
  readonly generatedAt: string
  readonly notice: string
  readonly source: SbcCombReport['source']
  readonly readiness: {
    readonly status: string
    readonly nextAction: string
    readonly canApproveExecution: boolean
    readonly blockers: readonly string[]
    readonly deferred: readonly string[]
    readonly warnings: readonly string[]
  }
  readonly probeSummary: {
    readonly supported: boolean
    readonly taskType: string
    readonly marketAccess: string
    readonly marketEvidence: readonly string[]
    readonly inventoryCoverage: string
    readonly visibleChallengeCount: number
    readonly visibleCardCount: number
    readonly sbcStorageVisible: boolean
  }
  readonly pageModel: {
    readonly view: string
    readonly observedAt: string
    readonly group: {
      readonly title: string
      readonly coverage: string
      readonly visibleChallengeCount: number
      readonly observedDetailCount: number
      readonly emittedChallengeCount: number
    } | null
    readonly inventory: {
      readonly coverage: string
      readonly visibleCardCount: number
      readonly sbcStorageVisible: boolean
      readonly observedAt: string | null
    } | null
  } | null
  readonly fieldAudit: {
    readonly status: string
    readonly summary: {
      readonly covered: number
      readonly partial: number
      readonly missing: number
    }
    readonly gaps: readonly {
      readonly area: string
      readonly code: string
      readonly status: string
      readonly detail: string
      readonly evidence: readonly string[]
    }[]
  }
  readonly quotePreflight: {
    readonly status: string
    readonly issues: readonly {
      readonly code: string
      readonly detail: string
    }[]
    readonly summary: NonNullable<SbcCombReport['summary']['quoteCoverage']>
  } | null
  readonly inventorySnapshot: SbcInventorySnapshot['summary'] | null
  readonly transactionReadback: {
    readonly purchase: string
    readonly submission: string
    readonly issues: readonly string[]
  } | null
  readonly riskPreflight: Pick<SbcRiskPreflight, 'status' | 'disclaimer' | 'issues' | 'summary' | 'sideEffects'> | {
    readonly status: string
    readonly disclaimer: string
    readonly issues: readonly []
    readonly summary: NonNullable<SbcReadinessReport['summary']['riskExposure']>
    readonly sideEffects: { readonly browserWrites: false; readonly purchases: false; readonly submits: false }
  } | null
  readonly approvalPreview: Pick<SbcApprovalPreview, 'status' | 'reviewDigest' | 'identity' | 'notice' | 'issues' | 'approvalWindow' | 'requiredBindings' | 'scope' | 'summary' | 'sideEffects'> | null
  readonly executionDryRun: Pick<SbcExecutionDryRun, 'status' | 'issues' | 'summary' | 'purchaseQueue' | 'submitQueue' | 'sideEffects'> | null
  readonly inventorySample: {
    readonly coverage: string
    readonly visibleCardCount: number
    readonly lockedVisibleCount: number
    readonly ratingBands: Readonly<Record<string, number>>
  }
  readonly challenges: SbcCombReport['challenges']
  readonly privacy: {
    readonly urlQueryRemoved: boolean
    readonly rawDomTextIncluded: boolean
    readonly cardTextSamplesIncluded: boolean
    readonly cardInstanceIdsIncluded: boolean
    readonly credentialsIncluded: boolean
  }
}

export function createSbcRedactedSample(input?: {
  readonly page?: { readonly url?: string; readonly title?: string; readonly documentId?: string }
  readonly probe?: FcSbcPageProbe
  readonly pageModel?: FcSbcPageModel
  readonly readiness?: SbcReadinessReport
  readonly report?: SbcReadinessReport
  readonly comb?: SbcCombReport
  readonly inventorySnapshot?: SbcInventorySnapshot
  readonly transactionReadback?: SbcTransactionReadback
  readonly executionDryRun?: SbcExecutionDryRun
  readonly generatedAt?: string
}): SbcRedactedSample
export function formatSbcRedactedSample(sample: SbcRedactedSample): string
