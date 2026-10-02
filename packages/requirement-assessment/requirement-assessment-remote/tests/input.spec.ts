import { expect, it } from 'vitest'
import { quickReviewInputSchema } from '../../requirement-assessment-review/src/schema.ts'
import { REVIEW_SYSTEM_PROMPT } from '../../requirement-assessment-review/src/prompt.ts'
it('admits bounded manual statements and refuses caller-controlled authority or fabricated evidence provenance', () => {
  const input = { requestId: 'one', subject: { kind: 'manual', id: 'subject', title: 'Review' }, text: 'Unverified assumption', evidence: [{ source: 'User', excerpt: 'A claim' }] }
  expect(quickReviewInputSchema.parse(input)).toEqual(input)
  for (const extra of [{ actorId: 'root' }, { baseline: { dsh: 'verified' } }, { route: 'BUILD' }, { tools: ['dispatch'] }]) expect(quickReviewInputSchema.safeParse({ ...input, ...extra }).success).toBe(false)
  expect(quickReviewInputSchema.safeParse({ ...input, evidence: [{ source: 'User', excerpt: 'Claim', verification: 'verified' }] }).success).toBe(false)
  expect(quickReviewInputSchema.safeParse({ ...input, text: undefined }).success).toBe(false)
  // System prompt is durably retained in the domain's bounded selected-context field.
  expect(REVIEW_SYSTEM_PROMPT.length).toBeLessThanOrEqual(8000)
})
