import { cp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Stage the unpacked extension with only the current fixture origin pre-granted. */
export async function stageBrowserExtension(directory: string, origin: string): Promise<string> {
  const source = resolve('apps/chrome-extension')
  const target = join(directory, 'extension')
  await cp(source, target, { recursive: true })
  const manifestPath = join(target, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    optional_host_permissions?: string[]
    host_permissions?: string[]
  }
  manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), `${origin}/*`])]
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  return target
}
