import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from 'vitest'
import { runLoaderSmoke, LOADER_SMOKE_TEST_TIMEOUT_MS } from '@deepseek-ai/dsh-loader-smoke'

const checkout = resolve(import.meta.dirname, '../../../..')
const app = join(checkout, 'packages/eval/eval-app/src/index.ts')
const fixture = join(checkout, 'packages/eval/eval-app/tests/fixtures/profile.ts')

async function run(args: readonly string[], expectedExitCode = 0) {
  return await runLoaderSmoke({
    label: 'eval-app-profile', tempDirPrefix: 'eval-app-profile-', binScript: join(checkout, 'apps/cli/src/bin.ts'),
    configPath: join(checkout, 'apps/cli/config/examples/eval.patch.yml'), tsconfigPath: join(checkout, 'tsconfig.json'),
    binArgs: ['--profile', 'eval-cli', ...args], expectedExitCode,
    prepare: async (cwd) => {
      const profile = join(cwd, '.dsh/profiles/eval-cli')
      await mkdir(profile, { recursive: true })
      await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'eval-cli-smoke', private: true,
        dsh: { profile: { bundles: [], patchReload: 'startup' } } }))
      await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: [
        { id: 'eval-fixture', name: pathToFileURL(fixture).href },
        { id: 'eval-app', name: pathToFileURL(app).href, config: {
          profile: 'eval-cli', workspaceId: 'workspace-1', actorId: 'operator', policyIds: ['approved'], gatePolicyIds: ['release'],
          maxOutputBytes: 65536, waitMs: 100,
        } },
      ] }]))
    },
  })
}

test('real dsh Profile starts an Eval request through the safe CLI consumer', async () => {
  const result = await run(['start', '--request', 'profile-request', '--plan', 'plan', '--version', '1', '--policy', 'approved'])
  expect(JSON.parse(result.stdout)).toMatchObject({ kind: 'success', result: {
    id: 'run-1', requestId: 'profile-request', phase: 'queued', policy: 'approved',
  } })
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

test('real dsh Profile evaluates an independently retained Gate decision', async () => {
  const result = await run(['gate', 'evaluate', 'run-1', '--policy', 'release'])
  expect(JSON.parse(result.stdout)).toMatchObject({ kind: 'success', result: {
    id: 'gate-1', runId: 'run-1', policyId: 'release', decision: { kind: 'pass' },
  } })
}, LOADER_SMOKE_TEST_TIMEOUT_MS)

test('real dsh Profile rejects an execution policy outside its trusted binding', async () => {
  const result = await run(['start', '--request', 'profile-request', '--plan', 'plan', '--version', '1', '--policy', 'unapproved'], 1)
  expect(result.stderr).toContain('eval-run:unauthorized')
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
