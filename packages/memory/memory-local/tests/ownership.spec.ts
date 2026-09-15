import { afterEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { acquireMemoryOwnership } from '../src/ownership.ts'

const roots: string[] = []
const execute = promisify(execFile)

async function root() {
  const value = await mkdtemp(join(tmpdir(), 'dsh-memory-owner-test-'))
  roots.push(value)
  return value
}

afterEach(async () => {
  for (const value of roots.splice(0)) {
    if (!resolve(value).startsWith(resolve(tmpdir()) + sep) || !value.includes('dsh-memory-owner-test-')) throw new Error('refusing unrelated cleanup')
    await rm(value, { recursive: true, force: true })
  }
})

describe('single Host project-memory ownership', () => {
  it.each(['relative/root', '\\\\server\\share', '//server/share'])('rejects a non-local ownership root: %s', async (path) => {
    await expect(acquireMemoryOwnership(path)).rejects.toMatchObject({ code: 'ownership-unavailable' })
  })

  it.each(['directory', 'oversized'])('preserves an owner lock replaced with an invalid %s', async (kind) => {
    const path = await root()
    const held = await acquireMemoryOwnership(path)
    const file = join(path, 'owner.lock')
    if (kind === 'directory') { await unlink(file); await mkdir(file) }
    else await writeFile(file, 'x'.repeat(16 * 1024 + 1))
    await expect(held.release()).rejects.toMatchObject({ code: 'ownership-unavailable' })
    expect(await readdir(path)).toContain('owner.lock')
  })

  it('rejects a second owner and permits acquisition after an exact release', async () => {
    const path = await root()
    const first = await acquireMemoryOwnership(path)
    try {
      const before = await readFile(join(path, 'owner.lock'), 'utf8')
      expect(JSON.parse(before)).toMatchObject({ pid: process.pid, version: 1 })
      await expect(acquireMemoryOwnership(path)).rejects.toMatchObject({ code: 'ownership-unavailable' })
      expect(await readFile(join(path, 'owner.lock'), 'utf8')).toBe(before)
    } finally { await first.release() }
    const second = await acquireMemoryOwnership(path)
    await second.release()
    await second.release()
  })

  it('does not steal a stale or malformed lock', async () => {
    const path = await root()
    await writeFile(join(path, 'owner.lock'), 'unknown prior owner')
    await expect(acquireMemoryOwnership(path)).rejects.toMatchObject({ code: 'ownership-unavailable' })
    expect(await readFile(join(path, 'owner.lock'), 'utf8')).toBe('unknown prior owner')
  })

  it('refuses to unlink an owner token replaced by another actor', async () => {
    const path = await root()
    const held = await acquireMemoryOwnership(path)
    const file = join(path, 'owner.lock')
    const original = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    const nextOwner = { ...original, token: 'another-owner' }
    await writeFile(file, JSON.stringify(nextOwner))
    await expect(held.release()).rejects.toMatchObject({ code: 'ownership-unavailable' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(nextOwner)
  })

  it('rejects a competing OS process without replacing the first process identity', async () => {
    const path = await root()
    const held = await acquireMemoryOwnership(path)
    try {
      const result = await execute(process.execPath, [fileURLToPath(new URL('./fixtures/owner-probe.ts', import.meta.url)), path])
      expect(JSON.parse(result.stdout)).toEqual({ acquired: false, code: 'ownership-unavailable' })
      expect(JSON.parse(await readFile(join(path, 'owner.lock'), 'utf8'))).toMatchObject({ pid: process.pid })
    } finally { await held.release() }
  })
})
