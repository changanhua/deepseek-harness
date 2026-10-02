import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { requirementAssessmentSchema } from '@changanhua/dsh-requirement-assessment'
export const assessmentRecordSchema = z.strictObject({
  workspaceId: z.string().min(1).max(256),
  reservations: z.array(z.strictObject({ requestId: z.string().min(1).max(256), requestDigest: z.string().min(1).max(256) })).max(200),
  assessments: z.array(requirementAssessmentSchema).max(200),
}).superRefine((record, ctx) => {
  const ids = new Set<string>()
  const requests = new Set<string>()
  for (const reservation of record.reservations) {
    if (requests.has(reservation.requestId)) ctx.addIssue({ code: 'custom', message: 'duplicate reservation identity' })
    requests.add(reservation.requestId)
  }
  for (const assessment of record.assessments) {
    if (assessment.workspaceId !== record.workspaceId || ids.has(assessment.id) || requests.has(assessment.requestId))
      ctx.addIssue({ code: 'custom', message: 'invalid assessment ownership or duplicate identity' })
    if (assessment.supersedes) {
      const previous = record.assessments.find(value => value.id === assessment.supersedes)
      if (!ids.has(assessment.supersedes) || !previous ||
        previous.subject.kind !== assessment.subject.kind || previous.subject.id !== assessment.subject.id ||
        (previous.subject.kind === 'focus' && assessment.subject.kind === 'focus' && previous.subject.planId !== assessment.subject.planId))
        ctx.addIssue({ code: 'custom', message: 'supersedes must name preceding same-subject workspace history' })
    }
    ids.add(assessment.id)
    requests.add(assessment.requestId)
  }
})
export const assessmentLocalDomain = defineDomain({
  name: 'requirement_assessments', version: 1, layout: 'single', tables: { workspaces: domainTable(assessmentRecordSchema) },
})
