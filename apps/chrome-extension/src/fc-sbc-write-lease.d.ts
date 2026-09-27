import type { SbcApprovalPreview, SbcApprovalPreviewIdentity } from './fc-sbc-approval-preview.js'

export type SbcWriteLeaseIssue = {
  readonly code: string
  readonly detail: string
}

export type SbcWriteLease = {
  readonly schemaVersion: 1
  readonly kind: 'fc-sbc-write-lease'
  readonly status: 'active' | 'blocked' | 'released'
  readonly issues: readonly SbcWriteLeaseIssue[]
  readonly leaseId: string
  readonly reviewDigest: string
  readonly identity: SbcApprovalPreviewIdentity
  readonly acquiredAt: number
  readonly expiresAt: number
  readonly purpose: string
  readonly releasedAt?: number
  readonly releaseReason?: string
  readonly sideEffects: {
    readonly browserWrites: false
    readonly purchases: false
    readonly squadFill: false
    readonly submits: false
  }
}

export type SbcWriteLeaseValidation = {
  readonly schemaVersion: 1
  readonly kind: 'fc-sbc-write-lease-validation'
  readonly status: 'valid' | 'blocked'
  readonly issues: readonly SbcWriteLeaseIssue[]
  readonly sideEffects: SbcWriteLease['sideEffects']
}

export function createSbcWriteLease(input?: {
  readonly approvalPreview?: SbcApprovalPreview
  readonly now?: number
  readonly ttlMs?: number
  readonly purpose?: string
}): SbcWriteLease

export function validateSbcWriteLease(input?: {
  readonly lease?: SbcWriteLease
  readonly expectedReviewDigest?: string
  readonly currentIdentity?: Partial<SbcApprovalPreviewIdentity>
  readonly now?: number
  readonly purpose?: string
}): SbcWriteLeaseValidation

export function releaseSbcWriteLease(input?: {
  readonly lease?: SbcWriteLease
  readonly now?: number
  readonly reason?: string
}): SbcWriteLease
