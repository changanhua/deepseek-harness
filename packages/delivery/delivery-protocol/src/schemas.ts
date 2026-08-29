/** Strict Zod schemas for every durable Delivery Protocol V1 object. */

import { z } from 'zod'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  AcceptanceClauseId,
  AcceptanceDecisionId,
  CompletionClaimId,
  ContractRevisionId,
  DispatchBindingId,
  EvidenceId,
  ExecutorId,
  GitBlobId,
  GitCommitId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RepositoryId,
  RepositoryRelativePath,
  Sha256Digest,
  SourceRefId,
  VerificationCheckId,
  VerificationVerdictId,
  WorkPacketId,
} from './brand.ts'
import { sourceRefContentDigest, verificationPlanDigest, workPacketDigest } from './canonical.ts'
import {
  isCanonicalGitHubIssueUrl,
  isGitHubRepositoryName,
  isGitHubRepositoryOwner,
} from './github.ts'
import type {
  AcceptanceClause,
  AcceptanceDecision,
  BaseSelectionRule,
  ChangedPathFinding,
  CodeChangeIntent,
  CodeChangeOutput,
  CodeVerifyIntent,
  CodeVerifyOutput,
  CompletionClaim,
  ContractRevision,
  ContractVerificationSource,
  DispatchBinding,
  EvidenceIntegrityFinding,
  EvidenceProvenance,
  EvidenceRef,
  ExecutorPreference,
  GitHubRepositoryRef,
  OpenDecision,
  PathRule,
  ReferenceLink,
  ResolvedCodeChange,
  ResolvedCodeVerify,
  ResumeAttemptFacts,
  ResumeCapsuleContent,
  ResumeFailingCheck,
  SourceRef,
  VerificationCheck,
  VerificationCheckResult,
  VerificationPlan,
  VerificationPlanDocument,
  VerificationPlanProvenance,
  VerificationVerdict,
  WorkPacket,
} from './types.ts'

/** Durable protocol version accepted by every V1 object schema. */
export const DELIVERY_SCHEMA_VERSION = 1 as const
/** Ownerless Queue kind that performs one bounded code change. */
export const CODE_CHANGE_KIND = 'code.change@1' as const
/** Ownerless Queue kind that independently verifies one immutable commit. */
export const CODE_VERIFY_KIND = 'code.verify@1' as const

const schemaVersionSchema = z.literal(DELIVERY_SCHEMA_VERSION)
const nonBlankString = z.string().refine(value => value.trim().length > 0, { message: 'must be non-blank' })
const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const positiveSafeInteger = nonNegativeSafeInteger.min(1)
const exitCodeSchema = z.number().int().min(0).max(255)

function branded<T extends string>(factory: (value: string) => T): z.ZodType<T> {
  return z.string().superRefine((value, context) => {
    try {
      factory(value)
    } catch (error) {
      context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'invalid branded value' })
    }
  }).transform(factory)
}

const sourceRefIdSchema = branded(SourceRefId)
const contractRevisionIdSchema = branded(ContractRevisionId)
const workPacketIdSchema = branded(WorkPacketId)
const dispatchBindingIdSchema = branded(DispatchBindingId)
const completionClaimIdSchema = branded(CompletionClaimId)
const verificationVerdictIdSchema = branded(VerificationVerdictId)
const acceptanceDecisionIdSchema = branded(AcceptanceDecisionId)
const evidenceIdSchema = branded(EvidenceId)
const acceptanceClauseIdSchema = branded(AcceptanceClauseId)
const verificationCheckIdSchema = branded(VerificationCheckId)
const repositoryIdSchema = branded(RepositoryId)
const executorIdSchema = branded(ExecutorId)
const queueWorkIdRefSchema = branded(QueueWorkIdRef)
const queueAttemptIdRefSchema = branded(QueueAttemptIdRef)
const gitCommitIdSchema = branded(GitCommitId)
const gitBlobIdSchema = branded(GitBlobId)
const sha256DigestSchema = branded(Sha256Digest)
const repositoryRelativePathSchema = branded(RepositoryRelativePath)

