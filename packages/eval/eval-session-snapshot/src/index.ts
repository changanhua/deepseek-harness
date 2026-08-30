/** ACP session-snapshot adapter for the deterministic Eval runner. */

import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { EvalUsage } from '@deepseek-ai/dsh-eval'
import type { EvalCaseExecutor } from '@deepseek-ai/dsh-eval'
import {
  fixtureContext,
  normalizeSessionSnapshots,
  runScenario,
  type AgentUnderTest,
  type RunOptions,
  type RunResult,
  type InputScript,
} from '@deepseek-ai/dsh-session-snapshot'

/** Subprocess driver compatible with session-snapshot's real ACP harness. */
export type EvalSnapshotScenarioDriver = (input: InputScript, options: RunOptions) => Promise<RunResult>

/** Per-route application and profile selection for a compared suite. */
export interface SessionSnapshotEvalRouteOptions {
  agent?: AgentUnderTest
  env?: NodeJS.ProcessEnv
  configPath?: string
}

/** Configuration for one keyless ACP replay executor. */
export interface SessionSnapshotEvalExecutorOptions {
  /** Root that contains every suite-authored relative replay path. */
  fixtureRoot: string
  /** Real DSH application/profile entry booted by the snapshot harness. */
  agent: AgentUnderTest
  /** Scenario environment layered into the spawned application. */
  env?: NodeJS.ProcessEnv
  /** Optional profile patch selected for every case in this executor. */
  configPath?: string
  /** Route-specific application, environment, or profile overrides. */
  routes?: Readonly<Record<string, SessionSnapshotEvalRouteOptions>>
  /** Test seam; production callers use the real session-snapshot driver. */
  runScenario?: EvalSnapshotScenarioDriver
  /** Monotonic timing seam; production callers use `performance.now()`. */
  now?: () => number
}

function fixturePath(root: string, candidate: string): string {
  if (isAbsolute(candidate)) {
    throw new Error(`eval replay fixture path must be relative: ${candidate}`)
  }
  const resolved = resolve(root, candidate)
  const fromRoot = relative(root, resolved)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`eval replay fixture escapes fixtureRoot: ${candidate}`)
  }
  return resolved
}

function recordedRoute(log: string): { provider: string; model: string } | undefined {
  for (const line of log.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    const record = JSON.parse(line) as {
      type?: unknown
      data?: { header?: { config?: { provider?: unknown; model?: unknown } } }
    }
    const config = record.type === 'request/header' ? record.data?.header?.config : undefined
    if (typeof config?.provider === 'string' && typeof config.model === 'string') {
      return { provider: config.provider, model: config.model }
    }
  }
  return undefined
}

function recordedUsage(log: string): EvalUsage {
  const attempts: Array<{
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }> = []
  let retried = false
  for (const line of log.split(/\r?\n/)) {
    if (line.trim().length === 0) continue
    const record = JSON.parse(line) as {
      type?: unknown
      data?: { usage?: unknown }
    }
    if (record.type === 'llm/retry') retried = true
    if (record.type !== 'assistant/message' || typeof record.data?.usage !== 'object'
      || record.data.usage === null) continue
    const usage = record.data.usage as Record<string, unknown>
    if (!Number.isSafeInteger(usage.inputTokens) || !Number.isSafeInteger(usage.outputTokens)) continue
    attempts.push({
      inputTokens: usage.inputTokens as number,
      outputTokens: usage.outputTokens as number,
      ...Number.isSafeInteger(usage.cacheReadTokens)
        ? { cacheReadTokens: usage.cacheReadTokens as number }
        : {},
      ...Number.isSafeInteger(usage.cacheWriteTokens)
        ? { cacheWriteTokens: usage.cacheWriteTokens as number }
        : {},
    })
  }
  const sum = (field: 'inputTokens' | 'outputTokens'): number | null => attempts.length === 0
    ? null
    : attempts.reduce((total, attempt) => total + attempt[field], 0)
  const optionalSum = (field: 'cacheReadTokens' | 'cacheWriteTokens'): number | null => (
    attempts.length > 0 && attempts.every(attempt => attempt[field] !== undefined)
      ? attempts.reduce((total, attempt) => total + (attempt[field] as number), 0)
      : null
  )
  return {
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    cacheReadTokens: optionalSum('cacheReadTokens'),
    cacheWriteTokens: optionalSum('cacheWriteTokens'),
    retryTokens: retried ? null : 0,
  }
}

