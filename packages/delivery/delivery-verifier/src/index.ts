/**
 * Independent fixed-plan verification runner for Personal Delivery.
 *
 * @module @changanhua/dsh-delivery-verifier
 */

import { lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import {
  DeliveryEvidenceError,
  type BoundDeliveryEvidenceWriter,
  type StoredDeliveryEvidence,
} from '@changanhua/dsh-delivery-evidence'
import {
  DELIVERY_SCHEMA_VERSION,
  RepositoryRelativePath,
  VerificationVerdictId,
  canonicalDigest,
  canonicalJson,
  changedPathBoundaryFindings,
  completionClaimEvidenceFindings,
  completionClaimSchema,
  contractRevisionSchema,
  evidenceBytesDigest,
  evidenceRefSchema,
  resolvedCodeVerifySchema,
  verificationCheckDigest,
  verificationVerdictSchema,
  workPacketSchema,
  type EvidenceIntegrityFinding,
  type CompletionClaim,
  type ContractRevision,
  type EvidenceId,
  type EvidenceRef,
  type QueueAttemptIdRef,
  type QueueWorkIdRef,
  type ResolvedCodeVerify,
  type VerificationCheckResult,
  type VerificationCheckId,
  type VerificationVerdict,
  type WorkPacket,
} from '@changanhua/dsh-delivery-protocol'
import type {
  RepositoryRangeFacts,
  VerificationWorkspaceLease,
} from '@changanhua/dsh-repo-workspace'
import type {
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessRuntime,
} from '@deepseek-ai/dsh-subprocess'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Hard ceiling for the configured per-check `verification-output` byte budget. */
export const MAX_VERIFICATION_OUTPUT_BYTES = 64 * 1024 * 1024

/** Stable non-verdict failure classification for configuration, authority, infrastructure, cancellation, and cleanup. */
export type DeliveryVerifierErrorCode =
  | 'configuration'
  | 'invalid-request'
  | 'workspace-boundary'
  | 'execution'
  | 'canceled'
  | 'cleanup'

/** Typed verifier infrastructure, authority, cancellation, or cleanup failure. */
export class DeliveryVerifierError extends Error {
  /**
   * @param code - Stable verifier failure classification.
   * @param message - Human-readable diagnostic.
   * @param options - Optional underlying failure.
   */
  constructor(
    readonly code: DeliveryVerifierErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'DeliveryVerifierError'
  }
}

/** Trusted host dependencies fixed before one verifier closure is created. */
export interface DeliveryVerifierDependencies {
  /** Shared subprocess capability used for trusted fixed-argv checks. */
  readonly subprocess: Pick<SubprocessRuntime, 'spawn'>
  /** Stable implementation identity retained in every verdict. */
  readonly verifierVersion: string
  /** Grace in milliseconds for terminating a verification subprocess tree. */
  readonly disposeGraceMs: number
  /** Complete byte cap for one saved check-output record; each Subprocess stream collector uses the same upper bound. */
  readonly verificationOutputBytes: number
}

/** Successful code-change claim eligible for immutable-target verification. */
export type CompletedChangeClaim = Extract<
  CompletionClaim,
  { readonly disposition: 'completed' }
>

/** Attempt-local inputs assembled by the Queue bridge. */
export interface DeliveryVerificationRunRequest {
  readonly contract: ContractRevision
  readonly packet: WorkPacket
  readonly resolved: ResolvedCodeVerify
  /**
   * Completed change Result already cross-checked by the Queue bridge: packet ids match and
   * checkpointCommit equals resolved.targetCommit exactly. The verifier reads
   * every required object named by completionClaim.evidenceIds.
   */
  readonly completionClaim: CompletedChangeClaim
  /** Queue Work that owns this independent verification execution. */
  readonly verificationQueueWorkId: QueueWorkIdRef
  /** Queue Attempt that owns the verification workspace and output evidence. */
  readonly verificationQueueAttemptId: QueueAttemptIdRef
  /** Independently derive ancestry and complete changed-path facts. */
  readonly inspectRange: (signal: AbortSignal) => Promise<RepositoryRangeFacts>
  /** Open the read/execute-only Attempt checkout only when verification starts. */
  readonly openWorkspace: (signal: AbortSignal) => Promise<VerificationWorkspaceLease>
  /** Bind evidence provenance to the exact planned verification check. */
  readonly evidenceFor: (checkId: VerificationCheckId) => BoundDeliveryEvidenceWriter
  /** Resolve a durable evidence id before integrity-checked byte reads. */
  readonly resolveEvidence: (
    evidenceId: EvidenceId,
    signal: AbortSignal,
  ) => Promise<EvidenceRef | undefined>
  /** Read bytes only through the evidence provider's integrity boundary. */
  readonly readEvidence: (
    reference: EvidenceRef,
    signal: AbortSignal,
  ) => Promise<StoredDeliveryEvidence>
}

/** Live verifier ownership published synchronously at the side-effect boundary. */
export interface DeliveryVerificationRun {
  /** Resolves with a Protocol-valid verdict after lease cleanup, or rejects on non-verdict failures. */
  readonly done: Promise<VerificationVerdict>
  /** Terminate active process work and resolve after `done` has settled and lease cleanup has completed. */
  cancel(reason: string): Promise<void>
}

/** Start independent verification and synchronously return its cancellation/settlement owner. */
export type StartDeliveryVerification = (
  request: DeliveryVerificationRunRequest,
  signal: AbortSignal,
) => DeliveryVerificationRun

function configuration(message: string): DeliveryVerifierError {
  return new DeliveryVerifierError('configuration', message)
}

function invalidRequest(message: string, cause?: unknown): DeliveryVerifierError {
  return new DeliveryVerifierError(
    'invalid-request',
    message,
    cause === undefined ? undefined : { cause },
  )
}

function verifierFailure(
  code: DeliveryVerifierErrorCode,
  message: string,
  cause?: unknown,
): DeliveryVerifierError {
  return new DeliveryVerifierError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  )
}

