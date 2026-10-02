import { resolveExampleMode } from '@deepseek-ai/dsh-loader-smoke'
import { copyFile, readFile, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { runLoaderSmoke, LOADER_SMOKE_TEST_TIMEOUT_MS } from '@deepseek-ai/dsh-loader-smoke'
import { evalContractDigest, parseEvalPlan, parseEvalSuite } from '@changanhua/dsh-eval'

test.each(['keyless', 'live'] as const)('real Profile and Commands preflight %s Plans without execution', async (mode) => {
  const example = fileURLToPath(new URL('../examples/', import.meta.url))
  const repo = fileURLToPath(new URL('../../../../', import.meta.url))
  const configPath = fileURLToPath(new URL(`./fixtures/profile/plans${resolveExampleMode() === 'lib' ? '.lib' : ''}.patch.yml`, import.meta.url))
  const binScript = fileURLToPath(new URL('./fixtures/profile/driver.ts', import.meta.url))
  const original = parseEvalPlan(JSON.parse(await readFile(join(example, 'minimal-v1.plan.json'), 'utf8')))
  const grant = { id: 'fixture-grant', version: '1', digest: 'c'.repeat(64) }
  const plan = mode === 'keyless' ? original : parseEvalPlan({ ...original,
    credentialAuthorizationRef: grant, routes: original.routes.map(route => ({ ...route, parameters: { maxTokens: 32 } })) })
  const approval = JSON.stringify({ id: plan.id, version: plan.version, digest: evalContractDigest(plan) })
  const suite = parseEvalSuite(JSON.parse(await readFile(join(example, 'minimal-v1.suite.json'), 'utf8')))
  let evidence: Record<string, unknown> = {}
  await runLoaderSmoke({ label: 'eval-plan-profile', tempDirPrefix: 'eval-plan-profile-', binScript, libBinScript: fileURLToPath(new URL('./fixtures/profile/driver.lib.ts', import.meta.url)), configPath,
    ...(process.platform === 'win32' ? { tempDirParent: homedir() } : {}), tsconfigPath: join(repo, 'tsconfig.json'),
    env: { DSH_PLAN_FIXTURE_APPROVAL: approval, DSH_PLAN_FIXTURE_MODE: mode,
      DSH_PLAN_FIXTURE_GRANT: JSON.stringify(mode === 'keyless' ? null : { reference: grant, credentialRefs: ['DSH_EVAL_TEST_CREDENTIAL'] }),
      DSH_EVAL_TEST_CREDENTIAL: 'test-only-no-provider-call' },
    prepare: async (cwd) => {
      await writeFile(join(cwd, 'plan.json'), JSON.stringify(plan))
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
  expect(evidence.first, JSON.stringify(evidence.preflight)).toMatchObject({ kind: mode === 'keyless' ? 'success' : 'error' })
  expect(evidence.first).toEqual(evidence.replay)
  const preflight = evidence.preflight as { kind: string; text: string }
  expect(preflight.kind).toBe('success')
  const result = JSON.parse(preflight.text) as { checks: unknown[] }
  expect(result).toMatchObject({ ready: mode === 'keyless', summary: { cellCount: 20 } })
  expect(result.checks).toContainEqual({ subject: plan.id, code: 'credential-authority', ok: true })
  if (mode === 'live') expect(result.checks).toContainEqual({ subject: plan.id, code: 'budget-authority', ok: false })
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
