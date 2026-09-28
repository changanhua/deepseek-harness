import type { SbcPlanInput } from './fc-sbc-core.js'

export type SbcPuzzleConstraint = {
  readonly type: 'attribute-count' | 'distinct-count' | 'same-count' | 'quality-count' | 'minimum-quality' | 'card-rating' | 'squad-rating' | 'chemistry' | string
  readonly attribute?: 'nationId' | 'leagueId' | 'clubId'
  readonly field?: 'nationId' | 'leagueId' | 'clubId'
  readonly values?: readonly string[]
  readonly quality?: 'bronze' | 'silver' | 'gold'
  readonly minimum?: number
  readonly maximum?: number
  readonly exact?: number
  readonly count?: number
  readonly model?: 'average-rounded' | 'average-floor' | 'verified-evaluator' | string
}

export type SbcPuzzleRequirements = {
  readonly status?: 'complete' | 'partial' | 'unknown'
  readonly slotCount?: number
  readonly constraints?: readonly SbcPuzzleConstraint[]
}

export type SbcPuzzleCard = {
  readonly instanceId: string
  readonly cardVersionId: string
  readonly source?: string
  readonly locked?: boolean
  readonly reserveValue?: number
  readonly rating?: number | null
  readonly quality?: 'bronze' | 'silver' | 'gold' | string | null
  readonly nationId?: string | null
  readonly leagueId?: string | null
  readonly clubId?: string | null
  readonly position?: string | null
}

export type SbcPuzzleIssue = { readonly code: string; readonly detail: string; readonly challengeId?: string }
export type SbcPuzzleRuleCompilation = {
  readonly kind: 'fc-sbc-puzzle-rules'
  readonly status: 'ready' | 'blocked'
  readonly slotCount: number
  readonly rules: readonly Record<string, unknown>[]
  readonly issues: readonly SbcPuzzleIssue[]
}
export type SbcPuzzleCandidates = {
  readonly kind: 'fc-sbc-puzzle-candidates'
  readonly status: 'ready' | 'blocked'
  readonly candidates: readonly { readonly candidateId: string; readonly cards: readonly { readonly instanceId: string }[] }[]
  /** Diagnostic only. Candidates here have not passed every SBC rule and cannot enter a plan. */
  readonly provisional: {
    readonly status: 'provisional'
    readonly reasonCodes: readonly string[]
    readonly candidates: readonly { readonly candidateId: string; readonly cards: readonly { readonly instanceId: string }[] }[]
  } | null
  readonly issues: readonly SbcPuzzleIssue[]
  readonly summary: { readonly searched: number; readonly eligibleCardCount: number; readonly poolCardCount: number; readonly poolComplete: boolean; readonly poolStrategy: 'round-robin-attribute-buckets'; readonly inventoryCoverage: string; readonly searchComplete: boolean; readonly searchIncompleteReasons: readonly string[] }
}

export function compileSbcPuzzleRequirements(requirements?: SbcPuzzleRequirements): SbcPuzzleRuleCompilation
export function generateSbcPuzzleCandidates(input: {
  readonly coverage?: 'complete' | 'partial' | 'visible-only' | 'unread'
  readonly requirements?: SbcPuzzleRequirements
  readonly cards?: readonly SbcPuzzleCard[]
  /** Must use a FC27-compatible, externally verified team chemistry calculation. */
  readonly evaluateChemistry?: (cards: readonly SbcPuzzleCard[]) => number
  /** Must use FC27's native squad rating calculation when model is verified-evaluator. */
  readonly evaluateSquadRating?: (cards: readonly SbcPuzzleCard[]) => number
  readonly candidateLimit?: number
  readonly searchLimit?: number
}): SbcPuzzleCandidates

export type SbcPuzzlePlanInputResult = {
  readonly kind: 'fc-sbc-puzzle-plan-input'
  readonly status: 'ready' | 'blocked'
  readonly issues: readonly SbcPuzzleIssue[]
  readonly planInput: SbcPlanInput | null
  /** UI-safe provisional diagnostic: intentionally excludes candidate card identities. */
  readonly provisionalByChallenge: readonly {
    readonly challengeId: string
    readonly candidateCount: number
    readonly reasonCodes: readonly string[]
  }[]
  readonly summary: {
    readonly challengeCount: number
    readonly completedChallengeCount: number
    readonly pendingChallengeCount: number
    readonly readyChallengeCount: number
    readonly inventoryCoverage: string
    readonly searchComplete: boolean
    readonly searchIncompleteChallenges: readonly {
      readonly challengeId: string
      readonly reasonCodes: readonly string[]
    }[]
    readonly variantCount?: number
  }
}

export function createSbcPuzzlePlanInput(input: {
  readonly fcYear: string
  readonly platform: string
  readonly groupId: string
  readonly read?: {
    readonly inventory?: { readonly coverage?: string; readonly cards?: readonly SbcPuzzleCard[] }
    readonly group?: { readonly sets?: readonly { readonly challenges?: readonly {
      readonly challengeId?: string
      readonly completed?: boolean
      readonly slotCount?: number
      readonly requirements?: SbcPuzzleRequirements
    }[] }[] }
  }
  readonly challenges?: readonly {
    readonly challengeId?: string
    readonly completed?: boolean
    readonly slotCount?: number
    readonly requirements?: SbcPuzzleRequirements
  }[]
  readonly quotes?: SbcPlanInput['quotes']
  readonly totalBudget?: number
  readonly variantLimit?: number
  readonly candidateLimit?: number
  readonly searchLimit?: number
  readonly evaluateChemistry?: (cards: readonly SbcPuzzleCard[], challengeId: string) => number
  readonly evaluateSquadRating?: (cards: readonly SbcPuzzleCard[], challengeId: string) => number
}): SbcPuzzlePlanInputResult