const utcInstantSchema = z.string().superRefine((value, context) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/u.exec(value)
  if (match === null) {
    context.addIssue({ code: 'custom', message: 'must be an RFC 3339 UTC instant ending in Z' })
    return
  }
  const [, year, month, day, hour, minute, second] = match
  const parts = [year, month, day, hour, minute, second].map(Number)
  const [y, m, d, h, min, sec] = parts
  if (y === undefined || m === undefined || d === undefined || h === undefined || min === undefined || sec === undefined
    || m < 1 || m > 12 || d < 1 || h > 23 || min > 59 || sec > 59) {
    context.addIssue({ code: 'custom', message: 'must be a valid RFC 3339 UTC instant' })
    return
  }
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (d > daysInMonth) context.addIssue({ code: 'custom', message: 'must be a valid calendar instant' })
})

function uniqueBy<T>(values: readonly T[], identity: (value: T) => string): boolean {
  return new Set(values.map(identity)).size === values.length
}

function uniqueStrings<T extends string>(schema: z.ZodType<T>) {
  return z.array(schema).refine(values => new Set(values).size === values.length, { message: 'must not contain duplicates' })
}

function uniqueNonEmptyStrings<T extends string>(schema: z.ZodType<T>) {
  return z.array(schema).min(1).refine(values => new Set(values).size === values.length, { message: 'must not contain duplicates' })
}

const gitHubRepositoryRefSchema = z.object({
  owner: z.string().refine(isGitHubRepositoryOwner, { message: 'must be a canonical GitHub owner' }),
  name: z.string().refine(isGitHubRepositoryName, { message: 'must be a canonical GitHub repository name' }),
}).strict() satisfies z.ZodType<GitHubRepositoryRef>

/** Runtime schema for an immutable GitHub Issue snapshot. */
export const sourceRefSchema: z.ZodType<SourceRef> = z.object({
  schemaVersion: schemaVersionSchema,
  id: sourceRefIdSchema,
  provider: z.literal('github'),
  repository: gitHubRepositoryRefSchema,
  issueNumber: positiveSafeInteger,
  canonicalUrl: z.url(),
  updatedAt: utcInstantSchema,
  title: nonBlankString,
  body: z.string(),
  contentDigest: sha256DigestSchema,
  createdAt: utcInstantSchema,
}).strict().superRefine((value, context) => {
  if (!isCanonicalGitHubIssueUrl(value.canonicalUrl, value.repository, value.issueNumber)) {
    context.addIssue({
      code: 'custom',
      path: ['canonicalUrl'],
      message: 'must be the canonical GitHub Issue URL for repository and issueNumber',
    })
  }
  if (value.contentDigest !== sourceRefContentDigest(value)) {
    context.addIssue({ code: 'custom', path: ['contentDigest'], message: 'does not match the title/body snapshot' })
  }
})

/** Runtime schema for one explicit, stable acceptance clause. */
export const acceptanceClauseSchema = z.object({
  id: acceptanceClauseIdSchema,
  text: nonBlankString,
}).strict() satisfies z.ZodType<AcceptanceClause>

/** Runtime schema for one explicit unresolved product decision. */
export const openDecisionSchema = z.object({
  id: nonBlankString,
  question: nonBlankString,
}).strict() satisfies z.ZodType<OpenDecision>

/** Runtime schema for a commit-pinned or point-in-time ref-head base rule. */
export const baseSelectionRuleSchema: z.ZodType<BaseSelectionRule> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('commit'), commit: gitCommitIdSchema }).strict(),
  z.object({ kind: z.literal('ref-head'), ref: nonBlankString }).strict(),
])

const POSIX_COMMAND_SHELLS = new Set(['ash', 'bash', 'dash', 'fish', 'ksh', 'sh', 'zsh'])
const POWERSHELL_COMMAND_OPTIONS = ['command', 'commandwithargs', 'encodedcommand'] as const

function executableName(value: string): string {
  const leaf = value.split(/[\\/]/u).at(-1)?.toLowerCase() ?? ''
  return leaf.endsWith('.exe') ? leaf.slice(0, -4) : leaf
}

function directShellCommandString(argv: readonly string[]): boolean {
  if (argv.length === 0) return false
  const executable = executableName(argv[0] as string)
  const options = argv.slice(1)
  if (POSIX_COMMAND_SHELLS.has(executable)) {
    return options.some(option => option === '--command' || /^-[^-]*c[^-]*$/u.test(option))
  }
  if (executable === 'pwsh' || executable === 'powershell') {
    return options.some((option) => {
      const normalized = option.replace(/^[-/]+/u, '').toLowerCase()
      return normalized.length > 0 && (normalized === 'c'
        || normalized === 'e'
        || POWERSHELL_COMMAND_OPTIONS.some(commandOption => commandOption.startsWith(normalized)))
    })
  }
  if (executable === 'cmd') {
    return options.some(option => /^\/[ck]$/iu.test(option))
  }
  return false
}