function cancellation(signal: AbortSignal): DeliveryVerifierError {
  return signal.reason instanceof DeliveryVerifierError
    && signal.reason.code === 'canceled'
    ? signal.reason
    : verifierFailure('canceled', 'verification was canceled', signal.reason)
}

function throwIfCanceled(signal: AbortSignal): void {
  if (signal.aborted) throw cancellation(signal)
}

async function callProvider<T>(
  signal: AbortSignal,
  message: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    // The signal can change while the asynchronous provider operation is pending.
    if (signal.aborted) throw cancellation(signal)
    throw verifierFailure('execution', message, error)
  }
}

function validateDependencies(
  dependencies: DeliveryVerifierDependencies,
): void {
  if (dependencies.verifierVersion.trim() === '') {
    throw configuration('verifierVersion must not be blank')
  }
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
    !Number.isSafeInteger(dependencies.verificationOutputBytes)
    || dependencies.verificationOutputBytes < 1
    || dependencies.verificationOutputBytes > MAX_VERIFICATION_OUTPUT_BYTES
  ) {
    throw configuration(
      `verificationOutputBytes must be a positive safe integer no greater than ${MAX_VERIFICATION_OUTPUT_BYTES}`,
    )
  }
}

async function verifyRequiredEvidence(
  request: DeliveryVerificationRunRequest,
  signal: AbortSignal,
): Promise<{
  readonly references: readonly EvidenceRef[]
  readonly findings: readonly EvidenceIntegrityFinding[]
}> {
  const references: EvidenceRef[] = []
  const findings: EvidenceIntegrityFinding[] = []
  for (const evidenceId of request.completionClaim.evidenceIds) {
    const reference = await callProvider(
      signal,
      `required evidence '${evidenceId}' could not be resolved`,
      () => request.resolveEvidence(evidenceId, signal),
    )
    throwIfCanceled(signal)
    if (reference === undefined) {
      findings.push({ evidenceId, required: true, status: 'missing' })
      continue
    }
    if (reference.id !== evidenceId) {
      findings.push({ evidenceId, required: true, status: 'digest-mismatch' })
      continue
    }
    references.push(reference)
    let stored: StoredDeliveryEvidence
    try {
      stored = await request.readEvidence(reference, signal)
      throwIfCanceled(signal)
    } catch (error) {
      // The signal can change while the asynchronous evidence read is pending.
      if (signal.aborted) throw cancellation(signal)
      if (error instanceof DeliveryEvidenceError) {
        const status = error.code === 'not-found'
          ? 'missing' as const
          : error.code === 'length-mismatch'
            ? 'size-mismatch' as const
            : error.code === 'digest-mismatch' || error.code === 'reference-mismatch'
              ? 'digest-mismatch' as const
              : undefined
        if (status !== undefined) {
          findings.push({ evidenceId, required: true, status })
          continue
        }
      }
      throw verifierFailure(
        'execution',
        `required evidence '${evidenceId}' could not be integrity-read`,
        error,
      )
    }
    const status = stored.data.byteLength !== reference.byteLength
      ? 'size-mismatch' as const
      : evidenceBytesDigest(stored.data) !== reference.digest
        || canonicalJson(stored.ref) !== canonicalJson(reference)
        ? 'digest-mismatch' as const
        : 'verified' as const
    findings.push({
      evidenceId,
      required: true,
      status,
    })
  }
  return { references, findings }
}

