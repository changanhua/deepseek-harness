import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import type { Browser, BrowserInstance } from '@changanhua/dsh-browser'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { ActivityEngine } from '../src/engine.ts'
import { activityDomainSpec } from '../src/spec.ts'
import type { ActivityBatch, ConfigureActivity } from '../src/types.ts'

const installationId = randomUUID()
const instance: BrowserInstance = { installationId, extensionId: 'extension', grantEpoch: 1, online: true,
  origins: ['https://example.test'], scopes: ['browser:read', 'browser:observe'] }
const request = (expectedRevision: string | null = null, enabled = true): ConfigureActivity => ({
  requestId: randomUUID(), expectedRevision, settings: { enabled, sessionId: 'session', origins: ['https://example.test'],
    kinds: ['visit'], minIntervalMs: 1000, retentionDays: 1, maxEvents: 100, maxTextChars: 100 },
})
const batch = (revision: string, at: number): ActivityBatch => ({
  id: randomUUID(), sequence: 1, revision, events: [{ id: randomUUID(), kind: 'visit', at, tabId: 1,
    url: 'https://example.test/article', title: 'Article', text: 'retained fact' }],
})
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })

async function harness(pool = new MemoryMediaPool()) {
  const ctx = new Context(); const storage = await ctx.plugin(Storage)
  const backend = new MemoryStorageBackend(pool)
  ctx.storage.backend.register('memory', { guarantees: ['single-writer', 'commit-sync', 'private-root'],
    kv: backend.kv, close: () => backend.close() })
  const facility = new DomainFacility(ctx, { backend: 'memory' })
  const domain = await facility.open(activityDomainSpec)
  const state = { now: 10 * 86400000, instance: structuredClone(instance) }
  const browser = { instances: vi.fn<Browser['instances']>(async () => [state.instance]),
    isAuthorized: vi.fn<Browser['isAuthorized']>(grant => grant === state.instance) }
  const engine = new ActivityEngine(domain.table('installations'), browser, () => state.now, 2)
  let closed = false
  const close = async () => { if (closed) return; closed = true; await engine.close(); await domain.close(); await storage.dispose() }
  cleanups.push(close)
  return { engine, state, browser, domain, pool, close }
}

