import type { z } from 'zod'
import type {
  planningActorSchema,
  planningBoardSchema,
  planningCapturedDraftSchema,
  planningCommandSchema,
  planningDraftSchema,
  planningEstimateSchema,
  planningHandoffSchema,
  planningLaneSchema,
  planningProposalSchema,
  planningRevisionSchema,
  planningSourceInputSchema,
  planningSourceSchema,
} from './schema.ts'
export type PlanningLane = z.infer<typeof planningLaneSchema>
export type PlanningSourceInput = z.infer<typeof planningSourceInputSchema>
export type PlanningSource = z.infer<typeof planningSourceSchema>
export type PlanningEstimate = z.infer<typeof planningEstimateSchema>
export type PlanningRevision = z.infer<typeof planningRevisionSchema>
export type PlanningDraft = z.infer<typeof planningDraftSchema>
export type PlanningCapturedDraft = z.infer<typeof planningCapturedDraftSchema>
export type PlanningActor = z.infer<typeof planningActorSchema>
export type PlanningProposal = z.infer<typeof planningProposalSchema>
/** Board data safe for consumer projection; replay receipts remain provider-private. */
export type PlanningBoardSnapshot = Omit<z.infer<typeof planningBoardSchema>, 'receipts'>
/** Provider-private durable Board record. Consumers must receive PlanningBoardSnapshot instead. */
export type PlanningBoardRecord = z.infer<typeof planningBoardSchema>
export type PlanningCommand = z.infer<typeof planningCommandSchema>
export interface PlanningMutationResult {
  readonly boardVersion: number
  readonly itemId?: string | undefined
  readonly revisionId?: string | undefined
  readonly reviewId?: string | undefined
  readonly proposalId?: string | undefined
  readonly proposalVersion?: number | undefined
}
/**
 * Trusted Host-derived authority for one Planning call. This is a composition capability, not
 * a security boundary against malicious Host plugins; the Provider calls {@link authorize}
 * at operation boundaries to reject stale identity, Workspace, or direct-user evidence.
 */
export interface PlanningAccess {
  /** Canonical Workspace selected by the trusted caller context. */
  readonly workspaceId: string
  /** Authenticated local human, Agent, or bridge actor derived by the Host. */
  readonly actorId: string
  /** Authority route admitted by the Host; bridge is reserved for Delivery link completion. */
  readonly kind: 'human' | 'agent' | 'bridge'
  /** Latest direct user message evidence when the operation depends on one. */
  readonly userMessage?: { readonly sessionId: string; readonly seq: number }
  /** Revalidate the trusted context immediately before a sensitive read or durable mutation. */
  readonly authorize: () => void | Promise<void>
}
/** Frozen Delivery bridge record persisted separately from external execution state. */
export type PlanningHandoff = z.infer<typeof planningHandoffSchema>
/** Host-only request that freezes one exact current planning revision for Delivery mapping. */
export interface PrepareDeliveryHandoffInput {
  readonly itemId: string
  readonly expectedRevisionId: string
  readonly repositoryId: string
  readonly key: string
  readonly mapperVersion: 1
  readonly operatorId: string
  readonly deliveryRequestDigest: string
}
/** Host Bridge callback that atomically binds an already prepared handoff to Delivery identities. */
export interface LinkDeliveryHandoffInput {
  readonly key: string
  readonly caseId: string
  readonly contractRevisionId: string
}