function completionEvidenceProvenanceFindings(
  claim: CompletedChangeClaim,
  references: readonly EvidenceRef[],
): readonly string[] {
  const byId = new Map(references.map(reference => [reference.id, reference]))
  const findings: string[] = []
  for (const evidenceId of claim.evidenceIds) {
    const reference = byId.get(evidenceId)
    if (reference === undefined) continue
    const provenance = reference.provenance
    if (
      provenance.kind !== 'change-attempt'
      || provenance.packetId !== claim.packetId
      || provenance.queueWorkId !== claim.queueWorkId
      || provenance.queueAttemptId !== claim.queueAttemptId
    ) {
      findings.push(`completion evidence '${evidenceId}' does not match its producing change Attempt`)
    }
  }
  return findings
}

function validateRequest(
  request: DeliveryVerificationRunRequest,
): DeliveryVerificationRunRequest {
  let contract: ContractRevision
  let packet: WorkPacket
  let resolved: ResolvedCodeVerify
  let completionClaim: CompletionClaim
  try {
    contract = contractRevisionSchema.parse(request.contract)
    packet = workPacketSchema.parse(request.packet)
    resolved = resolvedCodeVerifySchema.parse(request.resolved)
    completionClaim = completionClaimSchema.parse(request.completionClaim)
  } catch (cause) {
    throw invalidRequest('verification request does not match the frozen Protocol schemas', cause)
  }
  if (completionClaim.disposition !== 'completed') {
    throw invalidRequest('verification requires a completed change claim')
  }
  if (
    typeof request.verificationQueueWorkId !== 'string'
    || request.verificationQueueWorkId.trim() === ''
  ) {
    throw invalidRequest('verification Queue Work identity must not be blank')
  }
  if (
    typeof request.verificationQueueAttemptId !== 'string'
    || request.verificationQueueAttemptId.trim() === ''
  ) {
    throw invalidRequest('verification Queue Attempt identity must not be blank')
  }
  if (request.verificationQueueWorkId === completionClaim.queueWorkId) {
    throw invalidRequest('verification Queue Work must differ from the producing change Work')
  }
  if (request.verificationQueueAttemptId === completionClaim.queueAttemptId) {
    throw invalidRequest('verification Queue Attempt must differ from the producing change Attempt')
  }
  if (
    contract.id !== packet.contractRevisionId
    || contract.id !== resolved.contractRevisionId
  ) {
    throw invalidRequest('Contract identity does not match Packet and resolved verification input')
  }
  if (
    packet.id !== resolved.packetId
    || packet.id !== completionClaim.packetId
  ) {
    throw invalidRequest('Packet identity does not match resolved verification input and completion claim')
  }
  if (
    packet.repositoryId !== resolved.repositoryId
    || packet.baseCommit !== resolved.baseCommit
  ) {
    throw invalidRequest('resolved repository and base must match the immutable Packet')
  }
  if (contract.repositoryId !== packet.repositoryId) {
    throw invalidRequest('Contract repository must match the immutable Packet repository')
  }
  if (completionClaim.checkpointCommit !== resolved.targetCommit) {
    throw invalidRequest('completed checkpoint commit must match the resolved verification target')
  }
  if (canonicalJson(packet.verificationPlan) !== canonicalJson(resolved.trustedPlan)) {
    throw invalidRequest('resolved trusted plan must equal the immutable Packet plan')
  }
  return {
    ...request,
    contract,
    packet,
    resolved,
    completionClaim,
  }
}

