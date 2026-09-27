import type { SbcApprovalPreview, SbcApprovalPreviewIdentity } from './fc-sbc-approval-preview.js'

export type SbcExecutionGateIssue = {
  readonly code: string
  readonly detail: string
}

export type SbcExecutionGateAction = {
  readonly kind: 'read-only'
} | {
  readonly kind: 'purchase'
  readonly planPurchaseId: string
  readonly cardVersionId: string
  readonly maxPrice: number
} | {
  readonly kind: 'fill-squad' | 'submit'
  readonly challengeId: string
}

export type SbcExecutionWriteLease = Pick<SbcApprovalPreviewIdentity,
  'sessionId' | 'installationId' | 'grantEpoch' | 'tabId' | 'frameId' | 'documentId' | 'clubId'> & {
    readonly acquiredAt: number
    readonly expiresAt: number
    readonly purpose?: string
  }

export type SbcExecutionGate = {
  readonly schemaVersion: 1
  readonly kind: 'fc-sbc-execution-gate'
  readonly status: 'ready' | 'blocked'
  readonly issues: readonly SbcExecutionGateIssue[]
  readonly summary: {
    readonly action: string
    readonly reviewDigest: string
    readonly identityStatus: 'matched' | 'mismatch' | 'missing'
    readonly writeLeaseStatus: 'valid' | 'missing' | 'mismatch' | 'expired' | 'released' | 'not-required'
  }
  readonly scope: {
    readonly planId: string
    readonly groupId: string
    readonly platform: string
  }
  readonly sideEffects: {
    readonly browserWrites: false
    readonly purchases: false
    readonly squadFill: false
    readonly submits: false
  }
}

export function createSbcExecutionGate(input?: {
  readonly approvalPreview?: SbcApprovalPreview
  readonly expectedReviewDigest?: string
  readonly currentIdentity?: Partial<SbcApprovalPreviewIdentity>
  readonly writeLease?: Partial<SbcExecutionWriteLease>
  readonly now?: number
  readonly phase?: 'start' | 'run'
  readonly action?: SbcExecutionGateAction
}): SbcExecutionGate