function containsShellCommandString(argv: readonly string[]): boolean {
  if (executableName(argv[0] ?? '') !== 'env') return directShellCommandString(argv)
  if (argv.some(token => token === '-S' || token === '--split-string' || token.startsWith('--split-string='))) {
    return true
  }
  return argv.slice(1).some((_token, index) => directShellCommandString(argv.slice(index + 1)))
}

/** Runtime schema for an exact or subtree repository path rule. */
export const pathRuleSchema = z.object({
  kind: z.enum(['exact', 'subtree']),
  path: repositoryRelativePathSchema,
}).strict() satisfies z.ZodType<PathRule>

/** Runtime schema for one trusted fixed-argv check. */
export const verificationCheckSchema: z.ZodType<VerificationCheck> = z.object({
  id: verificationCheckIdSchema,
  name: nonBlankString,
  argv: z.tuple([nonBlankString], z.string()).refine(
    argv => !containsShellCommandString(argv),
    { message: 'must not invoke a shell command-string mode' },
  ),
  cwd: z.union([z.literal('.'), repositoryRelativePathSchema]),
  timeoutMs: positiveSafeInteger.max(MAX_TIMER_DELAY_MS),
  severity: z.enum(['required', 'optional']),
  expectedExitCodes: z.array(exitCodeSchema).min(1).refine(
    values => new Set(values).size === values.length,
    { message: 'must not contain duplicate exit codes' },
  ),
}).strict()

const verificationChecksSchema: z.ZodType<readonly VerificationCheck[]> = z
  .array(verificationCheckSchema)
  .min(1)
  .refine(
    checks => uniqueBy(checks, check => check.id),
    { message: 'verification check ids must be unique' },
  )

/** Runtime schema for the exact Git-blob verification-plan document. */
export const verificationPlanDocumentSchema: z.ZodType<VerificationPlanDocument> = z.object({
  format: z.literal('delivery-verification-plan@1'),
  checks: verificationChecksSchema,
}).strict()

/** Runtime schema for the Contract-owned verification-plan source. */
export const contractVerificationSourceSchema: z.ZodType<ContractVerificationSource> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('contract-field'),
    checks: verificationChecksSchema,
  }).strict(),
  z.object({
    kind: z.literal('git-blob'),
    path: repositoryRelativePathSchema,
    format: z.literal('delivery-verification-plan@1'),
  }).strict(),
])

/** Runtime schema for one supporting Contract reference link. */
export const referenceLinkSchema = z.object({
  label: nonBlankString,
  url: z.url(),
}).strict() satisfies z.ZodType<ReferenceLink>

/** Runtime schema for a syntactically valid ready or not-ready Contract revision. */
export const contractRevisionSchema: z.ZodType<ContractRevision> = z.object({
  schemaVersion: schemaVersionSchema,
  id: contractRevisionIdSchema,
  previousRevisionId: contractRevisionIdSchema.nullable(),
  sourceRef: sourceRefSchema,
  repositoryId: repositoryIdSchema.nullable(),
  outcome: nonBlankString.nullable(),
  context: z.string(),
  allowedScope: uniqueStrings(nonBlankString),
  forbiddenScope: uniqueStrings(nonBlankString),
  acceptanceClauses: z.array(acceptanceClauseSchema).refine(
    clauses => uniqueBy(clauses, clause => clause.id),
    { message: 'acceptance clause ids must be unique' },
  ),
  openDecisions: z.array(openDecisionSchema).refine(
    decisions => uniqueBy(decisions, decision => decision.id),
    { message: 'open decision ids must be unique' },
  ),
  baseSelectionRule: baseSelectionRuleSchema.nullable(),
  verificationSource: contractVerificationSourceSchema.nullable(),
  referenceLinks: z.array(referenceLinkSchema),
  createdAt: utcInstantSchema,
}).strict()

const verificationPlanProvenanceSchema: z.ZodType<VerificationPlanProvenance> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('contract-field'),
    contractRevisionId: contractRevisionIdSchema,
    field: z.literal('verificationSource'),
  }).strict(),
  z.object({
    kind: z.literal('git-blob'),
    baseCommit: gitCommitIdSchema,
    path: repositoryRelativePathSchema,
    blobId: gitBlobIdSchema,
  }).strict(),
])

