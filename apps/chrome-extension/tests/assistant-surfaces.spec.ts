import { describe, expect, test, vi } from 'vitest'
import { assistantSurfaceId, attachAssistantViewPort, createAssistantSurfaces } from '../src/assistant-surfaces.js'

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
  test('accepts a trusted sidebar port when Chrome omits its documentId', async () => {
    const fallback = 'surface-123e4567-e89b-42d3-a456-426614174000'
    let onMessage: (message: unknown) => void = () => {}
    let onDisconnect: () => void = () => {}
    const port = { name: 'dsh-assistant-view', sender: { id: 'extension-id', url },
      postMessage: vi.fn(), disconnect: vi.fn(),
      onMessage: { addListener: (handler: typeof onMessage) => { onMessage = handler } },
      onDisconnect: { addListener: (handler: typeof onDisconnect) => { onDisconnect = handler } } }
    const onPresence = vi.fn(async () => {})
    const onClosed = vi.fn(async () => {})

    attachAssistantViewPort({ port, extensionId: 'extension-id', sidebarUrl: url, onPresence, onClosed })
    expect(port.disconnect).not.toHaveBeenCalled()
    onMessage({ type: 'presence', visible: true, surfaceId: fallback })
    await vi.waitFor(() => { expect(port.postMessage).toHaveBeenCalledWith({ type: 'presence-ready' }) })
    expect(onPresence).toHaveBeenCalledWith(fallback, true)
    onDisconnect()
    expect(onClosed).toHaveBeenCalledWith(fallback)
  })

  test('rejects an untrusted view port and mismatched fallback identity', () => {
    const fallback = 'surface-123e4567-e89b-42d3-a456-426614174000'
    let onMessage: (message: unknown) => void = () => {}
    const port = { name: 'dsh-assistant-view', sender: { id: 'extension-id', url },
      postMessage: vi.fn(), disconnect: vi.fn(),
      onMessage: { addListener: (handler: typeof onMessage) => { onMessage = handler } },
      onDisconnect: { addListener: vi.fn() } }
    const onPresence = vi.fn()
    const onClosed = vi.fn()
    attachAssistantViewPort({ port, extensionId: 'extension-id', sidebarUrl: url, onPresence, onClosed })
    onMessage({ type: 'presence', visible: true, surfaceId: fallback })
    onMessage({ type: 'presence', visible: false, surfaceId: 'surface-123e4567-e89b-42d3-a456-426614174001' })
    expect(port.disconnect).toHaveBeenCalledOnce()
    expect(onPresence).toHaveBeenCalledTimes(1)
    attachAssistantViewPort({ port: { ...port, sender: { id: 'foreign', url } },
      extensionId: 'extension-id', sidebarUrl: url, onPresence, onClosed })
    expect(port.disconnect).toHaveBeenCalledTimes(2)
  })

  test('derives an opaque surface identity from the trusted Chrome document sender', () => {
    expect(assistantSurfaceId({ id: 'extension-id', url, documentId: 'document-a' }, 'extension-id', url)).toBe('document-a')
    expect(assistantSurfaceId({ id: 'extension-id', url, documentId: 'document-b' }, 'extension-id', url)).toBe('document-b')
    expect(assistantSurfaceId({ id: 'foreign', url, documentId: 'document-a' }, 'extension-id', url)).toBeNull()
    expect(assistantSurfaceId({ id: 'extension-id', url, documentId: '../unsafe' }, 'extension-id', url)).toBeNull()
  })

  test('uses the trusted sidebar fallback identity when Chrome omits documentId', () => {
    const fallback = 'surface-123e4567-e89b-42d3-a456-426614174000'
    expect(assistantSurfaceId({ id: 'extension-id', url }, 'extension-id', url, fallback)).toBe(fallback)
    expect(assistantSurfaceId({ id: 'foreign', url }, 'extension-id', url, fallback)).toBeNull()
    expect(assistantSurfaceId({ id: 'extension-id', url: `${url}?forged=1` }, 'extension-id', url, fallback)).toBeNull()
    expect(assistantSurfaceId({ id: 'extension-id', url }, 'extension-id', url, '../unsafe')).toBeNull()
  })

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
