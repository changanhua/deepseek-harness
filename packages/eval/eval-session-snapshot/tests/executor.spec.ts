import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import type { EvalCaseExecutor, EvalExecutionRequest } from '@deepseek-ai/dsh-eval'
import * as adapterApi from '../src/index.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const request: EvalExecutionRequest = {
  suiteId: 'runner-suite',
  route: { id: 'flash', provider: 'deepseek-official', model: 'deepseek-v4-flash', preset: 'base' },
  evalCase: {
    id: 'case-a',
    title: 'Case A',
    prompt: 'Run A.',
    workspace: { kind: 'empty' },
    successCriteria: [{ kind: 'session-snapshot' }],
    evaluator: { kind: 'deterministic' },
    replayFixtures: [
      { routeId: 'flash', binding: 'first-call-order', sessionFile: 'case-a/flash/session.jsonl' },
    ],
  },
  replayFixture: { routeId: 'flash', binding: 'first-call-order', sessionFile: 'case-a/flash/session.jsonl' },
}

const fixtureHeader = (id: string, cwd: string, model = 'deepseek-v4-flash'): string => [
  JSON.stringify({ type: 'session', version: 3, id, createdAt: 1, cwd }),
  JSON.stringify({
    type: 'request/header',
    data: { header: { config: { provider: 'deepseek-official', model } }, reason: 'initial' },
  }),
  '',
].join('\n')

type ExecutorFactory = (options: unknown) => EvalCaseExecutor
const createExecutor = (adapterApi as Record<string, unknown>)
  .createSessionSnapshotEvalExecutor as ExecutorFactory