/** Runtime schema for a resolved trusted verification plan and its canonical digest. */
export const verificationPlanSchema: z.ZodType<VerificationPlan> = z.object({
  checks: verificationChecksSchema,
  provenance: verificationPlanProvenanceSchema,
  digest: sha256DigestSchema,
}).strict().superRefine((value, context) => {
  if (value.digest !== verificationPlanDigest(value)) {
    context.addIssue({ code: 'custom', path: ['digest'], message: 'does not match the resolved checks and provenance' })
  }
})

const executorPreferenceSchema: z.ZodType<ExecutorPreference> = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('any') }).strict(),
  z.object({ mode: z.literal('preferred'), executorId: executorIdSchema }).strict(),
  z.object({ mode: z.literal('required'), executorId: executorIdSchema }).strict(),
])

/** Runtime schema for one immutable bounded Packet and its canonical digest. */
export const workPacketSchema: z.ZodType<WorkPacket> = z.object({
  schemaVersion: schemaVersionSchema,
  id: workPacketIdSchema,
  contractRevisionId: contractRevisionIdSchema,
  repositoryId: repositoryIdSchema,
  baseCommit: gitCommitIdSchema,
  objective: nonBlankString,
  allowedPaths: z.array(pathRuleSchema),
  forbiddenPaths: z.array(pathRuleSchema),
  acceptanceClauseIds: uniqueStrings(acceptanceClauseIdSchema).min(1),
  verificationPlan: verificationPlanSchema,
  stopConditions: uniqueStrings(nonBlankString),
  executorPreference: executorPreferenceSchema,
  packetDigest: sha256DigestSchema,
  createdAt: utcInstantSchema,
}).strict().superRefine((value, context) => {
  if (value.allowedPaths.length === 0 && value.forbiddenPaths.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['allowedPaths'],
      message: 'a bounded Packet requires at least one allowed or forbidden path rule',
    })
  }
  if (value.verificationPlan.provenance.kind === 'contract-field'
    && value.verificationPlan.provenance.contractRevisionId !== value.contractRevisionId) {
    context.addIssue({
      code: 'custom',
      path: ['verificationPlan', 'provenance', 'contractRevisionId'],
      message: 'must match the Packet Contract revision',
    })
  }
  if (value.verificationPlan.provenance.kind === 'git-blob'
    && value.verificationPlan.provenance.baseCommit !== value.baseCommit) {
    context.addIssue({
      code: 'custom',
      path: ['verificationPlan', 'provenance', 'baseCommit'],
      message: 'must match the Packet base commit',
    })
  }
  const { id: _id, packetDigest: _packetDigest, createdAt: _createdAt, ...input } = value
  if (value.packetDigest !== workPacketDigest(input)) {
    context.addIssue({ code: 'custom', path: ['packetDigest'], message: 'does not match the immutable Packet content' })
  }
})

const bindingCommon = {
  schemaVersion: schemaVersionSchema,
  id: dispatchBindingIdSchema,
  packetId: workPacketIdSchema,
  inputDigest: sha256DigestSchema,
  idempotencyKey: nonBlankString,
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema,
}

/** Runtime schema for all four valid DispatchBinding phase/kind combinations. */
export const dispatchBindingSchema: z.ZodType<DispatchBinding> = z.union([
  z.object({ ...bindingCommon, phase: z.literal('submitting'), queueWorkId: z.null(), kind: z.literal(CODE_CHANGE_KIND), executorId: executorIdSchema }).strict(),
  z.object({ ...bindingCommon, phase: z.literal('bound'), queueWorkId: queueWorkIdRefSchema, kind: z.literal(CODE_CHANGE_KIND), executorId: executorIdSchema }).strict(),
  z.object({ ...bindingCommon, phase: z.literal('submitting'), queueWorkId: z.null(), kind: z.literal(CODE_VERIFY_KIND), executorId: z.null() }).strict(),
  z.object({ ...bindingCommon, phase: z.literal('bound'), queueWorkId: queueWorkIdRefSchema, kind: z.literal(CODE_VERIFY_KIND), executorId: z.null() }).strict(),
])

