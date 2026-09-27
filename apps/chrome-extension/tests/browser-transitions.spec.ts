import { expect, test, vi } from 'vitest'
import { createBrowserTransitions } from '../src/browser-transitions.js'

type Listener = (...args: unknown[]) => void
const channel = () => {
  const listeners = new Set<Listener>()
  return {
    listeners,
    addListener: (listener: Listener) => listeners.add(listener),
    removeListener: (listener: Listener) => listeners.delete(listener),
  }
}

function harness({ timeoutMs = 1, pages = {}, probePage = { tabId: 7, frameId: 0, documentId: 'doc-2', url: 'https://example.test/next' } }: {
  timeoutMs?: number
  pages?: Record<number, { id: number; windowId: number; url: string }>
  probePage?: { tabId: number; frameId: number; documentId: string; url: string }
} = {}) {
  const committed = channel(), history = channel(), fragment = channel(), child = channel()
  const failed = channel(), created = channel(), removed = channel(), replaced = channel()
  const tabs = new Map<number, { id: number; windowId: number; url: string }>([
    [7, { id: 7, windowId: 1, url: 'https://example.test/account' }],
    ...Object.entries(pages).map(([id, tab]) => [Number(id), tab]),
  ])
  const chromeApi = {
    tabs: { get: vi.fn(async (id: number) => tabs.get(id)), onCreated: created, onRemoved: removed, onReplaced: replaced },
    webNavigation: {
      onCommitted: committed, onHistoryStateUpdated: history, onReferenceFragmentUpdated: fragment,
      onCreatedNavigationTarget: child, onErrorOccurred: failed,
    },
  }
  const probe = vi.fn(async () => probePage)
  const transitions = createBrowserTransitions({ chromeApi, browserSessionId: async () => '123e4567-e89b-42d3-a456-426614174000', probe, timeoutMs })
  const start = (options: object = {}) => transitions.start({
    source: { tabId: 7, frameId: 0, documentId: 'doc-1', url: 'https://example.test/account' },
    deadline: Date.now() + 1000, signal: new AbortController().signal, authorized: async () => true, ...options,
  })
  return { chromeApi, committed, history, fragment, child, failed, created, removed, replaced, probe, start }
}

test('aborting observation removes both Chrome and abort listeners', async () => {
  const committed = channel(), history = channel(), fragment = channel(), child = channel()
  const created = channel(), removed = channel(), replaced = channel()
  const abortListeners = new Set<Listener>()
  const signal = { aborted: false, addEventListener: (_type: string, listener: Listener) => abortListeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => abortListeners.delete(listener) }
  const chromeApi = {
    tabs: { get: vi.fn(async () => ({ id: 7, windowId: 1, url: 'https://example.test/account' })), onCreated: created, onRemoved: removed, onReplaced: replaced },
    webNavigation: {
      onCommitted: committed, onHistoryStateUpdated: history,
      onReferenceFragmentUpdated: fragment, onCreatedNavigationTarget: child,
    },
  }
  const transitions = createBrowserTransitions({ chromeApi, browserSessionId: async () => '123e4567-e89b-42d3-a456-426614174000',
    probe: vi.fn(), timeoutMs: 250 })
  const watcher = await transitions.start({
    source: { tabId: 7, frameId: 0, documentId: 'doc-1', url: 'https://example.test/account' },
    deadline: Date.now() + 1000, signal, authorized: async () => true,
  })
  const settled = watcher.settle()
  await Promise.resolve()
  signal.aborted = true
  for (const listener of abortListeners) listener()
  await settled
  expect([committed, history, fragment, child, created, removed, replaced].every(event => event.listeners.size === 0)).toBe(true)
  expect(abortListeners).toHaveLength(0)
})

test('a same-document history update returns only a re-probed current PageRef', async () => {
  const h = harness({ probePage: { tabId: 7, frameId: 0, documentId: 'doc-1', url: 'https://example.test/next' } })
  const watcher = await h.start()
  for (const listener of h.history.listeners) listener({ tabId: 7, frameId: 0, documentId: 'doc-1', url: 'https://example.test/next' })
  await expect(watcher.settle()).resolves.toMatchObject({ sameTab: { kind: 'same-document',
    page: { tabId: 7, frameId: 0, documentId: 'doc-1', url: 'https://example.test/next' } }, candidates: [] })
})

