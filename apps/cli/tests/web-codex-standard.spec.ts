/** Web's ordinary standard Agent exposes the existing writable Codex relay. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const jsExprType = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: value => String(value),
})
const configSchema = yaml.JSON_SCHEMA.extend(jsExprType)

interface ConfigRow {
  id?: string
  disabled?: boolean
  config?: Record<string, unknown> | ConfigRow[]
  insert?: ConfigRow[]
}

const rows = async (path: string): Promise<ConfigRow[]> => {
  const document = yaml.load(await readFile(path, 'utf8'), { schema: configSchema }) as ConfigRow[]
  const flatten = (row: ConfigRow): ConfigRow[] => [
    row,
    ...(row.insert ?? []).flatMap(flatten),
    ...(Array.isArray(row.config) ? row.config.flatMap(flatten) : []),
  ]
  return document.flatMap(flatten)
}

describe('Web standard Codex composition', () => {
  it('gives an ordinary standard session the workspace-write Codex tool', async () => {
    const web = await rows(join(repoRoot, 'packages/bundle/web-app/cordis.patch.yml'))
    const standard = await rows(join(repoRoot, 'packages/preset/agent-presets/presets/standard/agent.cordis.yml'))

    expect(web.find(row => row.id === 'subagent-codex')?.config).toEqual({
      permissionMode: 'approve-for-me',
    })
    expect(standard.find(row => row.id === 'tool-subagent-codex')).toMatchObject({
      id: 'tool-subagent-codex',
      config: {
        provider: 'codex',
        toolName: 'subagent_codex',
      },
    })
    expect(standard.find(row => row.id === 'tool-subagent-codex')?.disabled).toBeUndefined()
  })
})
