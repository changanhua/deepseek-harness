/**
 * Executable-resolution boundary: the resolver reads only the scrubbed PATH
 * it is handed, never the interactive shell's profile-injected state.
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '../src/index.ts'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * These suites pin the resolution boundary that runtime_inspect's command
 * inspection depends on: `resolveExecutable` is authoritative for the DSH
 * execution world and must NOT see what an interactive user shell injects
 * through a profile (aliases, functions, or a profile-edited PATH). The DSH
 * PowerShell executor runs `pwsh -NoProfile`, and the resolver reads the
 * scrubbed parent env handed to `childEnv` — so a fake executable that exists
 * only on a profile-modified PATH is invisible to it.
 */

let dir: string | undefined

afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

async function boot(): Promise<{ ctx: Context }> {
  const ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  return { ctx }
}

describe('resolveExecutable profile boundary', () => {
  it('does not see a fake executable that exists only on a profile-extra PATH entry', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-resolve-boundary-'))
    const extraBin = join(dir, 'profile-extra-bin')
    await mkdir(extraBin, { recursive: true })
    // A bare name a profile might prepend to $env:PATH; present on disk but NOT
    // in the scrubbed parent PATH the resolver reads.
    const ext = process.platform === 'win32' ? '.cmd' : ''
    const fake = join(extraBin, `profile-only-tool${ext}`)
    await writeFile(fake, '@echo profile-only\n', { mode: 0o755 })

    const { ctx } = await boot()
    // The scrubbed parent env is authoritative; a name only on a hypothetical
    // profile PATH is not resolvable without that entry being supplied.
    await expect(ctx.subprocess.resolveExecutable('profile-only-tool')).rejects
      .toThrow('was not found on PATH')
    // When the same entry IS supplied explicitly, it resolves — proving the
    // resolver is PATH-driven, not profile-driven. Windows PATHEXT may render
    // the extension in a different case, so compare case-insensitively there.
    const resolved = await ctx.subprocess.resolveExecutable('profile-only-tool', { PATH: extraBin })
    const expected = resolve(extraBin, `profile-only-tool${ext}`)
    if (process.platform === 'win32') {
      expect(resolved.toLowerCase()).toBe(expected.toLowerCase())
    } else {
      expect(resolved).toBe(expected)
    }
    await ctx.fiber.dispose()
  })

  it('resolves only the first PATH candidate and does not cache an inventory', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-resolve-path-change-'))
    const binA = join(dir, 'bin-a')
    const binB = join(dir, 'bin-b')
    await mkdir(binA, { recursive: true })
    await mkdir(binB, { recursive: true })
    // On Windows the resolver appends PATHEXT (default .COM;.EXE;.BAT;.CMD) for
    // a bare name; on POSIX it matches the file directly. Use the platform's
    // extension so both worlds exercise the first-candidate rule.
    const ext = process.platform === 'win32' ? '.cmd' : ''
    const toolA = join(binA, `path-tool${ext}`)
    const toolB = join(binB, `path-tool${ext}`)
    await writeFile(toolA, '@echo A\n', { mode: 0o755 })
    await writeFile(toolB, '@echo B\n', { mode: 0o755 })
    const sep = process.platform === 'win32' ? ';' : ':'

    const { ctx } = await boot()
    // A before B → resolves A.
    const first = await ctx.subprocess.resolveExecutable('path-tool', { PATH: `${binA}${sep}${binB}` })
    const expectedA = resolve(binA, `path-tool${ext}`)
    if (process.platform === 'win32') {
      expect(first.toLowerCase()).toBe(expectedA.toLowerCase())
    } else {
      expect(first).toBe(expectedA)
    }
    // B before A → resolves B. Resolution is a dynamic per-call observation,
    // not a cached inventory: the PATH supplied at call time is the authority.
    const second = await ctx.subprocess.resolveExecutable('path-tool', { PATH: `${binB}${sep}${binA}` })
    const expectedB = resolve(binB, `path-tool${ext}`)
    if (process.platform === 'win32') {
      expect(second.toLowerCase()).toBe(expectedB.toLowerCase())
    } else {
      expect(second).toBe(expectedB)
    }
    await ctx.fiber.dispose()
  })
})
