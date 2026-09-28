export type FcSbcRequirementConstraint = {
  readonly type: 'attribute-count' | 'distinct-count' | 'same-count' | 'quality-count' | 'minimum-quality' | 'card-rating' | 'squad-rating' | 'chemistry'
  readonly attribute?: 'nationId' | 'leagueId' | 'clubId'
  readonly values?: readonly string[]
  readonly quality?: string
  readonly model?: string
  readonly minimum?: number
  readonly maximum?: number
  readonly exact?: number
}

export type FcSbcMainRead = {
  readonly schemaVersion: 1
  readonly kind: 'fc-sbc-main-read'
  readonly url: string
  readonly capturedAt: string
  readonly platform: string | null
  readonly status: 'complete' | 'partial' | 'unknown'
  readonly issues: readonly { readonly code: string; readonly detail: string }[]
  readonly group: {
    readonly status: 'complete' | 'partial' | 'unknown'
    readonly selectedSetId?: string | null
    readonly sets: readonly {
      readonly setId: string
      readonly title: string
      readonly challenges: readonly {
        readonly challengeId: string
        readonly title: string
        readonly formationName: string | null
        readonly completed: boolean
        readonly requirements: {
          readonly status: 'complete' | 'partial' | 'unknown'
          readonly slotCount?: number
          readonly constraints: readonly FcSbcRequirementConstraint[]
        }
        readonly rewards: readonly { readonly name: string }[]
      }[]
    }[]
  }
  readonly inventory: {
    readonly coverage: 'complete' | 'partial' | 'unread'
    readonly club: { readonly status: 'complete' | 'partial' | 'unknown'; readonly pageCount: number; readonly retrievedAll: boolean }
    readonly sbcStorage: { readonly status: 'complete' | 'partial' | 'unknown'; readonly pageCount: number; readonly retrievedAll: boolean }
    readonly cards: readonly {
      readonly instanceId: string
      readonly cardVersionId: string
      readonly source: 'club' | 'sbc-storage'
      readonly rating: number | null
      readonly quality: string | null
      readonly nationId: string | null
      readonly leagueId: string | null
      readonly clubId: string | null
      readonly position: string | null
      readonly tradeable: boolean
      readonly locked: boolean
    }[]
  }
}

export function readFcSbcMain(input?: {
  readonly href?: string
  readonly capturedAt?: string
  readonly groupHint?: string
  readonly challengeTitles?: readonly string[]
  readonly maxPages?: number
  readonly maxItems?: number
  readonly pageSize?: number
  readonly readTimeoutMs?: number
}): Promise<FcSbcMainRead>
