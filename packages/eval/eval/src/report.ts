import {
  foldEvalOutcomes,
  parseEvalRun,
  type EvalEnvironment,
  type EvalLatency,
  type EvalOutcome,
  type EvalRun,
  type EvalUsage,
  type EvalVisibleSurface,
} from './run.ts'
import { parseEvalSuite, type EvalRoute, type EvalSuite } from './schema.ts'

/** Outcome totals for one compared route. */
export interface EvalOutcomeCounts {
  passed: number
  failed: number
  invalid: number
  'infrastructure-uncertain': number
}

/** One case row in a deterministic report. */
export interface EvalReportCaseResult {
  caseId: string
  title: string
  replayFixture: string
  fixtureId: string
  sessionId: string | null
  outcome: EvalOutcome
  reasonCode?: string
  usage: EvalUsage
  latency: EvalLatency
  evidenceRefs: string[]
}

/** Aggregated route metrics that preserve unknown evidence instead of guessing. */
export interface EvalRouteMetrics {
  successRate: number
  usage: EvalUsage
  latency: EvalLatency
  failureSamples: string[]
}

/** One compared route and its ordered case results. */
export interface EvalRouteReport {
  route: EvalRoute
  environment: EvalEnvironment | null
  visibleSurface: EvalVisibleSurface | null
  outcome: EvalOutcome
  counts: EvalOutcomeCounts
  metrics: EvalRouteMetrics
  results: EvalReportCaseResult[]
}

/** Stable machine-readable report for one suite comparison. */
export interface EvalReport {
  schemaVersion: 1
  suiteId: string
  suiteVersion: string
  sourceRevision: string
  title: string
  outcome: EvalOutcome
  routes: EvalRouteReport[]
}

function sameRoute(left: EvalRoute, right: EvalRoute): boolean {
  return left.id === right.id
    && left.provider === right.provider
    && left.model === right.model
    && left.preset === right.preset
}

function emptyCounts(): EvalOutcomeCounts {
  return { passed: 0, failed: 0, invalid: 0, 'infrastructure-uncertain': 0 }
}

function sumKnown(values: readonly (number | null)[]): number | null {
  if (values.some(value => value === null)) return null
  return values.reduce<number>((total, value) => total + (value as number), 0)
}

function averageKnown(values: readonly (number | null)[]): number | null {
  const total = sumKnown(values)
  return total === null ? null : total / values.length
}

function routeMetrics(results: readonly EvalReportCaseResult[], counts: EvalOutcomeCounts): EvalRouteMetrics {
  return {
    successRate: counts.passed / results.length,
    usage: {
      inputTokens: sumKnown(results.map(result => result.usage.inputTokens)),
      outputTokens: sumKnown(results.map(result => result.usage.outputTokens)),
      cacheReadTokens: sumKnown(results.map(result => result.usage.cacheReadTokens)),
      cacheWriteTokens: sumKnown(results.map(result => result.usage.cacheWriteTokens)),
      retryTokens: sumKnown(results.map(result => result.usage.retryTokens)),
    },
    latency: {
      agentMs: averageKnown(results.map(result => result.latency.agentMs)),
      evaluatorMs: averageKnown(results.map(result => result.latency.evaluatorMs)),
    },
    failureSamples: results.filter(result => result.outcome === 'failed').map(result => result.caseId),
  }
}

/**
 * Build a deterministic report in suite route/case order.
 *
 * Missing results remain infrastructure-uncertain. Cross-route fixture use,
 * duplicate runs/results, and provenance mismatches throw instead of producing
 * a misleading score.
 *
 * @param suiteInput Validated suite definition that owns report ordering.
 * @param runInputs Route-specific run evidence to compare.
 * @returns A stable report ordered by suite routes and cases.
 */