/**
 * Create a keyless executor that boots the real ACP application through
 * session-snapshot, replays the named route fixture, and compares normalized
 * persisted logs. Snapshot mismatches are model failures; subprocess errors
 * remain exceptions for {@link runEvalSuite} to classify as infrastructure.
 *
 * @param options Fixture root, application profile, and route-specific overrides.
 * @returns An Eval case executor backed by the session-snapshot ACP harness.
 */
export function createSessionSnapshotEvalExecutor(
  options: SessionSnapshotEvalExecutorOptions,
): EvalCaseExecutor {
  const root = resolve(options.fixtureRoot)
  const drive = options.runScenario ?? runScenario
  const now = options.now ?? (() => performance.now())
  return async (request) => {
    if (request.signal?.aborted === true) throw new DOMException('cancelled', 'AbortError')
    const fixtureFile = fixturePath(root, request.replayFixture.sessionFile)
    const childFiles = (request.replayFixture.childFiles ?? []).map(file => fixturePath(root, file))
    const overrideFile = request.replayFixture.overrideFile === undefined
      ? undefined
      : fixturePath(root, request.replayFixture.overrideFile)
    const expectedFiles = [fixtureFile, ...childFiles]
    const expectedLogs = await Promise.all(expectedFiles.map(file => readFile(file, 'utf8')))
    const provenance = recordedRoute(expectedLogs[0] as string)
    if (provenance === undefined) {
      return { deterministicOutcome: 'invalid', reasonCode: 'fixture-route-provenance-missing' }
    }
    if (provenance.provider !== request.route.provider || provenance.model !== request.route.model) {
      return { deterministicOutcome: 'invalid', reasonCode: 'fixture-route-mismatch' }
    }
    const input: InputScript = {
      steps: [
        { op: 'initialize' },
        { op: 'newSession' },
        { op: 'prompt', text: request.evalCase.prompt },
      ],
      ...request.evalCase.permissionAnswers === undefined
        ? {}
        : { permissionAnswers: request.evalCase.permissionAnswers },
    }
    const routeOptions = options.routes?.[request.route.id]
    const env = options.env === undefined && routeOptions?.env === undefined
      ? undefined
      : { ...options.env, ...routeOptions?.env }
    const configPath = routeOptions?.configPath ?? options.configPath
    const workspaceDir = request.evalCase.workspace.kind === 'fixture'
      ? fixturePath(root, request.evalCase.workspace.path)
      : undefined
    const agentStartedAt = now()
    const result = await drive(input, {
      agent: routeOptions?.agent ?? options.agent,
      mode: 'replay',
      fixtureFile,
      ...env === undefined ? {} : { env },
      ...configPath === undefined ? {} : { configPath },
      ...overrideFile === undefined ? {} : { overrideFile },
      ...childFiles.length === 0 ? {} : { childFiles },
      ...workspaceDir === undefined ? {} : { workspaceDir },
    })
    const agentMs = now() - agentStartedAt
    if (result.sessionLogs.length !== expectedFiles.length) {
      return { deterministicOutcome: 'failed', reasonCode: 'session-count-mismatch' }
    }
    const evaluatorStartedAt = now()
    const fixtureContexts = expectedLogs.map(fixtureContext)
    const fixtureCwd = fixtureContexts[0] as { cwd: string }
    const expected = normalizeSessionSnapshots(expectedLogs, {
      sessionIds: fixtureContexts.flatMap(context => context.sessionIds),
      cwd: fixtureCwd.cwd,
    })
    const actual = normalizeSessionSnapshots(
      result.sessionLogs.map(log => log.content),
      {
        sessionIds: result.sessionLogs.map(log => log.id),
        cwd: result.cwd,
        cwdAliases: result.cwdAliases,
      },
    )
    const evaluatorMs = now() - evaluatorStartedAt
    const evidence = {
      ...result.sessionId === undefined ? {} : { sessionId: result.sessionId },
      usage: recordedUsage((result.sessionLogs[0] as RunResult['sessionLogs'][number]).content),
      latency: { agentMs, evaluatorMs },
      evidenceRefs: [
        ...result.sessionId === undefined ? [] : [`session:${result.sessionId}`],
        ...expectedFiles.map(file => `fixture:${file}`),
      ],
    }
    return actual.every((snapshot, index) => snapshot === expected[index])
      ? { deterministicOutcome: 'passed', ...evidence }
      : { deterministicOutcome: 'failed', reasonCode: 'snapshot-mismatch', ...evidence }
  }
}
