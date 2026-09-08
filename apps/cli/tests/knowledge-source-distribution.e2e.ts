/** Clean-home acceptance for the built knowledge source distribution. */

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
const profileName = 'knowledge-source'

async function fixture(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-knowledge-source-'))
  homes.push(home)
  const profile = join(home, 'profiles', profileName)
  const probe = join(profile, 'runtime-probe.mjs')
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-knowledge-source', private: true, dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@changanhua/dsh-tool-knowledge-base'], patchReload: 'startup' } },
  }, undefined, 2)}\n`)
  await writeFile(join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n')
  await writeFile(probe, [
    "export const name = 'knowledge-source-runtime-probe'",
    "export const inject = ['knowledgeBase', 'knowledgeQueue', 'commands']",
    'export function apply(ctx) {',
    "  const ready = ctx.get('appReady')",
    "  const exit = ctx.get('appExit')",
    "  if (ready === undefined || exit === undefined) throw new Error('knowledge source probe lacks launcher services')",
    '  return ready.onReady(() => {',
    "    if (ctx.commands.find({ id: 'knowledge-source-probe' }, 'knowledge') === undefined) {",
    "      throw new Error('knowledge source probe observed a missing /knowledge command')",
    '    }',
    "    process.stdout.write('knowledge-source-runtime-ok\\n')",
    '    exit(0)',
    '  })',
    '}',
    '',
  ].join('\n'))
  await writeFile(join(profile, 'cordis.patch.yml'), [
    '- insert:',
    '    - id: knowledge-source-runtime-probe',
    `      name: ${pathToFileURL(probe).href}`,
    '',
  ].join('\n'))
  return home
}

async function run(home: string, args: readonly string[]) {
  expect(existsSync(builtBin), `missing built CLI ${builtBin}; run pnpm run build`).toBe(true)
  const result = await execa(process.execPath, [builtBin, '--profile', profileName, ...args], {
    cwd: root,
    env: { DSH_AGENTS_HOME: join(home, '.agents'), DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', NODE_PATH: '' },
    input: '', killSignal: 'SIGKILL', reject: false, timeout: 30_000,
  })
  return { code: result.exitCode ?? -1, stderr: result.stderr, stdout: result.stdout }
}

afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })

describe('knowledge source distribution', () => {
  it('composes the built knowledge bundle and its three services from a clean home', async () => {
    const result = await run(await fixture(), ['--dump-config'])
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain("name: '@changanhua/dsh-knowledge-base'")
    expect(result.stdout).toContain("name: '@changanhua/dsh-knowledge-base-task-queue'")
    expect(result.stdout).toContain("name: '@changanhua/dsh-tool-knowledge-base'")
  })

  it('boots the knowledge services and exposes the human /knowledge entry', async () => {
    const result = await run(await fixture(), [])
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).toContain('knowledge-source-runtime-ok')
  })
})
