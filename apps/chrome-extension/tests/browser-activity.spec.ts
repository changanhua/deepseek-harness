import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserActivity } from '../src/browser-activity.js'
import type { ActivityEvent, ActivityPolicy } from '../../../packages/browser/browser-activity/src/types.ts'

const policy = (): ActivityPolicy => ({ revision: '00000000-0000-4000-8000-000000000001', grantEpoch: 1, enabled: true,
  sessionId: 'session', origins: ['https://page.test'], kinds: ['visit', 'dwell', 'dom-change'], minIntervalMs: 1000,
  retentionDays: 1, maxEvents: 100, maxTextChars: 100 })
interface Collector { tick(): Promise<void>; policyChanged(): Promise<void>; stop(): Promise<void> }
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanup.splice(0)) await close() })
function harness() {
  let current: ActivityPolicy | null = policy()
  const state = { now: 1000, granted: true, focused: true, changed: false,
    tab: { id: 1, url: 'https://page.test/article' } }
  const chromeApi = {
    windows: { getLastFocused: vi.fn(async () => ({ id: 2, focused: state.focused })) },
    tabs: { query: vi.fn(async () => [state.tab]), get: vi.fn(async () => state.tab) },
    permissions: { contains: vi.fn(async () => state.granted) },
    scripting: { executeScript: vi.fn(async () => [{ frameId: 0, result: { url: state.tab.url,
      title: 'Page', documentId: 'document', changed: state.changed, text: 'Visible text' } }]) },
  }
  const enqueue = vi.fn<(events: ActivityEvent[]) => void>(), flush = vi.fn(async () => {})
  const raw: unknown = createBrowserActivity({ chromeApi, getPolicy: () => current, enqueue, flush, now: () => state.now })
  const collector = raw as Collector; cleanup.push(() => collector.stop())
  return { state, chromeApi, enqueue, flush, collector, pause: () => { current = null } }
}
describe('activity page collection', () => {
  it('checks persistent site permission before injection, independently of activeTab access', async () => {
    const h = harness(); h.state.granted = false; await h.collector.tick()
    expect(h.chromeApi.permissions.contains).toHaveBeenCalledWith({ origins: ['https://page.test/*'] })
    expect(h.chromeApi.scripting.executeScript).not.toHaveBeenCalled(); expect(h.enqueue).not.toHaveBeenCalled()
  })
  it('records visits, dwell, and local changes at the configured cadence', async () => {
    const h = harness(); await h.collector.tick()
    expect(h.enqueue.mock.calls[0]?.[0]).toMatchObject([{ kind: 'visit', tabId: 1, text: 'Visible text' }])
    h.state.now += 500; await h.collector.tick(); expect(h.enqueue).toHaveBeenCalledOnce()
    h.state.now += 500; h.state.changed = true; await h.collector.tick()
    expect(h.enqueue.mock.calls[1]?.[0]).toMatchObject([{ kind: 'dwell', durationMs: 1000 }, { kind: 'dom-change' }])
    h.state.focused = false; h.state.now += 1000; await h.collector.tick()
    expect(h.enqueue.mock.calls[2]?.[0]).toMatchObject([{ kind: 'dwell' }])
    expect(h.flush).toHaveBeenCalledTimes(3)
    h.state.now += 1000; await h.collector.tick(); expect(h.enqueue).toHaveBeenCalledTimes(3)
  })
  it('rejects an old document result after navigation during capture', async () => {
    const h = harness()
    h.chromeApi.tabs.get.mockImplementationOnce(async () => ({ ...h.state.tab, url: 'https://page.test/other' }))
    await h.collector.tick(); expect(h.enqueue).not.toHaveBeenCalled()
  })
  it('does not enqueue or flush a final dwell after the site permission is revoked', async () => {
    const h = harness(); await h.collector.tick()
    h.state.granted = false; h.state.now += 1000; await h.collector.tick()
    expect(h.enqueue).toHaveBeenCalledOnce(); expect(h.flush).toHaveBeenCalledOnce()
  })
  it('stops accepting a capture immediately when the policy is paused during injection', async () => {
    const h = harness()
    h.chromeApi.scripting.executeScript.mockImplementationOnce(async () => {
      h.pause()
      return [{ frameId: 0, result: { url: h.state.tab.url, title: 'Page', documentId: 'document', changed: true, text: 'late' } }]
    })
    await h.collector.tick(); expect(h.enqueue).not.toHaveBeenCalled(); expect(h.flush).not.toHaveBeenCalled()
    await h.collector.policyChanged()
    expect(h.chromeApi.scripting.executeScript.mock.calls.length).toBeGreaterThan(1)
  })
})
