/// <reference types="node" />
/** @vitest-environment jsdom */
/** @vitest-environment-options {"url":"https://example.test/article"} */
import { afterEach, expect, test, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import source from '../src/browser-page.js?raw'

interface ExternalApi {
  snapshot(): { elements: Array<{ text: string; snapshotId: string; elementId: string }> }
  prepare(request: unknown): Promise<{ value: { preparationId: string } }>
  startExternal(request: unknown): unknown
  externalNode(request: unknown): Element | null
  issueExternal(request: unknown): unknown
  completeExternal(request: unknown): unknown
  inspect(request: unknown, options?: { cancel: boolean }): unknown
}
const pageGlobal = globalThis as typeof globalThis & { __dshBrowserAssistant?: ExternalApi }
const install = (): ExternalApi => {
  const script: unknown = source
  if (typeof script !== 'string') throw new Error('missing browser source')
  globalThis.eval(script)
  if (!pageGlobal.__dshBrowserAssistant) throw new Error('missing page runtime')
  return pageGlobal.__dshBrowserAssistant
}
const identity = () => ({ protocolVersion: 1, installationId: 'installation', grantEpoch: 1,
  sessionId: 'session', requestId: randomUUID(), fingerprint: randomUUID(), deadline: Date.now() + 10000 })
const setup = async () => {
  document.body.innerHTML = '<button>Read</button><output></output>'
  const api = install(), snapshot = api.snapshot()
  const action = { kind: 'click', element: { ...snapshot.elements[0], page: { url: location.href } }, intent: 'Read' }
  const prepared = await api.prepare({ ...identity(), payload: { kind: 'prepare', action } })
  return { api, request: { ...identity(), payload: { kind: 'commit', action, preparationId: prepared.value.preparationId } } }
}
afterEach(() => { delete pageGlobal.__dshBrowserAssistant; document.body.innerHTML = '' })

test('external driver reserves exact prepared node once without firing a DOM click', async () => {
  const { api, request } = await setup(), click = vi.fn()
  document.querySelector('button')!.addEventListener('click', click)
  expect(api.startExternal(request)).toEqual({ ready: true })
  expect(api.externalNode(request)).toBe(document.querySelector('button'))
  expect(api.startExternal(request)).toMatchObject({ outcome: 'unknown' })
  expect(click).not.toHaveBeenCalled()
})
test('a rerender or changed label during actionability wait rejects the prepared target', async () => {
  const { api, request } = await setup()
  api.startExternal(request)
  document.querySelector('button')!.textContent = 'Delete'
  expect(api.issueExternal(request)).toMatchObject({ outcome: 'failed', reason: 'stale_preparation' })
})
test('stop before dispatch prevents a late driver from acquiring permission to click', async () => {
  const { api, request } = await setup()
  api.startExternal(request)
  expect(api.inspect(request, { cancel: true })).toMatchObject({ outcome: 'cancelled', quiescent: true })
  expect(api.issueExternal(request)).toMatchObject({ outcome: 'cancelled' })
})
test('a dispatched click is unknown until an observable change is read, and cannot replay', async () => {
  const { api, request } = await setup()
  api.startExternal(request)
  expect(api.issueExternal(request)).toEqual({ ready: true })
  expect(api.inspect(request)).toMatchObject({ outcome: 'unknown', quiescent: false })
  document.querySelector('output')!.textContent = 'Expanded'
  expect(api.completeExternal(request)).toMatchObject({ outcome: 'observed', value: { engine: 'puppeteer' } })
  expect(api.startExternal(request)).toMatchObject({ outcome: 'observed' })
})
test('unchanged page after trusted click is reported honestly', async () => {
  const { api, request } = await setup()
  api.startExternal(request); api.issueExternal(request)
  expect(api.completeExternal(request)).toMatchObject({ outcome: 'unknown', reason: 'effect_unverified', quiescent: true })
})
test('page-level screenshot reserves and issues without reading a null DOM node', async () => {
  document.body.innerHTML = '<main>Visual page</main>'
  const api = install()
  const page = { url: location.href }
  const action = { kind: 'screenshot', page }
  const prepared = await api.prepare({ ...identity(), payload: { kind: 'prepare', action } })
  const request = { ...identity(), payload: { kind: 'commit', action, preparationId: prepared.value.preparationId } }
  expect(api.startExternal(request)).toEqual({ ready: true })
  expect(api.issueExternal(request)).toEqual({ ready: true })
  expect(api.completeExternal(request, { result: { screenshot: { data: 'AQ==', mimeType: 'image/jpeg' } } }))
    .toMatchObject({ outcome: 'observed', value: { screenshot: { data: 'AQ==', mimeType: 'image/jpeg' } } })
})
test('open shadow-root controls join snapshots and hidden hosts stay excluded', () => {
  document.body.innerHTML = '<div id="host"></div>'
  const host = document.querySelector('#host')!
  host.attachShadow({ mode: 'open' }).innerHTML = '<button>Shadow action</button>'
  const api = install()
  expect(api.snapshot().elements.some(el => el.text === 'Shadow action')).toBe(true)
  host.setAttribute('hidden', '')
  expect(api.snapshot().elements).toEqual([])
})
