/** Host-only contracts for durable side-effect admission. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import type { z } from 'zod'
import type { approvalSchema, actionSchema, executionSchema, budgetSchema, costSchema, targetSchema } from './state.ts'

/** Opaque identity of one durable execution. */
export type SafetyExecutionId = Branded<'SafetyExecutionId'>
/** Opaque identity of one activated human approval. */
export type SafetyApprovalId = Branded<'SafetyApprovalId'>
/** Opaque identity of one intent that is never replayed after send. */
export type SafetyActionId = Branded<'SafetyActionId'>
/** Opaque identity of a business execution lease. */
export type SafetyLeaseId = Branded<'SafetyLeaseId'>
/** Persisted human authorization and its revocation state. */
export type SafetyApproval = z.infer<typeof approvalSchema>
/** Persisted action intent, risk consumption and settlement evidence references. */
export type SafetyAction = z.infer<typeof actionSchema>
/** Persisted approval-bound execution and action ledger. */
export type SafetyExecution = z.infer<typeof executionSchema>
/** Human-approved ceilings for retained attempt risk. */
export type RiskBudget = z.infer<typeof budgetSchema>
/** Attempt risk consumed atomically with SENT. */
export type RiskCost = z.infer<typeof costSchema>
/** Domain-owned business target identity. */
export type TargetRef = z.infer<typeof targetSchema>
/** References only; the referenced owner retains and verifies evidence bytes. */
export interface SafetyEvidenceRef { uri: string; digest: string }
/** Complete scope, policy, target, validity window and budget presented for approval. */
export interface ApprovalDraft {
  domain: string
  subjectRef: TargetRef
  scopeDigest: string
  policyDigest: string
  startsAt: number
  expiresAt: number
  budget: RiskBudget
}
/** Host confirmation of an actual human decision, bound to the entire activation draft. */
export interface HumanApprovalProof {
  kind: 'human'
  actorId: string
  draftDigest: string
  evidenceRefs: SafetyEvidenceRef[]
}
/** Adapter preparation input; only the parameter digest is persisted. */
export interface ActionInput {
  idempotencyKey: string
  kind: string
  targetRef: TargetRef
  parameters: unknown
  riskCost: RiskCost
}
/** Only the creating binding accepts this process-local one-shot capability. */
export interface AdmittedAction { readonly actionId: SafetyActionId; readonly __admitted: unique symbol }
/** Readback outcome with owner-verified evidence references. */
export interface Settlement {
  outcome: 'CONFIRMED' | 'NOT_APPLIED' | 'UNKNOWN'
  evidenceRefs: SafetyEvidenceRef[]
}
/** Trusted Host implementation; never supplied through a tool or Remote method. */
export interface SafetyAdapter {
  /** Verify an authenticated human activation; an automation allowed-once outcome alone is insufficient. */
  confirmHuman(this: void, draft: ApprovalDraft, request: ApprovalRequest): Promise<HumanApprovalProof | undefined>
  /** Re-evaluate current scope, policy, payload and runtime facts; throwing denies admission. */
  validate(this: void, action: SafetyAction, approval: SafetyApproval, parameters: unknown): Promise<boolean>
  /** Sole private side-effect boundary, invoked only after durable SENT. */
  send(this: void, action: SafetyAction, parameters: unknown): Promise<Settlement>
  /** Lookup-only readback; it never receives the original action payload. */
  inspect(this: void, action: SafetyAction): Promise<Settlement>
}
/** Adapter-local executor capability; raw payloads are not executable. */
export interface SafetyBinding {
  createExecution(approvalId: SafetyApprovalId, idempotencyKey: string): Promise<SafetyExecution>
  acquireLease(id: SafetyExecutionId, expectedRevision: number, durationMs: number): Promise<SafetyExecution>
  releaseLease(id: SafetyExecutionId, revision: number): Promise<SafetyExecution>
  control(id: SafetyExecutionId, revision: number, control: 'active' | 'paused' | 'aborted' | 'completed'): Promise<SafetyExecution>
  revokeApproval(id: SafetyApprovalId): Promise<void>
  approve(draft: ApprovalDraft, request: ApprovalRequest): Promise<SafetyApproval>
  prepare(executionId: SafetyExecutionId, expectedRevision: number, input: ActionInput): Promise<SafetyAction>
  admit(executionId: SafetyExecutionId, expectedRevision: number, actionId: SafetyActionId, parameters: unknown): Promise<AdmittedAction>
  execute(handle: AdmittedAction): Promise<SafetyAction>
  reconcile(executionId: SafetyExecutionId, expectedRevision: number, actionId: SafetyActionId): Promise<SafetyAction>
}
/** Required retention, evidence and admission bounds for one Host writer. */
export interface Config {
  /** Maximum retained execution records. */
  maxExecutions: number
  /** Maximum retained human approval artifacts. */
  maxApprovals: number
  /** Maximum retained ledger actions per execution. */
  maxActionsPerExecution: number
  /** UTF-8 byte limit for a complete approval or execution. */
  maxRecordBytes: number
  /** UTF-8 byte limit for the complete durable state. */
  maxTotalBytes: number
  /** Maximum references on one approval or settlement. */
  maxEvidenceRefs: number
  /** Maximum lifetime in milliseconds of a process-local admitted handle. */
  maxAdmissionMs: number
}
/** Current admission projection; unresolved effects require reconciliation. */
export type Breaker = 'READY' | 'RUNNING' | 'PAUSED' | 'RECONCILING' | 'BLOCKED' | 'COMPLETED'
/** Detached committed execution and derived admission state. */
export interface SafetySnapshot {
  execution: SafetyExecution
  breaker: Breaker
  reasons: string[]
  spent: RiskCost
  unresolved: SafetyActionId[]
}
