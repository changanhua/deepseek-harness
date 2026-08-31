import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RunOptions, RunResult } from '@deepseek-ai/dsh-session-snapshot'
import { describe, expect, test } from 'vitest'
import { createSessionSnapshotEvalExecutor } from '../src/index.ts'

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const fixtureRoot = join(repositoryRoot, 'snapshots', 'acp')

describe('recorded real Provider evidence', () => {
  test('replays a live recording and reports its Provider usage buckets', async () => {
    const manifest = readFileSync(join(fixtureRoot, 'escalation-rejected', 'snapshot.yml'), 'utf8')
    expect(manifest).toMatch(/^recording: live$/mu)
    const drive = async (_input: unknown, options: RunOptions): Promise<RunResult> => {
      const sessionId = 'actual-provider-session'
      const cwd = 'C:/actual/provider-workspace'
      const content = readFileSync(options.fixtureFile, 'utf8')
        .replaceAll('{{session:1}}', sessionId)
        .replaceAll('{{cwd}}', cwd)
      return {
        rawStdout: '', stderr: '', sessionId, cwd, cwdAliases: [], initialWorkspace: [], finalWorkspace: [],
        sessionLogs: [{ id: sessionId, createdAt: 1, content }],
      }
    }
    const execute = createSessionSnapshotEvalExecutor({
      fixtureRoot,
      agent: { binScript: 'unused.ts', configPath: 'unused.cordis.yml', tsconfigPath: 'tsconfig.json' },
      runScenario: drive,
      now: (() => {
        let tick = 0
        return () => ++tick
      })(),
    })

    const result = await execute({
      suiteId: 'recorded-provider',
      route: { id: 'flash', provider: 'deepseek-official', model: 'deepseek-v4-flash', preset: 'acp-default' },
      evalCase: {
        id: 'escalation-rejected', title: 'Recorded real Provider usage', prompt: 'replay',
        workspace: { kind: 'empty' }, successCriteria: [{ kind: 'session-snapshot' }],
        evaluator: { kind: 'deterministic' },
        replayFixtures: [{
          routeId: 'flash', binding: 'first-call-order', sessionFile: 'escalation-rejected/session.jsonl',
        }],
      },
      replayFixture: {
        routeId: 'flash', binding: 'first-call-order', sessionFile: 'escalation-rejected/session.jsonl',
      },
    })

    expect(result).toEqual(expect.objectContaining({
      deterministicOutcome: 'passed',
      sessionId: 'actual-provider-session',
      usage: {
        inputTokens: 1578,
        outputTokens: 243,
        cacheReadTokens: 1664,
        cacheWriteTokens: null,
        retryTokens: 0,
      },
    }))
  })
})
