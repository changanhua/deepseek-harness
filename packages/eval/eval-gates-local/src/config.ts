import type { GateSnapshotReader, GateVerifierInput, GateVerifierReport } from '@changanhua/dsh-eval-gates'

/** Locked Host verifier policy; process/profile execution is supplied by the local owner, never a caller. */
export interface GatePolicy {
  /** Stable Host-approved identity. */
  readonly id: string
  /** Exact verifier policy reference frozen in the admitted Eval Plan. */
  readonly verifierPlan: {
  /** Stable Host-approved identity. */
    readonly id: string
    /** Immutable policy content version. */
    readonly version: string
    /** SHA-256 of the complete approved content. */
    readonly digest: string }
  /** SHA-256 of the complete pinned verifier artifact tree. */
  readonly coreDigest: string
  /** Host-only process launcher and pinned verifier image; no wire input may alter them. */
  readonly launch: {
  /** Absolute Node executable inside the pinned core tree. */
    readonly executable: string
    /** Absolute dsh launcher inside the pinned core tree. */
    readonly entrypoint: string
    /** Fixed private Profile name selected by the Host. */
    readonly profile: string
    /** Host-owned parent for fresh verifier worlds; never shared with a Subject. */
    readonly homeRoot: string
    /** Complete pinned verifier image and approved source provenance. */
    readonly core: {
      /** Absolute physical core directory; links and shared writable files are refused. */
      readonly directory: string
      /** SHA-256 of the complete approved content. */
      readonly digest: string
      /** Approved build provenance in the pinned image's eval-core.json. Artifact bytes remain independently hashed. */
      readonly sourceCommit: string
      /** Complete image inventory and byte limits. */
      readonly imageBounds: {
        /** Maximum files in the observed core image. */
        readonly maxFiles: number
        /** Maximum image bytes including inventory metadata. */
        readonly maxBytes: number } }
    /** Maximum milliseconds for core observation, process execution and final evidence reads. */
    readonly timeoutMs: number
    /** Milliseconds allowed for forced process-tree quiescence. */
    readonly graceMs: number }
  /** Maximum complete verifier input and Host Profile file bytes. */
  readonly maxInputBytes: number
  /** Maximum report and collected process-output bytes. */
  readonly maxOutputBytes: number }

/** Host-observed completion of one separate verifier Profile world. */
export interface VerifierExecution {
  /** Host-generated identity of this separate verifier execution. */
  readonly executionId: string
  /** Actual Session id materialized by the verifier Profile. */
  readonly sessionId: string
  /** Parsed deterministic checker report, bound to exact retained bytes. */
  readonly report: GateVerifierReport
  /** SHA-256 of reportText. */
  readonly reportDigest: string
  /** SHA-256 of the exact rendered verifier input. */
  readonly inputDigest: string
  /** SHA-256 of the Host-written Profile patch. */
  readonly profileDigest: string
  /** Canonical content digest of the fixed checker configuration. */
  readonly configDigest: string
  /** Approved core source checkpoint read from the pinned build provenance. */
  readonly verifiedCommit: string
  /** Exact retained Host observation and world custody materials, addressed by their SHA-256. */
  readonly observer: string
  /** Retained Host world-custody material, distinct from a Subject lease. */
  readonly workspace: string
  /** Exact original report bytes decoded as UTF-8. */
  readonly reportText: string
  /** Whether the managed process tree was confirmed stopped. */
  readonly quiescent: boolean }

/** Private callbacks supplied only by trusted Host composition. */
export interface GateHost {
  /** Reauthorize and capture original Host facts, never a safe projection. */
  readonly snapshots: GateSnapshotReader
  /** Run the fixed independent checker and return Host-observed completion. */
  readonly verify: (input: GateVerifierInput, policy: GatePolicy, signal?: AbortSignal) => Promise<VerifierExecution>
  /** Optional test clock; production defaults to Date.now. */
  readonly now?: () => number }
/** Local producer config. Callbacks are code capabilities, absent from any wire/Profile schema. */
export interface Config {
  /** Maximum retained decision records, checked before dispatch. */
  readonly maxDecisions: number
  /** Maximum complete encoded private ledger bytes. */
  readonly maxLedgerBytes: number
  /** Maximum milliseconds a retained decision may remain current. */
  readonly retentionMs: number
  /** Explicit Host-approved fixed verifier policies. */
  readonly policies: readonly GatePolicy[]
  /** Private capabilities supplied by trusted Host composition. */
  readonly host: GateHost }

export function policyOf(config: Config, id: string): GatePolicy | undefined {
  return config.policies.find(policy => policy.id === id)
}