const claimCommon = {
  schemaVersion: schemaVersionSchema,
  id: completionClaimIdSchema,
  packetId: workPacketIdSchema,
  queueWorkId: queueWorkIdRefSchema,
  queueAttemptId: queueAttemptIdRefSchema,
  summary: nonBlankString,
  completedWork: z.array(nonBlankString),
  remainingWork: z.array(nonBlankString),
  changedPaths: uniqueStrings(repositoryRelativePathSchema),
  evidenceIds: uniqueStrings(evidenceIdSchema),
  resumeCapsuleEvidenceId: evidenceIdSchema.nullable(),
  createdAt: utcInstantSchema,
}

/** Runtime schema for the four truthful completion dispositions. */
export const completionClaimSchema: z.ZodType<CompletionClaim> = z.discriminatedUnion('disposition', [
  z.object({
    ...claimCommon,
    disposition: z.literal('completed'),
    checkpointCommit: gitCommitIdSchema,
    evidenceIds: uniqueNonEmptyStrings(evidenceIdSchema),
  }).strict(),
  z.object({ ...claimCommon, disposition: z.literal('blocked'), checkpointCommit: gitCommitIdSchema.nullable(), blocker: nonBlankString, nextSmallestAction: nonBlankString }).strict(),
  z.object({ ...claimCommon, disposition: z.literal('needs-decision'), checkpointCommit: gitCommitIdSchema.nullable(), question: nonBlankString }).strict(),
  z.object({ ...claimCommon, disposition: z.literal('needs-scope-change'), checkpointCommit: gitCommitIdSchema.nullable(), proposedScopeDelta: nonBlankString, reason: nonBlankString }).strict(),
])

const checkResultCommon = {
  checkId: verificationCheckIdSchema,
  checkDigest: sha256DigestSchema,
  severity: z.enum(['required', 'optional']),
  durationMs: nonNegativeSafeInteger,
  evidenceIds: uniqueNonEmptyStrings(evidenceIdSchema),
}

const verificationCheckResultSchema: z.ZodType<VerificationCheckResult> = z.discriminatedUnion('status', [
  z.object({ ...checkResultCommon, status: z.literal('exited'), exitCode: exitCodeSchema, expected: z.boolean() }).strict(),
  z.object({ ...checkResultCommon, status: z.literal('timed-out') }).strict(),
])

const evidenceIntegrityFindingSchema = z.object({
  evidenceId: evidenceIdSchema,
  required: z.boolean(),
  status: z.enum(['verified', 'missing', 'digest-mismatch', 'size-mismatch']),
}).strict() satisfies z.ZodType<EvidenceIntegrityFinding>

const changedPathFindingSchema = z.object({
  path: repositoryRelativePathSchema,
  kind: z.enum(['forbidden', 'outside-allowed']),
}).strict() satisfies z.ZodType<ChangedPathFinding>