describe('session-snapshot Eval executor', () => {
  test('drives the ACP replay harness and passes an equal normalized session snapshot', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-eval-adapter-'))
    roots.push(root)
    const scenarioDir = join(root, 'case-a', 'flash')
    const fixtureFile = join(scenarioDir, 'session.jsonl')
    mkdirSync(scenarioDir, { recursive: true })
    writeFileSync(fixtureFile, fixtureHeader('fixture-session', '/recorded/cwd'), { encoding: 'utf8', flag: 'wx' })
    let observedInput: unknown
    let observedOptions: unknown
    const execute = createExecutor({
      fixtureRoot: root,
      agent: { binScript: 'bin.ts', configPath: 'cordis.yml', tsconfigPath: 'tsconfig.json' },
      env: { DSH_PERMISSION_MODE: 'workspace-write', SHARED_EVAL: '1' },
      configPath: 'alternate.cordis.yml',
      routes: {
        flash: {
          agent: { binScript: 'flash-bin.ts', configPath: 'flash.cordis.yml', tsconfigPath: 'tsconfig.json' },
          env: { DSH_PERMISSION_MODE: 'danger-full-access' },
          configPath: 'flash.snapshot.cordis.yml',
        },
      },
      runScenario: async (input: unknown, options: unknown) => {
        observedInput = input
        observedOptions = options
        return {
          rawStdout: '',
          stderr: '',
          sessionId: 'actual-session',
          cwd: 'C:\\actual\\cwd',
          cwdAliases: [],
          initialWorkspace: [],
          finalWorkspace: [],
          sessionLogs: [{
            id: 'actual-session',
            createdAt: 1,
            content: fixtureHeader('actual-session', 'C:\\actual\\cwd'),
          }],
        }
      },
    })

    expect(await execute({
      ...request,
      evalCase: { ...request.evalCase, permissionAnswers: [{ kind: 'reject_once' }] },
    })).toEqual(expect.objectContaining({ deterministicOutcome: 'passed' }))
    expect(observedInput).toEqual({
      steps: [
        { op: 'initialize' },
        { op: 'newSession' },
        { op: 'prompt', text: 'Run A.' },
      ],
      permissionAnswers: [{ kind: 'reject_once' }],
    })
    expect(observedOptions).toEqual(expect.objectContaining({
      mode: 'replay',
      fixtureFile,
      agent: { binScript: 'flash-bin.ts', configPath: 'flash.cordis.yml', tsconfigPath: 'tsconfig.json' },
      env: { DSH_PERMISSION_MODE: 'danger-full-access', SHARED_EVAL: '1' },
      configPath: 'flash.snapshot.cordis.yml',
    }))
  })

  test('returns a deterministic failure code for a snapshot mismatch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-eval-adapter-'))
    roots.push(root)
    const fixtureFile = join(root, 'case-a', 'flash', 'session.jsonl')
    mkdirSync(join(root, 'case-a', 'flash'), { recursive: true })
    writeFileSync(fixtureFile, `${fixtureHeader('fixture-session', '/recorded/cwd')}${JSON.stringify({ type: 'marker', value: 'expected' })}\n`, { encoding: 'utf8', flag: 'wx' })
    const execute = createExecutor({
      fixtureRoot: root,
      agent: { binScript: 'bin.ts', configPath: 'cordis.yml', tsconfigPath: 'tsconfig.json' },
      runScenario: async () => ({
        rawStdout: '', stderr: '', cwd: 'C:\\actual\\cwd', cwdAliases: [], initialWorkspace: [], finalWorkspace: [],
        sessionLogs: [{ id: 'actual-session', createdAt: 1, content: `${fixtureHeader('actual-session', 'C:\\actual\\cwd')}${JSON.stringify({ type: 'marker', value: 'actual' })}\n` }],
      }),
    })

    expect(await execute(request)).toEqual(expect.objectContaining({ deterministicOutcome: 'failed', reasonCode: 'snapshot-mismatch' }))
  })

  test('uses the real session-snapshot subprocess harness by default', { timeout: 20_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-eval-adapter-real-'))
    roots.push(root)
    const scenarioDir = join(root, 'case-a', 'flash')
    mkdirSync(scenarioDir, { recursive: true })
    writeFileSync(join(scenarioDir, 'session.jsonl'), [
      JSON.stringify({ type: 'session', id: 'fixture-session', createdAt: 42, cwd: '/recorded/cwd' }),
      JSON.stringify({ type: 'request/header', data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }, reason: 'initial' } }),
      JSON.stringify({ type: 'turn/start', seq: 1, time: 9, data: { turn: 1 } }),
      JSON.stringify({ type: 'assistant/message', data: { usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 0 } } }),
      '',
    ].join('\n'))
    writeFileSync(join(scenarioDir, 'behavior.json'), JSON.stringify({
      logs: [{
        file: 'project/main/session.jsonl',
        lines: [
          { type: 'session', id: '{{SID}}', createdAt: 42, cwd: '{{CWD}}' },
          { type: 'request/header', data: { header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } }, reason: 'initial' } },
          { type: 'turn/start', seq: 1, time: 9, data: { turn: 1 } },
          { type: 'assistant/message', data: { usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 0 } } },
        ],
      }],
    }))
    const fakeAgent = fileURLToPath(new URL('../../../test-support/session-snapshot/tests/fixtures/fake-acp-agent.ts', import.meta.url))
    const execute = createExecutor({
      fixtureRoot: root,
      agent: {
        binScript: fakeAgent,
        libBinScript: fakeAgent,
        configPath: fakeAgent,
        tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)),
      },
    })

    const result = await execute(request)
    expect(result).toEqual(expect.objectContaining({
      deterministicOutcome: 'passed',
      usage: {
        inputTokens: 11, outputTokens: 3, cacheReadTokens: 5, cacheWriteTokens: 0, retryTokens: 0,
      },
    }))
    expect(typeof result.sessionId).toBe('string')
    expect(typeof result.latency?.agentMs).toBe('number')
    expect(typeof result.latency?.evaluatorMs).toBe('number')
  })

  test('rejects a replay fixture recorded for another model before execution', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-eval-adapter-route-'))
    roots.push(root)
    const scenarioDir = join(root, 'case-a', 'flash')
    mkdirSync(scenarioDir, { recursive: true })
    writeFileSync(join(scenarioDir, 'session.jsonl'), fixtureHeader('fixture-session', '/recorded/cwd'))
    let calls = 0
    const execute = createExecutor({
      fixtureRoot: root,
      agent: { binScript: 'bin.ts', configPath: 'cordis.yml', tsconfigPath: 'tsconfig.json' },
      runScenario: async () => {
        calls += 1
        throw new Error('must not execute')
      },
    })

    expect(await execute({
      ...request,
      route: { ...request.route, model: 'deepseek-v4-pro' },
    })).toEqual({ deterministicOutcome: 'invalid', reasonCode: 'fixture-route-mismatch' })
    expect(calls).toBe(0)
  })

  test('rejects traversal and absolute fixture paths but allows a child name beginning with dots', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-eval-adapter-path-'))
    roots.push(root)
    const dottedDir = join(root, '..fixtures')
    mkdirSync(dottedDir, { recursive: true })
    writeFileSync(join(dottedDir, 'session.jsonl'), fixtureHeader('fixture-session', '/recorded/cwd'))
    const execute = createExecutor({
      fixtureRoot: root,
      agent: { binScript: 'bin.ts', configPath: 'cordis.yml', tsconfigPath: 'tsconfig.json' },
      runScenario: async () => ({
        rawStdout: '', stderr: '', cwd: 'C:\\actual\\cwd', cwdAliases: [], initialWorkspace: [], finalWorkspace: [],
        sessionLogs: [{ id: 'actual-session', createdAt: 1, content: fixtureHeader('actual-session', 'C:\\actual\\cwd') }],
      }),
    })

    await expect(execute({
      ...request,
      replayFixture: { ...request.replayFixture, sessionFile: '../outside/session.jsonl' },
    })).rejects.toThrow(/escapes fixtureRoot/)
    await expect(execute({
      ...request,
      replayFixture: { ...request.replayFixture, sessionFile: join(root, '..fixtures', 'session.jsonl') },
    })).rejects.toThrow(/must be relative/)
    await expect(execute({
      ...request,
      replayFixture: { ...request.replayFixture, sessionFile: '..fixtures/session.jsonl' },
    })).resolves.toEqual(expect.objectContaining({ deterministicOutcome: 'passed' }))
  })

  test('classifies missing route provenance before launching the subprocess', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-eval-adapter-missing-route-'))
    roots.push(root)
    const scenarioDir = join(root, 'case-a', 'flash')
    mkdirSync(scenarioDir, { recursive: true })
    writeFileSync(join(scenarioDir, 'session.jsonl'), `${JSON.stringify({ type: 'session', id: 'fixture', cwd: '/recorded' })}\n\n`)
    let calls = 0
    const execute = createExecutor({
      fixtureRoot: root,
      agent: { binScript: 'bin.ts', configPath: 'cordis.yml', tsconfigPath: 'tsconfig.json' },
      runScenario: async () => {
        calls += 1
        throw new Error('must not execute')
      },
    })

    expect(await execute(request)).toEqual({ deterministicOutcome: 'invalid', reasonCode: 'fixture-route-provenance-missing' })
    expect(calls).toBe(0)
  })

  test('forwards override and child fixtures and reports a session-count mismatch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-eval-adapter-children-'))
    roots.push(root)
    const scenarioDir = join(root, 'case-a', 'flash')
    mkdirSync(scenarioDir, { recursive: true })
    writeFileSync(join(scenarioDir, 'session.jsonl'), fixtureHeader('fixture-session', '/recorded/cwd'))
    writeFileSync(join(scenarioDir, 'session.1.jsonl'), fixtureHeader('fixture-child', '/recorded/cwd'))
    writeFileSync(join(scenarioDir, 'replay.override.json'), '{}')
    let observedOptions: unknown
    const execute = createExecutor({
      fixtureRoot: root,
      agent: { binScript: 'bin.ts', configPath: 'cordis.yml', tsconfigPath: 'tsconfig.json' },
      runScenario: async (_input: unknown, options: unknown) => {
        observedOptions = options
        return {
          rawStdout: '', stderr: '', cwd: 'C:\\actual\\cwd', cwdAliases: [], initialWorkspace: [], finalWorkspace: [],
          sessionLogs: [{ id: 'actual-session', createdAt: 1, content: fixtureHeader('actual-session', 'C:\\actual\\cwd') }],
        }
      },
    })

    expect(await execute({
      ...request,
      replayFixture: {
        ...request.replayFixture,
        childFiles: ['case-a/flash/session.1.jsonl'],
        overrideFile: 'case-a/flash/replay.override.json',
      },
    })).toEqual({ deterministicOutcome: 'failed', reasonCode: 'session-count-mismatch' })
    expect(observedOptions).toEqual(expect.objectContaining({
      childFiles: [join(scenarioDir, 'session.1.jsonl')],
      overrideFile: join(scenarioDir, 'replay.override.json'),
    }))
  })

  test('rejects an already-aborted request before reading fixtures', async () => {
    const controller = new AbortController()
    controller.abort()
    const execute = createExecutor({
      fixtureRoot: 'missing-root',
      agent: { binScript: 'bin.ts', configPath: 'cordis.yml', tsconfigPath: 'tsconfig.json' },
    })

    await expect(execute({ ...request, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('keeps incomplete cache and retry usage explicitly unknown', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-eval-adapter-usage-'))
    roots.push(root)
    const scenarioDir = join(root, 'case-a', 'flash')
    mkdirSync(scenarioDir, { recursive: true })
    const usageRecords = [
      { type: 'assistant/message', data: { usage: null } },
      { type: 'assistant/message', data: { usage: { inputTokens: 'bad', outputTokens: 1 } } },
      { type: 'llm/retry', data: { turn: 1, step: 1 } },
      { type: 'assistant/message', data: { usage: { inputTokens: 4, outputTokens: 2 } } },
    ]
    const expected = `${fixtureHeader('fixture-session', '/recorded/cwd')}${usageRecords.map(record => JSON.stringify(record)).join('\n')}\n`
    const actual = `${fixtureHeader('actual-session', 'C:/actual/cwd')}${usageRecords.map(record => JSON.stringify(record)).join('\n')}\n`
    writeFileSync(join(scenarioDir, 'session.jsonl'), expected)
    const execute = createExecutor({
      fixtureRoot: root,
      agent: { binScript: 'bin.ts', configPath: 'cordis.yml', tsconfigPath: 'tsconfig.json' },
      runScenario: async () => ({
        rawStdout: '', stderr: '', sessionId: 'actual-session', cwd: 'C:/actual/cwd', cwdAliases: [],
        initialWorkspace: [], finalWorkspace: [],
        sessionLogs: [{ id: 'actual-session', createdAt: 1, content: actual }],
      }),
    })

    expect(await execute(request)).toEqual(expect.objectContaining({
      deterministicOutcome: 'passed',
      usage: {
        inputTokens: 4, outputTokens: 2, cacheReadTokens: null, cacheWriteTokens: null, retryTokens: null,
      },
    }))
  })

})
