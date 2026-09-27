export type SbcCandidatePart =
  | { readonly instanceId: string; readonly opportunityCost?: number }
  | { readonly cardVersionId: string; readonly planPurchaseId?: string; readonly maxPrice?: number }

export type SbcCandidateSquad = {
  readonly candidateId?: string
  readonly cards: readonly SbcCandidatePart[]
  readonly score?: number
}

export type SbcChallengeInput = {
  readonly challengeId: string
  readonly slotCount: number
  readonly candidates: readonly SbcCandidateSquad[]
}

export type SbcInventoryCard = {
  readonly instanceId: string
  readonly cardVersionId: string
  readonly reserveValue?: number
  readonly locked?: boolean
  readonly [key: string]: unknown
}

export type SbcQuote = {
  readonly platform: string
  readonly cardVersionId: string
  readonly price: number
  readonly source?: string
  readonly observedAt: number
  readonly validUntil: number
}

export type SbcPlanInput = {
  readonly now?: number
  readonly fcYear: string
  readonly platform: string
  readonly groupId: string
  readonly inventory: readonly SbcInventoryCard[]
  readonly quotes: readonly SbcQuote[]
  readonly challenges: readonly SbcChallengeInput[]
  readonly lockedCardIds?: readonly string[]
  readonly totalBudget?: number
  readonly variantLimit?: number
}

export type SbcPlanCard =
  | { readonly kind: 'owned'; readonly instanceId: string; readonly cardVersionId: string; readonly reserveValue: number; readonly opportunityCost: number }
  | { readonly kind: 'purchase'; readonly cardVersionId: string; readonly planPurchaseId: string; readonly maxPrice: number; readonly quote: SbcQuote }

export type SbcPlanChallenge = {
  readonly challengeId: string
  readonly candidateId: string
  readonly cards: readonly SbcPlanCard[]
  readonly purchaseCount: number
  readonly maxSpend: number
  readonly opportunityCost: number
  readonly score: number
}

export type SbcPlan = {
  readonly fcYear: string
  readonly platform: string
  readonly groupId: string
  readonly planId: string
  readonly challenges: readonly SbcPlanChallenge[]
  readonly purchaseCount: number
  readonly maxSpend: number
  readonly opportunityCost: number
}

export type PlanApproval = {
  readonly approvalId: string
  readonly planId: string
  readonly groupId: string
  readonly platform: string
  readonly approvedAt: number
  readonly startBy: number
  readonly expiresAt: number
  readonly sessionId: string
  readonly installationId: string
  readonly tabId: number
  readonly clubId: string
  readonly maxSpend: number
  readonly submitChallengeIds: readonly string[]
  readonly purchaseScope: readonly {
    readonly challengeId: string
    readonly planPurchaseId: string
    readonly cardVersionId: string
    readonly maxPrice: number
  }[]
}

export type ApprovalScope = {
  readonly sessionId: string
  readonly installationId: string
  readonly tabId: number
  readonly clubId: string
}

export type ActionLedger = {
  readonly approvalId: string
  readonly maxSpend: number
  readonly purchases: readonly {
    readonly requestId: string
    readonly planPurchaseId: string
    readonly cardVersionId: string
    readonly reservedPrice: number
    readonly actualPrice: number
    readonly status: 'reserved' | 'confirmed' | 'unknown' | 'not-acquired' | 'failed'
  }[]
  readonly submits: readonly {
    readonly requestId: string
    readonly challengeId: string
    readonly status: 'sent' | 'completed' | 'rejected' | 'unknown'
    readonly pageVerified: boolean
  }[]
}

export function buildSbcPlanVariants(input: SbcPlanInput): SbcPlan[]
export function createPlanApproval(plan: SbcPlan, input: {
  readonly approvalId?: string
  readonly approvedAt?: number
  readonly startBy?: number
  readonly expiresAt?: number
  readonly sessionId: string
  readonly installationId: string
  readonly tabId: number
  readonly clubId: string
  readonly submitChallengeIds?: readonly string[]
}): PlanApproval
export function assertApprovalCanRun(approval: PlanApproval, scope: ApprovalScope, now?: number, phase?: 'start' | 'run'): true
export function createActionLedger(approval: Pick<PlanApproval, 'approvalId' | 'maxSpend' | 'purchaseScope'>): ActionLedger
export function reservePurchase(ledger: ActionLedger, approval: Pick<PlanApproval, 'purchaseScope'>, input: {
  readonly requestId: string
  readonly planPurchaseId: string
  readonly cardVersionId: string
  readonly maxPrice?: number
}): ActionLedger
export function settlePurchase(ledger: ActionLedger, requestId: string, result: {
  readonly status: 'confirmed'
  readonly actualPrice: number
} | { readonly status: 'unknown' | 'not-acquired' | 'failed' }): ActionLedger
export function recordSubmitRequest(ledger: ActionLedger, approval: Pick<PlanApproval, 'submitChallengeIds'>, input: {
  readonly requestId: string
  readonly challengeId: string
}): ActionLedger
export function settleSubmitRequest(ledger: ActionLedger, requestId: string, result: {
  readonly status: 'observed' | 'page-completed' | 'rejected'
}): ActionLedger
export function ledgerBalance(ledger: ActionLedger): { readonly paid: number; readonly reserved: number }
