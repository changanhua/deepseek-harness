import { describe, expect, test, vi } from 'vitest'
import { createCaptureBridge } from '../src/capture-bridge.js'

const sender = { id: 'abcdefghijklmnopabcdefghijklmnop', frameId: 0, tab: { id: 7 }, url: 'https://chatgpt.com/c/example' }
const payload = { title: '标题', markdown: '正文', source: { url: sender.url, pageTitle: '页面', site: 'chatgpt.com', kind: 'single-reply', capturedAt: '2026-09-10T00:00:00.000Z' } }

describe('capture bridge', () => {
  test('valid page capture receives, saves, and returns the durable entry id', async () => {
    const controller = {
      receive: vi.fn(async () => ({ captureId: '123e4567-e89b-42d3-a456-426614174000' })),
      save: vi.fn(async () => ({ entryId: 'web:123e4567-e89b-42d3-a456-426614174000' })),
      receipt: vi.fn(),
    }
    const bridge = createCaptureBridge({ controller, extensionId: sender.id, openTab: vi.fn() })
    await expect(bridge.quickCapture(payload, sender)).resolves.toEqual({ ok: true, status: 'saved', entryId: 'web:123e4567-e89b-42d3-a456-426614174000' })
    expect(controller.receive).toHaveBeenCalledWith(payload, 7)
    expect(controller.save).toHaveBeenCalledWith('123e4567-e89b-42d3-a456-426614174000', true)
  })

  test('opens the DSH content entry using the stored receipt and the original page binding', async () => {
    const openTab = vi.fn()
    const controller = {
      receive: vi.fn(), save: vi.fn(),
      receipt: vi.fn(async () => ({ entryId: 'web:123e4567-e89b-42d3-a456-426614174000', baseUrl: 'http://127.0.0.1:3080', sourceUrl: sender.url, sourceTabId: 7 })),
    }
    const bridge = createCaptureBridge({ controller, extensionId: sender.id, openTab })
    await expect(bridge.openCaptured('web:123e4567-e89b-42d3-a456-426614174000', sender)).resolves.toEqual({ ok: true })
    expect(openTab).toHaveBeenCalledWith('http://127.0.0.1:3080/#content-entry=web%3A123e4567-e89b-42d3-a456-426614174000')
  })
})
