import type { SbcExecutionDryRun } from './fc-sbc-execution-dry-run.js'
import type { SbcPlan } from './fc-sbc-core.js'
import type { SbcReadinessReport } from './fc-sbc-readiness.js'
import type { SbcRiskPreflight } from './fc-sbc-risk-preflight.js'

export type SbcApprovalPreviewIdentity = {
  readonly sessionId: string
  readonly installationId: string
  readonly grantEpoch: number | null
  readonly tabId: number | null
  readonly frameId: number | null
  readonly documentId: string
  readonly clubId: string
  readonly pageCapturedAt: string
  readonly inventoryCapturedAt: string
}

export type SbcApprovalPreview = {
  readonly schemaVersion: 1
  readonly kind: 'fc-sbc-approval-preview'
  readonly status: 'ready' | 'blocked'
  readonly reviewDigest: string
  readonly identity: SbcApprovalPreviewIdentity
  readonly notice: string
  readonly issues: readonly {
    readonly code: string
    readonly detail: string
  }[]
  readonly approvalWindow: {
    readonly approvedAt: number
    readonly startBy: number
    readonly expiresAt: number
    readonly startWithinMs: number
    readonly expiresInMs: number
  }
  readonly requiredBindings: {
    readonly session: true
    readonly installation: true
    readonly tab: true
    readonly club: true
  }
  readonly scope: {
    readonly planId: string
    readonly groupId: string
    readonly platform: string
    readonly purchaseScope: readonly {
      readonly challengeId: string
      readonly planPurchaseId: string
      readonly cardVersionId: string
      readonly maxPrice: number
    }[]
    readonly submitChallengeIds: readonly string[]
  }
  readonly summary: {
    readonly planId: string
    readonly groupId: string
    readonly platform: string
    readonly purchaseCount: number
    readonly submitCount: number
    readonly maxSpend: number
    readonly reservedIfStarted: number
    readonly plannedSearches: number
    readonly riskStatus: string
    readonly readinessStatus: string
    readonly executionStatus: string
  }
  readonly sideEffects: {
    readonly browserWrites: false
    readonly purchases: false
    readonly squadFill: false
    readonly submits: false
  }
}

export function createSbcApprovalPreview(input?: {
  readonly readiness?: Pick<SbcReadinessReport, 'status' | 'canApproveExecution' | 'blockers' | 'variants' | 'executionDryRun' | 'riskPreflight'>
  readonly plan?: SbcPlan
  readonly executionDryRun?: SbcExecutionDryRun
  readonly riskPreflight?: SbcRiskPreflight
  readonly now?: number
  readonly startWithinMs?: number
  readonly expiresInMs?: number
  readonly submitChallengeIds?: readonly string[]
  readonly identity?: Partial<SbcApprovalPreviewIdentity>
  readonly sessionId?: string
  readonly installationId?: string
  readonly grantEpoch?: number
  readonly tabId?: number
  readonly frameId?: number
  readonly documentId?: string
  readonly clubId?: string
  readonly pageCapturedAt?: string
  readonly inventoryCapturedAt?: string
}): SbcApprovalPreview