/** Runtime schema for a verdict; `passed` enforces its locally provable obligations. */
export const verificationVerdictSchema: z.ZodType<VerificationVerdict> = z.object({
  schemaVersion: schemaVersionSchema,
  id: verificationVerdictIdSchema,
  packetId: workPacketIdSchema,
  targetCommit: gitCommitIdSchema,
  baseCommit: gitCommitIdSchema,
  verificationPlanDigest: sha256DigestSchema,
  status: z.enum(['passed', 'failed', 'needs-human-review']),
  ancestryResult: z.enum(['descendant', 'not-descendant']),
  checkResults: z.array(verificationCheckResultSchema).refine(
    results => uniqueBy(results, result => result.checkId),
    { message: 'verification check results must have unique check ids' },
  ),
  evidenceIntegrityFindings: z.array(evidenceIntegrityFindingSchema).refine(
    findings => uniqueBy(findings, finding => finding.evidenceId),
    { message: 'evidence integrity findings must have unique evidence ids' },
  ),
  changedPathFindings: z.array(changedPathFindingSchema),
  evidenceIds: uniqueNonEmptyStrings(evidenceIdSchema),
  verifierVersion: nonBlankString,
  reviewReasons: z.array(nonBlankString),
  completedAt: utcInstantSchema,
}).strict().superRefine((value, context) => {
  const manifestIds = new Set(value.evidenceIds)
  const requiredEvidenceIds = new Set(
    value.checkResults
      .filter(result => result.severity === 'required')
      .flatMap(result => result.evidenceIds),
  )
  for (const [index, result] of value.checkResults.entries()) {
    for (const evidenceId of result.evidenceIds) {
      if (!manifestIds.has(evidenceId)) {
        context.addIssue({
          code: 'custom',
          path: ['checkResults', index, 'evidenceIds'],
          message: `check evidence ${evidenceId} is absent from the verdict evidence manifest`,
        })
      }
    }
  }
  const findings = new Map(value.evidenceIntegrityFindings.map(finding => [finding.evidenceId, finding]))
  for (const evidenceId of value.evidenceIds) {
    const finding = findings.get(evidenceId)
    if (finding === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceIntegrityFindings'],
        message: `verdict evidence ${evidenceId} has no integrity finding`,
      })
    } else if (requiredEvidenceIds.has(evidenceId) && !finding.required) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceIntegrityFindings'],
        message: `required evidence ${evidenceId} is marked optional`,
      })
    }
  }
  for (const finding of value.evidenceIntegrityFindings) {
    if (!manifestIds.has(finding.evidenceId)) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceIntegrityFindings'],
        message: `integrity finding ${finding.evidenceId} is absent from the verdict evidence manifest`,
      })
    }
  }
  if (value.status === 'needs-human-review' && value.reviewReasons.length === 0) {
    context.addIssue({ code: 'custom', path: ['reviewReasons'], message: 'needs-human-review requires at least one reason' })
  }
  if (value.status !== 'passed') return
  if (value.ancestryResult !== 'descendant') {
    context.addIssue({ code: 'custom', path: ['ancestryResult'], message: 'a passed verdict requires descendant ancestry' })
  }
  if (value.checkResults.some(result => result.severity === 'required' && (result.status !== 'exited' || !result.expected))) {
    context.addIssue({ code: 'custom', path: ['checkResults'], message: 'a passed verdict requires every required check to exit as expected' })
  }
  if (value.changedPathFindings.length !== 0) {
    context.addIssue({ code: 'custom', path: ['changedPathFindings'], message: 'a passed verdict cannot contain path findings' })
  }
  if (value.evidenceIntegrityFindings.some(finding => finding.required && finding.status !== 'verified')) {
    context.addIssue({ code: 'custom', path: ['evidenceIntegrityFindings'], message: 'a passed verdict requires intact required evidence' })
  }
  if (value.reviewReasons.length !== 0) {
    context.addIssue({ code: 'custom', path: ['reviewReasons'], message: 'a passed verdict cannot retain review reasons' })
  }
})

/** Runtime schema for a human-only decision. Matching verdict semantics are checked separately. */
export const acceptanceDecisionSchema: z.ZodType<AcceptanceDecision> = z.object({
  schemaVersion: schemaVersionSchema,
  id: acceptanceDecisionIdSchema,
  packetId: workPacketIdSchema,
  targetCommit: gitCommitIdSchema,
  verdictId: verificationVerdictIdSchema,
  decision: z.enum(['accepted', 'rejected', 'waived']),
  reason: nonBlankString,
  actor: z.object({ kind: z.literal('human'), actorId: nonBlankString }).strict(),
  decisionNonce: nonBlankString,
  decidedAt: utcInstantSchema,
}).strict()

const evidenceProvenanceSchema: z.ZodType<EvidenceProvenance> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('change-attempt'),
    packetId: workPacketIdSchema,
    queueWorkId: queueWorkIdRefSchema,
    queueAttemptId: queueAttemptIdRefSchema,
  }).strict(),
  z.object({
    kind: z.literal('verification-check'),
    packetId: workPacketIdSchema,
    queueWorkId: queueWorkIdRefSchema,
    queueAttemptId: queueAttemptIdRefSchema,
    checkId: verificationCheckIdSchema,
  }).strict(),
])

/** Runtime schema for immutable content-addressed evidence metadata. */
export const evidenceRefSchema: z.ZodType<EvidenceRef> = z.object({
  schemaVersion: schemaVersionSchema,
  id: evidenceIdSchema,
  kind: z.enum(['log', 'git-diff-metadata', 'patch', 'checkpoint-metadata', 'verification-output', 'screenshot', 'resume-capsule']),
  mediaType: nonBlankString,
  uri: z.url(),
  byteLength: nonNegativeSafeInteger,
  digest: sha256DigestSchema,
  createdAt: utcInstantSchema,
  provenance: evidenceProvenanceSchema,
}).strict()

