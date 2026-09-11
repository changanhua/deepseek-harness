/// <reference types="node" />
/** @vitest-environment jsdom */
/** @vitest-environment-options {"url":"https://example.test/"} */
import { afterEach, expect, test } from 'vitest'
import source from '../src/browser-page.js?raw'
import { randomUUID } from 'node:crypto'
import { browserActionSchema } from '../../../packages/browser/browser-extension/src/wire.ts'

const page = { tabId: 1, frameId: 0, documentId: 'doc', url: 'https://example.test/' }
interface Api {
  snapshot(options?: { includeOptions?: boolean }): { elements: Array<{ snapshotId: string; elementId: string }> }
  prepare(request: object): { outcome: string; reason?: string }
}
test('native select snapshots expose option labels and values for the model to choose', () => {
  document.body.innerHTML = '<label>配送方式<select><option value="express">快递</option><option value="pickup">自提</option></select></label>'
  const raw: unknown = source
  if (typeof raw !== 'string') throw new Error('missing source')
  globalThis.eval(raw)
  const api = (globalThis as typeof globalThis & { __dshBrowserAssistant: Api }).__dshBrowserAssistant
  expect(api.snapshot({ includeOptions: true }).elements).toMatchObject([{ label: '配送方式', options: [
    { label: '快递', value: 'express' }, { label: '自提', value: 'pickup' },
  ] }])
})
afterEach(() => { document.body.innerHTML = ''; delete (globalThis as typeof globalThis & { __dshBrowserAssistant?: Api }).__dshBrowserAssistant })
test('extended actions survive wire validation and can prepare exact page or element targets', () => {
  document.body.innerHTML = '<button>Action</button><select><option value="a">A</option></select><input type="checkbox"><input type="file"><div draggable="true" tabindex="0">Drag</div>'
  const rawSource: unknown = source
  if (typeof rawSource !== 'string') throw new Error('missing browser page source')
  globalThis.eval(rawSource)
  const api = (globalThis as typeof globalThis & { __dshBrowserAssistant: Api }).__dshBrowserAssistant
  const elements = api.snapshot().elements.map(el => ({ page, snapshotId: el.snapshotId, elementId: el.elementId }))
  const actions = [
    ...['double_click', 'right_click', 'hover'].map(kind => ({ kind, element: elements[0], intent: 'test' })),
    { kind: 'press', element: elements[0], key: 'Enter', intent: 'test' },
    { kind: 'select', element: elements[1], values: ['a'], intent: 'test' },
    { kind: 'check', element: elements[2], checked: true, intent: 'test' },
    { kind: 'upload', element: elements[3], files: ['C:/fixture.txt'], intent: 'test' },
    { kind: 'drag', element: elements[4], target: elements[0], intent: 'test' },
    ...['back', 'forward', 'reload', 'tab_close', 'tab_focus', 'screenshot'].map(kind => ({ kind, page })),
    { kind: 'tab_open', page, url: 'https://example.test/new' },
  ]
  for (const action of actions) {
    expect(browserActionSchema.safeParse(action).success, action.kind).toBe(true)
    expect(api.prepare({ protocolVersion: 1, installationId: 'installation', grantEpoch: 1, sessionId: 'session',
      requestId: randomUUID(), fingerprint: 'fingerprint', deadline: Date.now() + 10000,
      payload: { kind: 'prepare', action } }), action.kind).toMatchObject({ outcome: 'observed' })
  }
})
