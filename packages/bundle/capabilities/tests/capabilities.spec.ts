/** Static composition contract for the standalone capabilities bundle. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

interface Row {
  readonly id?: string
  readonly name?: string
  readonly group?: boolean
  readonly isolate?: Record<string, boolean>
  readonly config?: unknown
}

const root = fileURLToPath(new URL('..', import.meta.url))

function loadRows(path: string): Row[] {
  return yaml.load(readFileSync(path, 'utf8'), { schema: entryListSchema }) as Row[]
}

describe('dsh-capabilities bundle composition', () => {
  it('keeps the Host small and exposes only the lazy capability catalog', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')

    const patch = yaml.load(
      readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{ insert?: Row[] }>
    const rows = patch[0]?.insert ?? []
    const byId = new Map(rows.map(row => [row.id, row]))

    expect(rows.map(row => row.id)).toEqual([
      'timer', 'llm', 'session', 'session-projection', 'system-prompt', 'tools',
      'agent', 'agent-loop', 'sessions', 'webserver', 'agent-presets', 'mcp-server',
    ])
    expect(byId.get('llm')?.name).toBe('@deepseek-ai/dsh-llm')
    expect(byId.get('tools')).toMatchObject({ config: { mode: 'native' } })
    expect(byId.get('agent-loop')).toMatchObject({ config: { agents: [] } })
    expect(byId.get('agent-presets')).toMatchObject({
      name: '@changanhua/dsh-capabilities',
      config: { default: 'choice', roots: [], includeShippedRoot: false, includeUserRoot: false },
    })
    expect(rows.some(row => row.name?.includes('sdk'))).toBe(false)
    expect(rows.some(row => row.name?.includes('terminal'))).toBe(false)
    expect(rows.some(row => row.name?.includes('jobs'))).toBe(false)

    expect(byId.get('mcp-server')).toMatchObject({
      name: '@changanhua/dsh-mcp-server',
      config: {
        path: '/mcp',
        tokenEnv: 'DSH_MCP_TOKEN',
        catalog: [
          { preset: 'choice', declaration: '@changanhua/dsh-tool-choice/declaration', options: {} },
          {
            preset: 'search',
            declaration: '@deepseek-ai/dsh-tool-fs-search/declaration',
            options: { sampleOverCapGlobResults: false, globMaxResults: 200 },
          },
        ],
      },
    })
  })

  it('keeps provider and subprocess services inside separate preset groups', () => {
    const choice = loadRows(resolve(root, 'presets/choice/agent.cordis.yml'))
    const search = loadRows(resolve(root, 'presets/search/agent.cordis.yml'))

    expect(choice).toHaveLength(1)
    expect(choice[0]).toMatchObject({ name: 'cordis:group', group: true, isolate: { llm: true } })
    expect((choice[0]?.config as Row[]).map(row => row.name)).toEqual([
      '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-llm-deepseek', '@changanhua/dsh-tool-choice',
    ])
    expect(search).toHaveLength(1)
    expect(search[0]).toMatchObject({ name: 'cordis:group', group: true, isolate: { subprocess: true } })
    expect((search[0]?.config as Row[]).map(row => row.name)).toEqual([
      '@deepseek-ai/dsh-subprocess-local', '@deepseek-ai/dsh-tool-fs-search',
    ])
  })
})
