export type FcSbcPageModel = {
  readonly page: { readonly tabId: number; readonly frameId: number; readonly documentId: string; readonly url: string }
  readonly observedAt: string
  readonly view: { readonly kind: string; readonly selectedChallenge: { readonly title: string; readonly visibleIndex: number } | null }
  readonly group: null | {
    readonly title: string | null
    readonly signature: string
    readonly visibleChallengeCount: number
    readonly observedDetailCount: number
    readonly coverage: 'unread' | 'partial' | 'visible-rows-read'
    readonly challenges: readonly {
      readonly title: string
      readonly visibleIndex: number
      readonly completed: boolean
      readonly requirements: readonly string[] | null
      readonly rewards: readonly string[] | null
      readonly observedAt: string | null
    }[]
  }
  readonly inventory: {
    readonly coverage: 'unread' | 'visible-only'
    readonly visibleCardCount: number
    readonly sbcStorageVisible: boolean
    readonly observedAt: string | null
  }
}

export function updateFcSbcPageModel(previous: FcSbcPageModel | null, input: {
  readonly page: { readonly tabId: number; readonly frameId: number; readonly documentId: string; readonly url: string }
  readonly probe: {
    readonly url: string
    readonly capturedAt: string
    readonly view?: { readonly kind: string; readonly selectedChallenge: { readonly title: string; readonly visibleIndex: number } | null }
    readonly challengeSet?: {
      readonly title: string | null
      readonly challenges: readonly {
        readonly title: string
        readonly completed: boolean
        readonly requirementLines: readonly string[]
        readonly rewardLines: readonly string[]
      }[]
    }
    readonly inventory?: {
      readonly sbcStorageVisible: boolean
      readonly visibleCards: readonly unknown[]
    }
  }
}): FcSbcPageModel
