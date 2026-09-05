import type { WorkKindDefinition } from '@changanhua/dsh-task-queue'

/** Caller intent for one host-configured operation. */
export interface OperationRunIntent {
  readonly operationId: string
}

/** Immutable operation facts persisted during Queue admission. */
export interface ResolvedOperationRun {
  readonly operationId: string
  readonly revision: string
  readonly argv: readonly string[]
  readonly cwd: string
  readonly resource: string
  readonly units: number
  readonly maxAttempts: number
  readonly collectBytes: number
  readonly resultBytes: number
  readonly failureTailBytes: number
  readonly graceMs: number
  readonly timeoutMs: number
}

/** Prepared operation facts; preparation performs validation without adding execution controls. */
export type PreparedOperationRun = ResolvedOperationRun

/** Bounded semantic result persisted after a successful operation. */
export interface OperationRunOutput {
  readonly operationId: string
  readonly revision: string
  readonly summary: string
  readonly stdout?: {
    readonly text: string
    readonly truncated: boolean
  }
}

/** Trusted host definition for one allowlisted operation revision. */
export interface OperationDefinition {
  /** Stable host revision persisted with admitted WorkItems. */
  readonly revision: string
  /** Host-facing explanation of the named operation. */
  readonly description: string
  /** Fixed, secret-free process vector selected by trusted deployment configuration. */
  readonly argv: readonly string[]
  /** Existing working directory validated before process start. */
  readonly cwd: string
  /** Queue resource capacity key claimed by every Attempt. */
  readonly resource: string
  /** Positive resource units claimed by every Attempt. */
  readonly units: number
  /** Positive upper bound on durable Attempts for one WorkItem. */
  readonly maxAttempts: number
  /** Positive byte bound for subprocess output collection. */
  readonly collectBytes: number
  /** Positive byte bound for stdout exposed in a successful Result. */
  readonly resultBytes: number
  /** Positive byte bound for the stderr tail retained in a failure. */
  readonly failureTailBytes: number
  /** Positive millisecond grace between process termination stages. */
  readonly graceMs: number
  /** Positive millisecond execution deadline. */
  readonly timeoutMs: number
}

/** Host-owned allowlist supplied to the operation WorkKind bridge. */
export interface Config {
  /** Closed map from caller-visible ids to trusted, fixed operation definitions. */
  readonly operations: Readonly<Record<string, OperationDefinition>>
}

declare module '@changanhua/dsh-task-queue' {
  interface WorkKindMap {
    'operation.run@1': WorkKindDefinition<
      OperationRunIntent,
      ResolvedOperationRun,
      PreparedOperationRun,
      OperationRunOutput
    >
  }
}
