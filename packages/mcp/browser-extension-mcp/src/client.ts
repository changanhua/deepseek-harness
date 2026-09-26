import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configSchema } from './schema.ts'
import type { ConnectorConfig, RpcInput } from './types.ts'

export function defaultConfigPath(): string {
  return process.env.BROWSER_CONNECTOR_CONFIG ?? join(homedir(), '.browser-connector', 'config.json')
}
export async function readConfig(path: string): Promise<ConnectorConfig> {
  return configSchema.parse(JSON.parse(await readFile(path, 'utf8')) as unknown)
}

/** One independently owned relay serves every MCP client; closing a client never stops it. */
export function createRelayClient(configPath: string, autostart = true) {
  let startup: Promise<ConnectorConfig> | undefined
  const probe = async (config: ConnectorConfig) => {
    const response = await fetch(`http://127.0.0.1:${config.port}/health`, {
      headers: { authorization: `Bearer ${config.secret}` }, signal: AbortSignal.timeout(750), redirect: 'error',
    })
    if (!response.ok) throw new Error('connector_port_conflict')
    const value = await response.json() as { service?: unknown; protocolVersion?: unknown }
    if (value.service !== 'browser-extension-connector' || value.protocolVersion !== 1) throw new Error('connector_port_conflict')
  }
  const ensure = async () => {
    const config = await readConfig(configPath)
    try { await probe(config); return config } catch (error) {
      if (error instanceof Error && error.message === 'connector_port_conflict') throw error
      if (!autostart) throw error
    }
    if (startup) return startup
    const work = (async () => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('./startup.js', import.meta.url)), '--connector', configPath], {
        detached: true, windowsHide: true, stdio: 'ignore', env: process.env,
      })
      let spawnError: Error | undefined
      child.on('error', (error) => { spawnError = error })
      child.unref()
      for (let attempt = 0; attempt < 20; attempt++) {
        if (spawnError) throw spawnError
        await new Promise(resolve => setTimeout(resolve, 100))
        try { await probe(config); return config } catch (error) {
          if (error instanceof Error && error.message === 'connector_port_conflict') throw error
        }
      }
      throw new Error('connector_unavailable')
    })()
    startup = work
    try { return await work } finally { if (startup === work) startup = undefined }
  }
  return {
    ensure,
    async call(input: RpcInput, signal?: AbortSignal): Promise<unknown> {
      const config = await ensure()
      const response = await fetch(`http://127.0.0.1:${config.port}/rpc`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.secret}` },
        body: JSON.stringify(input), redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000),
      })
      const value = await response.json() as { error?: { code?: string } }
      if (!response.ok) throw new Error(value.error?.code ?? `connector_http_${response.status}`)
      return value
    },
  }
}
