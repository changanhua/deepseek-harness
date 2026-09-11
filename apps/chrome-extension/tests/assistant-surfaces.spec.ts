import { describe, expect, test, vi } from 'vitest'
import { createAssistantSurfaces } from '../src/assistant-surfaces.js'

const url = 'chrome-extension://test/sidebar.html'
interface TestWindow { id: number; state?: string }
interface Surfaces { openWindow(): Promise<{ windowId: number }> }
const harness = () => {
  const chromeApi = { runtime: { getURL: () => url, getContexts: vi.fn(async (): Promise<Array<{ windowId: number }>> => []) }, windows: {
    getAll: vi.fn(async (): Promise<TestWindow[]> => []), update: vi.fn(async () => ({})), create: vi.fn(async () => ({ id: 2 })),
  } }
  const api: unknown = createAssistantSurfaces({ chromeApi })
  const surfaces = api as Surfaces
  return { chromeApi, surfaces }
}

describe('assistant independent surface', () => {
  test('simultaneous global invocations open one window using the existing sidebar entry', async () => {
    const h = harness()
    const [first, second] = await Promise.all([h.surfaces.openWindow(), h.surfaces.openWindow()])
    expect(first).toEqual({ windowId: 2 }); expect(second).toEqual(first)
    expect(h.chromeApi.windows.create).toHaveBeenCalledOnce()
    expect(h.chromeApi.windows.create).toHaveBeenCalledWith({ url, type: 'popup', width: 440, height: 820, focused: true })
  })
  test('a worker restart finds and restores only its own existing popup', async () => {
    const h = harness()
    h.chromeApi.windows.getAll.mockResolvedValueOnce([{ id: 3, state: 'minimized' }])
    h.chromeApi.runtime.getContexts.mockResolvedValueOnce([{ windowId: 3 }])
    expect(await h.surfaces.openWindow()).toEqual({ windowId: 3 })
    expect(h.chromeApi.windows.update).toHaveBeenCalledWith(3, { focused: true, state: 'normal' })
    expect(h.chromeApi.windows.create).not.toHaveBeenCalled()
  })
  test('closing the old window during lookup allows a new invocation to recover', async () => {
    const h = harness()
    h.chromeApi.windows.getAll.mockResolvedValueOnce([{ id: 3 }])
    h.chromeApi.runtime.getContexts.mockResolvedValueOnce([{ windowId: 3 }])
    h.chromeApi.windows.update.mockRejectedValueOnce(new Error('window closed'))
    expect(await h.surfaces.openWindow()).toEqual({ windowId: 2 })
  })
})
