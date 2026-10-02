import { describe, expect, it } from 'vitest'
import { assessmentCreateSchema, assessmentEvaluationSchema } from '../src/schema.ts'
import { evaluation, input } from './fixtures.ts'
describe('assessment durable schemas', () => {
  it('requires all eight distinct dimensions and three distinct stress tests', () => {
    expect(assessmentEvaluationSchema.safeParse(evaluation).success).toBe(true)
    expect(assessmentEvaluationSchema.safeParse({
      ...evaluation, dimensions: evaluation.dimensions.slice(1),
    }).success).toBe(false)
    expect(assessmentEvaluationSchema.safeParse({
      ...evaluation, dimensions: Array(8).fill(evaluation.dimensions[0]),
    }).success).toBe(false)
    expect(assessmentEvaluationSchema.safeParse({
      ...evaluation, stressTests: Array(3).fill(evaluation.stressTests[0]),
    }).success).toBe(false)
  })
  it('supports exactly five routes, three owners, and rejects totals and unknown executable fields', () => {
    for (const route of ['MODEL_ONLY', 'EXPERIMENT', 'BUILD_CORE', 'BUILD', 'DEFER']) expect(assessmentEvaluationSchema.safeParse({ ...evaluation, route }).success).toBe(true)
    expect(assessmentEvaluationSchema.safeParse({
      ...evaluation, allocation: { SYSTEM_OWNED: [], MODEL_OWNED: [], EXPERIMENT: [] },
    }).success).toBe(true)
    for (const extra of [{ route: 'APPROVE' }, { totalScore: 100 }, { execute: 'dispatch' }, { allocation: { SYSTEM_OWNED: [] } }]) expect(assessmentEvaluationSchema.safeParse({ ...evaluation, ...extra }).success).toBe(false)
  })
  it('binds frozen Plan and Focus identities to their actual input and baseline', () => {
    const subject = { kind: 'focus', id: 'focus-a', planId: 'plan-a' }
    const focus = { id: 'focus-a', planId: 'plan-a', version: 2, title: 'Old title', objective: 'Old objective', status: 'open' }
    const value = { ...input, subject, baseline: { ...input.baseline, subject, planRevision: 'rev-a', focusVersion: 2 }, actualInput: { ...input.actualInput, focus } }
    expect(assessmentCreateSchema.safeParse(value).success).toBe(true)
    expect(assessmentCreateSchema.safeParse({ ...value, actualInput: input.actualInput }).success).toBe(false)
    expect(assessmentCreateSchema.safeParse({ ...value, baseline: { ...value.baseline, focusVersion: 3 } }).success).toBe(false)
    expect(assessmentCreateSchema.safeParse({ ...input, actorId: 'forged' }).success).toBe(false)
  })
})
