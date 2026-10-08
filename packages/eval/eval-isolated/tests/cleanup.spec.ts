import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { ownDirectoryCleanup } from '../src/cleanup.ts'

test('removes only the captured world, preserving junction targets and refusing a replaced root', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'eval-cleanup-'))
  try {
    const root = join(parent, 'world'), outside = join(parent, 'outside')
    await mkdir(root); await mkdir(outside)
    await writeFile(join(outside, 'keep'), 'private')
    const cleanup = await ownDirectoryCleanup(root)
    await symlink(outside, join(root, 'link'), 'junction')
    await cleanup(); await cleanup()
    expect(await readFile(join(outside, 'keep'), 'utf8')).toBe('private')
    await mkdir(root)
    const second = await ownDirectoryCleanup(root)
    await rename(root, join(parent, 'original'))
    await mkdir(root)
    await writeFile(join(root, 'keep'), 'replacement')
    await expect(second()).rejects.toThrow('eval-cleanup-root-changed')
    expect(await readFile(join(root, 'keep'), 'utf8')).toBe('replacement')
  } finally { await rm(parent, { recursive: true, force: true }) }
})
