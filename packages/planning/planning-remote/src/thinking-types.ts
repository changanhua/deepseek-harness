import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  PlanningCommand, PlanningContextPack, PlanningDeltaOperation, PlanningFocus, PlanningMutationResult,
  PlanningResourceLink, PlanningSubjectRef, ResourceRef,
} from '@changanhua/dsh-planning'
import type { PlanningContextInput, SbcDesignCaseView } from './types.ts'

/** Canvas note with either manual authorship or exact model-result provenance. */
export interface ExplorationNote {
  id: string
  title: string
  body?: string
  source?: 'manual'
  sourceResultId?: string
  sourceResultVersion?: number
  createdAt: string
  position: { x: number; y: number }
}
/** Human-saved design rationale retaining its originating result and Planning baseline. */
export interface DesignContextRecord {
  id: string
  title: string
  body: string
  sourceRunId: string
  sourceSessionId: string
  sourceResultId: string
  sourceResultVersion: number
  caseVersionAtCreation: number
  planningRevisionAtCreation: string
  createdAt: string
}
/** Frozen input for one admitted Thinking run; later source changes appear as drift. */
export interface ThinkingContextPack {
  run: { id: string; question: string; sessionId: string; presetId: string; createdAt: string }
  subject: PlanningSubjectRef
  planning: { revisionAtStart: string; context: PlanningContextPack }
  designCase: {
    resource: ResourceRef
    title: string
    caseVersionAtStart: number
    caseBaseRevision: string
    currentRevisionAtStart: string | null
    driftAtStart: boolean
    selectedNode?: { id: string; title: string; body?: string }
    existingExplorationNotes: readonly Omit<ExplorationNote, 'position'>[]
    priorDesignContexts: readonly DesignContextRecord[]
  }
  availableResourceRefs: readonly ResourceRef[]
}
/** Independent model suggestions; none are applied or accepted by submission alone. */
export interface ThinkingResultDraft {
  summary: string
  findings: readonly string[]
  openQuestions: readonly string[]
  explorationNotes?: readonly { title: string; body?: string }[]
  designContext?: { title: string; body: string }
  planningDelta?: { operations: readonly PlanningDeltaOperation[]; rationale?: string }
}
/** Versioned model output and links to its explicitly applied products. */
export interface ThinkingResultRecord {
  id: string
  version: number
  createdAt: string
  draft: ThinkingResultDraft
  applied: { explorationNoteIds: readonly string[]; designContextId?: string; planningProposalId?: string }
}
/** Canonical review baseline captured before a Thinking Proposal is submitted. */
export interface ThinkingReviewSnapshot {
  planRevision: string
  focuses: readonly PlanningFocus[]
  resourceLinks: readonly PlanningResourceLink[]
}
/** Durable exact-command attempts for recovering a cross-owner Proposal write. */
export interface ThinkingProposalSubmission {
  resultId: string
  resultVersion: number
  proposalId: string
  attempts: readonly {
    command: PlanningCommand
    status: 'prepared' | 'conflict' | 'committed'
    receipt?: PlanningMutationResult
  }[]
}
/** Persisted run intent, native startup progress, frozen input and retained results. */
export interface ThinkingRunRecord {
  id: string
  version: number
  sessionId: string
  presetId: string
  question: string
  createdAt: string
  subject: PlanningSubjectRef
  planningRevisionAtStart: string
  caseResource: ResourceRef
  caseVersionAtStart: number
  caseBaseRevision: string
  context: ThinkingContextPack
  reviewSnapshot: ThinkingReviewSnapshot
  startup: {
    phase: 'prepared' | 'session-created' | 'planning-bound' | 'prompt-accepted' | 'blocked'
    bindRequestId: string
    promptRequestId: string
    promptText: string
    bindCommand: PlanningCommand
    blockedReason?: string | undefined
  }
  results: readonly ThinkingResultRecord[]
  proposalSubmissions: readonly ThinkingProposalSubmission[]
}
/** Detached projection of one exploration, its runs and saved design context. */
export interface ThinkingCaseView {
  design: SbcDesignCaseView
  runs: readonly ThinkingRunRecord[]
  designContexts: readonly DesignContextRecord[]
}
/** Caller-selected identities and case CAS for admitting one native Thinking Session. */
export interface PrepareThinkingInput extends PlanningContextInput {
  expectedCaseVersion: number
  runId: string
  sessionId: string
  question: string
  requestId: string
  bindRequestId: string
  promptRequestId: string
}
/** A retained run addressed within its original Workspace and subject. */
export interface ThinkingRunInput extends PlanningContextInput { runId: string }
/** CAS-fenced startup transition; callers must establish native progress first. */
export interface AdvanceThinkingInput extends ThinkingRunInput {
  expectedRunVersion: number
  requestId: string
  phase: ThinkingRunRecord['startup']['phase']
  blockedReason?: string | undefined
}
/** Idempotent result submission against the latest result version. */
export interface SubmitThinkingInput {
  runId: string
  expectedResultVersion: number
  requestId: string
  draft: ThinkingResultDraft
}
/** Explicit selection of result notes or context, with case CAS and optional drift acknowledgement. */
export interface ApplyThinkingInput extends ThinkingRunInput {
  resultId: string
  resultVersion: number
  expectedCaseVersion: number
  requestId: string
  kind: 'notes' | 'context'
  acknowledgeStale?: boolean | undefined
}
/** Exact reviewed result selected for a pending Proposal; this grants no acceptance authority. */
export interface SubmitThinkingProposalInput extends ThinkingRunInput {
  resultId: string
  resultVersion: number
  requestId: string
}
/** Host capability restricted to the real bound Thinking Agent; model-supplied identities are not accepted. */
export interface ThinkingAgentOwner {
  /** Read the admitted run's frozen input after revalidating its live Agent and binding.
   * @param agent - Exact live caller in the restricted Thinking preset.
   * @param signal - Caller cancellation.
   * @returns Detached frozen context; rejects stale scope or missing admission.
   */
  context(agent: Agent, signal: AbortSignal): Promise<ThinkingContextPack>
  /** Persist a versioned suggestion without applying it to Planning or the canvas.
   * @param agent - Exact live caller bound to the run.
   * @param input - Draft, expected result version and stable retry identity.
   * @param signal - Caller cancellation.
   * @returns Committed result or the original receipt on identical retry.
   */
  submit(
    agent: Agent,
    input: Omit<SubmitThinkingInput, 'runId'>,
    signal: AbortSignal,
  ): Promise<ThinkingResultRecord>
  /** Check current preset membership without admitting a read or write.
   * @param sessionId - Native Session to inspect.
   * @returns Whether the live Agent is composed with the Thinking preset.
   */
  isThinkingSession(sessionId: string): Promise<boolean>
}
declare module '@deepseek-ai/cordis' {
  interface Context { thinkingCase: ThinkingAgentOwner }
}
