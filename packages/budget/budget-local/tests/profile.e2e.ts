import { resolveExampleMode } from '@deepseek-ai/dsh-loader-smoke'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { expect, test } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'

test('production headless Profile enforces a durable SQLite budget before the second model request', async () => {
  const configPath = fileURLToPath(new URL(`./fixtures/profile/budget${resolveExampleMode() === 'lib' ? '.lib' : ''}.patch.yml`, import.meta.url))
  const binScript = fileURLToPath(new URL('./fixtures/profile/driver.ts', import.meta.url))
  let evidence: unknown
  await runLoaderSmoke({ label: 'resource-budget', tempDirPrefix: 'resource-budget-profile-', binScript, libBinScript: fileURLToPath(new URL('./fixtures/profile/driver.lib.ts', import.meta.url)),
    ...(process.platform === 'win32' ? { tempDirParent: homedir() } : {}),
    configPath, binArgs: [configPath, 'Prove the first authorized request.'],
    tsconfigPath: fileURLToPath(new URL('../../../../tsconfig.json', import.meta.url)),
    inspect: async (cwd) => {
      evidence = JSON.parse(await readFile(join(cwd, 'budget-evidence.json'), 'utf8'))
      expect(await readdir(join(cwd, 'budget-private'))).toContain('account.sqlite')
      expect(await readdir(join(cwd, '.sessions'))).not.toHaveLength(0)
    } })
  expect(evidence).toMatchObject({ calls: 1, snapshot: { consumed: { requests: 1, inputTokens: 7, outputTokens: 4,
    totalTokens: 11 }, unknownRequests: 0 },
  terminal: { kind: 'error', error: { code: 'BUDGET_EXHAUSTED' } } })
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
