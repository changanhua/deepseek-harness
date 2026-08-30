import { describe, expect, test } from 'vitest'
import * as evalApi from '../src/index.ts'
import type { EvalRouteMetrics } from '../src/index.ts'

const suite = {
  schemaVersion: 1,
  id: 'core-regression',
  version: '1.0.0',
  sourceRevision: '0123456789abcdef0123456789abcdef01234567',
  title: 'Core regression',
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

const runs = [
  {
    schemaVersion: 1,
    suiteId: 'core-regression',
    suiteVersion: '1.0.0',
    sourceRevision: suite.sourceRevision,
    route: suite.routes[1],
    environment: { os: 'win32', arch: 'x64', nodeVersion: 'v25.5.0' },
    visibleSurface: { tools: ['read'], skills: [] },
    results: [
      {
        caseId: 'case-a', replayFixture: 'fixtures/a/pro/session.jsonl', fixtureId: 'a/pro',
        sessionId: 'pro-a', outcome: 'passed', usage: { inputTokens: 2, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, retryTokens: 0 },
        latency: { agentMs: 12, evaluatorMs: 1 }, evidenceRefs: ['session:pro-a'],
      },
    ],
  },
  {
    schemaVersion: 1,
    suiteId: 'core-regression',
    suiteVersion: '1.0.0',
    sourceRevision: suite.sourceRevision,
    route: suite.routes[0],
    environment: { os: 'win32', arch: 'x64', nodeVersion: 'v25.5.0' },
    visibleSurface: { tools: ['read'], skills: [] },
    results: [
      {
        caseId: 'case-b', replayFixture: 'fixtures/b/flash/session.jsonl', fixtureId: 'b/flash', sessionId: 'flash-b', outcome: 'failed', reasonCode: 'unexpected-tool-call',
        usage: { inputTokens: 4, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0, retryTokens: 1 }, latency: { agentMs: 20, evaluatorMs: 2 }, evidenceRefs: ['session:flash-b'],
      },
      {
        caseId: 'case-a', replayFixture: 'fixtures/a/flash/session.jsonl', fixtureId: 'a/flash', sessionId: 'flash-a', outcome: 'passed',
        usage: { inputTokens: 2, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, retryTokens: 0 }, latency: { agentMs: 10, evaluatorMs: 1 }, evidenceRefs: ['session:flash-a'],
      },
    ],
  },
] as const

describe('EvalReport', () => {
  test('orders by the suite and preserves route-specific replay provenance', () => {
    const buildEvalReport = (evalApi as Record<string, unknown>).buildEvalReport
    const report = typeof buildEvalReport === 'function'
      ? (buildEvalReport as (suite: unknown, runs: unknown) => unknown)(suite, runs)
      : undefined

    expect(report).toMatchObject({
      schemaVersion: 1,
      suiteId: 'core-regression',
      title: 'Core regression',
      outcome: 'infrastructure-uncertain',
      routes: [
        {
          route: suite.routes[0],
          outcome: 'failed',
          counts: { passed: 1, failed: 1, invalid: 0, 'infrastructure-uncertain': 0 },
          results: [
            { caseId: 'case-a', title: 'Case A', replayFixture: 'fixtures/a/flash/session.jsonl', outcome: 'passed' },
            { caseId: 'case-b', title: 'Case B', replayFixture: 'fixtures/b/flash/session.jsonl', outcome: 'failed', reasonCode: 'unexpected-tool-call' },
          ],
        },
        {
          route: suite.routes[1],
          outcome: 'infrastructure-uncertain',
          counts: { passed: 1, failed: 0, invalid: 0, 'infrastructure-uncertain': 1 },
          results: [
            { caseId: 'case-a', title: 'Case A', replayFixture: 'fixtures/a/pro/session.jsonl', outcome: 'passed' },
            { caseId: 'case-b', title: 'Case B', replayFixture: 'fixtures/b/pro/session.jsonl', outcome: 'infrastructure-uncertain', reasonCode: 'missing-result' },
          ],
        },
      ],
    })
  })

  test('rejects a run that consumed another route fixture', () => {
    const buildEvalReport = (evalApi as Record<string, unknown>).buildEvalReport as ((suite: unknown, runs: unknown) => unknown) | undefined
    const mismatchedResult = {
      ...runs[1].results[1],
      replayFixture: 'fixtures/a/pro/session.jsonl',
    }
    const mismatched = [{ ...runs[1], results: [mismatchedResult] }]

    expect(() => buildEvalReport?.(suite, mismatched)).toThrow(/expected fixtures\/a\/flash\/session\.jsonl/)
  })

  test('renders stable machine and human reports', () => {
    const buildEvalReport = (evalApi as Record<string, unknown>).buildEvalReport as ((suite: unknown, runs: unknown) => unknown) | undefined
    const formatEvalReportJson = (evalApi as Record<string, unknown>).formatEvalReportJson as ((report: unknown) => string) | undefined
    const formatEvalReportMarkdown = (evalApi as Record<string, unknown>)
      .formatEvalReportMarkdown as ((report: unknown) => string) | undefined
    const report = buildEvalReport?.(suite, runs)

    expect(formatEvalReportJson?.(report)).toContain('"outcome": "infrastructure-uncertain"')
    expect(formatEvalReportJson?.(report)).toContain(`"sourceRevision": "${suite.sourceRevision}"`)
    expect(formatEvalReportJson?.(report).endsWith('\n')).toBe(true)
    expect(formatEvalReportMarkdown?.(report)).toContain('| flash | deepseek-official | deepseek-v4-flash | base | failed | 1 | 1 | 0 | 0 |')
    expect(formatEvalReportMarkdown?.(report)).toContain('fixtures/b/pro/session.jsonl')
    expect(formatEvalReportMarkdown?.(report)).toContain(`Source revision: \`${suite.sourceRevision}\``)
    expect(formatEvalReportMarkdown?.(report)).toContain('Token usage (input/output/cache-read/cache-write/retry): 6/3/3/0/1')
  })

  test('aggregates success, failure samples, usage, and split latency without hiding unknowns', () => {
    const buildEvalReport = (evalApi as Record<string, unknown>).buildEvalReport as ((suite: unknown, runs: unknown) => {
      routes: Array<{ metrics: EvalRouteMetrics }>
    })
    const report = buildEvalReport(suite, runs)

    expect(report.routes[0]?.metrics).toEqual({
      successRate: 0.5,
      usage: { inputTokens: 6, outputTokens: 3, cacheReadTokens: 3, cacheWriteTokens: 0, retryTokens: 1 },
      latency: { agentMs: 15, evaluatorMs: 1.5 },
      failureSamples: ['case-b'],
    })
    expect(report.routes[1]?.metrics.successRate).toBe(0.5)
    expect(report.routes[1]?.metrics.usage.inputTokens).toBeNull()
  })

  test('rejects cross-object identity, provenance, and duplication errors', () => {
    const buildEvalReport = (evalApi as Record<string, unknown>).buildEvalReport as ((suite: unknown, runs: unknown) => unknown) | undefined
    const flash = runs[1]

    expect(() => buildEvalReport?.(suite, [{ ...flash, suiteId: 'other-suite' }]))
      .toThrow(/names suite other-suite; expected core-regression/)
    expect(() => buildEvalReport?.(suite, [{ ...flash, suiteVersion: '2.0.0' }]))
      .toThrow(/suite version or source revision does not match/)
    expect(() => buildEvalReport?.(suite, [{ ...flash, sourceRevision: 'abcdef0' }]))
      .toThrow(/suite version or source revision does not match/)
    expect(() => buildEvalReport?.(suite, [{ ...flash, route: { ...flash.route, id: 'unknown' } }]))
      .toThrow(/unknown route unknown/)
    expect(() => buildEvalReport?.(suite, [{ ...flash, route: { ...flash.route, model: 'wrong-model' } }]))
      .toThrow(/route provenance for flash does not match/)
    expect(() => buildEvalReport?.(suite, [flash, flash]))
      .toThrow(/duplicate eval run for route flash/)
    expect(() => buildEvalReport?.(suite, [{
      ...flash,
      results: [{ ...flash.results[0], caseId: 'unknown' }],
    }])).toThrow(/unknown case unknown/)
    expect(() => buildEvalReport?.(suite, [{
      ...flash,
      results: [flash.results[0], flash.results[0]],
    }])).toThrow(/duplicate result for case case-b/)
  })

  test('synthesizes uncertainty when an entire route run is absent', () => {
    const buildEvalReport = (evalApi as Record<string, unknown>).buildEvalReport as ((suite: unknown, runs: unknown) => {
      routes: Array<{ outcome: string; results: unknown[] }>
    }) | undefined
    const report = buildEvalReport?.(suite, [])

    expect(report?.routes).toHaveLength(2)
    expect(report?.routes.every((route: { outcome: string }) => route.outcome === 'infrastructure-uncertain')).toBe(true)
    expect(report?.routes.flatMap((route: { results: unknown[] }) => route.results)).toHaveLength(4)
  })
})
