import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

/** Connect an owned test client to the built MCP without starting a relay. */
export async function connectBrowserTestClient(configPath: string): Promise<Client> {
  const client = new Client({ name: 'browser-coexistence-test', version: '1' })
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  env.BROWSER_CONNECTOR_CONFIG = configPath
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('../lib/startup.js', import.meta.url))], env, stderr: 'pipe' }))
    return client
  } catch (error) {
    await client.close()
    throw error
  }
}