test('two child navigation targets remain distinct candidate relations', async () => {
  const h = harness({ pages: { 8: { id: 8, windowId: 2, url: 'https://example.test/one' }, 9: { id: 9, windowId: 3, url: 'https://example.test/two' } } })
  const watcher = await h.start()
  for (const listener of h.child.listeners) listener({ sourceTabId: 7, sourceFrameId: 0, tabId: 8, url: 'https://example.test/one' })
  for (const listener of h.child.listeners) listener({ sourceTabId: 7, sourceFrameId: 0, tabId: 9, url: 'https://example.test/two' })
  await expect(watcher.settle()).resolves.toMatchObject({ sameTab: { kind: 'unchanged' }, candidates: [
    { tab: { tabId: 8, windowId: 2, browserSessionId: '123e4567-e89b-42d3-a456-426614174000' }, relation: 'opener', attribution: 'candidate', evidence: 'created-navigation-target' },
    { tab: { tabId: 9, windowId: 3, browserSessionId: '123e4567-e89b-42d3-a456-426614174000' }, relation: 'opener', attribution: 'candidate', evidence: 'created-navigation-target' },
  ] })
})

test('an opener-tab relation remains a candidate when no navigation-target event arrives', async () => {
  const h = harness({ pages: { 8: { id: 8, windowId: 2, url: 'https://example.test/one' } } })
  const watcher = await h.start()
  for (const listener of h.created.listeners) listener({ id: 8, openerTabId: 7, url: 'https://example.test/one' })
  await expect(watcher.settle()).resolves.toMatchObject({ candidates: [{
    tab: { tabId: 8, windowId: 2, browserSessionId: '123e4567-e89b-42d3-a456-426614174000' }, relation: 'opener', attribution: 'candidate', evidence: 'opener-tab',
  }] })
})

test('an elapsed deadline removes every Chrome listener without inventing a transition', async () => {
  const h = harness()
  const watcher = await h.start({ deadline: Date.now() - 1 })
  await expect(watcher.settle()).resolves.toMatchObject({ sameTab: { kind: 'unchanged' }, candidates: [] })
  expect([h.committed, h.history, h.fragment, h.child, h.failed, h.created, h.removed, h.replaced]
    .every(event => event.listeners.size === 0)).toBe(true)
})

test('a source navigation error is unavailable rather than a guessed replacement', async () => {
  const h = harness()
  const watcher = await h.start()
  for (const listener of h.failed.listeners) listener({ tabId: 7, frameId: 0, documentId: 'doc-1', url: 'https://example.test/next', error: 'net::ERR_ABORTED' })
  await expect(watcher.settle()).resolves.toMatchObject({ sameTab: { kind: 'unavailable' }, candidates: [] })
})

test('a grant revoked while the replacement page is being probed suppresses its PageRef', async () => {
  const h = harness()
  let authorized = true
  h.probe.mockImplementationOnce(async () => {
    authorized = false
    return { tabId: 7, frameId: 0, documentId: 'doc-2', url: 'https://example.test/next' }
  })
  const watcher = await h.start({ authorized: async () => authorized })
  for (const listener of h.committed.listeners) listener({ tabId: 7, frameId: 0, documentId: 'doc-2', url: 'https://example.test/next' })
  const receipt = await watcher.settle()
  expect(receipt.sameTab).toEqual({ kind: 'document-replaced' })
})

test('a grant revoked while resolving later children suppresses earlier cached candidates', async () => {
  const h = harness({ pages: { 8: { id: 8, windowId: 2, url: 'https://example.test/one' }, 9: { id: 9, windowId: 3, url: 'https://example.test/two' } } })
  let authorized = true
  h.chromeApi.tabs.get.mockImplementation(async (id: number) => {
    if (id === 9) authorized = false
    return id === 8 ? { id: 8, windowId: 2, url: 'https://example.test/one' }
      : id === 9 ? { id: 9, windowId: 3, url: 'https://example.test/two' }
        : { id: 7, windowId: 1, url: 'https://example.test/account' }
  })
  const watcher = await h.start({ authorized: async () => authorized })
  for (const listener of h.child.listeners) listener({ sourceTabId: 7, sourceFrameId: 0, tabId: 8, url: 'https://example.test/one' })
  for (const listener of h.child.listeners) listener({ sourceTabId: 7, sourceFrameId: 0, tabId: 9, url: 'https://example.test/two' })
  await expect(watcher.settle()).resolves.toMatchObject({ candidates: [] })
})

