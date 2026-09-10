/// <reference types="node" />
import { describe, expect, test, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { BrowserInvocation } from '../../../packages/browser/browser-extension/src/types.ts'
import { createBrowserExecutor } from '../src/browser-executor.js'
import { sealBrowserInvocation } from '../../../packages/browser/browser-extension/src/requests.ts'

const page = { tabId: 7, frameId: 0, documentId: 'doc-1', url: 'https://example.test/account' }
const grant = { installationId: '123e4567-e89b-42d3-a456-426614174000', grantEpoch: 1,
  scopes: ['browser:read', 'browser:write'], origins: ['https://example.test'] }
type ScriptOptions = { args?: unknown[]; target: { tabId: number; documentIds: string[] } }
type ScriptResult = { documentId: string; frameId: number; result: unknown }
const operation = (payload: BrowserInvocation['payload'] & { kind: string }) => sealBrowserInvocation({ protocolVersion: 1,
  installationId: grant.installationId, sessionId: 'session:test', grantEpoch: 1, requestId: randomUUID(),
  deadline: Date.now() + 30000, mutates: !['tabs', 'snapshot', 'wait'].includes(payload.kind), payload,
  ...(['tabs', 'snapshot'].includes(payload.kind) ? {} : { target: { tabId: page.tabId, frameId: page.frameId, documentId: page.documentId } }),
})
function harness() {
  const chromeApi = {
    permissions: { contains: vi.fn(async () => true) },
    tabs: { query: vi.fn(async () => [{ id: 7, windowId: 1, url: page.url, title: 'Allowed' }, { id: 8, url: 'https://private.test', title: 'Hidden' }]) },
    scripting: { executeScript: vi.fn(async (options: ScriptOptions): Promise<ScriptResult[]> => [{ documentId: page.documentId, frameId: 0,
      result: options.args?.[0] === 'execute' ? { outcome: 'observed', quiescent: true, value: { clicked: true } }
        : options.args?.[0] === 'snapshot' ? { url: page.url, snapshotId: 'snapshot', text: 'Account', elements: [] }
          : { url: page.url, title: 'Account' } }]) },
  }
  const getGrant = vi.fn((): typeof grant | null => structuredClone(grant))
  const executor = createBrowserExecutor({ chromeApi, getGrant, navigationTimeoutMs: 25 })
  return { executor, chromeApi, getGrant }
}

describe('Chrome document-bound browser executor', () => {
  test('background observations require separate observe permission and cannot carry a write', async () => {
    const h = harness()
    const request = operation({ kind: 'observe', action: { kind: 'snapshot', tabId: page.tabId, frameId: 0 } })
    request.mutates = false
    expect(await h.executor.execute(request, new AbortController().signal)).toMatchObject({ reason: 'authorization_changed' })
    expect(h.chromeApi.scripting.executeScript).not.toHaveBeenCalled()
    h.getGrant.mockReturnValue({ ...grant, scopes: [...grant.scopes, 'browser:observe'] })
    expect(await h.executor.execute(request, new AbortController().signal)).toMatchObject({ outcome: 'observed', value: { page } })
    const denied = operation({ kind: 'observe', action: { kind: 'click', element: { page, snapshotId: 's', elementId: 'e' }, intent: '后台点击' } })
    denied.mutates = false
    expect(await h.executor.execute(denied, new AbortController().signal)).toMatchObject({ reason: 'invalid_action' })
  })
  test('prepare reads the original target without issuing a write, while commit retains its exact payload', async () => {
    const h = harness(); const original = h.chromeApi.scripting.executeScript.getMockImplementation()!
    h.chromeApi.scripting.executeScript.mockImplementation(async options => options.args?.[0] === 'prepare'
      ? [{ documentId: page.documentId, frameId: 0, result: { outcome: 'observed', quiescent: true,
        value: { preparationId: 'prepared', description: { page }, expiresAt: Date.now() + 30000 } } }]
      : original(options))
    const action = { kind: 'fill', element: { page, snapshotId: 'snapshot', elementId: 'input' }, value: 'reviewed', intent: '填写' }
    const prepared = operation({ kind: 'prepare', action }); prepared.mutates = false
    prepared.target = { tabId: page.tabId, frameId: page.frameId, documentId: page.documentId }
    expect(await h.executor.execute(prepared, new AbortController().signal)).toMatchObject({ outcome: 'observed', value: { preparationId: 'prepared' } })
    expect(h.chromeApi.scripting.executeScript.mock.calls.some(([options]) => options.args?.[0] === 'execute')).toBe(false)
    const commit = operation({ kind: 'commit', action, preparationId: 'prepared' })
    expect(await h.executor.execute(commit, new AbortController().signal)).toMatchObject({ outcome: 'observed' })
    expect(h.chromeApi.scripting.executeScript.mock.calls.at(-1)?.[0].args).toEqual(['execute', commit, {}])
  })
  test('a read grant cannot prepare a write and a preparation response lost in transport is not a possible write', async () => {
    const h = harness()
    const action = { kind: 'click', element: { page, snapshotId: 'snapshot', elementId: 'buy' }, intent: '购买' }
    const prepared = operation({ kind: 'prepare', action }); prepared.mutates = false
    h.getGrant.mockReturnValue({ ...grant, scopes: ['browser:read'] })
    expect(await h.executor.execute(prepared, new AbortController().signal)).toMatchObject({ reason: 'authorization_changed', quiescent: true })
    expect(h.chromeApi.scripting.executeScript).not.toHaveBeenCalled()
    h.getGrant.mockReturnValue(grant)
    const original = h.chromeApi.scripting.executeScript.getMockImplementation()!
    h.chromeApi.scripting.executeScript.mockImplementation(async (options) => {
      if (options.args?.[0] === 'prepare') throw new Error('lost read')
      return original(options)
    })
    expect(await h.executor.execute(prepared, new AbortController().signal)).toMatchObject({ outcome: 'failed', quiescent: true })
  })
  test('snapshot returns the actual injected document identity', async () => {
    const h = harness()
    const result: unknown = await h.executor.execute(operation({ kind: 'snapshot', tabId: 7, frameId: 0 }), new AbortController().signal)
    expect(result).toMatchObject({ outcome: 'observed', value: { page, snapshotId: 'snapshot' } })
    expect(h.chromeApi.tabs.query).not.toHaveBeenCalled()
    expect(h.chromeApi.scripting.executeScript.mock.calls.at(-1)?.[0].target).toEqual({ tabId: 7, documentIds: ['doc-1'] })
  })
  test('only authorized sites appear in a tabs result', async () => {
    const h = harness()
    const result: unknown = await h.executor.execute(operation({ kind: 'tabs' }), new AbortController().signal)
    expect(result).toMatchObject({ value: { tabs: [{ tabId: 7 }] } })
    expect(JSON.stringify(result)).not.toContain('private.test')
  })
  test('navigation and every element action use the requested document, never the current tab', async () => {
    const h = harness()
    const action = { kind: 'click', element: { page, snapshotId: 'snapshot', elementId: 'button' }, intent: 'Open details' }
    expect(await h.executor.execute(operation(action), new AbortController().signal)).toMatchObject({ outcome: 'observed' })
    for (const [options] of h.chromeApi.scripting.executeScript.mock.calls) expect(options.target).toEqual({ tabId: 7, documentIds: ['doc-1'] })
    expect(h.chromeApi.tabs.query).not.toHaveBeenCalled()
  })
  test('a changed document or URL refuses to issue the action', async () => {
    const h = harness()
    h.chromeApi.scripting.executeScript.mockResolvedValueOnce([{ documentId: 'doc-2', frameId: 0, result: { url: page.url } }])
    expect(await h.executor.execute(operation({ kind: 'navigate', page, url: page.url }), new AbortController().signal)).toMatchObject({ reason: 'stale_document' })
    expect(h.chromeApi.scripting.executeScript).toHaveBeenCalledTimes(1)
  })
  test('checks destination and actual origin against grant and Chrome permission', async () => {
    const h = harness()
    expect(await h.executor.execute(operation({ kind: 'navigate', page, url: 'https://other.test' }), new AbortController().signal)).toMatchObject({ reason: 'site_not_authorized' })
    expect(h.chromeApi.scripting.executeScript).not.toHaveBeenCalled()
    h.chromeApi.permissions.contains.mockResolvedValue(false)
    expect(await h.executor.execute(operation({ kind: 'snapshot', tabId: 7, frameId: 0 }), new AbortController().signal)).toMatchObject({ reason: 'site_permission_required' })
  })
  test('grant loss during preparation prevents the effect', async () => {
    const h = harness(); const original = h.chromeApi.scripting.executeScript.getMockImplementation()!
    h.chromeApi.scripting.executeScript.mockImplementationOnce(async (options) => {
      const result = await original(options); h.getGrant.mockReturnValue(null); return result
    })
    expect(await h.executor.execute(operation({ kind: 'navigate', page, url: page.url }), new AbortController().signal)).toMatchObject({ reason: 'authorization_changed' })
    expect(h.chromeApi.scripting.executeScript.mock.calls.some(([options]) => options.args?.[0] === 'execute')).toBe(false)
  })
  test('a lost reply after issuing an action is unknown, while a pre-aborted action is cancelled', async () => {
    const h = harness(); const original = h.chromeApi.scripting.executeScript.getMockImplementation()!
    h.chromeApi.scripting.executeScript.mockImplementation(async (options) => {
      if (options.args?.[0] === 'execute') throw new Error('Document was unloaded')
      return original(options)
    })
    const action = operation({ kind: 'navigate', page, url: page.url })
    expect(await h.executor.execute(action, new AbortController().signal)).toMatchObject({ outcome: 'unknown', quiescent: false })
    expect(await h.executor.execute(action, AbortSignal.abort())).toMatchObject({ outcome: 'cancelled', quiescent: true })
  })
  test('navigation observes the replacement document before releasing the write', async () => {
    const h = harness(); const original = h.chromeApi.scripting.executeScript.getMockImplementation()!
    h.chromeApi.scripting.executeScript.mockImplementation(async (options) => {
      if (options.args?.[0] === 'execute') return [{ documentId: page.documentId, frameId: 0, result: { outcome: 'unknown', reason: 'navigation_in_progress', quiescent: false } }]
      if (options.target.frameIds) return [{ documentId: 'doc-2', frameId: 0, result: { url: 'https://example.test/next' } }]
      return original(options)
    })
    expect(await h.executor.execute(operation({ kind: 'navigate', page, url: 'https://example.test/next' }), new AbortController().signal))
      .toMatchObject({ outcome: 'observed', quiescent: true, value: { page: { documentId: 'doc-2', url: 'https://example.test/next' } } })
  })
  test('reconciliation distinguishes a replaced document from loss of injection permission', async () => {
    const h = harness(); const row = { identity: operation({ kind: 'navigate', page, url: page.url }), target: page }
    h.chromeApi.scripting.executeScript.mockRejectedValue(new Error('No access'))
    expect(await h.executor.inspect(row)).toMatchObject({ outcome: 'unknown', quiescent: false })
    h.chromeApi.scripting.executeScript.mockImplementation(async (options) => {
      if (options.target.documentIds) throw new Error('No such document')
      return [{ documentId: 'doc-2', frameId: 0, result: { url: page.url } }]
    })
    expect(await h.executor.inspect(row)).toMatchObject({ outcome: 'unknown', quiescent: true, reason: 'document_replaced' })
  })
  test('entry mount and unmount are issued through the page runtime and return their receipts', async () => {
    const h = harness()
    h.chromeApi.scripting.executeScript.mockImplementation(async (options) => {
      if (options.args?.[0] === 'entryMount') return [{ documentId: page.documentId, frameId: 0, result: { outcome: 'observed', quiescent: true, value: { mounted: 2 } } }]
      if (options.args?.[0] === 'entryUnmount') return [{ documentId: page.documentId, frameId: 0, result: { outcome: 'observed', quiescent: true, value: { unmounted: true } } }]
      return [{ documentId: page.documentId, frameId: 0, result: { url: page.url } }]
    })
    const mount = operation({ kind: 'entry_mount', page, mountId: 'collect', selector: '.item', label: '收集标题' } as never)
    expect(await h.executor.execute(mount, new AbortController().signal)).toMatchObject({ outcome: 'observed', value: { mounted: 2 } })
    expect(h.chromeApi.scripting.executeScript.mock.calls.at(-1)?.[0].args?.[0]).toBe('entryMount')
    const unmount = operation({ kind: 'entry_unmount', page, mountId: 'collect' } as never)
    expect(await h.executor.execute(unmount, new AbortController().signal)).toMatchObject({ outcome: 'observed', value: { unmounted: true } })
    expect(h.chromeApi.scripting.executeScript.mock.calls.at(-1)?.[0].args?.[0]).toBe('entryUnmount')
  })

  test('entry inspection is a read-only page operation routed to the binding checker', async () => {
    const h = harness()
    h.chromeApi.scripting.executeScript.mockImplementation(async (options) => {
      if (options.args?.[0] === 'entryInspect') return [{ documentId: page.documentId, frameId: 0,
        result: { outcome: 'observed', quiescent: true, value: { matched: 2, valid: 2, samples: [] } } }]
      return [{ documentId: page.documentId, frameId: 0, result: { url: page.url, title: 'Allowed' } }]
    })
    const inspect = operation({ kind: 'entry_inspect', page, regionSelector: 'main', selector: ':scope > .item', sampleLimit: 3 } as never)
    inspect.mutates = false

    expect(await h.executor.execute(inspect, new AbortController().signal)).toMatchObject({
      outcome: 'observed', value: { matched: 2, valid: 2 },
    })
    expect(h.chromeApi.scripting.executeScript.mock.calls.at(-1)?.[0].args?.[0]).toBe('entryInspect')
  })
})