describe('activity storage and authority', () => {
  it('rejects a captured offline grant revoked while its lookup was awaiting', async () => {
    const h = await harness(); const configured = await h.engine.configure(installationId, request())
    await h.engine.append(installationId, batch(configured.revision!, h.state.now))
    h.state.instance = { ...h.state.instance, online: false }
    const captured = h.state.instance
    let release!: (value: readonly BrowserInstance[]) => void
    h.browser.instances.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    const pending = h.engine.query(installationId, { sessionId: 'session' })
    await vi.waitFor(() => { expect(release).toBeTypeOf('function') })
    h.browser.isAuthorized.mockReturnValue(false)
    release([captured])
    await expect(pending).rejects.toThrow('observation_not_authorized')
  })
  it('allows current-authority historical search while Chrome is offline, without admitting new collection', async () => {
    const h = await harness(); const configured = await h.engine.configure(installationId, request())
    await h.engine.append(installationId, batch(configured.revision!, h.state.now))
    h.state.instance = { ...h.state.instance, online: false }
    expect(await h.engine.query(installationId, { sessionId: 'session' })).toHaveLength(1)
    await expect(h.engine.append(installationId, batch(configured.revision!, h.state.now))).rejects.toThrow('observation_not_authorized')
    h.state.instance = { ...h.state.instance, grantEpoch: 2 }
    expect(await h.engine.query(installationId, {})).toEqual([])
    h.state.instance = { ...h.state.instance, grantEpoch: 1, origins: ['https://other.test'] }
    expect(await h.engine.query(installationId, {})).toEqual([])
    h.state.instance = { ...h.state.instance, origins: ['https://example.test'], scopes: ['browser:read'] }
    await expect(h.engine.query(installationId, {})).rejects.toThrow('observation_not_authorized')
  })
  it('starts without collection and recovers configuration and last-batch receipts after reopening storage', async () => {
    const first = await harness()
    expect(await first.engine.state(installationId)).toMatchObject({ policy: null, revision: null })
    const configure = request(); const configured = await first.engine.configure(installationId, configure)
    const input = batch(configured.revision!, first.state.now)
    expect(await first.engine.append(installationId, input)).toEqual({ sequence: 1, accepted: 1 })
    await first.close()
    const next = await harness(first.pool)
    expect((await next.engine.configure(installationId, configure)).revision).toBe(configured.revision)
    expect(await next.engine.append(installationId, input)).toEqual({ sequence: 1, accepted: 1 })
    expect(await next.engine.query(installationId, { query: 'RETAINED', sessionId: 'session' })).toHaveLength(1)
    expect(await next.engine.query(installationId, { sessionId: 'different' })).toEqual([])
    await expect(next.engine.configure(installationId, { ...configure, settings: { ...configure.settings, enabled: false } }))
      .rejects.toThrow('activity_configuration_conflict')
  })

  it('makes pause durable, rejects stale resumes, and prunes while disabled without a query', async () => {
    const h = await harness(); const configured = await h.engine.configure(installationId, request())
    const input = batch(configured.revision!, h.state.now); await h.engine.append(installationId, input)
    const paused = await h.engine.configure(installationId, request(configured.revision, false))
    await expect(h.engine.append(installationId, input)).rejects.toThrow('activity_policy_changed')
    await expect(h.engine.configure(installationId, request(configured.revision))).rejects.toThrow('activity_configuration_changed')
    h.state.now += 86400001; await h.engine.tick()
    expect(h.domain.table('installations').get(installationId)?.events).toEqual([])
    await h.close(); const reopened = await harness(h.pool)
    expect(await reopened.engine.state(installationId)).toMatchObject({ revision: paused.revision, policy: { enabled: false } })
  })

  it('hides old epochs after a regrant and requires explicit reconfiguration', async () => {
    const h = await harness(); const configured = await h.engine.configure(installationId, request())
    const input = batch(configured.revision!, h.state.now); await h.engine.append(installationId, input)
    h.state.instance = { ...h.state.instance, grantEpoch: 2 }
    expect(await h.engine.state(installationId)).toEqual({ revision: configured.revision, policy: null,
      sequence: 0, authorizationChanged: true })
    expect(await h.engine.query(installationId, {})).toEqual([])
    await expect(h.engine.append(installationId, input)).rejects.toThrow('activity_policy_changed')
    const newPolicy = await h.engine.configure(installationId, request(configured.revision))
    await h.engine.append(installationId, batch(newPolicy.revision!, h.state.now + 1000))
    expect(await h.engine.query(installationId, {})).toHaveLength(1)
    expect(h.domain.table('installations').get(installationId)?.events).toHaveLength(2)
  })

  it('checks current sites and scopes independently of the uploaded policy', async () => {
    const h = await harness(); const configured = await h.engine.configure(installationId, request())
    h.state.instance = { ...h.state.instance, origins: ['https://elsewhere.test'] }
    expect(await h.engine.query(installationId, {})).toEqual([])
    await expect(h.engine.append(installationId, batch(configured.revision!, h.state.now))).rejects.toThrow('observation_not_authorized')
    await expect(h.engine.configure(installationId, request(configured.revision))).rejects.toThrow('observation_not_authorized')
    h.state.instance = { ...h.state.instance, scopes: ['browser:read'] }
    await expect(h.engine.state(installationId)).rejects.toThrow('observation_not_authorized')
  })

  it('rechecks transport authority after an awaited grant lookup and never commits a revoked upload', async () => {
    const h = await harness(); const configured = await h.engine.configure(installationId, request())
    let release!: (value: readonly BrowserInstance[]) => void
    h.browser.instances.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
    let permitted = true
    const pending = h.engine.append(installationId, batch(configured.revision!, h.state.now), () => {
      if (!permitted) throw new Error('revoked')
    })
    await vi.waitFor(() => { expect(release).toBeTypeOf('function') })
    permitted = false; release([h.state.instance])
    await expect(pending).rejects.toThrow('revoked')
    expect(h.domain.table('installations').get(installationId)?.sequence).toBe(0)
  })

  it('fails closed after an uncertain storage commit until the activation is reopened', async () => {
    const h = await harness(); const configured = await h.engine.configure(installationId, request())
    vi.spyOn(h.domain.table('installations'), 'put').mockRejectedValueOnce(new Error('storage uncertainty'))
    await expect(h.engine.append(installationId, batch(configured.revision!, h.state.now))).rejects.toThrow('storage uncertainty')
    expect(() => h.engine.state(installationId)).toThrow('browser_activity_unavailable')
    expect(() => h.engine.tick()).toThrow('browser_activity_unavailable')
  })
})
