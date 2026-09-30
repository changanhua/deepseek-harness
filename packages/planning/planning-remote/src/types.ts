/** Browser request and project selection types for planning. */
import type { PlanningBoardSnapshot, PlanningCommand, PlanningHandoff, PlanningFocus, PlanningRevision } from '@changanhua/dsh-planning'
import type { PlanningSubjectRef, ResourceRef } from '@changanhua/dsh-planning'
export interface PlanningContextInput { readonly workspaceId: string; readonly subject: PlanningSubjectRef }
/** SBC exploration contains a frozen projection, never accepted Planning state. */
export interface SbcExploration {
  positions: Record<string, { x: number; y: number }>
  selectedNodeId: string | null
}
export interface SbcDesignCase {
  workspaceId: string
  subject: PlanningSubjectRef
  planId: string
  baseRevision: PlanningRevision
  baseFocus?: PlanningFocus | undefined
  version: number
  local: SbcExploration
  history: { nodeId: string; x: number; y: number }[]
}
export interface SbcDesignCaseView {
  case: SbcDesignCase
  currentRevision: string | null
  currentFocusVersion: number | null
  drift: boolean
}
export type SbcExploreOperation =
  | { kind: 'select'; nodeId: string | null }
  | { kind: 'move'; nodeId: string; x: number; y: number }
  | { kind: 'undo' }
export interface SbcExploreInput extends PlanningContextInput {
  expectedVersion: number
  requestId: string
  operation: SbcExploreOperation
}
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

/** Thin navigation projection; exploration data remains owned by its provider. */
export interface DesignCaseSummary {
  resource: ResourceRef
  title: string
  subjectRef: PlanningSubjectRef
  baseRevision: string
  currentRevision: string | null
  drift: boolean
  status: 'exploration'
  preview: string
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
