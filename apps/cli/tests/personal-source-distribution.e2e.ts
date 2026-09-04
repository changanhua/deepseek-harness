/** Clean-home acceptance for the built personal source distribution. */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const builtBin = resolve(root, 'apps/cli/lib/bin.js')
const homes: string[] = []
const profileName = 'personal-source'

interface Fixture {
  readonly home: string
}

/** Create one isolated profile that composes the real personal bundle. */
async function createFixture(): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-personal-source-'))
  homes.push(home)
  const profileDir = join(home, 'profiles', profileName)
  const probe = join(profileDir, 'runtime-probe.mjs')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-personal-source',
    private: true,
    dependencies: {},
    dsh: {
      profile: {
        bundles: ['@deepseek-ai/dsh-base', '@changanhua/dsh-personal-delivery'],
        patchReload: 'startup',
      },
    },
  }, undefined, 2)}\n`)
  await writeFile(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  await writeFile(probe, [
    "export const name = 'personal-source-runtime-probe'",
    "export const inject = ['delivery', 'deliveryEvidence', 'repoWorkspace', 'deliveryRemote']",
    'export function apply(ctx) {',
    "  const ready = ctx.get('appReady')",
    "  const exit = ctx.get('appExit')",
    "  if (ready === undefined || exit === undefined) throw new Error('personal source probe lacks launcher services')",
    '  return ready.onReady(() => {',
    "    const services = ['delivery', 'deliveryEvidence', 'repoWorkspace', 'deliveryRemote']",
    '    if (services.some(service => ctx.get(service) === undefined)) {',
    "      throw new Error('personal source probe observed a missing personal service')",
    '    }',
    "    process.stdout.write('personal-source-runtime-ok\\n')",
    '    exit(0)',
    '  })',
    '}',
    '',
  ].join('\n'))
  await writeFile(join(profileDir, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: personal-source-runtime-probe',
    `      name: ${pathToFileURL(probe).href}`,
    '',
  ].join('\n'))
  return { home }
}

/** Run the built CLI with an isolated personal-source profile. */
async function run(fixture: Fixture, args: readonly string[]): Promise<{
  readonly code: number
  readonly stderr: string
  readonly stdout: string
}> {
  expect(existsSync(builtBin), `missing built CLI ${builtBin}; run pnpm run build`).toBe(true)
  const result = await execa(process.execPath, [builtBin, '--profile', profileName, ...args], {
    cwd: root,
    env: {
      DSH_AGENTS_HOME: join(fixture.home, '.agents'),
      DSH_HOME: fixture.home,
      DSH_TELEMETRY_DISABLED: '1',
      // Vitest gives workers a pnpm-wide NODE_PATH. A real built CLI has no
      // test-runner resolution fallback, so the acceptance subprocess must not
      // inherit one and accidentally find an undeclared workspace package.
      NODE_PATH: '',
    },
    input: '',
    killSignal: 'SIGKILL',
    reject: false,
    timeout: 30_000,
  })
  return { code: result.exitCode ?? -1, stderr: result.stderr, stdout: result.stdout }
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

describe('personal source distribution', () => {
  it('composes the personal bundle through the built CLI profile entry', async () => {
    const result = await run(await createFixture(), ['--dump-config'])

    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain("name: '@changanhua/dsh-delivery-local'")
    expect(result.stdout).toContain("name: '@changanhua/dsh-delivery-remote'")
    expect(result.stdout).toContain("name: '@changanhua/dsh-client-ui-delivery'")
  })

  it('boots the personal services through Loader and exits through the launcher', async () => {
    const result = await run(await createFixture(), [])

    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('personal-source-runtime-ok')
  })
})
