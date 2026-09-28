import type { FcSbcMainRead } from './fc-sbc-main-read.js'
import type { evaluateFcSbcChemistryMain, FcSbcNativeChemistryInput } from './fc-sbc-native-chemistry.js'
import type { FcSbcPageProbe } from './fc-sbc-page-probe.js'
import type { SbcInventorySnapshot } from './fc-sbc-inventory-snapshot.js'
import type { SbcPuzzleIssue, SbcPuzzlePlanInputResult } from './fc-sbc-puzzle-solver.js'
import type { SbcReadinessReport } from './fc-sbc-readiness.js'

export type FcSbcSliceReport = {
  readonly status: 'ready' | 'partial'
  readonly searchLimited: boolean
  readonly groupSummary: {
    readonly status: 'complete' | 'partial' | 'unknown' | 'unread'
    readonly selectedSetId: string | null
    readonly title: string | null
    readonly challengeCount: number
  }
  readonly inventorySummary: SbcInventorySnapshot['summary']
  readonly puzzle: Pick<SbcPuzzlePlanInputResult, 'status' | 'issues' | 'summary' | 'provisionalByChallenge'>
  readonly report: SbcReadinessReport
  readonly issues: readonly (SbcPuzzleIssue | FcSbcMainRead['issues'][number])[]
}

export type FcSbcVerificationRequest = {
  readonly status: 'ready' | 'blocked'
  readonly searchLimited: boolean
  readonly groups: NonNullable<FcSbcNativeChemistryInput['groups']>
  readonly issues: readonly { readonly code: string; readonly detail?: string; readonly challengeId?: string }[]
}

export function createFcSbcVerificationRequest(input?: {
  readonly probe?: FcSbcPageProbe | null
  readonly main?: FcSbcMainRead | null
}): FcSbcVerificationRequest

export function createFcSbcSliceReport(input?: {
  readonly probe?: FcSbcPageProbe | null
  readonly main?: FcSbcMainRead | null
  readonly verificationRequest?: FcSbcVerificationRequest | null
  readonly verification?: Awaited<ReturnType<typeof evaluateFcSbcChemistryMain>> | null
}): FcSbcSliceReport
