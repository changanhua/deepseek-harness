import { describe, expect, test } from 'vitest'
import * as evalApi from '../src/index.ts'

const validRun = {
  schemaVersion: 1,
  suiteId: 'core-regression',
  suiteVersion: '1.0.0',
  sourceRevision: '0123456789abcdef0123456789abcdef01234567',
  route: {
    id: 'flash',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    preset: 'base',
  },
  environment: { os: 'win32', arch: 'x64', nodeVersion: 'v25.5.0' },
  visibleSurface: { tools: ['read', 'write'], skills: ['dsh-code-review'] },
  results: [
    {
      caseId: 'answers-once',
      replayFixture: 'fixtures/answers-once/flash/session.jsonl',
      fixtureId: 'answers-once/flash',
      sessionId: 'session-1',
      outcome: 'passed',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 50,
        cacheWriteTokens: 0,
        retryTokens: 7,
      },
      latency: { agentMs: 1200, evaluatorMs: 4 },
      evidenceRefs: ['session:session-1#turn=1'],
    },
  ],
} as const

describe('EvalRun schema', () => {
  test('parses route provenance and the exact replay fixture consumed by each case', () => {
    const parseEvalRun = (evalApi as Record<string, unknown>).parseEvalRun
    const parsed = typeof parseEvalRun === 'function'
      ? (parseEvalRun as (input: unknown) => unknown)(validRun)
      : undefined

    expect(parsed).toEqual(validRun)
  })

  test('rejects runs without a fixed revision or with incomplete metrics', () => {
    const parseEvalRun = (evalApi as Record<string, unknown>).parseEvalRun as (input: unknown) => unknown
    const { sourceRevision: _sourceRevision, ...withoutRevision } = validRun
    expect(() => parseEvalRun(withoutRevision)).toThrow(/sourceRevision/i)
    expect(() => parseEvalRun({
      ...validRun,
      results: [{ ...validRun.results[0], usage: { inputTokens: 1 } }],
    })).toThrow(/usage/i)
  })
})

describe('EvalOutcome folding', () => {
  test.each([
    { outcomes: ['passed'], expected: 'passed' },
    { outcomes: ['passed', 'failed'], expected: 'failed' },
    { outcomes: ['failed', 'infrastructure-uncertain'], expected: 'infrastructure-uncertain' },
    { outcomes: ['infrastructure-uncertain', 'invalid'], expected: 'invalid' },
    { outcomes: [], expected: 'infrastructure-uncertain' },
  ] as const)('folds $outcomes to $expected', ({ outcomes, expected }) => {
    const foldEvalOutcomes = (evalApi as Record<string, unknown>).foldEvalOutcomes
    const actual = typeof foldEvalOutcomes === 'function'
      ? (foldEvalOutcomes as (values: readonly string[]) => unknown)(outcomes)
      : undefined

    expect(actual).toBe(expected)
  })
})