export function buildEvalReport(suiteInput: EvalSuite, runInputs: readonly EvalRun[]): EvalReport {
  const suite = parseEvalSuite(suiteInput)
  const runs = runInputs.map(run => parseEvalRun(run))
  const routeById = new Map(suite.routes.map(route => [route.id, route]))
  const runByRoute = new Map<string, EvalRun>()

  for (const run of runs) {
    if (run.suiteId !== suite.id) {
      throw new Error(`eval run for route ${run.route.id} names suite ${run.suiteId}; expected ${suite.id}`)
    }
    if (run.suiteVersion !== suite.version || run.sourceRevision !== suite.sourceRevision) {
      throw new Error(`eval run ${run.route.id} suite version or source revision does not match the suite`)
    }
    const expectedRoute = routeById.get(run.route.id)
    if (expectedRoute === undefined) throw new Error(`eval run names unknown route ${run.route.id}`)
    if (!sameRoute(run.route, expectedRoute)) {
      throw new Error(`eval run route provenance for ${run.route.id} does not match the suite`)
    }
    if (runByRoute.has(run.route.id)) throw new Error(`duplicate eval run for route ${run.route.id}`)
    runByRoute.set(run.route.id, run)
  }

  const routeReports = suite.routes.map((route): EvalRouteReport => {
    const run = runByRoute.get(route.id)
    const resultByCase = new Map<string, EvalRun['results'][number]>()
    for (const result of run?.results ?? []) {
      if (!suite.cases.some(evalCase => evalCase.id === result.caseId)) {
        throw new Error(`eval run ${route.id} names unknown case ${result.caseId}`)
      }
      if (resultByCase.has(result.caseId)) {
        throw new Error(`eval run ${route.id} contains duplicate result for case ${result.caseId}`)
      }
      resultByCase.set(result.caseId, result)
    }

    const results = suite.cases.map((evalCase): EvalReportCaseResult => {
      const fixture = evalCase.replayFixtures.find(candidate => candidate.routeId === route.id)
      /* v8 ignore next -- parseEvalSuite requires exactly one fixture for every route/case pair. */
      if (fixture === undefined) throw new Error(`case ${evalCase.id} has no replay fixture for route ${route.id}`)
      const result = resultByCase.get(evalCase.id)
      if (result === undefined) {
        return {
          caseId: evalCase.id,
          title: evalCase.title,
          replayFixture: fixture.sessionFile,
          fixtureId: `${evalCase.id}:${fixture.sessionFile}`,
          sessionId: null,
          outcome: 'infrastructure-uncertain',
          reasonCode: 'missing-result',
          usage: {
            inputTokens: null, outputTokens: null, cacheReadTokens: null,
            cacheWriteTokens: null, retryTokens: null,
          },
          latency: { agentMs: null, evaluatorMs: null },
          evidenceRefs: [],
        }
      }
      if (result.replayFixture !== fixture.sessionFile) {
        throw new Error(`eval run ${route.id}/${evalCase.id} used ${result.replayFixture}; expected ${fixture.sessionFile}`)
      }
      return {
        caseId: evalCase.id,
        title: evalCase.title,
        replayFixture: result.replayFixture,
        fixtureId: result.fixtureId,
        sessionId: result.sessionId,
        outcome: result.outcome,
        usage: result.usage,
        latency: result.latency,
        evidenceRefs: [...result.evidenceRefs],
        ...result.reasonCode === undefined ? {} : { reasonCode: result.reasonCode },
      }
    })
    const counts = emptyCounts()
    for (const result of results) counts[result.outcome] += 1
    return {
      route,
      environment: run?.environment ?? null,
      visibleSurface: run?.visibleSurface ?? null,
      outcome: foldEvalOutcomes(results.map(result => result.outcome)),
      counts,
      metrics: routeMetrics(results, counts),
      results,
    }
  })

  return {
    schemaVersion: 1,
    suiteId: suite.id,
    suiteVersion: suite.version,
    sourceRevision: suite.sourceRevision,
    title: suite.title,
    outcome: foldEvalOutcomes(routeReports.map(route => route.outcome)),
    routes: routeReports,
  }
}

/**
 * Serialize the stable report object as newline-terminated pretty JSON.
 *
 * @param report Report to serialize.
 * @returns Newline-terminated pretty JSON.
 */
export function formatEvalReportJson(report: EvalReport): string {
  return `${JSON.stringify(report, null, 2)}\n`
}

function markdownCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll(/\r?\n/g, ' ')
}

/**
 * Render a compact human-readable comparison with route provenance and case evidence.
 *
 * @param report Report to render.
 * @returns Newline-terminated Markdown.
 */
export function formatEvalReportMarkdown(report: EvalReport): string {
  const lines = [
    `# Eval report: ${report.title}`,
    '',
    `- Suite: \`${report.suiteId}\``,
    `- Suite version: \`${report.suiteVersion}\``,
    `- Source revision: \`${report.sourceRevision}\``,
    `- Outcome: **${report.outcome}**`,
    '',
    '## Routes',
    '',
    '| Route | Provider | Model | Preset | Outcome | Passed | Failed | Invalid | Infrastructure uncertain |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |',
    ...report.routes.map(({ route, outcome, counts }) => (
      `| ${markdownCell(route.id)} | ${markdownCell(route.provider)} | ${markdownCell(route.model)} | ${markdownCell(route.preset)} | ${outcome} | ${counts.passed} | ${counts.failed} | ${counts.invalid} | ${counts['infrastructure-uncertain']} |`
    )),
  ]
  for (const routeReport of report.routes) {
    lines.push(
      '',
      `## Cases: ${markdownCell(routeReport.route.id)}`,
      '',
      `- Success rate: ${String(routeReport.metrics.successRate)}`,
      `- Mean Agent latency (ms): ${String(routeReport.metrics.latency.agentMs ?? 'unknown')}`,
      `- Mean evaluator latency (ms): ${String(routeReport.metrics.latency.evaluatorMs ?? 'unknown')}`,
      `- Token usage (input/output/cache-read/cache-write/retry): ${[
        routeReport.metrics.usage.inputTokens,
        routeReport.metrics.usage.outputTokens,
        routeReport.metrics.usage.cacheReadTokens,
        routeReport.metrics.usage.cacheWriteTokens,
        routeReport.metrics.usage.retryTokens,
      ].map(value => String(value ?? 'unknown')).join('/')}`,
      '',
      '| Case | Outcome | Session | Replay fixture | Reason |',
      '| --- | --- | --- | --- | --- |',
      ...routeReport.results.map(result => (
        `| ${markdownCell(result.title)} | ${result.outcome} | ${markdownCell(result.sessionId ?? '')} | ${markdownCell(result.replayFixture)} | ${markdownCell(result.reasonCode ?? '')} |`
      )),
    )
  }
  return `${lines.join('\n')}\n`
}
