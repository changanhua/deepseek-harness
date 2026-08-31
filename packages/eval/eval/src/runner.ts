import { z } from 'zod'
import { buildEvalReport, type EvalReport } from './report.ts'
import {
  evalLatencySchema,
  evalOutcomeSchema,
  evalUsageSchema,
  type EvalCaseResult,
  type EvalEnvironment,
  type EvalLatency,
  type EvalOutcome,
  type EvalRun,
  type EvalUsage,
  type EvalVisibleSurface,
} from './run.ts'
import { parseEvalSuite, type EvalCase, type EvalReplayFixture, type EvalRoute, type EvalSuite } from './schema.ts'

/** One exact case/route fixture handed to a concrete replay executor. */
export interface EvalExecutionRequest {
  suiteId: string
  route: EvalRoute
  evalCase: EvalCase
  replayFixture: EvalReplayFixture
  signal?: AbortSignal
}

/** Score returned by a concrete snapshot or replay executor. */
export interface EvalExecutionResult {
  /** Non-overridable deterministic result. */
  deterministicOutcome: EvalOutcome
  /** Independent grader result, required only for model-grader cases. */
  evaluatorOutcome?: EvalOutcome
  reasonCode?: string
  sessionId?: string
  usage?: EvalUsage
  latency?: EvalLatency
  evidenceRefs?: readonly string[]
}

/** Concrete adapter that runs one case against its route-specific fixture. */
export type EvalCaseExecutor = (request: EvalExecutionRequest) => Promise<EvalExecutionResult>

/** Optional cancellation shared by one suite execution. */
export interface RunEvalSuiteOptions {
  signal?: AbortSignal
  /** Route-specific environment and visible capability snapshots. */
  routeContexts?: Readonly<Record<string, {
    environment?: EvalEnvironment
    visibleSurface?: EvalVisibleSurface
  }>>
}

/** Complete ordered runs plus their deterministic comparison report. */
export interface EvalSuiteExecution {
  runs: EvalRun[]
  report: EvalReport
}

const evalExecutionResultSchema = z.object({
  deterministicOutcome: evalOutcomeSchema,
  evaluatorOutcome: evalOutcomeSchema.optional(),
  reasonCode: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  usage: evalUsageSchema.optional(),
  latency: evalLatencySchema.optional(),
  evidenceRefs: z.array(z.string().min(1)).optional(),
}).strict()

const unknownUsage: EvalUsage = {
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  retryTokens: null,
}

const unknownLatency: EvalLatency = { agentMs: null, evaluatorMs: null }

function classifiedResult(
  caseId: string,
  replayFixture: string,
  outcome: EvalOutcome,
  reasonCode?: string,
  evidence: Partial<Pick<EvalCaseResult, 'sessionId' | 'usage' | 'latency' | 'evidenceRefs'>> = {},
): EvalCaseResult {
  return {
    caseId,
    replayFixture,
    fixtureId: `${caseId}:${replayFixture}`,
    sessionId: evidence.sessionId ?? null,
    outcome,
    usage: evidence.usage ?? unknownUsage,
    latency: evidence.latency ?? unknownLatency,
    evidenceRefs: evidence.evidenceRefs ?? [],
    ...reasonCode === undefined ? {} : { reasonCode },
  }
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false
}

/**
 * Execute every route and case sequentially in suite order.
 *
 * Sequential execution preserves `llm-replay` first-call-order binding. Abort
 * and executor exceptions become infrastructure uncertainty instead of model
 * failures; once aborted, remaining fixtures are recorded without invoking the
 * executor.
 *
 * @param suiteInput Validated suite definition to execute.
 * @param execute Concrete route fixture executor.
 * @param options Optional suite-wide cancellation signal.
 * @returns Ordered route runs and their deterministic comparison report.
 */
export async function runEvalSuite(
  suiteInput: EvalSuite,
  execute: EvalCaseExecutor,
  options: RunEvalSuiteOptions = {},
): Promise<EvalSuiteExecution> {
  const suite = parseEvalSuite(suiteInput)
  const runs: EvalRun[] = []
  let cancelled = isAborted(options.signal)

  for (const route of suite.routes) {
    const results: EvalCaseResult[] = []
    for (const evalCase of suite.cases) {
      const replayFixture = evalCase.replayFixtures.find(fixture => fixture.routeId === route.id)
      /* v8 ignore next -- parseEvalSuite requires exactly one fixture for every route/case pair. */
      if (replayFixture === undefined) throw new Error(`case ${evalCase.id} has no replay fixture for route ${route.id}`)
      if (cancelled || isAborted(options.signal)) {
        cancelled = true
        results.push(classifiedResult(evalCase.id, replayFixture.sessionFile, 'infrastructure-uncertain', 'cancelled'))
        continue
      }
      try {
        const execution = await execute({
          suiteId: suite.id,
          route,
          evalCase,
          replayFixture,
          ...options.signal === undefined ? {} : { signal: options.signal },
        })
        if (isAborted(options.signal)) {
          cancelled = true
          results.push(classifiedResult(
            evalCase.id,
            replayFixture.sessionFile,
            'infrastructure-uncertain',
            'cancelled',
          ))
          continue
        }
        const parsed = evalExecutionResultSchema.safeParse(execution)
        if (!parsed.success) {
          results.push(classifiedResult(
            evalCase.id,
            replayFixture.sessionFile,
            'invalid',
            'invalid-executor-result',
          ))
          continue
        }
        const result = parsed.data
        const evaluatedOutcome = result.deterministicOutcome !== 'passed'
          ? result.deterministicOutcome
          : evalCase.evaluator.kind === 'model-grader'
            ? result.evaluatorOutcome ?? 'invalid'
            : result.deterministicOutcome
        const missingSessionFact = result.sessionId === undefined
          && (evaluatedOutcome === 'passed' || evaluatedOutcome === 'failed')
        const outcome = missingSessionFact ? 'infrastructure-uncertain' : evaluatedOutcome
        const reasonCode = missingSessionFact
          ? 'missing-session-fact'
          : result.deterministicOutcome === 'passed'
          && evalCase.evaluator.kind === 'model-grader'
          && result.evaluatorOutcome === undefined
            ? 'grader-result-missing'
            : result.reasonCode
        results.push(classifiedResult(
          evalCase.id,
          replayFixture.sessionFile,
          outcome,
          reasonCode,
          {
            ...result.sessionId === undefined ? {} : { sessionId: result.sessionId },
            ...result.usage === undefined ? {} : { usage: result.usage },
            ...result.latency === undefined ? {} : { latency: result.latency },
            ...result.evidenceRefs === undefined ? {} : { evidenceRefs: result.evidenceRefs },
          },
        ))
      } catch (error) {
        cancelled = isAborted(options.signal)
          || (error instanceof Error && error.name === 'AbortError')
        results.push(classifiedResult(
          evalCase.id,
          replayFixture.sessionFile,
          'infrastructure-uncertain',
          cancelled ? 'cancelled' : 'executor-error',
        ))
      }
    }
    const routeContext = options.routeContexts?.[route.id]
    runs.push({
      schemaVersion: 1,
      suiteId: suite.id,
      suiteVersion: suite.version,
      sourceRevision: suite.sourceRevision,
      route,
      environment: routeContext?.environment ?? {
        os: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
      },
      visibleSurface: routeContext?.visibleSurface ?? { tools: [], skills: [] },
      results,
    })
  }

  return { runs, report: buildEvalReport(suite, runs) }
}
