import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const root = resolve(packageDir, '../../..')
const requiredArtifacts = [
  'packages/subagent/subagent-codex/lib/app-server-run.js',
  'packages/subagent/subagent-codex/lib/types/app-server-run.d.ts',
  'packages/core/session/lib/index.js',
  'packages/core/scope/lib/index.js',
  'packages/llm/llm/lib/index.js',
  'packages/subagent/subagent/lib/index.js',
  'packages/sdk/protocol/lib/index.js',
  'vendor/cordis/lib/index.js',
  'vendor/schemastery/lib/index.mjs',
].every(path => existsSync(resolve(root, path)))

describe.skipIf(!requiredArtifacts)(
  'Codex app-server supported built boundary',
  () => {
    it('imports by package-name subpath while the package root stays narrow', async () => {
      const script = `
        const boundary = await import('@deepseek-ai/dsh-subagent-codex/app-server-run')
        const root = await import('@deepseek-ai/dsh-subagent-codex')
        const expected = ['CODEX_APP_SERVER_PERMISSION_MODES', 'startCodexAppServerRun']
        const actual = Object.keys(boundary).sort()
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error('unexpected app-server-run exports: ' + JSON.stringify(actual))
        }
        if ('startCodexAppServerRun' in root) {
          throw new Error('parent-free start leaked through the package root')
        }
        for (const forbidden of [
          'codexAppServerArgv',
          'disposeCodexChild',
          'startCodexRun',
          'textTask',
        ]) {
          if (forbidden in boundary) {
            throw new Error('internal helper leaked through app-server-run: ' + forbidden)
          }
        }
      `
      const result = await runPlainNode(script)
      expect(result.exitCode, `stderr:\n${result.stderr}`).toBe(0)
    })
  },
)

function runPlainNode(script: string): Promise<{
  readonly exitCode: number | null
  readonly stderr: string
}> {
  return new Promise((resolveRun) => {
    execFile(process.execPath, ['--input-type=module', '-e', script], {
      cwd: packageDir,
      encoding: 'utf8',
      timeout: 30_000,
    }, (error, _stdout, stderr) => {
      resolveRun({
        exitCode: error === null ? 0 : typeof error.code === 'number' ? error.code : null,
        stderr,
      })
    })
  })
}
