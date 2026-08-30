import {
  AcceptanceDecisionId,
  ContractRevisionId,
  EvidenceId,
  ExecutorId,
  GitCommitId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RepositoryId,
  Sha256Digest,
  WorkPacketId,
  acceptanceDecisionSchema,
  canonicalGitHubIssueUrl,
  codeChangeIntentSchema,
  codeChangeOutputSchema,
  codeVerifyIntentSchema,
  codeVerifyOutputSchema,
  completionClaimSchema,
  contractRevisionSchema,
  dispatchBindingSchema,
  evidenceRefSchema,
  resolvedCodeChangeSchema,
  resolvedCodeVerifySchema,
  resumeCapsuleContentSchema,
  sourceRefSchema,
  verificationPlanDocumentSchema,
  verificationPlanSchema,
  verificationVerdictSchema,
  workPacketSchema,
} from '@deepseek-ai/dsh-delivery-protocol'
import type {
  AcceptanceDecision,
  CodeChangeIntent,
  CodeChangeOutput,
  CodeVerifyIntent,
  CodeVerifyOutput,
  CompletionClaim,
  ContractRevision,
  DispatchBinding,
  EvidenceRef,
  ResolvedCodeChange,
  ResolvedCodeVerify,
  ResumeCapsuleContent,
  SourceRef,
  VerificationPlan,
  VerificationPlanDocument,
  VerificationVerdict,
  WorkPacket,
} from '@deepseek-ai/dsh-delivery-protocol'
// @ts-expect-error Protocol exposes no executor-prepared shape.
import type { PreparedCodeChange } from '@deepseek-ai/dsh-delivery-protocol'
// @ts-expect-error Protocol V1 internals are not a supported deep-import surface.
import type { ContractRevision as DeepImportedContract } from '@deepseek-ai/dsh-delivery-protocol/src/types'
type NegativeApiAssertions = [PreparedCodeChange, DeepImportedContract]

const ids = {
  acceptanceDecision: AcceptanceDecisionId('decision-1'),
  contractRevision: ContractRevisionId('contract-1'),
  evidence: EvidenceId('evidence-1'),
  executor: ExecutorId('codex'),
  commit: GitCommitId('a'.repeat(40)),
  queueAttempt: QueueAttemptIdRef('attempt-1'),
  queueWork: QueueWorkIdRef('work-1'),
  repository: RepositoryId('repo-1'),
  digest: Sha256Digest(`sha256:${'a'.repeat(64)}`),
  packet: WorkPacketId('packet-1'),
}

const schemaOutputs = {
  sourceRef: null as unknown as SourceRef,
  verificationPlanDocument: null as unknown as VerificationPlanDocument,
  contractRevision: null as unknown as ContractRevision,
  verificationPlan: null as unknown as VerificationPlan,
  workPacket: null as unknown as WorkPacket,
  dispatchBinding: null as unknown as DispatchBinding,
  completionClaim: null as unknown as CompletionClaim,
  verificationVerdict: null as unknown as VerificationVerdict,
  acceptanceDecision: null as unknown as AcceptanceDecision,
  evidenceRef: null as unknown as EvidenceRef,
  resumeCapsule: null as unknown as ResumeCapsuleContent,
  changeIntent: null as unknown as CodeChangeIntent,
  changeResolved: null as unknown as ResolvedCodeChange,
  changeOutput: null as unknown as CodeChangeOutput,
  verifyIntent: null as unknown as CodeVerifyIntent,
  verifyResolved: null as unknown as ResolvedCodeVerify,
  verifyOutput: null as unknown as CodeVerifyOutput,
}

sourceRefSchema satisfies { parse(value: unknown): SourceRef }
verificationPlanDocumentSchema satisfies { parse(value: unknown): VerificationPlanDocument }
contractRevisionSchema satisfies { parse(value: unknown): ContractRevision }
verificationPlanSchema satisfies { parse(value: unknown): VerificationPlan }
workPacketSchema satisfies { parse(value: unknown): WorkPacket }
dispatchBindingSchema satisfies { parse(value: unknown): DispatchBinding }
completionClaimSchema satisfies { parse(value: unknown): CompletionClaim }
verificationVerdictSchema satisfies { parse(value: unknown): VerificationVerdict }
acceptanceDecisionSchema satisfies { parse(value: unknown): AcceptanceDecision }
evidenceRefSchema satisfies { parse(value: unknown): EvidenceRef }
resumeCapsuleContentSchema satisfies { parse(value: unknown): ResumeCapsuleContent }
codeChangeIntentSchema satisfies { parse(value: unknown): CodeChangeIntent }
resolvedCodeChangeSchema satisfies { parse(value: unknown): ResolvedCodeChange }
codeChangeOutputSchema satisfies { parse(value: unknown): CodeChangeOutput }
codeVerifyIntentSchema satisfies { parse(value: unknown): CodeVerifyIntent }
resolvedCodeVerifySchema satisfies { parse(value: unknown): ResolvedCodeVerify }
codeVerifyOutputSchema satisfies { parse(value: unknown): CodeVerifyOutput }

const negativeApiAssertions: NegativeApiAssertions | null = null
const canonicalIssueUrl: string = canonicalGitHubIssueUrl({ owner: 'deepseek-ai', name: 'deepseek-harness' }, 13)

void canonicalIssueUrl
void ids
void negativeApiAssertions
void schemaOutputs
