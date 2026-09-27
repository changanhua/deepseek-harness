export type FcSbcPageProbe = {
  readonly url: string
  readonly title: string
  readonly capturedAt: string
  readonly supported: boolean
  readonly loginRequired: boolean
  readonly view: {
    readonly kind: 'sbc-list' | 'sbc-group' | 'club' | 'sbc-storage' | 'unknown'
    readonly selectedChallenge: { readonly title: string; readonly visibleIndex: number } | null
  }
  readonly taskType: 'puzzle' | 'item-score' | 'unknown'
  readonly marketAccess: {
    readonly status: 'visible' | 'blocked' | 'unknown'
    readonly evidence: readonly string[]
  }
  readonly challengeSet: {
    readonly title: string | null
    readonly visibleChallengeCount: number
    readonly challenges: readonly {
      readonly challengeId: string
      readonly title: string
      readonly completed: boolean
      readonly requirementLines: readonly string[]
      readonly rewardLines: readonly string[]
      readonly textSample: string
    }[]
  }
  readonly inventory: {
    readonly coverage: 'visible-only' | 'unread' | 'complete'
    readonly sbcStorageVisible: boolean
    readonly visibleCards: readonly {
      readonly visibleId: string
      readonly instanceId: string | null
      readonly rating: number | null
      readonly locked: boolean
      readonly textSample: string
    }[]
  }
  readonly warnings: readonly string[]
}

export function probeFcSbcPage(input?: {
  readonly href?: string
  readonly title?: string
  readonly capturedAt?: string
}): FcSbcPageProbe
