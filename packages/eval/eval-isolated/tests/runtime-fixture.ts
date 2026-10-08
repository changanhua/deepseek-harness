/** Materialize the existing built CLI and its minimal Profile boot graph inside a test-owned directory. */
import { cp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const repository = resolve(import.meta.dirname, '../../../..')

export async function stageProfileFixture(runtime: string, home: string, probe: string, extraPackages: readonly string[] = [],
  fixtureAnchor = join(repository, 'packages/eval/eval-isolated/package.json')) {
  await mkdir(runtime, { recursive: true })
  await cp(process.execPath, join(runtime, 'node.exe'))
  const staged = new Map<string, string>()
  async function stagePackage(name: string, anchor: string): Promise<void> {
    const roots = createRequire(anchor).resolve.paths(name) ?? []
    const found = roots.map(root => join(root, name)).find(root => existsSync(join(root, 'package.json')))
    if (!found) throw new Error(`missing installed fixture dependency ${name}`)
    const source = await realpath(found)
    if (staged.has(name)) {
      if (staged.get(name) !== source) throw new Error(`fixture has conflicting versions of ${name}`)
      return
    }
    staged.set(name, source)
    await cp(source, join(runtime, 'node_modules', name), { recursive: true,
      filter: file => !file.slice(source.length + 1).split(/[\\/]/u).some(part => ['node_modules', '.git', 'tests'].includes(part)) })
    const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
      peerDependenciesMeta?: Record<string, { optional?: boolean }>
    }
    for (const dependency of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      if (!manifest.peerDependenciesMeta?.[dependency]?.optional) await stagePackage(dependency, join(source, 'package.json'))
    }
  }
  const anchor = join(repository, 'apps/cli/package.json')
  for (const name of ['@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh-cmdline', 'commander']) await stagePackage(name, anchor)
  for (const name of extraPackages) await stagePackage(name, fixtureAnchor)
  await stagePackage('koffi', join(repository, 'packages/subprocess/win32-process/package.json'))
  await stagePackage('@koromix/koffi-win32-x64', join(staged.get('koffi')!, 'package.json'))
  const cli = join(runtime, 'node_modules/@deepseek-ai/dsh')
  await mkdir(cli, { recursive: true })
  await cp(join(repository, 'apps/cli/lib'), join(cli, 'lib'), { recursive: true })
  await cp(anchor, join(cli, 'package.json'))
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ type: 'module' }))
  const sourceCommit = (await promisify(execFile)('git', ['-C', repository, 'rev-parse', 'HEAD'], { windowsHide: true })).stdout.trim()
  await writeFile(join(runtime, 'eval-core.json'), JSON.stringify({ sourceCommit }))
  for (const file of ['startup.js', 'worker.js']) {
    await cp(join(repository, 'packages/eval/eval-isolated/lib', file), join(runtime, file))
  }
  const profile = join(home, 'profiles/eval-fixture')
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'eval-isolated-fixture', private: true,
    dsh: { profile: { bundles: [], patchReload: 'startup' } } }))
  const plugin = join(runtime, 'probe.mjs')
  await writeFile(plugin, probe)
  await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'eval-fixture', name: pathToFileURL(plugin).href }] }]))
  // Only link staged packages. A Host NODE_PATH must not leak repository fallbacks into the role.
  for (const name of [...staged.keys(), '@deepseek-ai/dsh']) {
    const link = join(home, 'profiles/node_modules', name)
    await mkdir(dirname(link), { recursive: true })
    await symlink(join(runtime, 'node_modules', name), link, 'junction')
  }
  await mkdir(join(profile, 'node_modules'), { recursive: true })
  await mkdir(join(profile, '.dsh-module-fallback/node_modules'), { recursive: true })
  return { executable: join(runtime, 'node.exe'), entrypoint: join(cli, 'lib/bin.js'), startup: join(runtime, 'startup.js'), sourceCommit }
}