test('a replacement source document freezes later child candidates from the old source', async () => {
  const h = harness({ pages: { 8: { id: 8, windowId: 2, url: 'https://example.test/one' } } })
  const watcher = await h.start()
  for (const listener of h.committed.listeners) listener({ tabId: 7, frameId: 0, documentId: 'doc-2', url: 'https://example.test/next' })
  for (const listener of h.child.listeners) listener({ sourceTabId: 7, sourceFrameId: 0, tabId: 8, url: 'https://example.test/one' })
  await expect(watcher.settle()).resolves.toMatchObject({ sameTab: { kind: 'document-replaced' }, candidates: [], truncated: true })
})

test('a source iframe does not accept opener-tab evidence without a frame identity', async () => {
  const h = harness({ pages: { 8: { id: 8, windowId: 2, url: 'https://example.test/one' } } })
  const watcher = await h.start({ source: { tabId: 7, frameId: 2, documentId: 'frame-doc', url: 'https://example.test/frame' } })
  for (const listener of h.created.listeners) listener({ id: 8, openerTabId: 7, url: 'https://example.test/one' })
  await expect(watcher.settle()).resolves.toMatchObject({ candidates: [] })
})

test('abort disposes Chrome listeners before the caller settles its receipt', async () => {
  const h = harness()
  const abortListeners = new Set<Listener>()
  const signal = { aborted: false, addEventListener: (_type: string, listener: Listener) => abortListeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => abortListeners.delete(listener) }
  await h.start({ signal })
  signal.aborted = true
  for (const listener of abortListeners) listener()
  expect([h.committed, h.history, h.fragment, h.child, h.failed, h.created, h.removed, h.replaced]
    .every(event => event.listeners.size === 0)).toBe(true)
})

test('deadline disposes Chrome listeners before the caller settles its receipt', async () => {
  const h = harness()
  await h.start({ deadline: Date.now() + 1 })
  await new Promise(resolve => setTimeout(resolve, 5))
  expect([h.committed, h.history, h.fragment, h.child, h.failed, h.created, h.removed, h.replaced]
    .every(event => event.listeners.size === 0)).toBe(true)
})

test('unauthorized transition URLs never appear in the receipt', async () => {
  const h = harness({ pages: { 8: { id: 8, windowId: 2, url: 'https://private.test/child' } } })
  const watcher = await h.start({ authorized: async (url: string) => url.startsWith('https://example.test/') })
  for (const listener of h.committed.listeners) listener({ tabId: 7, frameId: 0, documentId: 'doc-2', url: 'https://private.test/redirect' })
  for (const listener of h.child.listeners) listener({ sourceTabId: 7, sourceFrameId: 0, tabId: 8, url: 'https://private.test/child' })
  const receipt = await watcher.settle()
  expect(receipt).toMatchObject({ sameTab: { kind: 'document-replaced' }, candidates: [] })
  expect(JSON.stringify(receipt)).not.toContain('private.test')
})

test('a child redirected to an unauthorized URL is not returned with its earlier event URL', async () => {
  const h = harness({ pages: { 8: { id: 8, windowId: 2, url: 'https://private.test/final' } } })
  const watcher = await h.start({ authorized: async (url: string) => url.startsWith('https://example.test/') })
  for (const listener of h.child.listeners) listener({ sourceTabId: 7, sourceFrameId: 0, tabId: 8, url: 'https://example.test/initial' })
  await expect(watcher.settle()).resolves.toMatchObject({ candidates: [] })
})

test('a child redirected within an authorized origin reports its final live URL', async () => {
  const h = harness({ pages: { 8: { id: 8, windowId: 2, url: 'https://example.test/final' } } })
  const watcher = await h.start()
  for (const listener of h.child.listeners) listener({ sourceTabId: 7, sourceFrameId: 0, tabId: 8, url: 'https://example.test/initial' })
  await expect(watcher.settle()).resolves.toMatchObject({ candidates: [{ url: 'https://example.test/final' }] })
})
