import { describe, expect, it } from 'vitest'
import { createResourcesRuntime } from '../src/client/workbench/resources-runtime.ts'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/types'

describe('project resource projection', () => {
  it('ignores a delayed old project response after selecting another project', async () => {
    let finish!: (value: unknown) => void
    const runtime = createResourcesRuntime(() => ({ resourcesList: (id: string) => id === 'old'
      ? new Promise((resolve) => { finish = resolve }) : Promise.resolve({ ok: true, value: { entries: [], configPath: 'new' } }) } as never))
    const old = runtime.load('old' as WorkspaceId)
    await runtime.load('new' as WorkspaceId)
    finish({ ok: true, value: { entries: [], configPath: 'old' } })
    await old
    expect(runtime.source.getSnapshot()).toMatchObject({ workspaceId: 'new', data: { configPath: 'new' }, busy: false })
  })

  it('surfaces a failed write and preserves the last confirmed list', async () => {
    const runtime = createResourcesRuntime(() => ({
      resourcesList: async () => ({ ok: true, value: { entries: [], configPath: 'project' } }),
      resourcesAdd: async () => ({ ok: false, error: { message: 'disk is full' } }),
    } as never))
    await runtime.load('project' as WorkspaceId)
    expect(await runtime.add('project' as WorkspaceId, { kind: 'note', name: 'note', content: 'body' })).toBe(false)
    expect(runtime.source.getSnapshot()).toMatchObject({ error: 'disk is full', data: { entries: [] }, busy: false })
  })
})
