import { randomUUID } from 'node:crypto'
import { describe, expect, test, vi } from 'vitest'
import type { BrowserMonitor } from '@changanhua/dsh-browser-monitor'
import { createRecord } from '../../browser-monitor/src/records.ts'
import { BrowserMonitors } from '../src/monitors.ts'
import type { GrantSummary } from '../src/grants.ts'

function harness() {
  let allowed = true
  const grant: GrantSummary = { installationId: randomUUID(), extensionId: 'a'.repeat(32), grantEpoch: 1,
    createdAt: new Date().toISOString(), scopes: ['session:interact', 'browser:read', 'browser:observe'], origins: ['https://example.test'] }
  const input = { requestId: randomUUID(), sessionId: 'session', installationId: grant.installationId, url: 'https://example.test/article',
    title: '检查', intervalMs: 1000, missedPolicy: 'latest' as const, match: { kind: 'changed' as const } }
  const record = createRecord(input, 1, 1000)
  const methods = {
    create: vi.fn<BrowserMonitor['create']>(async (_input, authorize) => { authorize?.(); return record }),
    pause: vi.fn<BrowserMonitor['pause']>(async () => record), resume: vi.fn<BrowserMonitor['resume']>(async () => record),
    acknowledge: vi.fn<BrowserMonitor['acknowledge']>(async () => {}), list: vi.fn(() => [record]),
  }
  return { grant, input, record, methods, bridge: new BrowserMonitors(methods, grant, () => allowed), revoke: () => { allowed = false } }
}

describe('browser monitor gateway authority', () => {
  test('binds creation to the authenticated installation and requires the separately granted observation scope', async () => {
    const h = harness(); const { installationId, ...input } = h.input
    await h.bridge.handle('monitor.create', input)
    expect(h.methods.create.mock.calls[0]?.[0]).toMatchObject({ installationId })
    await expect(h.bridge.handle('monitor.create', h.input)).rejects.toThrow()
    const denied = new BrowserMonitors(h.methods, { ...h.grant, scopes: ['session:interact', 'browser:read'] }, () => true)
    await expect(denied.handle('monitor.create', input)).rejects.toThrow('observation_not_authorized')
    expect(h.methods.create).toHaveBeenCalledOnce()
  })

  test('site narrowing and a new grant epoch do not expose prior samples or notices', async () => {
    const h = harness()
    h.record.lastSample = { digest: 'a'.repeat(64), matched: true, sampledAt: 1000,
      page: { tabId: 1, frameId: 0, documentId: 'doc', url: h.input.url } }
    h.record.outbox = [{ id: randomUUID(), monitorId: h.record.id, installationId: h.grant.installationId,
      sessionId: 'session', kind: 'changed', title: 'old title', message: 'old message', createdAt: 1000, slot: 1000 }]
    const narrowed = new BrowserMonitors(h.methods, { ...h.grant, origins: ['https://other.test'] }, () => true)
    expect(await narrowed.handle('monitor.list', {})).toEqual({ monitors: [] })
    await expect(narrowed.handle('monitor.resume', { id: h.record.id, revision: h.record.revision })).rejects.toThrow('monitor_not_found')
    const renewed = new BrowserMonitors(h.methods, { ...h.grant, grantEpoch: 2 }, () => true)
    expect(await renewed.handle('monitor.list', {})).toMatchObject({ monitors: [{ authorizationChanged: true, lastSample: null, outbox: [] }] })
    await expect(renewed.handle('monitor.acknowledge', { id: h.record.id, noticeId: h.record.outbox[0]!.id }))
      .rejects.toThrow('authorization_changed')
  })

  test('revocation while creating is checked at the commit boundary and suppresses the returned record', async () => {
    const h = harness(); const { installationId: _installationId, ...input } = h.input
    const barrier = Promise.withResolvers<undefined>()
    h.methods.create.mockImplementationOnce(async (_input, authorize) => { await barrier.promise; authorize?.(); return h.record })
    const creation = h.bridge.handle('monitor.create', input)
    const rejection = expect(creation).rejects.toThrow('observation_not_authorized')
    h.revoke(); barrier.resolve(undefined); await rejection
    expect(h.methods.pause).not.toHaveBeenCalled()
  })

  test('forwards the viewed revision so a lost control response cannot silently repeat a new resume', async () => {
    const h = harness()
    await h.bridge.handle('monitor.resume', { id: h.record.id, revision: h.record.revision })
    expect(h.methods.resume.mock.calls[0]?.slice(0, 3)).toEqual([h.record.id, h.grant.installationId, h.record.revision])
    await expect(h.bridge.handle('monitor.resume', { id: h.record.id })).rejects.toThrow()
  })
})
