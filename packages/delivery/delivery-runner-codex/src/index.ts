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
import {
  CompletionClaimId,
  DELIVERY_SCHEMA_VERSION,
  canonicalJson,
  completionClaimSchema,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  CompletionClaim,
  ContractRevision,
  EvidenceRef,
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
export type DeliveryCodexRunnerErrorCode =
  | 'configuration'
  | 'invalid-request'
  | 'startup'
  | 'product'
  | 'canceled'
  | 'completion'
  | 'ownership-lost'
  | 'cleanup'

/** Optional structured facts retained with one runner failure. */
export interface DeliveryCodexRunnerErrorOptions extends ErrorOptions {
  /** Native Codex terminal reason when the run was published. */
  readonly stopReason?: string
}

/** Typed infrastructure or terminal failure from one governed Codex Attempt. */
export class DeliveryCodexRunnerError extends Error {
  /** Native Codex terminal reason when the run was published. */
  readonly stopReason: string | undefined

  /**
   * @param code - Stable runner failure classification.
   * @param message - Human-readable diagnostic.
   * @param options - Optional underlying failure and native stop reason.
   */
  constructor(
    readonly code: DeliveryCodexRunnerErrorCode,
    message: string,
    options?: DeliveryCodexRunnerErrorOptions,
  ) {
    super(message, options)
    this.name = 'DeliveryCodexRunnerError'
    this.stopReason = options?.stopReason
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
  /** Request cancellation, await process-tree cleanup, and reject on cleanup failure. */
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

interface ModelEnvelopeCommon {
  readonly summary: string
  readonly completedWork: readonly string[]
  readonly remainingWork: readonly string[]
}

type ModelCompletionEnvelope = ModelEnvelopeCommon & (
  | { readonly disposition: 'completed' }
  | {
    readonly disposition: 'blocked'
    readonly blocker: string
    readonly nextSmallestAction: string
  }
  | { readonly disposition: 'needs-decision'; readonly question: string }
  | {
    readonly disposition: 'needs-scope-change'
    readonly proposedScopeDelta: string
    readonly reason: string
  }
)

interface RetainedModelOutput {
  readonly text: string
  readonly totalBytes: number
  readonly retainedBytes: number
  readonly omittedBytes: number
}

const encoder = new TextEncoder()
const fatalDecoder = new TextDecoder('utf-8', { fatal: true })

function runnerFailure(
  code: DeliveryCodexRunnerErrorCode,
  message: string,
  cause?: unknown,
  stopReason?: string,
): DeliveryCodexRunnerError {
  return new DeliveryCodexRunnerError(code, message, {
    ...cause === undefined ? {} : { cause },
    ...stopReason === undefined ? {} : { stopReason },
  })
}

function asError(value: unknown): Error {
  /* v8 ignore next -- owned async boundaries reject with Error values. */
  return value instanceof Error ? value : new Error(String(value))
}

function cancellationFailure(signal: AbortSignal): DeliveryCodexRunnerError {
  return runnerFailure(
    'canceled',
    'Delivery Codex run was canceled',
    signal.reason,
  )
}

function asRunnerError(
  value: unknown,
  signal: AbortSignal,
): DeliveryCodexRunnerError {
  if (value instanceof DeliveryCodexRunnerError) return value
  return signal.aborted
    ? cancellationFailure(signal)
    : runnerFailure('completion', 'Delivery Codex completion failed', value)
}

function ensureActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw cancellationFailure(signal)
  }
}

function validateRequest(request: CodeChangeRunRequest): void {
  const { contract, packet, resolved } = request
  if (
    contract.id !== packet.contractRevisionId
    || contract.repositoryId !== packet.repositoryId
    || resolved.packetId !== packet.id
    || resolved.contractRevisionId !== contract.id
    || resolved.repositoryId !== packet.repositoryId
    || resolved.baseCommit !== packet.baseCommit
    || (
      packet.executorPreference.mode === 'required'
      && packet.executorPreference.executorId !== resolved.executorId
    )
  ) {
    throw runnerFailure(
      'invalid-request',
      'Delivery Codex request identities do not describe one exact Packet execution',
    )
  }
}

function compilePrompt(
  request: CodeChangeRunRequest,
  modelOutputBytes: number,
): readonly [{ readonly type: 'text'; readonly text: string }] {
  const input = canonicalJson({
    contract: request.contract,
    packet: request.packet,
    resolved: request.resolved,
  })
  const text = [
    'Execute one bounded Personal Delivery code-change Attempt.',
    'The JSON below is authoritative. Work only inside the supplied workspace and obey every allowed path, forbidden path, stop condition, and acceptance clause.',
    input,
    'Your final response must be exactly one JSON object with no Markdown fence or surrounding prose.',
    'Always include exactly "disposition", "summary", "completedWork", and "remainingWork".',
    'For "completed", add no fields. For "blocked", add exactly "blocker" and "nextSmallestAction". For "needs-decision", add exactly "question". For "needs-scope-change", add exactly "proposedScopeDelta" and "reason".',
    'Do not supply checkpoint, changed-path, evidence, Queue, or timestamp fields; the trusted host derives them after process-tree quiescence.',
    `Output retention is UTF-8 head retention: at most the first ${modelOutputBytes} bytes of the final response are retained. If the JSON envelope exceeds that budget, it is incomplete and the Attempt cannot complete.`,
  ].join('\n\n')
  return [{ type: 'text', text }]
}

function retainModelOutput(text: string, limit: number): RetainedModelOutput {
  const bytes = encoder.encode(text)
  if (bytes.byteLength <= limit) {
    return {
      text,
      totalBytes: bytes.byteLength,
      retainedBytes: bytes.byteLength,
      omittedBytes: 0,
    }
  }
  let retainedLength = limit
  let retained = ''
  for (;;) {
    try {
      retained = fatalDecoder.decode(bytes.subarray(0, retainedLength))
      break
    } catch {
      retainedLength -= 1
      /* v8 ignore next -- UTF-8 encoded input finds a boundary within four bytes. */
      if (retainedLength < 0) retainedLength = 0
    }
  }
  return {
    text: retained,
    totalBytes: bytes.byteLength,
    retainedBytes: retainedLength,
    omittedBytes: bytes.byteLength - retainedLength,
  }
}

function modelOutputText(output: readonly {
  readonly type: string
  readonly text?: string
}[]): string {
  /* v8 ignore if -- the selected app-server maps a completed turn without one final text message to product error before this boundary. */
  if (
    output.length !== 1
    || output[0]?.type !== 'text'
    || typeof output[0].text !== 'string'
  ) {
    throw runnerFailure(
      'completion',
      'Codex must return exactly one text completion envelope',
    )
  }
  return output[0].text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function nonBlankList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonBlank)
}

