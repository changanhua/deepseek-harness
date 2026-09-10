import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('DSH control MCP bundle', () => {
  it('starts only its stdio adapter and ships an explicit opt-in Host patch', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const bundle = yaml.load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'), {
      schema: entryListSchema,
    }) as Array<{ insert?: Array<{ id?: string; name?: string; inject?: string[] }> }>
    expect(bundle.flatMap(item => item.insert ?? [])).toEqual([
      { id: 'control-mcp-startup', name: '@changanhua/dsh-control-mcp/startup' },
      {
        id: 'control-mcp-server', name: '@changanhua/dsh-control-mcp',
        inject: ['controlMcpStartup', 'loader'],
        config: {
          autoStartHost: { __jsExpr: "process.env.DSH_CONTROL_AUTOSTART !== 'false'" },
          hostHome: { __jsExpr: 'process.env.DSH_CONTROL_HOST_HOME' },
          origin: { __jsExpr: 'process.env.DSH_CONTROL_ORIGIN' },
          runId: { __jsExpr: 'process.env.DSH_CONTROL_RUN_ID' },
          tokenEnv: 'DSH_CONTROL_TOKEN',
        },
      },
    ])
    const host = yaml.load(readFileSync(resolve(root, 'host.cordis.patch.yml'), 'utf8'), {
      schema: entryListSchema,
    }) as Array<{ insert?: Array<{ id?: string; name?: string; config?: unknown }> }>
    expect(host.flatMap(item => item.insert ?? [])).toEqual([{
      id: 'control-mcp-host', name: '@changanhua/dsh-control-mcp/host',
      config: { runId: { __jsExpr: 'process.env.DSH_CONTROL_RUN_ID' } },
    }])
  })
})