function snapshotRangeFacts(
  range: unknown,
  request: DeliveryVerificationRunRequest,
): RepositoryRangeFacts {
  if (range === null || typeof range !== 'object') {
    throw invalidRequest('range facts do not match the repository range contract')
  }
  const candidate = range as Partial<RepositoryRangeFacts>
  if (
    candidate.repositoryId !== request.packet.repositoryId
    || candidate.baseCommit !== request.packet.baseCommit
    || candidate.targetCommit !== request.resolved.targetCommit
  ) {
    throw invalidRequest('range facts do not match the Packet repository, base, and target')
  }
  if (typeof candidate.descendsFromBase !== 'boolean' || !Array.isArray(candidate.changedPaths)) {
    throw invalidRequest('range facts do not match the repository range contract')
  }
  const changedPaths: RepositoryRelativePath[] = []
  const seen = new Set<string>()
  try {
    for (const path of candidate.changedPaths) {
      if (typeof path !== 'string') throw new TypeError('changed path must be a string')
      const normalized = RepositoryRelativePath(path)
      if (seen.has(normalized)) continue
      seen.add(normalized)
      changedPaths.push(normalized)
    }
  } catch (cause) {
    throw invalidRequest('range facts contain a non-normalized changed path', cause)
  }
  return Object.freeze({
    repositoryId: candidate.repositoryId,
    baseCommit: candidate.baseCommit,
    targetCommit: candidate.targetCommit,
    descendsFromBase: candidate.descendsFromBase,
    changedPaths: Object.freeze(changedPaths),
  })
}

