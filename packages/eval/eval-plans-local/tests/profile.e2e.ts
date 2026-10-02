import { resolveExampleMode } from '@deepseek-ai/dsh-loader-smoke'
import { copyFile, readFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { runLoaderSmoke, LOADER_SMOKE_TEST_TIMEOUT_MS } from '@deepseek-ai/dsh-loader-smoke'
import { parseEvalSuite } from '@changanhua/dsh-eval'

test('real Profile and Commands discover the shipped Plan across web, CLI and CI without execution', async () => {
  const example = fileURLToPath(new URL('../examples/', import.meta.url))
  const repo = fileURLToPath(new URL('../../../../', import.meta.url))
  const configPath = fileURLToPath(new URL(`./fixtures/profile/plans${resolveExampleMode() === 'lib' ? '.lib' : ''}.patch.yml`, import.meta.url))
  const binScript = fileURLToPath(new URL('./fixtures/profile/driver.ts', import.meta.url))
  const approval = await readFile(join(example, 'minimal-v1.approval.json'), 'utf8')
  const suite = parseEvalSuite(JSON.parse(await readFile(join(example, 'minimal-v1.suite.json'), 'utf8')))
  let evidence: Record<string, unknown> = {}
  await runLoaderSmoke({ label: 'eval-plan-profile', tempDirPrefix: 'eval-plan-profile-', binScript, libBinScript: fileURLToPath(new URL('./fixtures/profile/driver.lib.ts', import.meta.url)), configPath,
    ...(process.platform === 'win32' ? { tempDirParent: homedir() } : {}), tsconfigPath: join(repo, 'tsconfig.json'),
    env: { DSH_PLAN_FIXTURE_APPROVAL: approval },
    prepare: async (cwd) => {
      await copyFile(join(example, 'minimal-v1.plan.json'), join(cwd, 'plan.json'))
      await copyFile(join(example, 'minimal-v1.suite.json'), join(cwd, 'suite.json'))
      for (const fixture of suite.cases.flatMap(item => item.replayFixtures)) {
        const target = join(cwd, fixture.sessionFile)
        await mkdir(dirname(target), { recursive: true })
        await copyFile(join(repo, fixture.sessionFile), target)
      }
    },
    inspect: async (cwd) => { evidence = JSON.parse(await readFile(join(cwd, 'plan-evidence.json'), 'utf8')) as Record<string, unknown> },
  })
  expect(evidence.calls).toBe(0)
  expect(evidence.cli).toEqual(evidence.web)
  expect(evidence.cli).toEqual(evidence.ci)
  expect(evidence.first, JSON.stringify(evidence.preflight)).toMatchObject({ kind: 'success' })
  expect(evidence.first).toEqual(evidence.replay)
  const preflight = evidence.preflight as { kind: string; text: string }
  expect(preflight.kind).toBe('success')
  expect(JSON.parse(preflight.text)).toMatchObject({ ready: true, summary: { cellCount: 20 } })
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
