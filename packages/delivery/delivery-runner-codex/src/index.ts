/**
 * Delivery-specific Codex change runner over the supported app-server subpath.
 *
 * @module @deepseek-ai/dsh-delivery-runner-codex
 */

import {
  CODEX_APP_SERVER_PERMISSION_MODES,
  startCodexAppServerRun,
} from '@deepseek-ai/dsh-subagent-codex/app-server-run'
import type {
  CodexAppServerPermissionMode,
  CodexAppServerStartRequest,
} from '@deepseek-ai/dsh-subagent-codex/app-server-run'
import type { BoundDeliveryEvidenceWriter } from '@deepseek-ai/dsh-delivery-evidence'
import type {
  CompletionClaim,
  ContractRevision,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  ResolvedCodeChange,
  WorkPacket,
} from '@deepseek-ai/dsh-delivery-protocol'
import type { ChangeWorkspaceLease } from '@deepseek-ai/dsh-repo-workspace'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

export { CODEX_APP_SERVER_PERMISSION_MODES }
export type { CodexAppServerPermissionMode }

/** Hard ceiling for retained Codex assistant output configured by the bridge. */
export const MAX_MODEL_OUTPUT_BYTES = 64 * 1024 * 1024

/** Stable runner failure classification. */
export type DeliveryCodexRunnerErrorCode = 'configuration' | 'unavailable'

/** Typed failure returned while the concrete runner implementation is unavailable. */
export class DeliveryCodexRunnerError extends Error {
  /**
   * @param code - Stable runner failure classification.
   * @param message - Human-readable diagnostic.
   * @param options - Optional underlying failure.
   */
  constructor(
    readonly code: DeliveryCodexRunnerErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'DeliveryCodexRunnerError'
  }
}

/** Trusted deployment inputs fixed before one runner closure is created. */
export interface CodexChangeRunnerDependencies {
  /** Shared subprocess operation used by the selected app-server transport. */
  readonly spawn: CodexAppServerStartRequest['spawn']
  /** Optional native Codex model override. */
  readonly model?: string
  /** Native unattended approval and sandbox policy. */
  readonly permissionMode: CodexAppServerPermissionMode
  /** Explicit child environment layered after credential scrubbing. */
  readonly env: Record<string, string>
  /** Grace in milliseconds for process-tree termination. */
  readonly disposeGraceMs: number
  /** Maximum UTF-8 bytes retained from Codex assistant output. */
  readonly modelOutputBytes: number
}

/** Attempt-local inputs assembled by the Queue bridge without durable host paths. */
export interface CodeChangeRunRequest {
  readonly contract: ContractRevision
  readonly packet: WorkPacket
  readonly resolved: ResolvedCodeChange
  /** Durable Queue Work identity copied into the claim and evidence provenance. */
  readonly queueWorkId: QueueWorkIdRef
  /**
   * Current Queue Attempt identity. The opened lease owner must equal this id,
   * and the claim plus every returned EvidenceRef must retain the same pair.
   */
  readonly queueAttemptId: QueueAttemptIdRef
  /** Open the writable Attempt-owned checkout only when runner work starts. */
  readonly openWorkspace: (signal: AbortSignal) => Promise<ChangeWorkspaceLease>
  /** Evidence writer whose provenance is already bound to the request Queue pair. */
  readonly evidence: BoundDeliveryEvidenceWriter
}

/** Live ownership published synchronously before a Codex side effect may begin. */
export interface CodeChangeRun {
  readonly done: Promise<CompletionClaim>
  /** Request cancellation and wait until the runner has processed it. */
  cancel(reason: string): Promise<void>
}

/** Start one Delivery code-change attempt. */
export type StartCodeChange = (
  request: CodeChangeRunRequest,
  signal: AbortSignal,
) => CodeChangeRun

function configuration(message: string): DeliveryCodexRunnerError {
  return new DeliveryCodexRunnerError('configuration', message)
}

function validateDependencies(
  dependencies: CodexChangeRunnerDependencies,
): void {
  if (
    !Number.isInteger(dependencies.disposeGraceMs)
    || dependencies.disposeGraceMs < 1
    || dependencies.disposeGraceMs > MAX_TIMER_DELAY_MS
  ) {
    throw configuration(
      `disposeGraceMs must be a positive integer no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  if (
    !Number.isSafeInteger(dependencies.modelOutputBytes)
    || dependencies.modelOutputBytes < 1
    || dependencies.modelOutputBytes > MAX_MODEL_OUTPUT_BYTES
  ) {
    throw configuration(
      `modelOutputBytes must be a positive safe integer no greater than ${MAX_MODEL_OUTPUT_BYTES}`,
    )
  }
}

const SELECTED_TRANSPORT = startCodexAppServerRun.name

function unavailableRun(): CodeChangeRun {
  const error = new DeliveryCodexRunnerError(
    'unavailable',
    `Delivery Codex runner implementation is not installed; expected transport ${SELECTED_TRANSPORT}`,
  )
  const done = Promise.reject<CompletionClaim>(error)
  // Preserve the rejected contract without creating an unhandled rejection
  // when a host probes the scaffold before attaching its own observer.
  void done.catch(() => undefined)
  return Object.freeze({
    done,
    cancel: (_reason: string) => Promise.resolve(),
  })
}

/**
 * Create the Delivery-specific Codex runner closure.
 *
 * The selected transport is intentionally fixed to the supported
 * subagent-codex app-server subpath. This is a package-local factory, not a
 * Cordis executor registry or a second provider seam.
 *
 * @param dependencies - Trusted transport and deployment inputs.
 * @returns a stable closure whose concrete runner implementation is unavailable.
 */
export function createCodexChangeRunner(
  dependencies: CodexChangeRunnerDependencies,
): StartCodeChange {
  validateDependencies(dependencies)
  return (_request: CodeChangeRunRequest, _signal: AbortSignal) =>
    unavailableRun()
}
