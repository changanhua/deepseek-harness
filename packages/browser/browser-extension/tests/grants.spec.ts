import { createHash, randomBytes } from 'node:crypto'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it, vi } from 'vitest'
import { BrowserGrants } from '../src/grants.ts'
import { Context } from '@deepseek-ai/cordis'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'

const extensionId = 'a'.repeat(32)
const installationId = '123e4567-e89b-42d3-a456-426614174000'
const pair = () => { const verifier = randomBytes(32).toString('base64url'); return { verifier, challenge: createHash('sha256').update(Buffer.from(verifier, 'base64url')).digest('base64url') } }
class SerialCredentials extends MemoryCredentials {
  private writes = Promise.resolve()
  override modifyRecord(
    key: CredentialKey,
    mutate: (value: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    const operation = this.writes.then(() => super.modifyRecord(key, mutate))
    this.writes = operation.then(() => {}, () => {})
    return operation
  }
}
async function create() {
  const ctx = new Context()
  await ctx.plugin(SerialCredentials)
  const invalidated: string[] = []
  const grants = new BrowserGrants(ctx, { requestTTL: 1000, pendingLimit: 2, maxGrants: 2 }, (id) => { invalidated.push(id) })
  await grants.start()
  return { ctx, grants, invalidated }
}
describe('BrowserGrants', () => {
  it('exchanges only an approved verifier for its separately stored browser token', async () => {
    const { grants } = await create(); const p = pair()
    const pending = await grants.begin({ extensionId, installationId, challenge: p.challenge, scopes: ['browser:read'], origins: ['https://example.test'] })
    await expect(grants.exchange(pending.requestId, { extensionId, installationId, verifier: p.verifier })).resolves.toEqual({ status: 'pending' })
    const grant = await grants.approve(pending.requestId, { scopes: ['browser:read'], origins: ['https://example.test'] })
    const exchanged = await grants.exchange(pending.requestId, { extensionId, installationId, verifier: p.verifier })
    expect(exchanged).toMatchObject({ status: 'connected', grant }); expect(await grants.authenticate((exchanged as { token: string }).token, extensionId)).toEqual(grant)
    expect(await grants.authenticate('content-import-token', extensionId)).toBeUndefined()
  })
  it('rejects approval scopes or origins outside the request', async () => {
    const { grants } = await create(); const p = pair(); const pending = await grants.begin({ extensionId, installationId, challenge: p.challenge, scopes: ['browser:read'], origins: ['https://example.test'] })
    await expect(grants.approve(pending.requestId, { scopes: ['browser:write'], origins: ['https://example.test'] })).rejects.toThrow()
    await expect(grants.approve(pending.requestId, { scopes: ['browser:read'], origins: ['https://other.test'] })).rejects.toThrow()
  })
  it('persists grants and fails permit closed immediately on revoke', async () => {
    const { ctx, grants, invalidated } = await create(); const p = pair(); const pending = await grants.begin({ extensionId, installationId, challenge: p.challenge, scopes: ['browser:read'], origins: ['*'] }); const grant = await grants.approve(pending.requestId, { scopes: ['browser:read'], origins: ['*'] })
    expect(grants.permit(grant)).toBe(true)
    await grants.revoke(installationId)
    expect(grants.permit(grant)).toBe(false)
    expect(invalidated).toContain(installationId)
    const restarted = new BrowserGrants(ctx, { requestTTL: 1000, pendingLimit: 2, maxGrants: 2 }, () => {})
    await restarted.start()
    expect(await restarted.list()).toEqual([])
  })
  it('allows narrowing explicitly requested all-sites access to a single origin', async () => {
    const { grants } = await create()
    const pending = await grants.begin({ extensionId, installationId, challenge: pair().challenge,
      scopes: ['browser:read'], origins: ['*'] })
    await expect(grants.approve(pending.requestId, { scopes: ['browser:read'], origins: ['https://example.test'] }))
      .resolves.toMatchObject({ origins: ['https://example.test'] })
    await grants.dispose()
  })
  it('fails closed when persistence fails or its credential record changes externally', async () => {
    const { ctx, grants } = await create(); const p = pair(); const pending = await grants.begin({ extensionId, installationId, challenge: p.challenge, scopes: ['browser:read'], origins: ['*'] }); const grant = await grants.approve(pending.requestId, { scopes: ['browser:read'], origins: ['*'] })
    await ctx.credentials.modifyRecord(credentialKey('browser-extension', 'grants'), () => Promise.resolve({ kind: 'grant', payload: { version: 1, nextEpoch: 99, grants: [] } }))
    expect(grants.permit(grant)).toBe(false)
  })
  it('does not create a usable grant when credential persistence rejects', async () => {
    const { ctx, grants } = await create(); const p = pair(); const pending = await grants.begin({ extensionId, installationId, challenge: p.challenge, scopes: ['browser:read'], origins: ['*'] })
    ctx.credentials.modifyRecord = async () => { throw Error('disk failure') }
    await expect(grants.approve(pending.requestId, { scopes: ['browser:read'], origins: ['*'] })).rejects.toThrow('disk failure')
    expect(await grants.list()).toEqual([])
  })
  it('keeps nextEpoch monotonic after every grant was revoked and restarted', async () => {
    const { ctx, grants } = await create(); const p = pair(); const pending = await grants.begin({ extensionId, installationId, challenge: p.challenge, scopes: ['browser:read'], origins: ['*'] }); const first = await grants.approve(pending.requestId, { scopes: ['browser:read'], origins: ['*'] }); await grants.revoke(installationId)
    const restarted = new BrowserGrants(ctx, { requestTTL: 1000, pendingLimit: 2, maxGrants: 2 }, () => {}); await restarted.start(); const next = await restarted.begin({ extensionId, installationId, challenge: pair().challenge, scopes: ['browser:read'], origins: ['*'] }); const second = await restarted.approve(next.requestId, { scopes: ['browser:read'], origins: ['*'] }); expect(second.grantEpoch).toBeGreaterThan(first.grantEpoch)
  })
  it('fails closed and invalidates every captured grant when an external record update arrives', async () => {
    const { ctx, grants, invalidated } = await create()
    const pending = await grants.begin({ extensionId, installationId, challenge: pair().challenge, scopes: ['browser:read'], origins: ['*'] })
    const grant = await grants.approve(pending.requestId, { scopes: ['browser:read'], origins: ['*'] })
    let permitDuringNotification: boolean | undefined
    ctx.on('credentials/record-updated', () => { permitDuringNotification = grants.permit(grant) })
    await ctx.credentials.modifyRecord(credentialKey('browser-extension', 'grants'), current => Promise.resolve(current))
    expect(permitDuringNotification).toBe(false)
    expect(invalidated).toContain(installationId)
    // An unchanged, freshly revalidated grant may become usable again.
    await grants.list()
    expect(grants.permit(grant)).toBe(true)
  })
  it('expires and bounds pending requests', async () => {
    vi.useFakeTimers(); try { const { grants } = await create(); const p = pair(); const pending = await grants.begin({ extensionId, installationId, challenge: p.challenge, scopes: ['browser:read'], origins: ['*'] }); await grants.begin({ extensionId, installationId, challenge: p.challenge, scopes: ['browser:read'], origins: ['*'] }); await expect(grants.begin({ extensionId, installationId, challenge: p.challenge, scopes: ['browser:read'], origins: ['*'] })).rejects.toThrow('pending capacity'); await vi.advanceTimersByTimeAsync(1001); expect(() => grants.request(pending.requestId)).toThrow(); await grants.begin({ extensionId, installationId, challenge: p.challenge, scopes: ['browser:read'], origins: ['*'] }) } finally { vi.useRealTimers() }
  })

  it('redelivers a paired token until expiry when the first HTTP response was lost', async () => {
    const { grants } = await create(); const proof = pair()
    const pending = await grants.begin({ extensionId, installationId, challenge: proof.challenge, scopes: ['browser:read'], origins: ['*'] })
    await grants.approve(pending.requestId, { scopes: ['browser:read'], origins: ['*'] })
    const first = await grants.exchange(pending.requestId, { extensionId, installationId, verifier: proof.verifier })
    expect(await grants.exchange(pending.requestId, { extensionId, installationId, verifier: proof.verifier })).toEqual(first)
  })

  it('refuses approval after expiry even when no intervening request pruned the map', async () => {
    vi.useFakeTimers()
    try {
      const { grants } = await create()
      const pending = await grants.begin({ extensionId, installationId, challenge: pair().challenge, scopes: ['browser:read'], origins: ['*'] })
      await vi.advanceTimersByTimeAsync(1001)
      await expect(grants.approve(pending.requestId, { scopes: ['browser:read'], origins: ['*'] })).rejects.toThrow()
      expect(await grants.list()).toEqual([])
    } finally { vi.useRealTimers() }
  })

  it('rejects noncanonical verifier encodings even if they decode to the same bytes', async () => {
    const { grants } = await create()
    const canonical = Buffer.alloc(32).toString('base64url')
    const pending = await grants.begin({ extensionId, installationId, challenge: createHash('sha256').update(Buffer.alloc(32)).digest('base64url'), scopes: ['browser:read'], origins: ['*'] })
    await grants.approve(pending.requestId, { scopes: ['browser:read'], origins: ['*'] })
    expect(await grants.exchange(pending.requestId, { extensionId, installationId, verifier: canonical.slice(0, -1) + 'B' }).then(() => true, () => false)).toBe(false)
  })

  it('does not allow a public summary to mutate stored access scope', async () => {
    const { grants } = await create()
    const pending = await grants.begin({ extensionId, installationId, challenge: pair().challenge, scopes: ['browser:read'], origins: ['https://example.test'] })
    const approved = await grants.approve(pending.requestId, { scopes: ['browser:read'], origins: ['https://example.test'] })
    ;(approved.origins as string[]).push('https://unauthorized.test')
    expect((await grants.list())[0]?.origins).toEqual(['https://example.test'])
    expect(grants.permit(approved)).toBe(false)
  })

  it('fails startup closed on malformed durable grants', async () => {
    const { ctx } = await create()
    await ctx.credentials.modifyRecord(credentialKey('browser-extension', 'grants'), async () => ({ kind: 'grant', payload: { version: 1, nextEpoch: 4, grants: [{ installationId }] } }))
    const next = new BrowserGrants(ctx, { requestTTL: 1000, pendingLimit: 2, maxGrants: 2 }, () => {})
    await expect(next.start()).rejects.toThrow()
  })

  it('merges two authorization owners through the shared serialized credential record', async () => {
    const { ctx, grants } = await create()
    const other = new BrowserGrants(ctx, { requestTTL: 1000, pendingLimit: 2, maxGrants: 2 }, () => {})
    await other.start()
    const secondId = '223e4567-e89b-42d3-a456-426614174000'
    const first = await grants.begin({ extensionId, installationId, challenge: pair().challenge, scopes: ['browser:read'], origins: ['*'] })
    const second = await other.begin({ extensionId, installationId: secondId, challenge: pair().challenge, scopes: ['browser:read'], origins: ['*'] })
    const accepted = await Promise.all([grants.approve(first.requestId, { scopes: ['browser:read'], origins: ['*'] }), other.approve(second.requestId, { scopes: ['browser:read'], origins: ['*'] })])
    expect(new Set(accepted.map(grant => grant.grantEpoch)).size).toBe(2)
    const restarted = new BrowserGrants(ctx, { requestTTL: 1000, pendingLimit: 2, maxGrants: 2 }, () => {})
    await restarted.start()
    expect((await restarted.list()).map(grant => grant.installationId).sort()).toEqual([installationId, secondId])
    await grants.revoke(installationId)
    expect((await other.list()).map(grant => grant.installationId)).toEqual([secondId])
  })

  it('keeps a failed revocation fenced after an unrelated credential refresh', async () => {
    const { ctx, grants } = await create()
    const pending = await grants.begin({ extensionId, installationId, challenge: pair().challenge, scopes: ['browser:read'], origins: ['*'] })
    const approved = await grants.approve(pending.requestId, { scopes: ['browser:read'], origins: ['*'] })
    const original = ctx.credentials.modifyRecord.bind(ctx.credentials)
    ctx.credentials.modifyRecord = async () => { throw Error('disk failure') }
    await expect(grants.revoke(installationId)).rejects.toThrow()
    expect(grants.permit(approved)).toBe(false)
    ctx.credentials.modifyRecord = original
    await original(credentialKey('browser-extension', 'grants'), async current => current)
    await grants.list().catch(() => [])
    expect(grants.permit(approved)).toBe(false)
  })

  it('never lets approval completion clear a revocation that began during its commit', async () => {
    const { ctx, grants } = await create()
    const pending = await grants.begin({ extensionId, installationId, challenge: pair().challenge, scopes: ['browser:read'], origins: ['*'] })
    const original = ctx.credentials.modifyRecord.bind(ctx.credentials)
    const release = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    let writes = 0
    ctx.credentials.modifyRecord = async (key, mutate) => {
      writes += 1
      if (writes === 2) { entered.resolve(undefined); await release.promise }
      return original(key, mutate)
    }
    let revoke: Promise<void> | undefined
    ctx.on('credentials/record-updated', () => { revoke ??= grants.revoke(installationId) })
    try {
      const approved = await grants.approve(pending.requestId, { scopes: ['browser:read'], origins: ['*'] })
      await entered.promise
      expect(grants.permit(approved)).toBe(false)
    } finally { release.resolve(undefined); await revoke }
  })
})
