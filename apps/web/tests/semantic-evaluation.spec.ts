import { describe, expect, it } from 'vitest'
import { selectSemanticEvaluationCase } from './fixtures/semantic-evaluation.ts'

describe('语义评估样本分组准入', () => {
  it('要求显式匹配当前分组，避免已用于调参的页面仍以留出身份运行', () => {
    expect(selectSemanticEvaluationCase('holdout-list', 'development').split).toBe('development')
    expect(() => selectSemanticEvaluationCase('holdout-list', 'holdout')).toThrow(/split/iu)
    expect(() => selectSemanticEvaluationCase('holdout-delivery-scope', undefined)).toThrow(/split/iu)
    expect(selectSemanticEvaluationCase('holdout-delivery-scope', 'holdout').split).toBe('holdout')
    expect(() => selectSemanticEvaluationCase('unknown', 'holdout')).toThrow(/unknown/iu)
  })
})
