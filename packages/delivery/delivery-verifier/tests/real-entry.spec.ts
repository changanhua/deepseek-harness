import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const repositoryRoot = resolve(packageRoot, '../../..')
const fixture = fileURLToPath(new URL('./fixtures/built-real-entry.mjs', import.meta.url))
const requiredArtifacts = [
  join(packageRoot, 'lib/index.js'),
  join(repositoryRoot, 'packages/delivery/delivery-protocol/lib/index.js'),
  join(repositoryRoot, 'packages/delivery/delivery-testkit/lib/index.js'),
  join(repositoryRoot, 'packages/subprocess/subprocess-local/lib/index.js'),
  join(repositoryRoot, 'vendor/cordis/lib/index.js'),
]
const built = requiredArtifacts.every(existsSync)

/**
 * Vitest resolves workspace imports to source. This smoke therefore launches plain Node after
 * a host build so the verifier and local Subprocess Service Provider both load from `lib/`.
 */
describe.skipIf(!built)('delivery verifier built public entry', () => {
  it('uses the production local subprocess provider for success, bounds, timeout, and tree cancellation', async () => {
    const { stdout, stderr } = await execFileAsync(process.execPath, [fixture, repositoryRoot], {
      cwd: dirname(fixture),
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })

    expect(stderr).toBe('')
    const result = JSON.parse(stdout.trim()) as {
      entry: string
      provider: string
      success: string
      boundedBytes: number
      timeout: string
      cancellation: string
      helperTreeGone: boolean
    }
    expect(result).toEqual({
      entry: 'lib/index.js',
      provider: 'LocalSubprocessRuntime',
      success: 'passed',
      boundedBytes: 256,
      timeout: 'timed-out',
      cancellation: 'canceled',
      helperTreeGone: true,
    })
  }, 35_000)
})
