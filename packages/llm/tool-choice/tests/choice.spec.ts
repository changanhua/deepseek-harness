import { describe, expect, it } from 'vitest'
import { buildChoiceRequest, decodeChoiceResponse } from '../src/choice.ts'

const input = {
  goal: '打开 README',
  facts: '当前在仓库主页',
  candidates: [
    { id: 'readme', description: '打开 README' },
    { id: 'issues', description: '打开 Issues' },
    { id: 'disabled', description: '不可用按钮', disabled: true },
  ],
}

describe('有限候选选择', () => {
  it('过滤禁用候选且保留可复现请求', () => {
    const request = buildChoiceRequest(input, { maxCandidates: 8, maxInputBytes: 4096 })
    if (request.kind !== 'request') throw new Error('expected request')
    expect(request.candidates.map(candidate => candidate.id)).toEqual(['readme', 'issues'])
    expect(request.prompt).not.toContain('"disabled"')
  })

  it('没有可选候选时放弃且无需请求模型', () => {
    expect(buildChoiceRequest({ ...input, candidates: [{ id: 'disabled', description: '不可用', disabled: true }] }, { maxCandidates: 8, maxInputBytes: 4096 }))
      .toMatchObject({ kind: 'abstain', reason: 'no_eligible_candidates' })
  })

  it('只接受已声明候选或 abstain', () => {
    const request = buildChoiceRequest(input, { maxCandidates: 8, maxInputBytes: 4096 })
    if (request.kind !== 'request') throw new Error('expected request')
    expect(decodeChoiceResponse('{"status":"selected","candidateId":"readme"}', request.candidates)).toEqual({ status: 'selected', candidateId: 'readme' })
    expect(decodeChoiceResponse('{"status":"abstain","reason":"ambiguous"}', request.candidates)).toEqual({ status: 'abstain', reason: 'ambiguous' })
    expect(() => decodeChoiceResponse('{"status":"selected","candidateId":"disabled"}', request.candidates)).toThrow('unknown or disabled')
  })

  it('拒绝畸形 JSON 和截断输出', () => {
    const request = buildChoiceRequest(input, { maxCandidates: 8, maxInputBytes: 4096 })
    if (request.kind !== 'request') throw new Error('expected request')
    expect(() => decodeChoiceResponse('{"status":"selected"', request.candidates)).toThrow('valid JSON')
    expect(() => decodeChoiceResponse('{"status":"selected","candidateId":"readme"} trailing', request.candidates)).toThrow('valid JSON')
  })
})
