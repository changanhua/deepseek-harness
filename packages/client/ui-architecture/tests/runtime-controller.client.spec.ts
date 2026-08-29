// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-host-plugin-inventory/types'
import {
  createArchitectureRuntimeController,
  type ArchitectureRuntimeRemoteFace,
} from '../src/client/runtime-controller.ts'

const ACTIVE: PluginInventorySnapshot = {
  entries: [{
    entryId: 'loader-1' as never,
    moduleName: '@deepseek-ai/dsh-client-ui-layout',
    enabled: true,
    fiberPhase: 'active',
  }],
}

describe('Architecture runtime controller', () => {
  it('publishes loading and then the current Loader snapshot', async () => {
    let resolve!: (value: { ok: true; value: PluginInventorySnapshot }) => void
    const remote: ArchitectureRuntimeRemoteFace = {
      list: () => new Promise((r) => { resolve = r }),
    }
    const controller = createArchitectureRuntimeController(remote)

    controller.load()
    expect(controller.source.getSnapshot()).toMatchObject({ status: 'loading', snapshot: undefined })
    resolve({ ok: true, value: ACTIVE })
    await vi.waitFor(() => {
      expect(controller.source.getSnapshot()).toEqual({ status: 'ready', error: null, snapshot: ACTIVE })
    })
  })

  it('keeps the last good snapshot when a refresh fails', async () => {
    let calls = 0
    const remote: ArchitectureRuntimeRemoteFace = {
      async list() {
        calls += 1
        return calls === 1
          ? { ok: true, value: ACTIVE }
          : { ok: false, error: { code: 'transport', message: 'offline', details: {} } }
      },
    }
    const controller = createArchitectureRuntimeController(remote)
    controller.load()
    await vi.waitFor(() => { expect(controller.source.getSnapshot().status).toBe('ready') })

    controller.load()
    await vi.waitFor(() => {
      expect(controller.source.getSnapshot()).toEqual({
        status: 'error',
        error: 'transport: offline',
        snapshot: ACTIVE,
      })
    })
  })

  it('ignores a response superseded by a newer refresh', async () => {
    let resolveFirst!: (value: { ok: true; value: PluginInventorySnapshot }) => void
    let calls = 0
    const remote: ArchitectureRuntimeRemoteFace = {
      list() {
        calls += 1
        if (calls === 1) return new Promise((r) => { resolveFirst = r })
        return Promise.resolve({ ok: true as const, value: ACTIVE })
      },
    }
    const controller = createArchitectureRuntimeController(remote)
    controller.load()
    controller.load()
    await vi.waitFor(() => { expect(controller.source.getSnapshot().status).toBe('ready') })

    resolveFirst({ ok: true, value: { entries: [] } })
    await Promise.resolve()
    expect(controller.source.getSnapshot().snapshot).toBe(ACTIVE)
  })

  it('ignores a pending response after the owning plugin is disposed', async () => {
    let resolve!: (value: { ok: true; value: PluginInventorySnapshot }) => void
    const remote: ArchitectureRuntimeRemoteFace = {
      list: () => new Promise((r) => { resolve = r }),
    }
    const controller = createArchitectureRuntimeController(remote)
    controller.load()
    controller.dispose()

    resolve({ ok: true, value: ACTIVE })
    await Promise.resolve()
    expect(controller.source.getSnapshot()).toMatchObject({ status: 'loading', snapshot: undefined })
  })
})
