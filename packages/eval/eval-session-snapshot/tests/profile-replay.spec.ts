import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  runScenario,
  type InputScript,
} from '@deepseek-ai/dsh-session-snapshot'
import { describe, expect, test } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const fixtureRoot = join(repositoryRoot, 'snapshots', 'acp')

describe('shipped ACP Profile Eval evidence', () => {
  test('boots the real Loader/Profile composition and creates a persisted Session keylessly', {
    timeout: 60_000,
  }, async () => {
    const fixtureFile = join(fixtureRoot, 'handshake', 'session.jsonl')
    const input = JSON.parse(readFileSync(join(fixtureRoot, 'handshake', 'input.json'), 'utf8')) as InputScript
    const result = await runScenario(input, {
      mode: 'replay',
      fixtureFile,
      agent: {
        binScript: join(repositoryRoot, 'apps', 'cli', 'src', 'bin.ts'),
        configPath: join(fixtureRoot, 'escalation-approved', 'cordis.yml'),
        profile: 'acp',
        tsconfigPath: join(repositoryRoot, 'tsconfig.json'),
      },
      env: { DSH_PERMISSION_MODE: 'workspace-write' },
    })

    expect(result.sessionId).toBeTypeOf('string')
    expect(result.rawStdout).toContain('"name":"deepseek-harness-acp"')
    expect(result.sessionLogs).toHaveLength(1)
    expect(result.sessionLogs[0]?.content).toContain('"type":"session"')
    expect(result.sessionLogs[0]?.content).toContain('"type":"permission/preset"')
  })
})
