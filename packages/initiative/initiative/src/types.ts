import type { z } from 'zod'
import type { candidateSchema, candidateActorSchema, initiativeCommandSchema, initiativeQuerySchema, initiativeReceiptSchema } from './schema.ts'
/** Canonical Candidate record retained by its durable owner. */
export type InitiativeCandidate = z.infer<typeof candidateSchema>
/** Host-derived proposer or investigation actor with exact Session evidence. */
export type CandidateActor = z.infer<typeof candidateActorSchema>
/** Candidate mutation; input supplies no actor, permission or Workspace identity. */
export type InitiativeCommand = z.infer<typeof initiativeCommandSchema>
/** Bounded Candidate query with optional exact revision selection. */
export type InitiativeQuery = z.infer<typeof initiativeQuerySchema>
/** Original committed mutation result, replayed by payload-bound idempotency key. */
export type InitiativeReceipt = z.infer<typeof initiativeReceiptSchema>
/** Host invocation context; command evidence must match the active Commands-owned event. */
export interface InitiativeInvocation { readonly commandId?: string }
/** Candidate metadata projection; complete immutable histories remain with the durable owner. */
export type CandidateSummary = Omit<InitiativeCandidate, 'revisions' | 'investigations' | 'dispositions'>
/** One bounded exact-revision view, explicitly distinct from the full durable Candidate schema. */
export interface InitiativeView {
  candidate: CandidateSummary
  revision: InitiativeCandidate['revisions'][number]
  revisionCount: number
  investigations: InitiativeCandidate['investigations']
  latestDisposition?: InitiativeCandidate['dispositions'][number]
  drift: boolean
  rir: { availability: 'unavailable'; assessments: never[] }
}
/** Detached filtered Candidate page; nextOffset is null at the final page. */
export interface InitiativePage { entries: InitiativeView[]; total: number; nextOffset: number | null }
