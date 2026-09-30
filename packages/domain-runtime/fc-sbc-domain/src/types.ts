import type { z } from 'zod'
import type { DomainArtifactHeader, DomainArtifactRef } from '@changanhua/dsh-domain-runtime'
import type { buildPlanSchema, captureRealitySchema, cardSchema, challengeSchema } from './schema.ts'
/** Supplied sanitized read/probe observations
    no browser capability is accepted. */
export type CaptureFcReality = z.input<typeof captureRealitySchema>
/** Exact Reality and bounded deterministic solver options. */
export type BuildFcPlan = z.input<typeof buildPlanSchema>
/** Existing main-read card representation, not a second card ontology. */
export type FcCardObservation = z.infer<typeof cardSchema>
/** Existing main-read challenge representation. */
export type FcChallengeObservation = z.infer<typeof challengeSchema>
/** Persisted FC observation compiled only from declared evidence. */
export interface FcSbcRealitySnapshot {
  readonly schemaVersion: 1
  readonly pageIdentity: { readonly installationId?: string
    readonly tabId: number
    readonly frameId: number
    readonly documentId: string
    readonly url: string
    readonly clubId?: string
    readonly platform?: string }
  readonly group: { readonly id?: string
    readonly title: string
    readonly taskType: 'puzzle' | 'item-score' | 'unknown'
    readonly coverage: 'partial' | 'unknown'
    readonly challenges: readonly FcChallengeObservation[] }
  readonly inventory: { readonly status: 'complete' | 'partial' | 'unknown'
    readonly coverage: string
    readonly cards: readonly FcCardObservation[]
    readonly summary: InventorySnapshot['summary'] }
  readonly marketAccess: { readonly status: 'visible' | 'blocked' | 'unknown'
    readonly observedAt?: string }
  readonly pageModel: unknown
  readonly capturedAt: string
}
/** Shared inventory helper result, retaining its own existing summary names. */
export interface InventorySnapshot {
  status: 'complete' | 'partial' | 'invalid'
  summary: { coverage: string
    cardCount: number
    clubCount: number
    sbcStorageCount: number
    visibleCount: number
    lockedCount: number
    tradeableCount: number
    duplicateInstanceCount: number
    invalidRowCount: number
    uniqueCardVersionCount: number }
  cards: Array<{ instanceId: string
    cardVersionId: string
    source: string
    locked: boolean
    tradeable: boolean
    reserveValue: number
    rating?: number }>
  issues: Array<{ code: string
    detail?: string }>
}
/** Existing solver result shape at the typed bridge. */
export interface PuzzleCandidates {
  status: 'ready' | 'blocked'
  candidates: Array<{ candidateId: string
    cards: Array<{ instanceId: string }> }>
  provisional: { reasonCodes: string[]
    candidates: PuzzleCandidates['candidates'] } | null
  issues: Array<{ code: string
    detail?: string }>
  summary: { searched: number
    searchComplete: boolean
    searchIncompleteReasons: string[]
    poolComplete: boolean }
}
/** Existing pure cross-challenge plan projection. */
export interface PlanVariant {
  planId: string
  challenges: Array<{ challengeId: string
    candidateId: string
    cards: Array<{ kind: 'owned'
      instanceId: string
      cardVersionId: string
      reserveValue: number
      opportunityCost: number }>
    purchaseCount: number
    maxSpend: number
    opportunityCost: number
    score: number }>
  purchaseCount: number
  maxSpend: number
  opportunityCost: number
}
/** Frozen candidate record
    neither approval nor execution authorization. */
export interface FcSbcPlanArtifact {
  readonly schemaVersion: 1
  readonly realityRef: DomainArtifactRef
  readonly solver: { readonly version: string
    readonly searched: number
    readonly searchComplete: boolean
    readonly incompleteReasons: readonly string[] }
  readonly candidates: readonly { readonly id: string
    readonly challengePlans: PlanVariant['challenges']
    readonly purchaseCount: number
    readonly maxSpend: number
    readonly provisional: boolean
    readonly issues: readonly string[] }[]
  readonly challengeCandidates: readonly { readonly challengeId: string
    readonly candidates: PuzzleCandidates['candidates']
    readonly provisional: boolean
    readonly issues: readonly string[] }[]
  readonly quoteStatus: { readonly status: 'missing'
    readonly quoteRefs: readonly DomainArtifactRef[] }
  readonly readiness: { readonly status: 'candidate' | 'blocked'
    readonly blockers: readonly string[] }
}
/** FC owner artifact discriminated by its immutable header kind. */
export interface FcArtifact { readonly header: DomainArtifactHeader
  readonly payload: FcSbcRealitySnapshot | FcSbcPlanArtifact }
/** Compact status, independent from immutable capture-time freshness. */
export interface FcArtifactStatus {
  readonly ref: DomainArtifactRef
  readonly coverage: DomainArtifactHeader['coverage']
  readonly freshness: 'fresh' | 'stale' | 'unknown'
  readonly issueCodes: readonly string[]
  readonly candidateCount?: number
  readonly readiness?: FcSbcPlanArtifact['readiness']
  readonly quoteStatus?: FcSbcPlanArtifact['quoteStatus']
}
