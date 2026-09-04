import { describe, expect, test } from 'vitest'
import { parseEvalSuite, runEvalSuite, type EvalExecutionResult } from '../src/index.ts'

const suite = {
  schemaVersion: 1,
  id: 'runner-suite',
  version: '1.0.0',
  sourceRevision: '0123456789abcdef0123456789abcdef01234567',
  title: 'Runner suite',
  defaultRouteIds: ['flash', 'pro'],
  routes: [
    { id: 'flash', provider: 'deepseek-official', model: 'deepseek-v4-flash', preset: 'base' },
    { id: 'pro', provider: 'deepseek-official', model: 'deepseek-v4-pro', preset: 'base' },
  ],
  cases: [
    {
      id: 'case-a',
      title: 'Case A',
      prompt: 'Run A.',
      workspace: { kind: 'empty' },
      successCriteria: [{ kind: 'session-snapshot' }],
      evaluator: { kind: 'deterministic' },
      replayFixtures: [
        { routeId: 'flash', binding: 'first-call-order', sessionFile: 'fixtures/a/flash/session.jsonl' },
        { routeId: 'pro', binding: 'first-call-order', sessionFile: 'fixtures/a/pro/session.jsonl' },
      ],
    },
    {
      id: 'case-b',
      title: 'Case B',
      prompt: 'Run B.',
      workspace: { kind: 'empty' },
      successCriteria: [{ kind: 'session-snapshot' }],
      evaluator: { kind: 'deterministic' },
      replayFixtures: [
        { routeId: 'flash', binding: 'first-call-order', sessionFile: 'fixtures/b/flash/session.jsonl' },
        { routeId: 'pro', binding: 'first-call-order', sessionFile: 'fixtures/b/pro/session.jsonl' },
      ],
    },
  ],
} as const

const parsedSuite = parseEvalSuite(suite)

