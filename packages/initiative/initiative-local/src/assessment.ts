import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { InitiativeError } from '@changanhua/dsh-initiative'
import type { InitiativeCandidate, InitiativeView } from '@changanhua/dsh-initiative'
import { AssessmentError } from '@changanhua/dsh-requirement-assessment'
import type { AssessmentAccess, RequirementAssessment } from '@changanhua/dsh-requirement-assessment'
import type { CandidateReviewSource } from '@changanhua/dsh-requirement-assessment-review'
import type { initiativeScope } from './scope.ts'

/** Capture immutable owner content; mutable status, head and later investigation facts stay out. */
export function candidateReviewSource(candidate: InitiativeCandidate, version: number): CandidateReviewSource {
  const revision = candidate.revisions.find(value => value.version === version)
  if (revision === undefined) throw new InitiativeError('not-found', 'Candidate revision is unavailable')
  const text = JSON.stringify({ id: candidate.id, workspaceId: candidate.workspaceId, kind: candidate.kind,
    trigger: candidate.trigger, proposer: candidate.proposer, origin: candidate.origin, parents: candidate.parents,
    createdAt: candidate.createdAt, revision })
  const digest = createHash('sha256').update(text).digest('hex')
  return { subject: { kind: 'candidate', id: candidate.id, revision: version, digest }, text,
    evidence: [{ source: 'Exact Candidate owner record', provenance: 'owner_observation', verification: 'verified',
      immutableRef: { kind: 'initiative-candidate', id: candidate.id, provider: 'initiative', revision: String(version) } }] }
}

/** Derive the RIR capability from the already verified live Initiative scope. */
export function assessmentAccess(scope: Awaited<ReturnType<typeof initiativeScope>>): AssessmentAccess {
  return { workspaceId: scope.workspaceId, actorId: scope.actor.id, kind: scope.actor.kind, authorize: scope.authorize }
}

/** Resolve only an immutable, exact-revision Assessment from this Candidate's Workspace. */
export async function selectedAssessment(
  ctx: Context, access: AssessmentAccess, candidate: InitiativeCandidate, id: string, signal?: AbortSignal,
): Promise<RequirementAssessment> {
  const owner = ctx.get('requirementAssessment')
  if (owner === undefined) throw new InitiativeError('unavailable', 'Assessment provider is unavailable')
  let assessment: RequirementAssessment
  try { assessment = await owner.get(access, id, signal) }
  catch (error) {
    if (error instanceof AssessmentError && error.code === 'closed')
      throw new InitiativeError('unavailable', 'Assessment provider is unavailable')
    if (error instanceof AssessmentError && error.code === 'not-found')
      throw new InitiativeError('not-found', 'Assessment is unavailable in this Workspace')
    throw error
  }
  const subject = assessment.subject
  if (assessment.workspaceId !== candidate.workspaceId || assessment.baseline.workspace !== candidate.workspaceId
    || subject.kind !== 'candidate' || subject.id !== candidate.id)
    throw new InitiativeError('invalid-input', 'Assessment does not name this Candidate and Workspace')
  const source = candidateReviewSource(candidate, subject.revision)
  if (source.subject.digest !== subject.digest || JSON.stringify(assessment.baseline.subject) !== JSON.stringify(subject)
    || assessment.actualInput.text !== source.text)
    throw new InitiativeError('invalid-input', 'Assessment does not match the exact immutable Candidate revision')
  return assessment
}

/** Read-time Candidate freshness; this does not attest model quality or external evidence. */
export function assessmentRelations(candidate: InitiativeCandidate, assessments: RequirementAssessment[]): InitiativeView['rir'] {
  const matches = assessments.filter(value => value.subject.kind === 'candidate' && value.subject.id === candidate.id)
  const relations = matches.slice(-50).map((value) => {
    const subject = value.subject
    if (subject.kind !== 'candidate') throw new Error('Candidate Assessment filter mismatch')
    let state: InitiativeView['rir']['assessments'][number]['state'] = 'unavailable'
    if (candidate.revisions.some(revision => revision.version === subject.revision)) {
      const source = candidateReviewSource(candidate, subject.revision)
      state = value.workspaceId !== candidate.workspaceId || value.baseline.workspace !== candidate.workspaceId
        || source.subject.digest !== subject.digest
        || source.text !== value.actualInput.text || JSON.stringify(value.baseline.subject) !== JSON.stringify(subject)
        ? 'unknown' : subject.revision === candidate.headVersion ? 'fresh' : 'drift'
    }
    return { id: value.id, candidateVersion: subject.revision, candidateDigest: subject.digest, state, route: value.evaluation.route }
  })
  return { availability: 'available', assessments: relations, total: matches.length }
}
