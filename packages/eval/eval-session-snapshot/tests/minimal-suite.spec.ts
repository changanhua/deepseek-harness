import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatEvalReportJson,
  parseEvalSuite,
  runEvalSuite,
  type EvalExecutionRequest,
} from '@deepseek-ai/dsh-eval'
import type { RunOptions, RunResult } from '@deepseek-ai/dsh-session-snapshot'
import { describe, expect, test } from 'vitest'
import { createSessionSnapshotEvalExecutor } from '../src/index.ts'

const suiteRoot = fileURLToPath(new URL('../suites/minimal-v1', import.meta.url))
const suite = parseEvalSuite(JSON.parse(readFileSync(join(suiteRoot, 'suite.json'), 'utf8')))

function deterministicNow(): () => number {
  let tick = 0
  return () => {
    tick += 10
    return tick
  }
}

async function replayFixture(_input: unknown, options: RunOptions): Promise<RunResult> {
  const sessionId = 'actual-session'
  const cwd = 'C:/actual/cwd'
  const content = readFileSync(options.fixtureFile, 'utf8')
    .replaceAll('{{session:1}}', sessionId)
    .replaceAll('{{cwd}}', cwd)
  return {
    rawStdout: '', stderr: '', sessionId, cwd, cwdAliases: [], initialWorkspace: [], finalWorkspace: [],
    sessionLogs: [{ id: sessionId, createdAt: 42, content }],
  }
}

function createKeylessExecutor() {
  const replay = createSessionSnapshotEvalExecutor({
    fixtureRoot: suiteRoot,
    agent: { binScript: 'unused.ts', configPath: 'unused.cordis.yml', tsconfigPath: 'tsconfig.json' },
    runScenario: replayFixture,
    now: deterministicNow(),
  })
  return async (request: EvalExecutionRequest) => {
    const result = await replay(request)
    switch (request.evalCase.id) {
      case 'case-03':
        return { ...result, deterministicOutcome: 'failed' as const, reasonCode: 'task-check-failed' }
      case 'case-04':
        return { ...result, evaluatorOutcome: 'failed' as const, reasonCode: 'grader-rejected' }
      case 'case-05':
        throw new Error('simulated host restart after replay')
      default:
        return result
    }
  }
}

describe('minimal replay evaluation suite', () => {
  test('ships ten cases and independent first-call-order fixtures for both routes', () => {
    expect(suite.cases).toHaveLength(10)
    const fixtures = suite.cases.flatMap(evalCase => evalCase.replayFixtures)
    expect(fixtures).toHaveLength(20)
    expect(new Set(fixtures.map(fixture => fixture.sessionFile)).size).toBe(20)
    expect(fixtures.every(fixture => fixture.binding === 'first-call-order')).toBe(true)
  })

  test('rebuilds a byte-stable report with success, task, grader, and infrastructure samples', async () => {
    const routeContexts = Object.fromEntries(suite.routes.map(route => [route.id, {
      environment: { os: 'win32', arch: 'x64', nodeVersion: 'v25.5.0' },
      visibleSurface: { tools: ['read', 'write'], skills: ['dsh-code-review'] },
    }]))
    const probeCase = suite.cases[0] as NonNullable<typeof suite.cases[0]>
    const probeFixture = probeCase.replayFixtures[0] as NonNullable<typeof probeCase.replayFixtures[0]>
    await expect(createKeylessExecutor()({
      suiteId: suite.id, route: suite.routes[0] as NonNullable<typeof suite.routes[0]>,
      evalCase: probeCase, replayFixture: probeFixture,
    })).resolves.toEqual(expect.objectContaining({ deterministicOutcome: 'passed' }))
    const first = await runEvalSuite(suite, createKeylessExecutor(), { routeContexts })
    const second = await runEvalSuite(suite, createKeylessExecutor(), { routeContexts })

    expect(formatEvalReportJson(first.report)).toBe(formatEvalReportJson(second.report))
    expect(first.runs).toHaveLength(2)
    expect(first.runs.every(run => run.results.length === 10)).toBe(true)
    expect(first.runs.flatMap(run => run.results)).toEqual(expect.arrayContaining([
      expect.objectContaining({ outcome: 'passed' }),
      expect.objectContaining({ outcome: 'failed', reasonCode: 'task-check-failed' }),
      expect.objectContaining({ outcome: 'failed', reasonCode: 'grader-rejected' }),
      expect.objectContaining({ outcome: 'infrastructure-uncertain', reasonCode: 'executor-error' }),
    ]))
  })

  test('boots the real ACP subprocess harness for one fixture from each route', { timeout: 30_000 }, async () => {
    const fakeAgent = fileURLToPath(new URL(
      '../../../test-support/session-snapshot/tests/fixtures/fake-acp-agent.ts',
      import.meta.url,
    ))
    const execute = createSessionSnapshotEvalExecutor({
      fixtureRoot: suiteRoot,
      agent: {
        binScript: fakeAgent,
        libBinScript: fakeAgent,
        configPath: fakeAgent,
        tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)),
      },
    })

    for (const route of suite.routes) {
      const evalCase = suite.cases[0]
      const replayFixture = evalCase?.replayFixtures.find(fixture => fixture.routeId === route.id)
      expect(evalCase).toBeDefined()
      expect(replayFixture).toBeDefined()
      await expect(execute({
        suiteId: suite.id,
        route,
        evalCase: evalCase as NonNullable<typeof evalCase>,
        replayFixture: replayFixture as NonNullable<typeof replayFixture>,
      })).resolves.toEqual(expect.objectContaining({ deterministicOutcome: 'passed' }))
    }
  })
})
