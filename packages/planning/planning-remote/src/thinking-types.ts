import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  PlanningCommand, PlanningContextPack, PlanningDeltaOperation, PlanningFocus, PlanningMutationResult,
  PlanningResourceLink, PlanningSubjectRef, ResourceRef,
} from '@changanhua/dsh-planning'
import type { PlanningContextInput, SbcDesignCaseView } from './types.ts'

export interface ExplorationNote {
  id: string
  title: string
  body?: string
  sourceResultId: string
  sourceResultVersion: number
  createdAt: string
  position: { x: number; y: number }
}
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
export interface ThinkingResultDraft {
  summary: string
  findings: readonly string[]
  openQuestions: readonly string[]
  explorationNotes?: readonly { title: string; body?: string }[]
  designContext?: { title: string; body: string }
  planningDelta?: { operations: readonly PlanningDeltaOperation[]; rationale?: string }
}
export interface ThinkingResultRecord {
  id: string
  version: number
  createdAt: string
  draft: ThinkingResultDraft
  applied: { explorationNoteIds: readonly string[]; designContextId?: string; planningProposalId?: string }
}
export interface ThinkingReviewSnapshot {
  planRevision: string
  focuses: readonly PlanningFocus[]
  resourceLinks: readonly PlanningResourceLink[]
}
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
export interface ThinkingCaseView {
  design: SbcDesignCaseView
  runs: readonly ThinkingRunRecord[]
  designContexts: readonly DesignContextRecord[]
}
export interface PrepareThinkingInput extends PlanningContextInput {
  expectedCaseVersion: number
  runId: string
  sessionId: string
  question: string
  requestId: string
  bindRequestId: string
  promptRequestId: string
}
export interface ThinkingRunInput extends PlanningContextInput { runId: string }
export interface AdvanceThinkingInput extends ThinkingRunInput {
  expectedRunVersion: number
  requestId: string
  phase: ThinkingRunRecord['startup']['phase']
  blockedReason?: string | undefined
}
export interface SubmitThinkingInput {
  runId: string
  expectedResultVersion: number
  requestId: string
  draft: ThinkingResultDraft
}
export interface ApplyThinkingInput extends ThinkingRunInput {
  resultId: string
  resultVersion: number
  expectedCaseVersion: number
  requestId: string
  kind: 'notes' | 'context'
  acknowledgeStale?: boolean | undefined
}
export interface SubmitThinkingProposalInput extends ThinkingRunInput {
  resultId: string
  resultVersion: number
  requestId: string
}
export interface ThinkingAgentOwner {
  context(agent: Agent, signal: AbortSignal): Promise<ThinkingContextPack>
  submit(
    agent: Agent,
    input: Omit<SubmitThinkingInput, 'runId'>,
    signal: AbortSignal,
  ): Promise<ThinkingResultRecord>
  isThinkingSession(sessionId: string): Promise<boolean>
}
declare module '@deepseek-ai/cordis' {
  interface Context { thinkingCase: ThinkingAgentOwner }
}
