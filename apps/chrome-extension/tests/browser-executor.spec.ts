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
  deadline: Date.now() + 30000, mutates: !['tabs', 'snapshot', 'entry_inspect', 'wait', 'screenshot'].includes(payload.kind), payload,
  ...(['tabs', 'snapshot'].includes(payload.kind) ? {} : { target: { tabId: page.tabId, frameId: page.frameId, documentId: page.documentId } }),
})
function harness() {
  const session = new Map<string, unknown>()
  const chromeApi = {
    storage: { session: { get: vi.fn(async (key: string) => ({ [key]: session.get(key) })),
      set: vi.fn(async (value: Record<string, unknown>) => { for (const [key, item] of Object.entries(value)) session.set(key, item) }),
      clear: vi.fn(async () => { session.clear() }) } },
    permissions: { contains: vi.fn(async () => true) },
    tabs: { query: vi.fn(async () => [{ id: 7, windowId: 1, url: page.url, title: 'Allowed', active: true }, { id: 8, url: 'https://private.test', title: 'Hidden' }]),
      create: vi.fn(async (_options: { url: string; active: boolean }) => ({ id: 9, windowId: 2 })),
      get: vi.fn(async () => ({ id: 7, windowId: 1, url: page.url, title: 'Allowed', active: true })),
      update: vi.fn(async () => ({ id: 7, windowId: 1, url: page.url })),
      captureVisibleTab: vi.fn(async (
        _windowId: number,
        _options: { readonly format: 'jpeg'; readonly quality: number },
      ) => 'data:image/jpeg;base64,AQ==') },
    scripting: { executeScript: vi.fn(async (options: ScriptOptions): Promise<ScriptResult[]> => [{ documentId: page.documentId, frameId: 0,
      result: options.args?.[0] === 'execute' ? { outcome: 'observed', quiescent: true, value: { clicked: true } }
        : options.args?.[0] === 'snapshot' ? { url: page.url, snapshotId: 'snapshot', text: 'Account', elements: [] }
          : { url: page.url, title: 'Account' } }]) },
  }
  const getGrant = vi.fn((): typeof grant | null => structuredClone(grant))
  const executor = createBrowserExecutor({ chromeApi, getGrant, navigationTimeoutMs: 25 })
  return { executor, chromeApi, getGrant, session }
}

