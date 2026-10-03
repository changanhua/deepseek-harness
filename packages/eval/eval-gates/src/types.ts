import type { EvalPlan, EvalSuite, ResolvedExecutionManifest } from '@changanhua/dsh-eval'
import type { EvalRunAccess } from '@changanhua/dsh-eval-runs'

/** Content-addressed record identity; no Host path or private material body crosses the public Gate seam. */
export interface GateReference { readonly id: string
  readonly version: string
  readonly digest: string }

/** One frozen case/route/repeat position required by the admitted Plan. */
export interface GateCellIdentity { readonly caseId: string
  readonly routeId: string
  readonly repeatIndex: number }

/** Actual Queue state observed by the Host; absent work or Attempt remains an explicit fact. */
export interface GateAttemptFact { readonly id: string
  readonly ordinal: number
  readonly status: 'queued' | 'starting' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'unknown' }

/** The typed cell result committed by Queue, if any. It is never reconstructed from a safe report view. */
export interface GateCellOutputFact { readonly outcome: 'passed' | 'failed' | 'invalid'
  readonly reason: string | null
  readonly manifest: ResolvedExecutionManifest | null
  readonly evidenceDigest: string }

/** Raw execution material has already been checked by the Host receiver, but is kept private to the snapshot reader. */
export interface GateMaterialFact { readonly reference: GateReference
  readonly kind: 'observer' | 'workspace' | 'execution'
  readonly role: 'subject' | 'grader'
  readonly executionId: string
  readonly content: string }

/** Evidence integrity is distinct from whether an execution produced a successful result. */
export interface GateEvidenceFact { readonly status: 'intact' | 'missing' | 'expired' | 'corrupt' | 'unknown'
  readonly bundle: GateReference | null
  readonly receivedAt: number | null
  readonly expiresAt: number | null
  readonly materials: readonly GateMaterialFact[] }

/** Host-observed final Budget ledger facts for one actual model dispatch. Null usage is an unresolved reservation, never zero. */
export interface GateBudgetReceipt { readonly requestId: string
  readonly attemptId: string
  readonly provider: string
  readonly model: string
  readonly dispatched: boolean
  readonly phase: 'reserved' | 'dispatched' | 'settled' | 'released' | 'unknown' | 'denied'
  readonly usage: { readonly inputTokens: number
    readonly outputTokens: number } | null }

/** One expected cell with the current Queue Attempt, original output and Host-verified evidence/accounting facts. */
export interface GateCellSnapshot { readonly binding: GateCellIdentity & { readonly runId: string }
  readonly work: { readonly id: string | null
    readonly status: 'submitting' | 'queued' | 'starting' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'unknown' | 'missing'
    readonly attempt: GateAttemptFact | null
    readonly output: GateCellOutputFact | null }
  readonly evidence: GateEvidenceFact
  readonly budget: readonly GateBudgetReceipt[] }

/** Host-private source of truth for one Gate decision. `revision` hashes every durable fact below except `observedAt`. */
export interface GateSnapshot { readonly revision: string
  readonly observedAt: number
  readonly expiresAt: number
  readonly plan: EvalPlan
  readonly suite: EvalSuite
  readonly run: { readonly id: string
    readonly expectedCells: readonly GateCellIdentity[] }
  readonly cells: readonly GateCellSnapshot[] }

/** A Host capability, not a wire method: it authorizes and re-reads original Queue/evidence/Budget facts on every call. */
export type GateSnapshotReader = (access: EvalRunAccess, runId: string, signal?: AbortSignal) => Promise<GateSnapshot | null>

/** Fixed deterministic criterion accepted by the first independent checker. */
export type GateVerifierCriterion = { readonly kind: 'output-equals' | 'output-contains'; readonly text: string }
/** One frozen Suite case as the checker is allowed to see it. */
export interface GateVerifierCase { readonly id: string
  readonly criteria: readonly GateVerifierCriterion[]
  readonly requiresGrader: boolean }
/** Actual data independently rechecked for one expected cell. */
export interface GateVerifierCell extends GateCellIdentity { readonly manifestDigest: string
  readonly subjectOutput: string
  readonly graderOutput: 'PASS' | 'FAIL' | null
  readonly integrity: 'intact'
  readonly budget: 'settled' | 'not-required' }
/** Read-only private-material-derived input for the fixed checker; no Host outcome field is accepted. */
export interface GateVerifierInput { readonly kind: 'eval-verifier-input'
  readonly schemaVersion: 1
  readonly snapshotRevision: string
  readonly plan: GateReference & { readonly expectedCommit: string; readonly baseline: 'none' }
  readonly suite: GateReference & { readonly sourceRevision: string }
  readonly verifierPlan: GateReference
  readonly expectedCells: readonly GateCellIdentity[]
  readonly cases: readonly GateVerifierCase[]
  readonly cells: readonly GateVerifierCell[] }

/** Bounded deterministic output from the frozen verifier process. The Host authenticates its process/profile separately. */
export interface GateVerifierReport { readonly kind: 'eval-verifier-report'
  readonly schemaVersion: 1
  readonly snapshotRevision: string
  readonly inputDigest: string
  readonly outcome: 'approved' | 'rejected' | 'unknown'
  readonly reason: 'criteria-satisfied' | 'criteria-failed' | 'invalid-result' | 'invalid-input'
  readonly cells: readonly (GateCellIdentity & { readonly outcome: 'approved' | 'rejected' | 'unknown'
    readonly reason: 'criteria-satisfied' | 'criteria-failed' | 'invalid-input' })[]
  readonly runtime: { readonly sessionId: string; readonly profile: string; readonly configDigest: string } }
