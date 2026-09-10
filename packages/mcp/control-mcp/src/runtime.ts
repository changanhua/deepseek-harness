/** Non-secret process identity and package code fingerprint captured when the Host adapter loads. */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

const execute = promisify(execFile)

/** Code fingerprint identifies this package, while checkout metadata describes source at adapter load. */
export async function captureRuntimeIdentity(): Promise<Readonly<Record<string, unknown>>> {
  const directory = dirname(fileURLToPath(import.meta.url))
  const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js'
  const names = (await readdir(directory)).filter(name => name.endsWith(extension)).sort()
  const hash = createHash('sha256')
  for (const name of names) hash.update(name).update('\0').update(await readFile(join(directory, name)))
  const profileIndex = process.argv.indexOf('--profile')
  const profile = profileIndex >= 0 ? process.argv[profileIndex + 1]
    : process.argv.find(arg => arg.startsWith('--profile='))?.slice(10) ?? (process.argv.includes('web') ? 'web' : undefined)
  let checkout: unknown = null
  try {
    const git = async (args: string[]) => (await execute('git', ['-C', directory, ...args], {
      windowsHide: true, timeout: 2000, maxBuffer: 1024 * 1024,
    })).stdout.trim()
    const [root, commit, status] = await Promise.all([
      git(['rev-parse', '--show-toplevel']), git(['rev-parse', 'HEAD']), git(['status', '--porcelain', '--untracked-files=normal']),
    ])
    checkout = { root, commit, dirtyAtLoad: status.length > 0 }
  } catch { /* Installed packages may have no source checkout or git executable. */ }
  return {
    pid: process.pid, profile: profile ?? null, cwd: process.cwd(), dshHome: resolveDshHome(),
    code: { directory, sha256: hash.digest('hex'), face: extension === '.ts' ? 'source' : 'built' },
    checkout,
  }
}