describe('runEvalSuite', () => {
  test('executes case fixtures sequentially in route then suite order', async () => {
    const calls: string[] = []
    const result = await runEvalSuite(parsedSuite, async (request) => {
      calls.push(`${request.route.id}/${request.evalCase.id}/${request.replayFixture.sessionFile}`)
      return request.route.id === 'flash' && request.evalCase.id === 'case-b'
        ? { deterministicOutcome: 'failed', reasonCode: 'snapshot-mismatch', sessionId: 'session-case-b' }
        : { deterministicOutcome: 'passed', sessionId: 'session-case' }
    }, {
      routeContexts: {
        flash: {
          environment: { os: 'win32', arch: 'x64', nodeVersion: 'v25.5.0' },
          visibleSurface: { tools: ['read'], skills: ['dsh-code-review'] },
        },
      },
    })

    expect(calls).toEqual([
      'flash/case-a/fixtures/a/flash/session.jsonl',
      'flash/case-b/fixtures/b/flash/session.jsonl',
      'pro/case-a/fixtures/a/pro/session.jsonl',
      'pro/case-b/fixtures/b/pro/session.jsonl',
    ])
    expect(result.runs.map(run => run.route.id)).toEqual(['flash', 'pro'])
    expect(result.runs[0]).toEqual(expect.objectContaining({
      suiteVersion: '1.0.0',
      sourceRevision: suite.sourceRevision,
      visibleSurface: { tools: ['read'], skills: ['dsh-code-review'] },
    }))
    expect(result.report.outcome).toBe('failed')
  })

  test('classifies cancellation as infrastructure uncertainty and stops invoking the executor', async () => {
    const controller = new AbortController()
    let calls = 0
    const result = await runEvalSuite(parsedSuite, async () => {
      calls += 1
      controller.abort()
      throw new DOMException('cancelled', 'AbortError')
    }, { signal: controller.signal })

    expect(calls).toBe(1)
    expect(result.runs.flatMap(run => run.results)).toHaveLength(4)
    expect(result.runs.flatMap(run => run.results))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ outcome: 'infrastructure-uncertain', reasonCode: 'cancelled' }),
      ]))
    expect(result.report.outcome).toBe('infrastructure-uncertain')
  })

  test('does not accept a score returned after cancellation', async () => {
    const controller = new AbortController()
    let calls = 0
    const result = await runEvalSuite(parsedSuite, async () => {
      calls += 1
      controller.abort()
      return { deterministicOutcome: 'passed', sessionId: 'session-cancelled' }
    }, { signal: controller.signal })

    expect(calls).toBe(1)
    expect(result.runs[0]?.results[0]).toEqual(expect.objectContaining({
      outcome: 'infrastructure-uncertain',
      reasonCode: 'cancelled',
    }))
  })

  test('keeps an executor exception out of model failure scores and continues other cases', async () => {
    let calls = 0
    const result = await runEvalSuite(parsedSuite, async () => {
      calls += 1
      if (calls === 1) throw new Error('host disappeared')
      return { deterministicOutcome: 'passed', sessionId: 'session-ok' }
    })

    expect(calls).toBe(4)
    expect(result.runs[0]?.results[0]).toEqual(expect.objectContaining({
      outcome: 'infrastructure-uncertain',
      reasonCode: 'executor-error',
    }))
    expect(result.report.outcome).toBe('infrastructure-uncertain')
  })

  test('classifies an invalid executor score as invalid evidence', async () => {
    const result = await runEvalSuite(
      parsedSuite,
      async () => ({ deterministicOutcome: 'maybe' }) as unknown as EvalExecutionResult,
    )

    expect(result.runs[0]?.results[0]).toEqual(expect.objectContaining({
      outcome: 'invalid',
      reasonCode: 'invalid-executor-result',
    }))
    expect(result.report.outcome).toBe('invalid')
  })

  test('never lets a model grader override a deterministic failure', async () => {
    const graderSuite = parseEvalSuite({
      ...suite,
      cases: [{
        ...suite.cases[0],
        evaluator: {
          kind: 'model-grader', provider: 'grader-provider', model: 'grader-model', promptVersion: 'v1',
        },
      }],
    })
    const result = await runEvalSuite(graderSuite, async () => ({
      deterministicOutcome: 'failed',
      evaluatorOutcome: 'passed',
      reasonCode: 'deterministic-check-failed',
      sessionId: 'session-grader-fail',
    }))

    expect(result.runs[0]?.results[0]).toEqual(expect.objectContaining({
      outcome: 'failed', reasonCode: 'deterministic-check-failed',
    }))
  })

  test('marks missing independent grader evidence invalid', async () => {
    const graderSuite = parseEvalSuite({
      ...suite,
      cases: [{
        ...suite.cases[0],
        evaluator: {
          kind: 'model-grader', provider: 'grader-provider', model: 'grader-model', promptVersion: 'v1',
        },
      }],
    })
    const result = await runEvalSuite(graderSuite, async () => ({
      deterministicOutcome: 'passed', sessionId: 'session-grader-missing',
    }))

    expect(result.runs[0]?.results[0]).toEqual(expect.objectContaining({
      outcome: 'invalid', reasonCode: 'grader-result-missing',
    }))
  })

  test('classifies a missing Session fact as infrastructure uncertainty', async () => {
    const result = await runEvalSuite(parsedSuite, async () => ({ deterministicOutcome: 'passed' }))

    expect(result.runs[0]?.results[0]).toEqual(expect.objectContaining({
      outcome: 'infrastructure-uncertain', reasonCode: 'missing-session-fact', sessionId: null,
    }))
  })

  test('does not accept a task failure without its Session fact', async () => {
    const result = await runEvalSuite(parsedSuite, async () => ({
      deterministicOutcome: 'failed', reasonCode: 'task-check-failed',
    }))

    expect(result.runs[0]?.results[0]).toEqual(expect.objectContaining({
      outcome: 'infrastructure-uncertain', reasonCode: 'missing-session-fact', sessionId: null,
    }))
  })
})
