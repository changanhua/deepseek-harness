export type FcSbcNativeChemistryCandidate = {
  readonly candidateId: string
  readonly instanceIds: readonly string[]
  /** Snapshot used to generate the candidate. Present calls reject any native drift. */
  readonly expectedCards?: readonly {
    readonly instanceId: string
    readonly cardVersionId: string
    readonly rating: number
    readonly nationId: string
    readonly leagueId: string
    readonly clubId: string
    readonly quality: 'bronze' | 'silver' | 'gold' | string
  }[]
}

export type FcSbcNativeChemistryInput = {
  readonly url?: string
  readonly groups?: readonly {
    readonly challengeId: string
    readonly formationName: string
    readonly candidates: readonly FcSbcNativeChemistryCandidate[]
  }[]
  readonly maxGroups?: number
  readonly maxCandidates?: number
  readonly maxUniqueItems?: number
  readonly batchSize?: number
  readonly timeoutMs?: number
}

export type FcSbcNativeChemistryIssue = { readonly code: string; readonly detail: string }
export type FcSbcNativeChemistryResult = {
  readonly challengeId: string
  readonly candidateId: string | null
  readonly status: 'complete' | 'blocked'
  readonly issues: readonly FcSbcNativeChemistryIssue[]
  readonly chemistry?: number
  /** Number of cards placed in a native possible-position; remaining cards are intentionally evaluated off-position. */
  readonly onPositionCount?: number
  /** FC27 11-card squad rating, or null if source ratings or the feature flag are unavailable. */
  readonly squadRating?: number | null
  readonly squadRatingStatus?: 'complete' | 'unknown'
  /** Native 11-slot order, only present after a verified position assignment. */
  readonly instanceIds?: readonly string[]
  readonly slots?: readonly { readonly slot: number; readonly instanceId: string | null; readonly chemistry: number | null }[]
}

export function evaluateFcSbcChemistryMain(input?: FcSbcNativeChemistryInput): Promise<{
  readonly url: string
  readonly status: 'complete' | 'partial' | 'unknown'
  readonly issues: readonly FcSbcNativeChemistryIssue[]
  readonly results: readonly FcSbcNativeChemistryResult[]
}>
