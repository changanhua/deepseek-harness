import { z } from 'zod'

const nonBlankString = z.string().min(1).refine(value => value.trim().length > 0, {
  message: 'must not be blank',
})
const sourceRevision = z.string().regex(/^[0-9a-f]{7,64}$/iu, 'sourceRevision must be a fixed hexadecimal revision')

/** Runtime schema for one compared Provider/model/Preset route. */
export const evalRouteSchema = z.object({
  id: nonBlankString,
  provider: nonBlankString,
  model: nonBlankString,
  preset: nonBlankString,
}).strict()

/** Runtime schema for the replay transcript selected by one case and route. */
export const evalReplayFixtureSchema = z.object({
  routeId: nonBlankString,
  binding: z.literal('first-call-order'),
  sessionFile: nonBlankString,
  overrideFile: nonBlankString.optional(),
  childFiles: z.array(nonBlankString).optional(),
}).strict()

/** Runtime schema for deterministic workspace preparation. */
export const evalWorkspaceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('empty') }).strict(),
  z.object({ kind: z.literal('fixture'), path: nonBlankString }).strict(),
])

/** Runtime schema for one non-overridable deterministic success condition. */
export const evalSuccessCriterionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session-snapshot') }).strict(),
  z.object({ kind: z.literal('output-equals'), text: z.string() }).strict(),
  z.object({ kind: z.literal('output-contains'), text: nonBlankString }).strict(),
])

/** Runtime schema for the evaluator permitted after deterministic checks. */
export const evalEvaluatorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('deterministic') }).strict(),
  z.object({
    kind: z.literal('model-grader'),
    provider: nonBlankString,
    model: nonBlankString,
    promptVersion: nonBlankString,
  }).strict(),
])

/** Runtime schema for one deterministic evaluation case. */
export const evalCaseSchema = z.object({
  id: nonBlankString,
  title: nonBlankString,
  prompt: nonBlankString,
  workspace: evalWorkspaceSchema,
  successCriteria: z.array(evalSuccessCriterionSchema).min(1),
  evaluator: evalEvaluatorSchema,
  permissionAnswers: z.array(z.object({
    kind: z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always']),
  }).strict()).optional(),
  replayFixtures: z.array(evalReplayFixtureSchema).min(1),
}).strict()

/** Runtime schema for a versioned deterministic evaluation suite. */
export const evalSuiteSchema = z.object({
  schemaVersion: z.literal(1),
  id: nonBlankString,
  version: nonBlankString,
  sourceRevision,
  title: nonBlankString,
  defaultRouteIds: z.array(nonBlankString).min(2),
  routes: z.array(evalRouteSchema).min(2),
  cases: z.array(evalCaseSchema).min(1),
}).strict().superRefine((suite, context) => {
  if (new Set(suite.routes.map(route => route.id)).size !== suite.routes.length) {
    context.addIssue({ code: 'custom', path: ['routes'], message: 'route ids must be unique' })
  }
  if (new Set(suite.cases.map(evalCase => evalCase.id)).size !== suite.cases.length) {
    context.addIssue({ code: 'custom', path: ['cases'], message: 'case ids must be unique' })
  }
  const routeIds = new Set(suite.routes.map(route => route.id))
  if (new Set(suite.defaultRouteIds).size !== suite.defaultRouteIds.length) {
    context.addIssue({ code: 'custom', path: ['defaultRouteIds'], message: 'default route ids must be unique' })
  }
  for (const [index, routeId] of suite.defaultRouteIds.entries()) {
    if (!routeIds.has(routeId)) {
      context.addIssue({
        code: 'custom', path: ['defaultRouteIds', index], message: `unknown default route ${routeId}`,
      })
    }
  }
  for (const [caseIndex, evalCase] of suite.cases.entries()) {
    for (const routeId of routeIds) {
      const count = evalCase.replayFixtures.filter(fixture => fixture.routeId === routeId).length
      if (count !== 1) {
        context.addIssue({
          code: 'custom',
          path: ['cases', caseIndex, 'replayFixtures'],
          message: `case ${evalCase.id} must provide exactly one replay fixture for route ${routeId}`,
        })
      }
    }
    for (const [fixtureIndex, fixture] of evalCase.replayFixtures.entries()) {
      if (!routeIds.has(fixture.routeId)) {
        context.addIssue({
          code: 'custom',
          path: ['cases', caseIndex, 'replayFixtures', fixtureIndex, 'routeId'],
          message: `unknown route ${fixture.routeId}`,
        })
      }
      const shared = evalCase.replayFixtures.findIndex((candidate, index) => (
        index < fixtureIndex && candidate.sessionFile === fixture.sessionFile
      ))
      if (shared !== -1) {
        context.addIssue({
          code: 'custom',
          path: ['cases', caseIndex, 'replayFixtures', fixtureIndex, 'sessionFile'],
          message: `compared routes require an independent sessionFile; fixture ${fixture.routeId} shares one with fixture ${evalCase.replayFixtures[shared]?.routeId}`,
        })
      }
    }
  }
})

/** One validated evaluation suite. */
export type EvalSuite = z.infer<typeof evalSuiteSchema>
/** One validated compared route. */
export type EvalRoute = z.infer<typeof evalRouteSchema>
/** One validated evaluation case. */
export type EvalCase = z.infer<typeof evalCaseSchema>
/** One validated route-specific replay fixture. */
export type EvalReplayFixture = z.infer<typeof evalReplayFixtureSchema>
/** One deterministic workspace preparation declaration. */
export type EvalWorkspace = z.infer<typeof evalWorkspaceSchema>
/** One deterministic success condition. */
export type EvalSuccessCriterion = z.infer<typeof evalSuccessCriterionSchema>
/** One permitted evaluator declaration. */
export type EvalEvaluator = z.infer<typeof evalEvaluatorSchema>

/**
 * Parse an untrusted evaluation-suite document.
 *
 * @param input Untrusted suite data.
 * @returns The validated deterministic evaluation suite.
 * @throws {z.ZodError} when any record is malformed or contains unknown fields.
 */
export function parseEvalSuite(input: unknown): EvalSuite {
  return evalSuiteSchema.parse(input)
}
