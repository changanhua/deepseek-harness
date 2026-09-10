import { expect, test, vi } from 'vitest'
import { createPuppeteerDriver } from '../src/browser-puppeteer.js'

test('attachment failure is reported before reserving or performing any page action', async () => {
  const invoke = vi.fn()
  const driver = createPuppeteerDriver({ chromeApi: { runtime: { id: 'ext' } },
    connect: vi.fn(), ExtensionTransport: { connectTab: vi.fn(async () => { throw new Error('busy debugger') }) } })
  const result: unknown = await driver.execute({ page: { tabId: 1 }, request: { deadline: Date.now() + 5000 }, invoke,
    validate: () => {}, signal: new AbortController().signal })
  expect(result).toMatchObject({ outcome: 'failed', quiescent: true, reason: 'debugger_unavailable' })
  expect(invoke).not.toHaveBeenCalled()
})
test('pre-aborted action never attaches to the browser', async () => {
  const attach = vi.fn()
  const driver = createPuppeteerDriver({ chromeApi: {}, connect: vi.fn(), ExtensionTransport: { connectTab: attach } })
  const result: unknown = await driver.execute({ page: { tabId: 1 }, request: { deadline: Date.now() + 5000 },
    invoke: vi.fn(), validate: () => {}, signal: AbortSignal.abort() })
  expect(result).toMatchObject({ outcome: 'cancelled', quiescent: true })
  expect(attach).not.toHaveBeenCalled()
})
