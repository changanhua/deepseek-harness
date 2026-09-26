import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createBrowserMcp } from './index.ts'
import { createRelayClient, defaultConfigPath, readConfig } from './client.ts'

if (process.argv[2] === '--connector') {
  const configPath = process.argv[3] ?? defaultConfigPath()
  const { startBrowserRelay } = await import('./relay.ts')
  try {
    const relay = await startBrowserRelay(await readConfig(configPath))
    const close = () => { void relay.close().finally(() => { process.exit(0) }) }
    process.once('SIGINT', close)
    process.once('SIGTERM', close)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EADDRINUSE')) process.stderr.write('Browser connector could not start. Check local configuration.\n')
    process.exitCode = 1
  }
} else {
  const server = createBrowserMcp()
  await server.connect(new StdioServerTransport())
  void createRelayClient(defaultConfigPath()).ensure().catch(() => {})
}
