import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect } from 'vitest'
import { launchAcpTestAgent } from '@deepseek-ai/dsh-session-snapshot'

export const repo = fileURLToPath(new URL('../../../../', import.meta.url))
const bundle = resolve(import.meta.dirname, '..')

/** Isolated supported CLI Profile whose package closure points at built artifacts. */
export async function createMemoryLoaderWorld(enabled = true) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-loader-'))
  const profile = join(root, '.dsh/profiles/acp')
  const bundleLink = join(profile, 'node_modules/@changanhua/dsh-personal-memory')
  const close = async () => {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !root.includes('dsh-memory-loader-')) throw new Error('refusing unrelated cleanup')
    const removeLinks = async (directory: string): Promise<void> => {
      for (const name of await readdir(directory)) {
        const path = join(directory, name)
        const info = await lstat(path)
        if (info.isSymbolicLink()) await unlink(path)
        else if (info.isDirectory()) await removeLinks(path)
      }
    }
    await removeLinks(root)
    await rm(root, { recursive: true, force: true })
  }
  try {
    await mkdir(profile, { recursive: true })
    await writeFile(join(root, 'README.md'), 'Run pnpm test')
    await writeFile(join(profile, 'package.json'), JSON.stringify({
      name: 'memory-loader-test', private: true, type: 'module',
      dsh: { profile: { patchReload: 'startup', bundles: [
        '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app', ...enabled ? ['@changanhua/dsh-personal-memory'] : [],
      ] } },
    }))
    if (enabled) {
      await mkdir(dirname(bundleLink), { recursive: true })
      await symlink(bundle, bundleLink, process.platform === 'win32' ? 'junction' : 'dir')
    }
  } catch (error) {
    await close()
    throw error
  }
  const start = async () => {
    await rm(join(root, 'memory-loader-ready'), { force: true })
    await rm(join(root, 'memory-loader-proof.jsonl'), { force: true })
    return launchAcpTestAgent({
      agent: {
        binScript: join(repo, 'apps/cli/src/bin.ts'), libBinScript: join(repo, 'apps/cli/lib/bin.js'),
        profile: 'acp', configPath: join(bundle, 'tests/fixtures/web.cordis.patch.yml'), tsconfigPath: join(repo, 'tsconfig.base.json'),
      },
      cwd: root,
      env: {
        DSH_EXAMPLE_MODE: 'lib', DSH_HOME: join(root, '.dsh'), DSH_AGENTS_HOME: join(root, '.agents'),
        DSH_PERMISSION_MODE: 'danger-full-access', DSH_TELEMETRY_DISABLED: '1',
      },
    })
  }
  return { root, start, close }
}

/** The ACP handshake precedes complete plugin activation; wait for the actual probe listener. */
export async function inspectMemoryLoader(root: string, running: ReturnType<typeof launchAcpTestAgent>): Promise<Record<string, unknown>> {
  await running.spawned
  await running.client.initialize({ protocolVersion: 1, clientCapabilities: {} })
  await expect.poll(async () => {
    try { return await readFile(join(root, 'memory-loader-ready'), 'utf8') }
    catch { return '' }
  }, { timeout: 20_000, interval: 100 }).toBe('ready\n')
  await running.client.newSession({ cwd: root, mcpServers: [] })
  let report: Record<string, unknown> | undefined
  await expect.poll(async () => {
    try {
      const lines = (await readFile(join(root, 'memory-loader-proof.jsonl'), 'utf8')).trim().split('\n')
      report = JSON.parse(lines[0] ?? '') as Record<string, unknown>
      return report
    } catch { return undefined }
  }, { timeout: 20_000, interval: 100 }).not.toBeUndefined()
  expect(report, running.stderr()).not.toHaveProperty('error')
  if (report === undefined) throw new Error('memory probe did not produce a report')
  return report
}
