import { describe, expect, test } from 'vitest'
import { parseEvalSuite } from '../src/index.ts'

const validSuite = {
  schemaVersion: 1,
  id: 'core-regression',
  version: '1.0.0',
  sourceRevision: '0123456789abcdef0123456789abcdef01234567',
  title: 'Core regression',
  defaultRouteIds: ['flash', 'pro'],
  routes: [
    {
      id: 'flash',
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      preset: 'base',
    },
    {
      id: 'pro',
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      preset: 'base',
    },
  ],
  cases: [
    {
      id: 'answers-once',
      title: 'Answers once',
      prompt: 'Answer once, then stop.',
      workspace: { kind: 'empty' },
      successCriteria: [{ kind: 'session-snapshot' }],
      evaluator: { kind: 'deterministic' },
      replayFixtures: [
        {
          routeId: 'flash',
          binding: 'first-call-order',
          sessionFile: 'fixtures/answers-once/flash/session.jsonl',
        },
        {
          routeId: 'pro',
          binding: 'first-call-order',
          sessionFile: 'fixtures/answers-once/pro/session.jsonl',
        },
      ],
    },
  ],
} as const

describe('EvalSuite schema', () => {
  test('parses a strict suite with one independent replay fixture per compared route', () => {
    expect(parseEvalSuite(validSuite)).toEqual(validSuite)
  })

  test('rejects unknown fields at every record boundary', () => {
    expect(() => parseEvalSuite({ ...validSuite, evaluatorPrompt: 'judge this' })).toThrow(/unrecognized/i)
    expect(() => parseEvalSuite({
      ...validSuite,
      routes: [{ ...validSuite.routes[0], apiKey: 'secret' }, validSuite.routes[1]],
    })).toThrow(/unrecognized/i)
  })

  test('requires every case to provide exactly one fixture for every route', () => {
    expect(() => parseEvalSuite({
      ...validSuite,
      cases: [{ ...validSuite.cases[0], replayFixtures: [validSuite.cases[0].replayFixtures[0]] }],
    })).toThrow(/exactly one replay fixture for route pro/)
  })

  test('rejects a replay transcript shared by compared routes', () => {
    expect(() => parseEvalSuite({
      ...validSuite,
      cases: [{
        ...validSuite.cases[0],
        replayFixtures: [
          validSuite.cases[0].replayFixtures[0],
          {
            ...validSuite.cases[0].replayFixtures[1],
            sessionFile: validSuite.cases[0].replayFixtures[0].sessionFile,
          },
        ],
      }],
    })).toThrow(/independent sessionFile/)
  })

  test('rejects duplicate route and case ids', () => {
    expect(() => parseEvalSuite({
      ...validSuite,
      routes: [validSuite.routes[0], { ...validSuite.routes[1], id: 'flash' }],
      cases: [{
        ...validSuite.cases[0],
        replayFixtures: [
          validSuite.cases[0].replayFixtures[0],
          { ...validSuite.cases[0].replayFixtures[1], routeId: 'flash' },
        ],
      }],
    })).toThrow(/route ids must be unique/)
    expect(() => parseEvalSuite({
      ...validSuite,
      cases: [validSuite.cases[0], validSuite.cases[0]],
    })).toThrow(/case ids must be unique/)
  })

  test('requires a fixed source revision and a valid default run matrix', () => {
    const { sourceRevision: _sourceRevision, ...withoutRevision } = validSuite
    expect(() => parseEvalSuite(withoutRevision)).toThrow(/sourceRevision/i)
    expect(() => parseEvalSuite({ ...validSuite, sourceRevision: 'working-tree' })).toThrow(/sourceRevision/i)
    expect(() => parseEvalSuite({ ...validSuite, defaultRouteIds: ['flash', 'missing'] }))
      .toThrow(/unknown default route missing/)
    expect(() => parseEvalSuite({ ...validSuite, defaultRouteIds: ['flash', 'flash'] }))
      .toThrow(/default route ids must be unique/)
  })

  test('round-trips workspace, success criteria, and independent grader provenance', () => {
    const withGrader = {
      ...validSuite,
      cases: [{
        ...validSuite.cases[0],
        workspace: { kind: 'fixture', path: 'workspaces/answers-once' },
        successCriteria: [
          { kind: 'session-snapshot' },
          { kind: 'output-equals', text: 'DONE' },
        ],
        evaluator: {
          kind: 'model-grader',
          provider: 'independent-grader',
          model: 'grader-v1',
          promptVersion: '2026-08-31',
        },
      }],
    } as const

    const parsed = parseEvalSuite(withGrader)
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(withGrader)
  })

  test('accepts deterministic approval answers for ACP-backed cases', () => {
    const withApproval = {
      ...validSuite,
      cases: [{
        ...validSuite.cases[0],
        permissionAnswers: [{ kind: 'reject_once' }],
      }],
    } as const

    expect(parseEvalSuite(withApproval)).toEqual(withApproval)
  })

  test('rejects a fixture that names a route outside the suite', () => {
    expect(() => parseEvalSuite({
      ...validSuite,
      cases: [{
        ...validSuite.cases[0],
        replayFixtures: [
          ...validSuite.cases[0].replayFixtures,
          { routeId: 'unknown', binding: 'first-call-order', sessionFile: 'fixtures/unknown/session.jsonl' },
        ],
      }],
    })).toThrow(/unknown route unknown/)
  })
})
