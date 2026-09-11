import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserActivity } from '@changanhua/dsh-browser-activity'
import { BrowserActivities } from '../src/activity.ts'
import type { GrantSummary } from '../src/grants.ts'

function harness() {
  let allowed = true
  const grant: GrantSummary = { installationId: randomUUID(), extensionId: 'a'.repeat(32), grantEpoch: 1,
    createdAt: new Date().toISOString(), scopes: ['session:interact', 'browser:read', 'browser:observe'], origins: ['https://example.test'] }
  const state = { revision: null, policy: null, sequence: 0, authorizationChanged: false }
  const activity = {
    state: vi.fn<BrowserActivity['state']>(async () => state), configure: vi.fn<BrowserActivity['configure']>(async () => state),
    append: vi.fn<BrowserActivity['append']>(async () => ({ sequence: 1, accepted: 1 })),
    query: vi.fn<BrowserActivity['query']>(async () => []),
  }
  return { grant, activity, bridge: new BrowserActivities(activity, grant, () => allowed), revoke: () => { allowed = false } }
}

describe('activity gateway', () => {
  it('preserves a known pre-commit configuration conflict code for safe client recovery', async () => {
    const h = harness()
    h.activity.configure.mockRejectedValueOnce(new Error('activity_configuration_changed'))
    await expect(h.bridge.handle('activity.configure', { requestId: randomUUID(), expectedRevision: null, settings: {
      enabled: true, sessionId: 'session', origins: ['https://example.test'], kinds: ['visit'], minIntervalMs: 1000,
      retentionDays: 1, maxEvents: 10, maxTextChars: 0,
    } })).rejects.toMatchObject({ code: 'activity_configuration_changed' })
  })
  it('binds reads to the authenticated installation and rejects caller-supplied ownership', async () => {
    const h = harness()
    await h.bridge.handle('activity.query', { query: 'article', sessionId: 'session' })
    expect(h.activity.query.mock.calls[0]?.slice(0, 2)).toEqual([h.grant.installationId, { query: 'article', sessionId: 'session', limit: 50 }])
    await expect(h.bridge.handle('activity.query', { installationId: randomUUID() })).rejects.toThrow()
    await expect(h.bridge.handle('activity.state', { sessionId: 'session' })).rejects.toThrow()
  })

  it('requires both observation and session authority', async () => {
    const h = harness()
    for (const missing of h.grant.scopes) {
      const bridge = new BrowserActivities(h.activity,
        { ...h.grant, scopes: h.grant.scopes.filter(scope => scope !== missing) }, () => true)
      await expect(bridge.handle('activity.state', {})).rejects.toThrow('observation_not_authorized')
    }
    expect(h.activity.state).not.toHaveBeenCalled()
  })

  it('rejects configuration beyond the paired sites before reaching storage', async () => {
    const h = harness()
    await expect(h.bridge.handle('activity.configure', { requestId: randomUUID(), expectedRevision: null, settings: {
      enabled: true, sessionId: 'session', origins: ['https://elsewhere.test'], kinds: ['visit'], minIntervalMs: 1000,
      retentionDays: 1, maxEvents: 10, maxTextChars: 0,
    } })).rejects.toThrow('observation_not_authorized')
    expect(h.activity.configure).not.toHaveBeenCalled()
  })

  it('supplies a live authority fence and suppresses late results after revocation', async () => {
    const h = harness()
    h.activity.query.mockImplementationOnce(async (_installation, _input, authorize) => {
      h.revoke(); expect(authorize).toBeTypeOf('function'); authorize?.(); return []
    })
    await expect(h.bridge.handle('activity.query', {})).rejects.toThrow('observation_not_authorized')
    const other = harness()
    other.activity.state.mockImplementationOnce(async () => {
      other.revoke(); return { revision: null, policy: null, sequence: 0, authorizationChanged: false }
    })
    await expect(other.bridge.handle('activity.state', {})).rejects.toThrow('observation_not_authorized')
  })
})
