/** Public project-memory data and operation types. @module @changanhua/dsh-memory/types */
import type { z } from 'zod'
import type {
  memoryDecisionSchema, memoryKindSchema, memoryMutationSchema, memoryProposalSchema,
  memoryReceiptSchema, memoryRecordSchema, memoryRevisionSchema, memorySourceInputSchema, memorySourceSchema,
} from './schema.ts'

/** A supported reusable claim category. */
export type MemoryKind = z.infer<typeof memoryKindSchema>
/** A source locator before the provider has observed its content. */
export type MemorySourceInput = z.infer<typeof memorySourceInputSchema>
/** A locator bound to provider-observed content. */
export type MemorySource = z.infer<typeof memorySourceSchema>
/** Validated candidate admission input. */
export type MemoryProposal = z.infer<typeof memoryProposalSchema>
/** Immutable claim text and provenance. */
export type MemoryRevision = z.infer<typeof memoryRevisionSchema>
/** An exact human decision, separate from source validity. */
export type MemoryDecision = z.infer<typeof memoryDecisionSchema>
/** Stable mutation response retained across retries. */
export type MemoryMutation = z.infer<typeof memoryMutationSchema>
/** Atomically recorded mutation identity and response. */
export type MemoryReceipt = z.infer<typeof memoryReceiptSchema>
/** The authoritative atomic record for one memory. */
export type MemoryRecord = z.infer<typeof memoryRecordSchema>

/** Recomputed availability of an accepted memory. */
export type MemoryEligibility = 'usable' | 'source-changed' | 'source-unavailable' | 'review-due' | 'conflicted' | 'withdrawn'

/** One checked source; its preview is bounded and treated as quoted material. */
export interface MemorySourceObservation {
  readonly source: MemorySource
  readonly status: 'current' | 'changed' | 'unavailable' | 'not-checked'
  readonly preview?: string
}

/** A read never includes an unusable claim body in the model-facing result. */
export interface MemoryReadResult {
  readonly id: string
  readonly recordVersion: number
  readonly revision: number | null
  readonly eligibility: MemoryEligibility
  readonly checkedAt: string
  readonly reviewAfter?: string
  readonly sources: readonly MemorySourceObservation[]
  readonly memory?: MemoryRevision
}

/** Project-local lexical query with a caller-requested result cap. */
export interface MemorySearchRequest {
  readonly query: string
  readonly tags?: readonly string[]
  readonly limit?: number
}

/** Usable hits and counts of withheld claims; foreign projects contribute neither. */
export interface MemorySearchResult {
  readonly items: readonly MemoryReadResult[]
  readonly excluded: Readonly<Partial<Record<MemoryEligibility, number>>>
}

/** A decision identifies both content revision and the observed record fence. */
export interface MemoryDecisionRequest {
  readonly id: string
  readonly revision: number
  readonly expectedVersion: number
  readonly action: MemoryDecision['action']
  readonly commandId: string
  readonly reviewAfter?: string
}

/** Only a current human command may inspect candidates and full history. */
export interface MemoryInspectionRequest {
  readonly commandId: string
  readonly id?: string
  /** Optional historical revision selected by a human show command. */
  readonly revision?: number
}

/** Human-only record inspection with checks for the displayed content versions. */
export type MemoryInspectedRecord = MemoryRecord & {
  readonly sourceChecks: ReadonlyArray<{
    readonly revision: number
    readonly checkedAt: string
    readonly observations: readonly MemorySourceObservation[]
  }>
}

/** Provider-independent failure classification. */
export type MemoryErrorCode =
  | 'invalid-input' | 'workspace-unavailable' | 'not-found' | 'unauthorized'
  | 'source-changed' | 'source-unavailable' | 'version-conflict' | 'idempotency-conflict'
  | 'candidate-pending' | 'invalid-transition' | 'capacity-exceeded' | 'concurrent-change'
  | 'closed' | 'ownership-unavailable'
