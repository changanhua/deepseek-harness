import type { FcSbcPageProbe } from './fc-sbc-page-probe.js'
import type { SbcInventorySnapshot } from './fc-sbc-inventory-snapshot.js'
import type { SbcTransactionReadback } from './fc-sbc-transaction-readback.js'

export type SbcFieldAuditStatus = 'covered' | 'partial' | 'missing'
export type SbcFieldAuditArea = 'page' | 'task' | 'market' | 'inventory' | 'readback'

export type SbcFieldAuditItem = {
  readonly area: SbcFieldAuditArea
  readonly code: string
  readonly status: SbcFieldAuditStatus
  readonly detail: string
  readonly evidence: readonly string[]
}

export type SbcFieldAudit = {
  readonly schemaVersion: 1
  readonly kind: 'fc-sbc-field-audit'
  readonly status: 'covered' | 'partial' | 'needs-samples'
  readonly summary: {
    readonly covered: number
    readonly partial: number
    readonly missing: number
  }
  readonly fields: readonly SbcFieldAuditItem[]
  readonly gaps: readonly SbcFieldAuditItem[]
}

export function createSbcFieldAudit(input?: {
  readonly probe?: FcSbcPageProbe
  readonly inventorySnapshot?: SbcInventorySnapshot
  readonly transactionReadback?: SbcTransactionReadback | {
    readonly purchase?: boolean
    readonly submission?: boolean
  }
} | FcSbcPageProbe): SbcFieldAudit
