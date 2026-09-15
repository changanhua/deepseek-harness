/** Source-path acceptance: the same tsx CLI selected by Codex owns a real child Host. */
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { describe, expect, it } from 'vitest'

describe('source control-mcp profile', () => {
  it.each(['close-tool', 'disconnect'] as const)('loads this worktree and cleans the managed Host after %s', { timeout: 60_000 }, async (ending) => {
    const repository = resolve(import.meta.dirname, '../../../..')
    const connectorHome = await mkdtemp(join(tmpdir(), 'dsh-control-source-'))
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', import.meta.resolve('tsx/esm'), join(repository, 'apps/cli/src/bin.ts'), '--profile', 'control-mcp'],
      cwd: repository, stderr: 'pipe',
      env: { ...getDefaultEnvironment(), DSH_HOME: connectorHome,
        DSH_CONTROL_CLI_ENTRY: join(repository, 'apps/cli/src/bin.ts'), DSH_TELEMETRY_DISABLED: '1' },
    })
    // Keep protocol diagnostics out of test assertions that could print environment secrets.
    transport.stderr?.on('data', () => {})
    const client = new Client({ name: 'source-control-check', version: '1' })
    let pid: number | undefined
    try {
      await client.connect(transport, { timeout: 45_000 })
      expect((await client.listTools()).tools.map(tool => tool.name)).toContain('dsh_session_wait')
      const result = await client.callTool({ name: 'dsh_runtime_status', arguments: {} })
      expect(result.isError).toBe(false)
      const runtime = (result.structuredContent as { result: { identity: {
        pid: number
        profile: string
        dshHome: string
        code: { face: string }
        checkout: { root: string }
      } } }).result.identity
      pid = runtime.pid
      expect(runtime.profile).toBe('web')
      expect(resolve(runtime.checkout.root)).toBe(repository)
      expect(runtime.code.face).toBe('source')
      expect(runtime.dshHome).not.toBe(connectorHome)
      expect(existsSync(runtime.dshHome)).toBe(true)
      if (ending === 'close-tool') {
        expect((await client.callTool({ name: 'dsh_control_close', arguments: {} })).isError).toBe(false)
      }
      await client.close()
      await expect.poll(() => {
        try { process.kill(runtime.pid, 0); return false } catch { return true }
      }, { timeout: 10_000 }).toBe(true)
      expect(existsSync(runtime.dshHome)).toBe(false)
    } finally {
      await client.close()
      await transport.close()
      // A failed assertion must not leave the exact child observed by this test running.
      if (pid !== undefined) {
        try { process.kill(pid, 'SIGTERM') } catch { /* The managed Host already exited. */ }
      }
      await rm(connectorHome, { recursive: true, force: true })
    }
  })
})