function exactKeys(
  value: Record<string, unknown>,
  variantKeys: readonly string[],
): boolean {
  const commonKeys = [
    'completedWork',
    'disposition',
    'remainingWork',
    'summary',
  ]
  const expected = [...commonKeys, ...variantKeys].sort()
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected)
}

function parseModelEnvelope(output: RetainedModelOutput): ModelCompletionEnvelope {
  if (output.omittedBytes > 0) {
    throw runnerFailure(
      'completion',
      `Codex completion exceeded the ${output.retainedBytes}-byte retained head by ${output.omittedBytes} bytes`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(output.text)
  } catch (cause: unknown) {
    throw runnerFailure(
      'completion',
      'Codex completion was not one exact JSON object',
      cause,
    )
  }
  if (
    !isRecord(parsed)
    || !nonBlank(parsed.summary)
    || !nonBlankList(parsed.completedWork)
    || !nonBlankList(parsed.remainingWork)
  ) {
    throw runnerFailure(
      'completion',
      'Codex response does not match the strict completion envelope',
    )
  }
  const common: ModelEnvelopeCommon = {
    summary: parsed.summary,
    completedWork: parsed.completedWork,
    remainingWork: parsed.remainingWork,
  }
  switch (parsed.disposition) {
    case 'completed':
      if (exactKeys(parsed, [])) return { ...common, disposition: 'completed' }
      break
    case 'blocked':
      if (
        exactKeys(parsed, ['blocker', 'nextSmallestAction'])
        && nonBlank(parsed.blocker)
        && nonBlank(parsed.nextSmallestAction)
      ) {
        return {
          ...common,
          disposition: 'blocked',
          blocker: parsed.blocker,
          nextSmallestAction: parsed.nextSmallestAction,
        }
      }
      break
    case 'needs-decision':
      if (exactKeys(parsed, ['question']) && nonBlank(parsed.question)) {
        return {
          ...common,
          disposition: 'needs-decision',
          question: parsed.question,
        }
      }
      break
    case 'needs-scope-change':
      if (
        exactKeys(parsed, ['proposedScopeDelta', 'reason'])
        && nonBlank(parsed.proposedScopeDelta)
        && nonBlank(parsed.reason)
      ) {
        return {
          ...common,
          disposition: 'needs-scope-change',
          proposedScopeDelta: parsed.proposedScopeDelta,
          reason: parsed.reason,
        }
      }
      break
  }
  throw runnerFailure(
    'completion',
    'Codex response does not match the strict completion envelope',
  )
}

function assertEvidenceOwner(
  reference: EvidenceRef,
  request: CodeChangeRunRequest,
): void {
  const provenance = reference.provenance
  if (
    provenance.kind !== 'change-attempt'
    || provenance.packetId !== request.packet.id
    || provenance.queueWorkId !== request.queueWorkId
    || provenance.queueAttemptId !== request.queueAttemptId
  ) {
    throw runnerFailure(
      'ownership-lost',
      'Delivery evidence was published under another Packet, Work, or Attempt',
    )
  }
}

function cleanupFailure(
  primary: DeliveryCodexRunnerError,
  cleanup: unknown,
): DeliveryCodexRunnerError {
  const cleanupError = asError(cleanup)
  return runnerFailure(
    'cleanup',
    `${primary.message}; cleanup failed: ${cleanupError.message}`,
    new AggregateError([primary, cleanupError], 'Delivery Codex cleanup failed'),
    primary.stopReason,
  )
}

class LeaseSettlementFailure extends Error {
  constructor(readonly failure: DeliveryCodexRunnerError) {
    super(failure.message, { cause: failure })
    this.name = 'LeaseSettlementFailure'
  }
}

async function saveModelOutput(
  request: CodeChangeRunRequest,
  retained: RetainedModelOutput,
  signal: AbortSignal,
): Promise<EvidenceRef> {
  const reference = await request.evidence.save({
    kind: 'log',
    mediaType: 'text/plain; charset=utf-8',
    data: encoder.encode(retained.text),
  }, signal)
  assertEvidenceOwner(reference, request)
  return reference
}

function completionClaimId(request: CodeChangeRunRequest): CompletionClaimId {
  return CompletionClaimId(
    `delivery:${request.packet.id}:${request.queueWorkId}:${request.queueAttemptId}:completion`,
  )
}

async function executeChange(
  dependencies: CodexChangeRunnerDependencies,
  request: CodeChangeRunRequest,
  signal: AbortSignal,
): Promise<CompletionClaim> {
  validateRequest(request)
  ensureActive(signal)

  let lease: ChangeWorkspaceLease
  try {
    lease = await request.openWorkspace(signal)
  } catch (cause: unknown) {
    ensureActive(signal)
    throw runnerFailure(
      'startup',
      'Delivery Codex workspace could not be opened',
      cause,
    )
  }

  let transportPublished = false

  if (lease.ownerAttemptId !== request.queueAttemptId) {
    throw runnerFailure(
      'ownership-lost',
      'Delivery Codex workspace is owned by another Queue Attempt',
    )
  }

  try {
    if (
      lease.repositoryId !== request.packet.repositoryId
      || lease.baseCommit !== request.packet.baseCommit
    ) {
      throw runnerFailure(
        'ownership-lost',
        'Delivery Codex workspace does not match the Packet repository and base',
      )
    }
    ensureActive(signal)

    let transport
    try {
      transport = await startCodexAppServerRun({
        prompt: compilePrompt(request, dependencies.modelOutputBytes),
        signal,
        cwd: lease.cwd,
        ...dependencies.model === undefined ? {} : { model: dependencies.model },
        permissionMode: dependencies.permissionMode,
        env: { ...dependencies.env },
        disposeGraceMs: dependencies.disposeGraceMs,
        spawn: dependencies.spawn,
      })
    } catch (cause: unknown) {
      if (cause instanceof AggregateError) {
        throw runnerFailure(
          'cleanup',
          `Delivery Codex startup rollback did not prove ${SELECTED_TRANSPORT} process-tree quiescence`,
          cause,
        )
      }
      ensureActive(signal)
      throw runnerFailure(
        'startup',
        `Delivery Codex failed before ${SELECTED_TRANSPORT} published a run`,
        cause,
      )
    }
    transportPublished = true

    const result = await transport.result
    let terminalFailure: DeliveryCodexRunnerError | undefined
    if (signal.aborted || result.stopReason === 'aborted') {
      terminalFailure = runnerFailure(
        'canceled',
        'Delivery Codex run was canceled',
        signal.reason,
        result.stopReason,
      )
    } else if (result.stopReason !== 'completed') {
      terminalFailure = runnerFailure(
        'product',
        `Codex ended without completion: ${result.stopReason}`,
        undefined,
        result.stopReason,
      )
    }

    try {
      await transport.dispose()
    } catch (cause: unknown) {
      throw cleanupFailure(
        terminalFailure ?? runnerFailure(
          'cleanup',
          'Codex completed but process-tree cleanup failed',
        ),
        cause,
      )
    }
    if (terminalFailure !== undefined) throw terminalFailure
    ensureActive(signal)

    const retained = retainModelOutput(
      modelOutputText(result.output),
      dependencies.modelOutputBytes,
    )
    const envelope = parseModelEnvelope(retained)
    if (envelope.disposition !== 'completed') {
      const logRef = await saveModelOutput(request, retained, signal)
      ensureActive(signal)
      const common = {
        schemaVersion: DELIVERY_SCHEMA_VERSION,
        id: completionClaimId(request),
        packetId: request.packet.id,
        queueWorkId: request.queueWorkId,
        queueAttemptId: request.queueAttemptId,
        summary: envelope.summary,
        completedWork: envelope.completedWork,
        remainingWork: envelope.remainingWork,
        checkpointCommit: null,
        changedPaths: [],
        evidenceIds: [logRef.id],
        resumeCapsuleEvidenceId: null,
        createdAt: new Date().toISOString(),
      }
      const claim = completionClaimSchema.parse(
        envelope.disposition === 'blocked'
          ? {
            ...common,
            disposition: envelope.disposition,
            blocker: envelope.blocker,
            nextSmallestAction: envelope.nextSmallestAction,
          }
          : envelope.disposition === 'needs-decision'
            ? {
              ...common,
              disposition: envelope.disposition,
              question: envelope.question,
            }
            : {
              ...common,
              disposition: envelope.disposition,
              proposedScopeDelta: envelope.proposedScopeDelta,
              reason: envelope.reason,
            },
      )
      try {
        await lease.close('preserve')
      } catch (cause: unknown) {
        throw new LeaseSettlementFailure(cleanupFailure(
          signal.aborted
            ? cancellationFailure(signal)
            : runnerFailure('completion', 'Delivery Codex claim was assembled'),
          cause,
        ))
      }
      if (signal.aborted) {
        throw new LeaseSettlementFailure(cancellationFailure(signal))
      }
      return claim
    }
    let checkpoint
    try {
      checkpoint = await lease.checkpoint({
        message: `Personal Delivery checkpoint for ${request.packet.id}`,
        signal,
      })
    } catch (cause: unknown) {
      ensureActive(signal)
      throw runnerFailure(
        'completion',
        'Codex completed but the governed checkpoint failed',
        cause,
      )
    }
    ensureActive(signal)
    if (
      checkpoint.repositoryId !== request.packet.repositoryId
      || checkpoint.baseCommit !== request.packet.baseCommit
    ) {
      throw runnerFailure(
        'ownership-lost',
        'Governed checkpoint facts do not match the Packet repository and base',
      )
    }

    const logRef = await saveModelOutput(request, retained, signal)
    const checkpointRef = await request.evidence.save({
      kind: 'checkpoint-metadata',
      mediaType: 'application/json',
      data: encoder.encode(canonicalJson({
        format: 'delivery-codex-checkpoint@1',
        packetId: request.packet.id,
        queueWorkId: request.queueWorkId,
        queueAttemptId: request.queueAttemptId,
        repositoryId: checkpoint.repositoryId,
        baseCommit: checkpoint.baseCommit,
        checkpointCommit: checkpoint.checkpointCommit,
        changedPaths: checkpoint.changedPaths,
        modelOutputRetention: {
          strategy: 'utf8-head',
          budgetBytes: dependencies.modelOutputBytes,
          totalBytes: retained.totalBytes,
          retainedBytes: retained.retainedBytes,
          omittedBytes: retained.omittedBytes,
        },
      })),
    }, signal)
    assertEvidenceOwner(checkpointRef, request)
    ensureActive(signal)

    const claim = completionClaimSchema.parse({
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      id: completionClaimId(request),
      packetId: request.packet.id,
      queueWorkId: request.queueWorkId,
      queueAttemptId: request.queueAttemptId,
      summary: envelope.summary,
      completedWork: envelope.completedWork,
      remainingWork: envelope.remainingWork,
      disposition: 'completed',
      checkpointCommit: checkpoint.checkpointCommit,
      changedPaths: checkpoint.changedPaths,
      evidenceIds: [logRef.id, checkpointRef.id],
      resumeCapsuleEvidenceId: null,
      createdAt: new Date().toISOString(),
    })
    try {
      await lease.close('remove')
    } catch (cause: unknown) {
      throw new LeaseSettlementFailure(cleanupFailure(
        signal.aborted
          ? cancellationFailure(signal)
          : runnerFailure('completion', 'Delivery Codex claim was assembled'),
        cause,
      ))
    }
    if (signal.aborted) {
      throw new LeaseSettlementFailure(cancellationFailure(signal))
    }
    return claim
  } catch (cause: unknown) {
    if (cause instanceof LeaseSettlementFailure) throw cause.failure
    let failure = asRunnerError(cause, signal)
    try {
      await lease.close(
        transportPublished || failure.code === 'cleanup'
          ? 'preserve'
          : 'remove',
      )
    } catch (cleanup: unknown) {
      failure = cleanupFailure(failure, cleanup)
    }
    throw failure
  }
}

/**
 * Create the Delivery-specific Codex runner closure.
 *
 * The selected transport is intentionally fixed to the supported
 * subagent-codex app-server subpath. This is a package-local factory, not a
 * Cordis executor registry or a second provider seam.
 *
 * @param dependencies - Trusted transport and deployment inputs.
 * @returns a stable closure over the selected explicit-workspace transport.
 */
export function createCodexChangeRunner(
  dependencies: CodexChangeRunnerDependencies,
): StartCodeChange {
  validateDependencies(dependencies)
  return (request: CodeChangeRunRequest, callerSignal: AbortSignal) => {
    const controller = new AbortController()
    const forwardCancellation = (): void => {
      if (!controller.signal.aborted) {
        controller.abort(callerSignal.reason)
      }
    }
    if (callerSignal.aborted) forwardCancellation()
    else callerSignal.addEventListener('abort', forwardCancellation, { once: true })

    let settled = false
    const done = Promise.resolve()
      .then(() => executeChange(dependencies, request, controller.signal))
      .finally(() => {
        settled = true
        callerSignal.removeEventListener('abort', forwardCancellation)
      })
    // A Queue owner normally observes `done`; keep an abandoned handle from
    // producing an unhandled rejection while preserving the rejecting promise.
    void done.catch(() => undefined)
    return Object.freeze({
      done,
      async cancel(reason: string): Promise<void> {
        if (!settled && !controller.signal.aborted) {
          controller.abort(new Error(`Delivery Codex cancellation: ${reason}`))
        }
        try {
          await done
        } catch (error: unknown) {
          if (
            error instanceof DeliveryCodexRunnerError
            && error.code === 'cleanup'
          ) {
            throw error
          }
        }
      },
    })
  }
}
