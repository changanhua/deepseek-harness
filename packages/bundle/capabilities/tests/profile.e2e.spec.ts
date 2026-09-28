/** Built-CLI regression for the bundle's lazy MCP surface. */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { describe, expect, it } from 'vitest'

const repo = fileURLToPath(new URL('../../../..', import.meta.url))
const bin = join(repo, 'apps/cli/lib/bin.js')
const timeoutMs = 45_000

interface RunningProfile {
  readonly child: ChildProcess
  readonly output: () => string
}

async function reservePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve, reject) => server.close((error) => { if (error === undefined) resolve(); else reject(error) }))
  return port
}

function start(home: string, workspace: string, port: number, token: string): RunningProfile {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: home,
    DSH_MCP_WORKSPACE: workspace,
    DSH_MCP_PORT: String(port),
    DSH_MCP_TOKEN: token,
    DSH_TELEMETRY_DISABLED: '1',
  }
  delete env.DEEPSEEK_API_KEY
  delete env.DEEPSEEK_BASE_URL
  const child = spawn(process.execPath, [bin, '--profile', 'capabilities'], {
    cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  let output = ''
  const append = (chunk: Buffer | string) => { output = `${output}${String(chunk)}`.slice(-12_000) }
  child.stdout?.on('data', append)
  child.stderr?.on('data', append)
  return { child, output: () => output }
}

async function stop(running: RunningProfile | undefined): Promise<void> {
  if (running === undefined || running.child.exitCode !== null) return
  const exited = new Promise<void>((resolve) => { running.child.once('exit', () =>{  resolve() }) })
  running.child.kill('SIGTERM')
  const force = setTimeout(() => { running.child.kill('SIGKILL') }, 8_000)
  force.unref()
  await exited
  clearTimeout(force)
}

async function connect(url: URL, token: string): Promise<Client> {
  let last: unknown
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const client = new Client({ name: 'capabilities-profile-e2e', version: '1' })
    const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${token}` } } })
    try {
      await client.connect(transport as Transport)
      return client
    } catch (error) {
      last = error
      await client.close().catch(() => undefined)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  throw new Error(`capabilities profile did not accept MCP: ${String(last)}`)
}

async function sessionEvents(home: string): Promise<Array<{ id: string; events: Array<{ type: string; data: Record<string, unknown> }> }>> {
  const root = join(home, 'sessions')
  const files = (await readdir(root, { recursive: true })).filter(file => typeof file === 'string' && file.endsWith('.jsonl'))
  const ids = await Promise.all(files.map(async (file) => {
    const [header] = (await readFile(join(root, file), 'utf8')).split('\n')
    const parsed = JSON.parse(header ?? '') as { id: string }
    return SessionId(parsed.id)
  }))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  try {
    return await Promise.all(ids.map(async (id) => {
      const handle = await ctx.sessionPersistence.open(id, 'read')
      try {
        const { events } = await handle.read()
        return { id, events: events.map(event => ({ type: event.type, data: event.data as Record<string, unknown> })) }
      } finally {
        await handle.close()
      }
    }))
  } finally {
    await ctx.fiber.dispose()
  }
}

describe.skipIf(!existsSync(bin))('built capabilities profile', () => {
  it('keeps declarations cold, then runs disabled choice and local glob in isolated audited sessions', { timeout: timeoutMs + 20_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-capabilities-profile-'))
    const home = join(root, 'home')
    const workspace = join(root, 'workspace')
    const port = await reservePort()
    const token = randomBytes(24).toString('hex')
    await writeFile(join(root, 'placeholder'), '')
    await mkdir(workspace)
    await writeFile(join(workspace, 'capability-proof.txt'), 'local search proof\n')
    let running: RunningProfile | undefined
    let client: Client | undefined
    try {
      running = start(home, workspace, port, token)
      client = await connect(new URL(`http://127.0.0.1:${String(port)}/mcp`), token)

      const listed = await client.listTools()
      expect(listed.tools.map(tool => tool.name).sort()).toEqual(['choose_candidate', 'dsh_capabilities', 'glob'])
      const cold = await client.callTool({ name: 'dsh_capabilities', arguments: {} })
      expect(cold.structuredContent).toMatchObject({ capabilities: [
        { name: 'choose_candidate', preset: 'choice', state: 'unloaded', loadAttempts: 0 },
        { name: 'glob', preset: 'search', state: 'unloaded', loadAttempts: 0 },
      ] })

      const choice = await client.callTool({ name: 'choose_candidate', arguments: {
        goal: 'Choose an enabled action.', facts: 'Both presented options are disabled.',
        candidates: [
          { id: 'first', description: 'Disabled first option.', disabled: true },
          { id: 'second', description: 'Disabled second option.', disabled: true },
        ],
      } })
      expect(choice.isError).not.toBe(true)
      expect(choice.structuredContent).toMatchObject({ value: { status: 'abstain', usage: null, provider: 'deepseek-official', model: 'deepseek-flash' } })

      const glob = await client.callTool({ name: 'glob', arguments: { pattern: '*.txt' } })
      expect(glob.isError).not.toBe(true)
      expect(glob.structuredContent).toMatchObject({ value: { root: '.', paths: [expect.stringMatching(/capability-proof\.txt$/u)] } })

      const after = await client.callTool({ name: 'dsh_capabilities', arguments: {} })
      expect(after.structuredContent).toMatchObject({ capabilities: [
        { name: 'choose_candidate', preset: 'choice', state: 'ready', loadAttempts: 1 },
        { name: 'glob', preset: 'search', state: 'ready', loadAttempts: 1 },
      ] })

      const sessions = await sessionEvents(home)
      const external = sessions.filter(session => session.events.some(event => event.type === 'mcp/invocation-start'))
      expect(external).toHaveLength(2)
      expect(new Set(external.map(session => session.id)).size).toBe(2)
      for (const session of external) {
        expect(session.events.map(event => event.type)).toContain('mcp/invocation-start')
        expect(session.events.map(event => event.type)).toContain('mcp/invocation-end')
        expect(session.events.some(event => ['turn/start', 'turn/end', 'step/start', 'step/end', 'assistant/message', 'choice/llm-request'].includes(event.type))).toBe(false)
      }
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nprofile output:\n${running?.output() ?? ''}`, { cause: error })
    } finally {
      await client?.close().catch(() => undefined)
      await stop(running)
      await rm(root, { recursive: true, force: true })
    }
  })
})
