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

function feedbackHarness(mode: 'gone' | 'background' | 'input-failed' | 'abort' | 'deadline' | 'revoked' | 'detach' | 'fill', kind: 'click' | 'press' | 'submit' = 'click') {
  const events = new Set<(source: object, method: string, params: object) => void>()
  const detached = new Set<(source: object) => void>()
  const controller = new AbortController()
  const page = { tabId: 1, frameId: 0, documentId: 'original', url: 'https://example.test/' }
  const action = mode === 'fill' ? { kind: 'fill', value: 'value', element: { page } } : { kind, key: 'Enter', element: { page } }
  const request = { deadline: Date.now() + 5000, payload: action }
  const world = { inputs: 0, value: '', authorized: true, focused: false, focusChanges: [] as boolean[] }
  const chromeApi = {
    runtime: { id: 'ext', getPlatformInfo: async () => ({ os: 'win' }) },
    debugger: {
      onEvent: { addListener: (fn: (source: object, method: string, params: object) => void) => events.add(fn),
        removeListener: (fn: (source: object, method: string, params: object) => void) => events.delete(fn) },
      onDetach: {
        addListener: (fn: (source: object) => void) => detached.add(fn),
        removeListener: (fn: (source: object) => void) => detached.delete(fn),
      },
    },
  }
  const handle = {
    scrollIntoView: async () => {}, focus: async () => {}, dispose: async () => {},
    evaluate: async (fn: (...args: unknown[]) => unknown) => {
      if (kind === 'submit' && fn.toString().includes('requestSubmit')) {
        world.inputs++
        if (mode === 'input-failed') throw new Error('No document with id original')
        return true
      }
      return { bounds: [0, 0, 100, 20] }
    },
    clickablePoint: async () => ({ x: 50, y: 10 }),
  }
  const mouse = {
    click: async () => {
      if (mode === 'background' && !world.focused) return
      world.inputs++
      if (mode === 'input-failed') throw new Error('No document with id original')
    },
  }
  const frame = {
    _id: 'frame', parentFrame: () => null,
    isolatedRealm: () => ({ adoptBackendNode: async () => ({ asElement: () => handle }) }),
    client: { id: () => 'pageTargetSessionId', send: async (method: string, params: { expression?: string; enabled?: boolean }) => {
      if (method === 'Emulation.setFocusEmulationEnabled') {
        world.focused = params.enabled === true
        world.focusChanges.push(world.focused)
        return {}
      }
      if (method === 'Runtime.evaluate') return { result: params.expression?.includes('externalNode')
        ? { objectId: 'node', subtype: 'node' } : { value: 'token' } }
      return { node: { backendNodeId: 1 } }
    } },
  }
  const keyboard = {
    down: async () => {},
    press: async () => {
      if (kind === 'press') { world.inputs++; if (mode === 'input-failed') throw new Error('No document with id original') }
    },
    up: async () => {},
    sendCharacter: async (value: string) => { world.value = value },
  }
  const browser = { pages: async () => [{ frames: () => [frame], mainFrame: () => frame, keyboard, mouse }], disconnect: async () => {} }
  const transport = { send: () => {}, close: async () => {} }
  const invoke = async (_page: unknown, method: string) => {
    if (method === 'documentToken') return 'token'
    if (['startExternal', 'issueExternal', 'guardExternal'].includes(method)) return { ready: true }
    if (method === 'externalChanged') {
      if (mode === 'abort') controller.abort()
      if (mode === 'deadline') request.deadline = 0
      if (mode === 'revoked') world.authorized = false
      if (mode === 'detach') for (const listener of detached) listener({ tabId: 1 })
    }
    throw new Error('No document with id original')
  }
  const driver = createPuppeteerDriver({ chromeApi, connect: async () => {
    for (const listener of events) listener({ tabId: 1 }, 'Runtime.executionContextCreated', {
      context: { id: 1, origin: 'chrome-extension://ext', auxData: { frameId: 'frame' } },
    })
    return browser
  }, ExtensionTransport: { connectTab: async () => transport } })
  const execute = () => driver.execute({ page, request, invoke,
    validate: () => { if (!world.authorized) throw Object.assign(new Error('authorization_changed'), { code: 'authorization_changed' }) },
    signal: controller.signal })
  return { execute, world }
}

test('acknowledges a completed click when only old-document feedback disappears', async () => {
  const h = feedbackHarness('gone')
  expect(await h.execute()).toEqual({ outcome: 'observed', quiescent: true,
    value: { engine: 'puppeteer', input: 'click', effect: 'unobserved', feedbackUnavailable: true, businessOutcome: 'unverified' } })
  expect(h.world.inputs).toBe(1)
})

test('delivers background input with temporary focus emulation and clears it after navigation', async () => {
  const h = feedbackHarness('background')
  expect(await h.execute()).toMatchObject({ outcome: 'observed', quiescent: true })
  expect(h.world.inputs).toBe(1)
  expect(h.world.focusChanges).toEqual([true, false])
  expect(h.world.focused).toBe(false)
})

test('acknowledges a confirmed form submission when only old-document feedback disappears', async () => {
  const h = feedbackHarness('gone', 'submit')
  expect(await h.execute()).toMatchObject({ outcome: 'observed', quiescent: true,
    value: { formSubmitted: true, feedbackUnavailable: true, businessOutcome: 'unverified' } })
  expect(h.world.inputs).toBe(1)
})

test.each(['input-failed', 'abort', 'deadline', 'revoked', 'detach'] as const)(
  'preserves an uncertain or interrupted form submission: %s', async (mode) => {
    const h = feedbackHarness(mode, 'submit')
    expect(await h.execute()).toMatchObject({ outcome: 'unknown', quiescent: false })
    expect(h.world.inputs).toBe(1)
  },
)

test.each(['input-failed', 'abort', 'deadline', 'revoked', 'detach'] as const)(
  'does not upgrade an uncertain or interrupted click: %s', async (mode) => {
    const h = feedbackHarness(mode)
    expect(await h.execute()).toMatchObject({ outcome: 'unknown', quiescent: false })
    expect(h.world.inputs).toBe(1)
  },
)

test('does not treat sent fill characters as verified form state after losing feedback', async () => {
  const h = feedbackHarness('fill')
  expect(await h.execute()).toMatchObject({ outcome: 'unknown', quiescent: false })
  expect(h.world.value).toBe('value')
})

test('acknowledges a completed Enter input when navigation removes the old document', async () => {
  const h = feedbackHarness('gone', 'press')
  expect(await h.execute()).toMatchObject({ outcome: 'observed', quiescent: true,
    value: { input: 'press', effect: 'unobserved', feedbackUnavailable: true, businessOutcome: 'unverified' } })
  expect(h.world.inputs).toBe(1)
})

test.each(['input-failed', 'abort', 'deadline', 'revoked', 'detach'] as const)(
  'does not upgrade an uncertain or interrupted Enter input: %s', async (mode) => {
    const h = feedbackHarness(mode, 'press')
    expect(await h.execute()).toMatchObject({ outcome: 'unknown', quiescent: false })
    expect(h.world.inputs).toBe(1)
  },
)