describe('Chrome document-bound browser executor', () => {
  test('rechecks authority after browser session storage resolves before creating a tab', async () => {
    const h = harness()
    const request = operation({ kind: 'tab_open', url: page.url })
    delete request.target
    h.chromeApi.storage.session.set.mockImplementationOnce(async () => { h.getGrant.mockReturnValue(null) })
    expect(await h.executor.execute(request, new AbortController().signal)).toMatchObject({
      outcome: 'failed', quiescent: true, reason: 'authorization_changed',
    })
    expect(h.chromeApi.tabs.create).not.toHaveBeenCalled()
  })
  test('opens a background tab without an existing page, DOM injection or debugger attachment', async () => {
    const h = harness()
    const request = operation({ kind: 'tab_open', url: page.url })
    delete request.target
    expect(await h.executor.execute(request, new AbortController().signal)).toMatchObject({
      outcome: 'observed', quiescent: true, value: { opened: true, tab: { tabId: 9, windowId: 2, browserSessionId: expect.any(String) } },
    })
    expect(h.chromeApi.tabs.create).toHaveBeenCalledExactlyOnceWith({ url: page.url, active: false })
    expect(h.chromeApi.scripting.executeScript).not.toHaveBeenCalled()
    expect(h.chromeApi.tabs.query).not.toHaveBeenCalled()
  })
  test('rejects a target-free snapshot when browser session storage was cleared before executor restart', async () => {
    const h = harness()
    const open = operation({ kind: 'tab_open', url: page.url }); delete open.target
    const opened = await h.executor.execute(open, new AbortController().signal) as {
      value: { tab: { tabId: number; windowId: number; browserSessionId: string } }
    }
    const snapshot = operation({ kind: 'snapshot', tabId: opened.value.tab.tabId, frameId: 0,
      expectedTab: opened.value.tab } as BrowserInvocation['payload'] & { kind: 'snapshot'; expectedTab: { tabId: number; windowId: number; browserSessionId: string } })
    h.chromeApi.tabs.get.mockResolvedValue({ id: 9, windowId: 2, url: page.url })
    expect(await h.executor.execute(snapshot, new AbortController().signal)).toMatchObject({ outcome: 'observed' })
    const beforeRestartInjections = h.chromeApi.scripting.executeScript.mock.calls.length
    h.chromeApi.tabs.get.mockResolvedValue({ id: 9, windowId: 3, url: page.url })
    expect(await h.executor.execute(snapshot, new AbortController().signal)).toMatchObject({ outcome: 'failed', quiescent: true, reason: 'tab_reference_stale' })
    expect(h.chromeApi.scripting.executeScript).toHaveBeenCalledTimes(beforeRestartInjections)
    await h.chromeApi.storage.session.clear()
    const restarted = createBrowserExecutor({ chromeApi: h.chromeApi, getGrant: h.getGrant, navigationTimeoutMs: 25 })
    expect(await restarted.execute(snapshot, new AbortController().signal)).toMatchObject({ outcome: 'failed', quiescent: true, reason: 'tab_reference_stale' })
    expect(h.chromeApi.scripting.executeScript).toHaveBeenCalledTimes(beforeRestartInjections)
  })
  test('denies unauthorized target-free creation before issuing it', async () => {
    const h = harness()
    const request = operation({ kind: 'tab_open', url: 'https://private.test/' })
    delete request.target
    expect(await h.executor.execute(request, new AbortController().signal)).toMatchObject({ outcome: 'failed', reason: 'site_not_authorized' })
    request.payload = { kind: 'tab_open', url: page.url }
    h.chromeApi.permissions.contains.mockResolvedValue(false)
    expect(await h.executor.execute(request, new AbortController().signal)).toMatchObject({ outcome: 'failed', reason: 'site_permission_required' })
    expect(h.chromeApi.tabs.create).not.toHaveBeenCalled()
  })
  test('keeps a lost creation reply unknown and does not label restart recovery as a read', async () => {
    const h = harness()
    const request = operation({ kind: 'tab_open', url: page.url })
    delete request.target
    h.chromeApi.tabs.create.mockRejectedValueOnce(new Error('worker disconnected'))
    expect(await h.executor.execute(request, new AbortController().signal)).toMatchObject({ outcome: 'unknown', quiescent: false })
    expect(await h.executor.inspect({ identity: request, mutates: true, operation: 'tab_open' })).toEqual({
      outcome: 'unknown', quiescent: false, reason: 'tab_creation_unconfirmed',
    })
    expect(h.chromeApi.tabs.create).toHaveBeenCalledTimes(1)
  })
  test('retains the created tab even when authorization changes after Chrome accepts creation', async () => {
    const h = harness()
    const request = operation({ kind: 'tab_open', url: page.url })
    delete request.target
    h.chromeApi.tabs.create.mockImplementationOnce(async () => { h.getGrant.mockReturnValue(null); return { id: 9, windowId: 2 } })
    expect(await h.executor.execute(request, new AbortController().signal)).toMatchObject({
      outcome: 'observed', quiescent: true, value: { opened: true, tab: { tabId: 9 } },
    })
    expect(h.chromeApi.scripting.executeScript).not.toHaveBeenCalled()
  })
  test('独立连接的直接点击也进入所选 Puppeteer 执行器，不降级为 DOM click', async () => {
    const h = harness()
    const puppeteer = { execute: vi.fn(async () => ({ outcome: 'observed', quiescent: true,
      value: { engine: 'puppeteer', input: 'click', businessOutcome: 'unverified' } })) }
    const executor = createBrowserExecutor({ chromeApi: h.chromeApi, getGrant: h.getGrant, puppeteer })
    const request = operation({ kind: 'click', element: { page, snapshotId: 'snapshot', elementId: 'title' }, intent: '打开详情' })
    expect(await executor.execute(request, new AbortController().signal))
      .toMatchObject({ outcome: 'observed', value: { engine: 'puppeteer', input: 'click' } })
    expect(puppeteer.execute).toHaveBeenCalledWith(expect.objectContaining({ page, request }))
    expect(h.chromeApi.scripting.executeScript.mock.calls.some(([options]) => options.args?.[0] === 'execute')).toBe(false)
  })

  test('按请求安装身份选择授权，不把另一条连接的 grant 用于执行', async () => {
    const h = harness()
    const request = operation({ kind: 'snapshot', tabId: 7, frameId: 0 })
    await h.executor.execute(request, new AbortController().signal)
    expect(h.getGrant).toHaveBeenCalledWith(request)
  })

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
  test('snapshot forwards wire-bounded presentation queries unchanged to the page runtime', async () => {
    const h = harness()
    const presentationQueries = [{ mountId: 'analysis-panel', text: '证据分歧' }, { mountId: 'summary-panel', text: '摘要已展示' }]
    await h.executor.execute(operation({ kind: 'snapshot', tabId: 7, frameId: 0, presentationQueries }), new AbortController().signal)
    expect(h.chromeApi.scripting.executeScript.mock.calls.at(-1)?.[0].args).toEqual(['snapshot', {
      query: '', offset: 0, limit: 128, textLimit: 50000, tree: false, treeLimit: 256,
      includeOptions: false, structure: true, presentationQueries,
      presentationOwner: { sessionId: 'session:test', installationId: grant.installationId, grantEpoch: 1, page },
    }, {}])
  })
  test('only authorized sites appear in a tabs result', async () => {
    const h = harness()
    const result: unknown = await h.executor.execute(operation({ kind: 'tabs' }), new AbortController().signal)
    expect(result).toMatchObject({ value: { tabs: [{ tabId: 7 }] } })
    expect(JSON.stringify(result)).not.toContain('private.test')
  })
  test('wait bypasses Puppeteer and screenshot returns a base64 image for the active tab', async () => {
    const h = harness()
    const puppeteer = { execute: vi.fn(async () => { throw new Error('must not attach') }) }
    const executor = createBrowserExecutor({ chromeApi: h.chromeApi, getGrant: h.getGrant, puppeteer })
    const wait: unknown = await (executor.execute(
      operation({ kind: 'wait', page, milliseconds: 0 }),
      new AbortController().signal,
    ) as Promise<unknown>)
    expect(wait).toMatchObject({ outcome: 'observed' })
    expect(puppeteer.execute).not.toHaveBeenCalled()
    const screenshot: unknown = await (executor.execute(
      operation({ kind: 'screenshot', page }),
      new AbortController().signal,
    ) as Promise<unknown>)
    expect(screenshot).toMatchObject({ outcome: 'observed', value: { screenshot: { data: 'AQ==', mimeType: 'image/jpeg' } } })
    expect(h.chromeApi.tabs.captureVisibleTab).toHaveBeenCalledWith(1, { format: 'jpeg', quality: 55 })
    expect(puppeteer.execute).not.toHaveBeenCalled()
  })
  test('screenshot never changes the active tab when the target cannot be proven foreground', async () => {
    const h = harness()
    h.chromeApi.tabs.get.mockRejectedValue(new Error('tab facts unavailable'))
    h.chromeApi.tabs.query.mockResolvedValue([{ id: 8, windowId: 1, url: 'https://example.test/other', active: true }])
    const result: unknown = await h.executor.execute(operation({ kind: 'screenshot', page }), new AbortController().signal)
    expect(result).toMatchObject({ outcome: 'failed', reason: 'screenshot_requires_active_tab' })
    expect(h.chromeApi.tabs.update).not.toHaveBeenCalled()
    expect(h.chromeApi.tabs.captureVisibleTab).not.toHaveBeenCalled()
  })
  test('tab focus is a direct Chrome operation', async () => {
    const h = harness()
    const executor = createBrowserExecutor({ chromeApi: h.chromeApi, getGrant: h.getGrant,
      puppeteer: { execute: vi.fn(async () => { throw new Error('must not attach') }) } })
    expect(await executor.execute(operation({ kind: 'tab_focus', page }), new AbortController().signal))
      .toMatchObject({ outcome: 'observed', value: { focused: true } })
    expect(h.chromeApi.tabs.update).toHaveBeenCalledWith(7, { active: true })
  })
  test('large active screenshots step down JPEG quality before refusing', async () => {
    const h = harness()
    h.chromeApi.tabs.captureVisibleTab.mockImplementation(async (_windowId, options) =>
      options.quality === 55 ? `data:image/jpeg;base64,${'A'.repeat(1_500_001)}` : 'data:image/jpeg;base64,AQ==')
    const result: unknown = await (h.executor.execute(
      operation({ kind: 'screenshot', page }),
      new AbortController().signal,
    ) as Promise<unknown>)
    expect(result).toMatchObject({ outcome: 'observed', value: { screenshot: { data: 'AQ==' } } })
    expect(h.chromeApi.tabs.captureVisibleTab.mock.calls.map(([, options]) => options.quality)).toEqual([55, 45])
  })
  test('navigation and every element action use the requested document, never the current tab', async () => {
    const h = harness()
    const action = { kind: 'click', element: { page, snapshotId: 'snapshot', elementId: 'button' }, intent: 'Open details' }
    expect(await h.executor.execute(operation(action), new AbortController().signal)).toMatchObject({ outcome: 'observed' })
    for (const [options] of h.chromeApi.scripting.executeScript.mock.calls) expect(options.target).toEqual({ tabId: 7, documentIds: ['doc-1'] })
    expect(h.chromeApi.tabs.query).not.toHaveBeenCalled()
  })
  test('a replaced document refuses to issue the action with a recoverable cause', async () => {
    const h = harness()
    h.chromeApi.scripting.executeScript.mockResolvedValueOnce([{ documentId: 'doc-2', frameId: 0, result: { url: page.url } }])
    expect(await h.executor.execute(operation({ kind: 'navigate', page, url: page.url }), new AbortController().signal)).toMatchObject({ reason: 'document_replaced' })
    expect(h.chromeApi.scripting.executeScript).toHaveBeenCalledTimes(1)
  })
  test('a same-document URL change refuses to issue the action without claiming DOM replacement', async () => {
    const h = harness()
    h.chromeApi.scripting.executeScript.mockResolvedValueOnce([{ documentId: page.documentId, frameId: 0, result: { url: 'https://example.test/account?tab=security' } }])
    expect(await h.executor.execute(operation({ kind: 'navigate', page, url: page.url }), new AbortController().signal))
      .toMatchObject({ outcome: 'failed', quiescent: true, reason: 'target_url_stale' })
    expect(h.chromeApi.scripting.executeScript).toHaveBeenCalledTimes(1)
  })
  test('同文档 URL 漂移仅允许精确的 route-discard 清理调用旧页面 runtime', async () => {
    const h = harness()
    h.chromeApi.scripting.executeScript.mockImplementation(async (options) => {
      if (options.args?.[0] === 'entryUnmount') {
        return [{ documentId: page.documentId, frameId: 0, result: {
          outcome: 'observed', quiescent: true, value: { unmounted: true, remaining: 0, disposition: 'route_discarded' },
        } }]
      }
      if (options.files) return []
      return [{ documentId: page.documentId, frameId: 0, result: { url: 'https://example.test/account?tab=security' } }]
    })
    const result: unknown = await (h.executor.execute(
      operation({ kind: 'entry_unmount', page, mountId: 'old-entry' }),
      new AbortController().signal,
    ) as Promise<unknown>)
    expect(result).toMatchObject({ outcome: 'observed', quiescent: true, value: { disposition: 'route_discarded' } })
    expect(h.chromeApi.scripting.executeScript.mock.calls.at(-1)?.[0].target).toEqual({ tabId: 7, documentIds: ['doc-1'] })
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
  test('a missing bound document reports document replacement when the tab exposes a new document', async () => {
    const h = harness()
    h.chromeApi.scripting.executeScript.mockImplementation(async (options) => {
      if (options.target.documentIds) throw new Error('No such document')
      return [{ documentId: 'doc-2', frameId: 0, result: { url: 'https://example.test/next' } }]
    })
    const result: unknown = await (h.executor.execute(
      operation({ kind: 'navigate', page, url: 'https://example.test/next' }),
      new AbortController().signal,
    ) as Promise<unknown>)
    expect(result).toMatchObject({ outcome: 'failed', quiescent: true, reason: 'document_replaced' })
  })
  test('entry mount and unmount are issued through the page runtime and return their receipts', async () => {
    const h = harness()
    h.chromeApi.scripting.executeScript.mockImplementation(async (options) => {
      if (options.args?.[0] === 'entryInspect') return [{ documentId: page.documentId, frameId: 0, result: { outcome: 'observed', quiescent: true, value: { matches: 2 } } }]
      if (options.args?.[0] === 'entryMount') return [{ documentId: page.documentId, frameId: 0, result: { outcome: 'observed', quiescent: true, value: { mounted: 2 } } }]
      if (options.args?.[0] === 'entryUnmount') return [{ documentId: page.documentId, frameId: 0, result: { outcome: 'observed', quiescent: true, value: { unmounted: true } } }]
      return [{ documentId: page.documentId, frameId: 0, result: { url: page.url } }]
    })
    const mount = operation({ kind: 'entry_mount', page, mountId: 'collect', selector: '.item', label: '收集标题' })
    expect(await h.executor.execute(mount, new AbortController().signal)).toMatchObject({ outcome: 'observed', value: { mounted: 2 } })
    expect(h.chromeApi.scripting.executeScript.mock.calls.at(-1)?.[0].args?.[0]).toBe('entryMount')
    const unmount = operation({ kind: 'entry_unmount', page, mountId: 'collect' })
    expect(await h.executor.execute(unmount, new AbortController().signal)).toMatchObject({ outcome: 'observed', value: { unmounted: true } })
    expect(h.chromeApi.scripting.executeScript.mock.calls.at(-1)?.[0].args?.[0]).toBe('entryUnmount')
  })
  test('entry inspection is a read action issued through the page runtime', async () => {
    const h = harness()
    h.chromeApi.scripting.executeScript.mockImplementation(async (options) => {
      if (options.args?.[0] === 'entryInspect') return [{ documentId: page.documentId, frameId: page.frameId,
        result: { outcome: 'observed', quiescent: true, value: { matched: 2 } } }]
      return [{ documentId: page.documentId, frameId: 0, result: { url: page.url, title: 'Account' } }]
    })
    const inspect = operation({ kind: 'entry_inspect', page, regionSelector: '#feed', selector: '.item', label: '收集' })
    expect(await h.executor.execute(inspect, new AbortController().signal)).toMatchObject({ outcome: 'observed', value: { matched: 2 } })
    expect(h.chromeApi.scripting.executeScript.mock.calls.at(-1)?.[0].args?.[0]).toBe('entryInspect')
  })
})
