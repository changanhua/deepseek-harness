import {
  AcceptanceDecisionId,
  ContractRevisionId,
  DeliveryCaseId,
  EvidenceId,
  ExecutorId,
  GitCommitId,
  IssuePublicationId,
  QueueAttemptIdRef,
  QueueWorkIdRef,
  RepositoryId,
  RequirementDecisionId,
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
  deliveryCaseSchema,
  dispatchBindingSchema,
  evidenceRefSchema,
  gitHubIssueRefSchema,
  issuePublicationSchema,
  nonStartedPublicationFailureSchema,
  publicationFailureSchema,
  requirementDecisionSchema,
  requirementOriginSchema,
  resolvedCodeChangeSchema,
  resolvedCodeVerifySchema,
  resumeCapsuleContentSchema,
  unknownPublicationFailureSchema,
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
  DeliveryCase,
  DispatchBinding,
  EvidenceRef,
  GitHubIssueRef,
  IssuePublication,
  PublicationFailure,
  RequirementDecision,
  RequirementOrigin,
  ResolvedCodeChange,
  ResolvedCodeVerify,
  ResumeCapsuleContent,
  VerificationPlan,
  VerificationPlanDocument,
  VerificationVerdict,
  WorkPacket,
} from '@deepseek-ai/dsh-delivery-protocol'
// @ts-expect-error Protocol exposes no executor-prepared shape.
import type { PreparedCodeChange } from '@deepseek-ai/dsh-delivery-protocol'
// @ts-expect-error Protocol V1 internals are not a supported deep-import surface.
import type { ContractRevision as DeepImportedContract } from '@deepseek-ai/dsh-delivery-protocol/src/types'
// @ts-expect-error Protocol V2 removed the GitHub-only SourceRef requirement snapshot.
import type { SourceRef } from '@deepseek-ai/dsh-delivery-protocol'
type NegativeApiAssertions = [PreparedCodeChange, DeepImportedContract, SourceRef]

const ids = {
  acceptanceDecision: AcceptanceDecisionId('decision-1'),
  contractRevision: ContractRevisionId('contract-1'),
  deliveryCase: DeliveryCaseId('case-1'),
  evidence: EvidenceId('evidence-1'),
  executor: ExecutorId('codex'),
  commit: GitCommitId('a'.repeat(40)),
  issuePublication: IssuePublicationId('publication-1'),
  queueAttempt: QueueAttemptIdRef('attempt-1'),
  queueWork: QueueWorkIdRef('work-1'),
  repository: RepositoryId('repo-1'),
  requirementDecision: RequirementDecisionId('decision-requirement-1'),
  digest: Sha256Digest(`sha256:${'a'.repeat(64)}`),
  packet: WorkPacketId('packet-1'),
}

const schemaOutputs = {
  deliveryCase: null as unknown as DeliveryCase,
  requirementDecision: null as unknown as RequirementDecision,
  requirementOrigin: null as unknown as RequirementOrigin,
  contractRevision: null as unknown as ContractRevision,
  issuePublication: null as unknown as IssuePublication,
  publicationFailure: null as unknown as PublicationFailure,
  gitHubIssueRef: null as unknown as GitHubIssueRef,
  verificationPlanDocument: null as unknown as VerificationPlanDocument,
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

deliveryCaseSchema satisfies { parse(value: unknown): DeliveryCase }
requirementDecisionSchema satisfies { parse(value: unknown): RequirementDecision }
requirementOriginSchema satisfies { parse(value: unknown): RequirementOrigin }
contractRevisionSchema satisfies { parse(value: unknown): ContractRevision }
issuePublicationSchema satisfies { parse(value: unknown): IssuePublication }
publicationFailureSchema satisfies { parse(value: unknown): PublicationFailure }
nonStartedPublicationFailureSchema satisfies { parse(value: unknown): PublicationFailure }
unknownPublicationFailureSchema satisfies { parse(value: unknown): PublicationFailure }
gitHubIssueRefSchema satisfies { parse(value: unknown): GitHubIssueRef }
verificationPlanDocumentSchema satisfies { parse(value: unknown): VerificationPlanDocument }
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
