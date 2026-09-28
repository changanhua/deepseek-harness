/** Browser request and project selection types for planning. */
import type { PlanningBoardSnapshot, PlanningCommand, PlanningHandoff } from '@changanhua/dsh-planning'
import type { DeliveryCaseCard, DeliveryCaseLane } from '@changanhua/dsh-delivery-remote'

/** A registered project available to the authenticated local user. */
export interface PlanningWorkspaceView {
  readonly id: string
  readonly title: string
}

/** Image already captured by a plan or pending proposal in this project. */
export interface PlanningImageInput {
  readonly workspaceId: string
  readonly attachmentId: string
}

/** Verified stored image, encoded for the browser. */
export interface PlanningImageView {
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  readonly data: string
}

/** A mutation scoped to one selected project; identity remains Host-owned. */
export interface PlanningExecuteInput {
  readonly workspaceId: string
  readonly command: PlanningCommand
}

/** Exact adopted revision selected for execution preparation. */
export interface PlanningHandoffInput {
  readonly workspaceId: string
  readonly itemId: string
  readonly expectedRevisionId: string
}

/** Selected plan whose linked execution records should be read. */
export interface PlanningExecutionInput {
  readonly workspaceId: string
  readonly itemId: string
}

/** One evidence object already named by a linked Delivery packet for this Plan. */
export interface PlanningEvidenceInput {
  readonly workspaceId: string
  readonly itemId: string
  readonly evidenceId: string
}

/** Live Delivery projection joined to durable Planning references; never persisted. */
export interface PlanningExecutionView {
  readonly available: boolean
  readonly handoffs: readonly {
    readonly handoff: PlanningHandoff
    readonly case: DeliveryCaseCard | null
  }[]
}

/** Read-only Planning Board augmented with linked Delivery work that has real completion evidence. */
export interface PlanningBoardView extends PlanningBoardSnapshot {
  readonly executions: readonly {
    readonly itemId: string
    readonly revisionId: string
    readonly caseId: string
    readonly stage: DeliveryCaseLane | 'unavailable'
    readonly reviewSuggested: boolean
  }[]
}