function physicallyContained(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot === ''
    || (!isAbsolute(pathFromRoot)
      && pathFromRoot !== '..'
      && !pathFromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`))
}

async function resolveCheckCwd(
  workspaceRoot: string,
  cwd: DeliveryVerificationRunRequest['resolved']['trustedPlan']['checks'][number]['cwd'],
): Promise<string> {
  try {
    await lstat(workspaceRoot)
    const physicalRoot = await realpath(workspaceRoot)
    const lexicalCandidate = cwd === '.' ? workspaceRoot : resolve(workspaceRoot, cwd)
    await lstat(lexicalCandidate)
    const physicalCandidate = await realpath(lexicalCandidate)
    if (!physicallyContained(physicalRoot, physicalCandidate)) {
      throw new DeliveryVerifierError(
        'workspace-boundary',
        `verification cwd '${cwd}' resolves outside the workspace lease`,
      )
    }
    if (!(await stat(physicalCandidate)).isDirectory()) {
      throw new DeliveryVerifierError(
        'workspace-boundary',
        `verification cwd '${cwd}' is not a directory`,
      )
    }
    return physicalCandidate
  } catch (cause) {
    if (cause instanceof DeliveryVerifierError) throw cause
    throw new DeliveryVerifierError(
      'workspace-boundary',
      `verification cwd '${cwd}' cannot be resolved inside the workspace lease`,
      { cause },
    )
  }
}

function verificationOutput(
  stdout: string,
  stderr: string,
  outcome: SubprocessOutcome,
  timedOut: boolean,
  maxBytes: number,
): Uint8Array {
  const encoded = new TextEncoder().encode([
    `exitCode=${outcome.exitCode === null ? 'null' : String(outcome.exitCode)}`,
    `signal=${outcome.signal ?? 'null'}`,
    `timedOut=${String(timedOut)}`,
    '--- stdout ---',
    stdout,
    '--- stderr ---',
    stderr,
  ].join('\n'))
  if (encoded.byteLength <= maxBytes) return encoded
  let end = maxBytes
  while (end > 0) {
    const firstExcludedByte = encoded[end]
    if (firstExcludedByte === undefined || (firstExcludedByte & 0xc0) !== 0x80) break
    end -= 1
  }
  return encoded.slice(0, end)
}

interface LiveProcessState {
  handle: SubprocessHandle | undefined
  quiescent: boolean
}

async function runCheck(
  dependencies: DeliveryVerifierDependencies,
  request: DeliveryVerificationRunRequest,
  check: DeliveryVerificationRunRequest['resolved']['trustedPlan']['checks'][number],
  cwd: string,
  signal: AbortSignal,
  live: LiveProcessState,
): Promise<{
  readonly result: VerificationCheckResult
  readonly outputReference: EvidenceRef
  readonly outputFinding: EvidenceIntegrityFinding
}> {
  throwIfCanceled(signal)
  const startedAt = Date.now()
  const timeoutController = new AbortController()
  const processSignal = AbortSignal.any([signal, timeoutController.signal])
  let cause: 'canceled' | 'timeout' | undefined
  const requestTermination = (next: 'canceled' | 'timeout') => {
    cause ??= next
    if (next === 'timeout' && !timeoutController.signal.aborted) {
      timeoutController.abort(verifierFailure(
        'execution',
        `verification check '${check.id}' exceeded ${check.timeoutMs}ms`,
      ))
    }
    live.handle?.terminate()
  }
  const onAbort = () => { requestTermination('canceled') }
  signal.addEventListener('abort', onAbort, { once: true })
  /* v8 ignore next -- no await or callback boundary exists between the initial cancellation guard and listener installation. */
  if (signal.aborted) onAbort()
  const timeout = setTimeout(() => { requestTermination('timeout') }, check.timeoutMs)
  let timerCleared = false
  try {
    let handle: SubprocessHandle
    try {
      handle = dependencies.subprocess.spawn({
        argv: Array.from(check.argv),
        cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: dependencies.verificationOutputBytes },
          stderr: { maxBytes: dependencies.verificationOutputBytes },
        },
        graceMs: dependencies.disposeGraceMs,
        signal: processSignal,
      })
    } catch (error) {
      if (signal.aborted || cause === 'canceled') throw cancellation(signal)
      throw verifierFailure(
        'execution',
        `verification check '${check.id}' failed to spawn`,
        error,
      )
    }
    live.handle = handle
    live.quiescent = false
    if (cause !== undefined) handle.terminate()
    let outcome: SubprocessOutcome
    try {
      outcome = await handle.done
    } catch (error) {
      // The Subprocess contract rejects `done` only when spawn never started.
      live.quiescent = true
      live.handle = undefined
      if (signal.aborted || cause === 'canceled') throw cancellation(signal)
      throw verifierFailure(
        'execution',
        `verification check '${check.id}' process handle failed`,
        error,
      )
    }
    let quiescent: boolean
    try {
      quiescent = await handle.waitForExit()
    } catch (error) {
      throw verifierFailure(
        'execution',
        `verification check '${check.id}' process-tree wait failed`,
        error,
      )
    }
    if (!quiescent) {
      throw verifierFailure(
        'execution',
        `verification check '${check.id}' process tree did not quiesce`,
      )
    }
    live.quiescent = true
    live.handle = undefined
    clearTimeout(timeout)
    timerCleared = true
    if (signal.aborted || cause === 'canceled') throw cancellation(signal)
    const timedOut = cause === 'timeout'
    if (outcome.exitCode === null && !timedOut) {
      throw verifierFailure(
        'execution',
        `verification check '${check.id}' exited without a numeric code`,
      )
    }
    const stdoutReader = handle.collected.stdout
    const stderrReader = handle.collected.stderr
    if (stdoutReader === undefined || stderrReader === undefined) {
      throw verifierFailure(
        'execution',
        `verification check '${check.id}' collect-mode output readers are unavailable`,
      )
    }
    let output: Uint8Array
    try {
      output = verificationOutput(
        stdoutReader.readFrom(0).text,
        stderrReader.readFrom(0).text,
        outcome,
        timedOut,
        dependencies.verificationOutputBytes,
      )
    } catch (error) {
      throw verifierFailure(
        'execution',
        `verification check '${check.id}' collected output could not be read`,
        error,
      )
    }
    let outputReference: EvidenceRef
    try {
      outputReference = await request.evidenceFor(check.id).save({
        kind: 'verification-output',
        mediaType: 'text/plain; charset=utf-8',
        data: output,
      }, signal)
    } catch (error) {
      // `AbortSignal.aborted` can change while the asynchronous evidence write is pending.
      throwIfCanceled(signal)
      throw verifierFailure(
        'execution',
        `verification check '${check.id}' output evidence could not be published`,
        error,
      )
    }
    throwIfCanceled(signal)
    try {
      outputReference = evidenceRefSchema.parse(outputReference)
    } catch (error) {
      throw verifierFailure(
        'execution',
        `verification check '${check.id}' output writer returned an invalid EvidenceRef`,
        error,
      )
    }
    const provenance = outputReference.provenance
    if (
      outputReference.kind !== 'verification-output'
      || outputReference.mediaType !== 'text/plain; charset=utf-8'
      || outputReference.byteLength !== output.byteLength
      || outputReference.digest !== evidenceBytesDigest(output)
      || provenance.kind !== 'verification-check'
      || provenance.packetId !== request.packet.id
      || provenance.queueWorkId !== request.verificationQueueWorkId
      || provenance.queueAttemptId !== request.verificationQueueAttemptId
      || provenance.checkId !== check.id
    ) {
      throw verifierFailure(
        'execution',
        `verification check '${check.id}' output evidence is not bound to its exact bytes and provenance`,
      )
    }
    const common = {
      checkId: check.id,
      checkDigest: verificationCheckDigest(check),
      severity: check.severity,
      durationMs: Math.max(0, Date.now() - startedAt),
      evidenceIds: [outputReference.id],
    }
    const result: VerificationCheckResult = timedOut
      ? { ...common, status: 'timed-out' }
      : {
        ...common,
        status: 'exited',
        exitCode: outcome.exitCode as number,
        expected: check.expectedExitCodes.includes(outcome.exitCode as number),
      }
    return {
      result,
      outputReference,
      outputFinding: {
        evidenceId: outputReference.id,
        required: check.severity === 'required',
        status: 'verified',
      },
    }
  } finally {
    if (!timerCleared) clearTimeout(timeout)
    signal.removeEventListener('abort', onAbort)
  }
}

async function executeVerification(
  dependencies: DeliveryVerifierDependencies,
  request: DeliveryVerificationRunRequest,
  signal: AbortSignal,
): Promise<VerificationVerdict> {
  throwIfCanceled(signal)
  request = validateRequest(request)
  const evidence = await verifyRequiredEvidence(request, signal)
  const inspectedRange = await callProvider(
    signal,
    'verification range facts could not be inspected',
    () => request.inspectRange(signal),
  )
  throwIfCanceled(signal)
  const range = snapshotRangeFacts(inspectedRange, request)
  const workspace = await callProvider(
    signal,
    'verification workspace could not be opened',
    () => request.openWorkspace(signal),
  )
  const checkResults: VerificationCheckResult[] = []
  const outputReferences: EvidenceRef[] = []
  const outputFindings: EvidenceIntegrityFinding[] = []
  const evidenceIds = new Set(request.completionClaim.evidenceIds)
  const live: LiveProcessState = { handle: undefined, quiescent: true }
  let verdict!: VerificationVerdict
  let failure: Error | undefined
  try {
    throwIfCanceled(signal)
    if (
      workspace.repositoryId !== request.packet.repositoryId
      || workspace.baseCommit !== request.packet.baseCommit
      || workspace.targetCommit !== request.resolved.targetCommit
      || workspace.ownerAttemptId !== request.verificationQueueAttemptId
    ) {
      throw invalidRequest('verification workspace lease does not match the Packet repository, base, target, and Attempt')
    }
    const runnableChecks: Array<{
      readonly check: DeliveryVerificationRunRequest['resolved']['trustedPlan']['checks'][number]
      readonly cwd: string
    }> = []
    for (const check of request.resolved.trustedPlan.checks) {
      runnableChecks.push({
        check,
        cwd: await resolveCheckCwd(workspace.cwd, check.cwd),
      })
    }
    for (const { check, cwd } of runnableChecks) {
      throwIfCanceled(signal)
      const completed = await runCheck(
        dependencies,
        request,
        check,
        cwd,
        signal,
        live,
      )
      if (evidenceIds.has(completed.outputReference.id)) {
        throw verifierFailure(
          'execution',
          `verification check '${check.id}' reused evidence id '${completed.outputReference.id}'`,
        )
      }
      evidenceIds.add(completed.outputReference.id)
      checkResults.push(completed.result)
      outputReferences.push(completed.outputReference)
      outputFindings.push(completed.outputFinding)
    }
    const verdictEvidenceIds = [
      ...request.completionClaim.evidenceIds,
      ...outputReferences.map(reference => reference.id),
    ]
    const changedPathFindings = changedPathBoundaryFindings(
      range.changedPaths,
      request.packet.allowedPaths,
      request.packet.forbiddenPaths,
    )
    const failedReasons: string[] = []
    const reviewReasons: string[] = []
    if (!range.descendsFromBase) {
      failedReasons.push('target commit does not descend from the Packet base commit')
    }
    for (const finding of changedPathFindings) {
      failedReasons.push(`changed path '${finding.path}' is ${finding.kind}`)
    }
    for (const finding of evidence.findings) {
      if (finding.status !== 'verified') {
        failedReasons.push(`required evidence '${finding.evidenceId}' is ${finding.status}`)
      }
    }
    failedReasons.push(...completionClaimEvidenceFindings(
      request.completionClaim,
      evidence.references,
    ))
    failedReasons.push(...completionEvidenceProvenanceFindings(
      request.completionClaim,
      evidence.references,
    ))
    for (const result of checkResults) {
      const reason = result.status === 'timed-out'
        ? `${result.severity} check '${result.checkId}' timed out`
        : result.expected
          ? undefined
          : `${result.severity} check '${result.checkId}' exited with unexpected code ${result.exitCode}`
      if (reason === undefined) continue
      if (result.severity === 'required') failedReasons.push(reason)
      else reviewReasons.push(reason)
    }
    const status = failedReasons.length !== 0
      ? 'failed' as const
      : reviewReasons.length !== 0
        ? 'needs-human-review' as const
        : 'passed' as const
    const verdictFields = {
      schemaVersion: DELIVERY_SCHEMA_VERSION,
      packetId: request.packet.id,
      targetCommit: request.resolved.targetCommit,
      baseCommit: request.packet.baseCommit,
      verificationPlanDigest: request.packet.verificationPlan.digest,
      status,
      ancestryResult: range.descendsFromBase ? 'descendant' as const : 'not-descendant' as const,
      checkResults,
      evidenceIntegrityFindings: [...evidence.findings, ...outputFindings],
      changedPathFindings,
      evidenceIds: verdictEvidenceIds,
      verifierVersion: dependencies.verifierVersion,
      reviewReasons: [...failedReasons, ...reviewReasons],
    }
    verdict = verificationVerdictSchema.parse({
      ...verdictFields,
      id: VerificationVerdictId(`verification-verdict:${canonicalDigest(verdictFields)}`),
      completedAt: new Date().toISOString(),
    })
  } catch (error) {
    failure = error instanceof Error
      ? error
      : verifierFailure('execution', 'verification failed with a non-Error rejection', error)
  }
  try {
    await workspace.close(live.quiescent ? 'remove' : 'preserve')
  } catch (cleanupError) {
    const canceled = signal.aborted
      && !(failure instanceof DeliveryVerifierError && failure.code === 'canceled')
      ? cancellation(signal)
      : undefined
    const causes: unknown[] = [
      ...failure === undefined ? [] : [failure],
      ...canceled === undefined ? [] : [canceled],
      cleanupError,
    ]
    throw verifierFailure(
      'cleanup',
      `verification workspace cleanup failed after ${failure === undefined ? 'settlement' : 'an earlier failure'}`,
      causes.length === 1
        ? cleanupError
        : new AggregateError(causes, 'verification settlement and cleanup both failed'),
    )
  }
  if (failure === undefined) throwIfCanceled(signal)
  if (failure !== undefined) throw failure
  return verdict
}

function startRun(
  dependencies: DeliveryVerifierDependencies,
  request: DeliveryVerificationRunRequest,
  signal: AbortSignal,
): DeliveryVerificationRun {
  const controller = new AbortController()
  const combined = AbortSignal.any([signal, controller.signal])
  const done = executeVerification(dependencies, request, combined)
  return Object.freeze({
    done,
    async cancel(reason: string): Promise<void> {
      controller.abort(verifierFailure(
        'canceled',
        reason.trim() === '' ? 'verification was canceled' : reason,
      ))
      await done.catch(() => undefined)
    },
  })
}

/**
 * Create an independent Delivery verifier closure.
 *
 * @param dependencies - Trusted subprocess capability and verifier identity.
 * @returns a stable closure that executes one trusted immutable verification plan.
 */
export function createDeliveryVerifier(
  dependencies: DeliveryVerifierDependencies,
): StartDeliveryVerification {
  validateDependencies(dependencies)
  return (
    request: DeliveryVerificationRunRequest,
    signal: AbortSignal,
  ) => startRun(dependencies, request, signal)
}