const resumeAttemptFactsSchema = z.object({
  queueWorkId: queueWorkIdRefSchema,
  queueAttemptId: queueAttemptIdRefSchema,
  status: z.enum(['starting', 'running', 'unknown', 'succeeded', 'failed', 'canceled']),
  sideEffect: z.enum(['not-started', 'started', 'unknown']),
  startedAt: utcInstantSchema,
  finishedAt: utcInstantSchema.nullable(),
}).strict() satisfies z.ZodType<ResumeAttemptFacts>

const resumeFailingCheckSchema = z.object({
  checkId: verificationCheckIdSchema,
  summary: nonBlankString,
  evidenceIds: uniqueStrings(evidenceIdSchema),
}).strict() satisfies z.ZodType<ResumeFailingCheck>

/** Runtime schema for compiled Resume Capsule content. */
export const resumeCapsuleContentSchema: z.ZodType<ResumeCapsuleContent> = z.object({
  schemaVersion: schemaVersionSchema,
  contractRevisionId: contractRevisionIdSchema,
  packetId: workPacketIdSchema,
  objective: nonBlankString,
  baseCommit: gitCommitIdSchema,
  checkpointCommit: gitCommitIdSchema.nullable(),
  completedChanges: z.array(nonBlankString),
  latestAttempt: resumeAttemptFactsSchema,
  failingChecks: z.array(resumeFailingCheckSchema),
  decisions: z.array(nonBlankString),
  rejectedApproaches: z.array(nonBlankString),
  openQuestions: z.array(nonBlankString),
  knownRisks: z.array(nonBlankString),
  nextSmallestAction: nonBlankString,
  relevantFiles: uniqueStrings(repositoryRelativePathSchema),
  evidenceIds: uniqueStrings(evidenceIdSchema),
  compiledAt: utcInstantSchema,
}).strict()

/** Runtime schema for `code.change@1` caller intent. */
export const codeChangeIntentSchema: z.ZodType<CodeChangeIntent> = z.object({ packetId: workPacketIdSchema }).strict()
/** Runtime schema for `code.change@1` admission-resolved data. */
export const resolvedCodeChangeSchema: z.ZodType<ResolvedCodeChange> = z.object({
  packetId: workPacketIdSchema,
  contractRevisionId: contractRevisionIdSchema,
  repositoryId: repositoryIdSchema,
  baseCommit: gitCommitIdSchema,
  executorId: executorIdSchema,
  policyDigest: sha256DigestSchema,
}).strict()
/** Runtime schema for successful `code.change@1` output. */
export const codeChangeOutputSchema: z.ZodType<CodeChangeOutput> = z.object({ completionClaim: completionClaimSchema }).strict()
/** Runtime schema for `code.verify@1` caller intent. */
export const codeVerifyIntentSchema: z.ZodType<CodeVerifyIntent> = z.object({
  packetId: workPacketIdSchema,
  targetCommit: gitCommitIdSchema,
  verificationPlanDigest: sha256DigestSchema,
}).strict()
/** Runtime schema for `code.verify@1` admission-resolved data. */
export const resolvedCodeVerifySchema: z.ZodType<ResolvedCodeVerify> = z.object({
  packetId: workPacketIdSchema,
  contractRevisionId: contractRevisionIdSchema,
  repositoryId: repositoryIdSchema,
  baseCommit: gitCommitIdSchema,
  targetCommit: gitCommitIdSchema,
  trustedPlan: verificationPlanSchema,
}).strict().superRefine((value, context) => {
  if (value.trustedPlan.provenance.kind === 'contract-field'
    && value.trustedPlan.provenance.contractRevisionId !== value.contractRevisionId) {
    context.addIssue({
      code: 'custom',
      path: ['trustedPlan', 'provenance', 'contractRevisionId'],
      message: 'must match the resolved Contract revision',
    })
  }
  if (value.trustedPlan.provenance.kind === 'git-blob'
    && value.trustedPlan.provenance.baseCommit !== value.baseCommit) {
    context.addIssue({
      code: 'custom',
      path: ['trustedPlan', 'provenance', 'baseCommit'],
      message: 'must match the resolved base commit',
    })
  }
})
/** Runtime schema for successful `code.verify@1` output. */
export const codeVerifyOutputSchema: z.ZodType<CodeVerifyOutput> = z.object({ verificationVerdict: verificationVerdictSchema }).strict()
