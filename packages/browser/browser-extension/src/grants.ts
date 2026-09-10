import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { z } from 'zod'

const KEY = credentialKey('browser-extension', 'grants')
const extensionId = z.string().regex(/^[a-p]{32}$/u)
const installationId = z.uuid({ version: 'v4' })
const encodedSecret = z.string().refine((value) => {
  const bytes = Buffer.from(value, 'base64url')
  return bytes.length === 32 && bytes.toString('base64url') === value
})
const scope = z.enum(['session:interact', 'browser:read', 'browser:write', 'browser:observe'])
const origin = z.string().max(512).refine((value) => {
  if (value === '*') return true
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.origin === value } catch { return false }
})
const choiceSchema = z.object({
  scopes: z.array(scope).min(1).max(4).refine(values => new Set(values).size === values.length),
  origins: z.array(origin).max(64).refine(values => new Set(values).size === values.length),
}).strict()
const pairingSchema = choiceSchema.extend({ extensionId, installationId, challenge: encodedSecret })
const storedGrant = choiceSchema.extend({
  installationId, extensionId, grantEpoch: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  createdAt: z.iso.datetime(), tokenHash: encodedSecret,
})
const recordSchema = z.object({
  version: z.literal(1), nextEpoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  grants: z.array(storedGrant).max(128),
}).strict().refine(value => new Set(value.grants.map(grant => grant.installationId)).size === value.grants.length
  && value.grants.every(grant => grant.grantEpoch <= value.nextEpoch))

/** Permission data safe to show to the signed-in owner, never token material. */
export interface GrantSummary {
  readonly installationId: string
  readonly extensionId: string
  readonly grantEpoch: number
  readonly scopes: readonly string[]
  readonly origins: readonly string[]
  readonly createdAt: string
}
type StoredGrant = z.infer<typeof storedGrant>
type StoredPayload = z.infer<typeof recordSchema>
interface Pending {
  readonly requestId: string
  readonly input: z.infer<typeof pairingSchema>
  readonly expiresAt: number
  status: 'pending' | 'approved'
  token?: string
  grantEpoch?: number
}
/** Public pairing view excludes the challenge and exchange token. */
export interface PendingView {
  readonly requestId: string
  readonly extensionId: string
  readonly installationId: string
  readonly scopes: readonly string[]
  readonly origins: readonly string[]
  readonly expiresAt: string
  readonly status: 'pending' | 'approved'
}

/** Durable grants and the synchronous send-permit fence for the browser gateway. */
export class BrowserGrants {
  private readonly pending = new Map<string, Pending>()
  private readonly revoking = new Map<string, object>()
  private grants: StoredGrant[] = []
  private active = false
  private closed = false
  private revision = 0
  private snapshotRevision = -1
  private refreshing: Promise<void> | undefined
  private mutations = Promise.resolve()
  private readonly unlisten: () => void

  constructor(
    private readonly ctx: Context,
    private readonly limits: { requestTTL: number; pendingLimit: number; maxGrants: number },
    private readonly onInvalidate: (installationId: string) => void,
  ) {
    this.unlisten = ctx.on('credentials/record-updated', (key) => {
      if (key !== KEY || this.closed) return
      this.revision += 1
      this.active = false
      for (const grant of this.grants) this.invalidate(grant.installationId)
      // Never ignore an external event while our own write is waiting for I/O.
      void this.refresh().catch(() => {})
    })
  }

  /** Read and validate durable authority before exposing any send permit. */
  async start(): Promise<void> {
    if (Object.values(this.limits).some(value => !Number.isSafeInteger(value) || value <= 0)
      || this.limits.pendingLimit > 32 || this.limits.maxGrants > 128 || this.limits.requestTTL > 300000) {
      throw new RangeError('invalid browser grant limits')
    }
    await this.refresh()
  }

  /** Begin a bounded verifier/challenge exchange with exactly the requested access. */
  async begin(input: {
    extensionId: string
    installationId: string
    challenge: string
    scopes: readonly string[]
    origins: readonly string[]
  }): Promise<PendingView> {
    await this.fresh()
    const parsed = pairingSchema.parse(input)
    this.expire()
    if (this.pending.size >= this.limits.pendingLimit) throw new Error('pending capacity')
    const value: Pending = { requestId: randomUUID(), input: parsed, expiresAt: Date.now() + this.limits.requestTTL, status: 'pending' }
    this.pending.set(value.requestId, value)
    return view(value)
  }

  /** Read safe pairing metadata; expired or disposed requests cannot be approved. */
  request(requestId: string): PendingView { return view(this.pendingRequest(requestId)) }

  /** Commit the chosen subset atomically; concurrent owners merge through the credential provider. */
  async approve(requestId: string, choice: { scopes: readonly string[]; origins: readonly string[] }): Promise<GrantSummary> {
    const pending = this.pendingRequest(requestId)
    const parsed = choiceSchema.parse(choice)
    if (pending.status !== 'pending'
      || !subset(parsed.scopes, pending.input.scopes)
      || !pending.input.origins.includes('*') && !subset(parsed.origins, pending.input.origins)) {
      throw new Error('approval exceeds request or is already settled')
    }
    const token = randomBytes(32).toString('base64url')
    const priorRevocation = this.revoking.get(pending.input.installationId)
    return this.serialize(async () => {
      let accepted: StoredGrant | undefined
      await this.ctx.credentials.modifyRecord(KEY, (current) => {
        const live = this.pendingRequest(requestId)
        if (live !== pending || live.status !== 'pending') throw new Error('request unavailable')
        const prior = payloadOf(current)
        if (prior.nextEpoch === Number.MAX_SAFE_INTEGER) throw new Error('grant epoch exhausted')
        const retained = prior.grants.filter(grant => grant.installationId !== pending.input.installationId)
        if (retained.length >= this.limits.maxGrants) throw new Error('grant capacity')
        accepted = { ...parsed, installationId: pending.input.installationId, extensionId: pending.input.extensionId,
          grantEpoch: prior.nextEpoch + 1, createdAt: new Date().toISOString(), tokenHash: hash(token) }
        return Promise.resolve<CredentialRecord>({ kind: 'grant', payload: {
          version: 1, nextEpoch: accepted.grantEpoch, grants: [...retained, accepted],
        } })
      })
      if (accepted === undefined) throw new Error('grant commit unavailable')
      pending.status = 'approved'
      pending.token = token
      pending.grantEpoch = accepted.grantEpoch
      // An explicit new approval can recover an older failed revocation, but
      // cannot release a revoke that began while this approval was committing.
      if (this.revoking.get(accepted.installationId) === priorRevocation) this.revoking.delete(accepted.installationId)
      await this.refresh()
      return summary(accepted)
    })
  }

  /** Redeliver only the current grant's token until pairing expiry; a lost HTTP receipt is recoverable. */
  async exchange(requestId: string, input: { extensionId: string; installationId: string; verifier: string }): Promise<
    { status: 'pending' } | { status: 'connected'; token: string; grant: GrantSummary }
  > {
    const pending = this.pendingRequest(requestId)
    if (input.extensionId !== pending.input.extensionId || input.installationId !== pending.input.installationId
      || !encodedSecret.safeParse(input.verifier).success
      || !same(hashBytes(input.verifier), pending.input.challenge)) throw new Error('exchange denied')
    if (pending.status === 'pending') return { status: 'pending' }
    await this.fresh()
    const grant = this.grants.find(grant => grant.installationId === input.installationId)
    if (grant === undefined || grant.grantEpoch !== pending.grantEpoch || pending.token === undefined
      || !same(grant.tokenHash, hash(pending.token)) || !this.permit(summary(grant))) throw new Error('exchange denied')
    return { status: 'connected', token: pending.token, grant: summary(grant) }
  }

  /** Authenticate only this owner's persistent record, never the content-import credential. */
  async authenticate(token: string, extension: string): Promise<GrantSummary | undefined> {
    await this.fresh()
    if (!extensionId.safeParse(extension).success || !encodedSecret.safeParse(token).success) return undefined
    const found = this.grants.find(grant => grant.extensionId === extension && same(grant.tokenHash, hash(token)))
    return found !== undefined && this.permit(summary(found)) ? summary(found) : undefined
  }

  /** Synchronous final check immediately before sending; captured or caller-mutated authority is rejected. */
  permit(grant: Pick<GrantSummary, 'installationId' | 'extensionId' | 'grantEpoch' | 'scopes' | 'origins'>): boolean {
    if (!this.active || this.closed || this.revoking.has(grant.installationId)) return false
    const current = this.grants.find(value => value.installationId === grant.installationId)
    return current !== undefined && current.extensionId === grant.extensionId && current.grantEpoch === grant.grantEpoch
      && arraysEqual(current.scopes, grant.scopes) && arraysEqual(current.origins, grant.origins)
  }

  /** Return detached safe views after any pending credential refresh completes. */
  async list(): Promise<GrantSummary[]> { await this.fresh(); return this.grants.map(summary) }

  /** Fence new sends synchronously, then commit deletion; failed writes retain the local fence. */
  async revoke(id: string): Promise<void> {
    this.open()
    installationId.parse(id)
    const revocation = {}
    this.revoking.set(id, revocation)
    this.invalidate(id)
    for (const [key, pending] of this.pending) if (pending.input.installationId === id) this.pending.delete(key)
    await this.serialize(async () => {
      await this.ctx.credentials.modifyRecord(KEY, (current) => {
        this.open()
        const prior = payloadOf(current)
        return Promise.resolve<CredentialRecord>({ kind: 'grant', payload: {
          ...prior, grants: prior.grants.filter(grant => grant.installationId !== id),
        } })
      })
      await this.refresh()
      if (this.revoking.get(id) === revocation) this.revoking.delete(id)
    })
  }

  /** Disable the owner, detach its listener, and await every admitted persistence operation. */
  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.active = false
    this.unlisten()
    for (const grant of this.grants) this.invalidate(grant.installationId)
    this.pending.clear()
    await this.mutations
    await this.refreshing?.catch(() => {})
    this.grants = []
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    this.open()
    const pending = this.mutations.then(() => { this.open(); return operation() })
    this.mutations = pending.then(() => {}, () => {})
    return pending
  }

  private async fresh(): Promise<void> {
    this.open()
    if (!this.active || this.refreshing !== undefined || this.snapshotRevision !== this.revision) await this.refresh()
    this.open()
    if (!this.active) throw new Error('browser grant owner unavailable')
  }

  private refresh(): Promise<void> {
    this.open()
    if (this.refreshing !== undefined) return this.refreshing
    let failed = false
    const task = (async () => {
      for (;;) {
        const revision = this.revision
        const payload = payloadOf(await this.ctx.credentials.readRecord(KEY))
        this.open()
        if (revision !== this.revision) continue
        this.grants = payload.grants
        this.snapshotRevision = revision
        this.active = true
        return
      }
    })().catch((error: unknown) => { failed = true; this.active = false; throw error }).finally(() => {
      this.refreshing = undefined
      if (!this.closed && !failed && this.snapshotRevision !== this.revision) void this.refresh().catch(() => {})
    })
    this.refreshing = task
    return task
  }

  private pendingRequest(requestId: string): Pending {
    this.open()
    this.expire()
    const pending = this.pending.get(requestId)
    if (pending === undefined) throw new Error('request unavailable')
    return pending
  }

  private expire(): void {
    for (const [key, value] of this.pending) if (value.expiresAt <= Date.now()) this.pending.delete(key)
  }

  private open(): void { if (this.closed) throw new Error('browser grant owner closed') }

  private invalidate(id: string): void {
    try { this.onInvalidate(id) } catch { this.ctx.logger.warn('browser grant connection invalidation failed') }
  }
}

function payloadOf(record: CredentialRecord | undefined): StoredPayload {
  if (record === undefined) return { version: 1, nextEpoch: 0, grants: [] }
  if (record.kind !== 'grant') throw new Error('invalid browser grant record')
  return recordSchema.parse(record.payload)
}
function hash(value: string): string { return createHash('sha256').update(value).digest('base64url') }
function hashBytes(value: string): string { return createHash('sha256').update(Buffer.from(value, 'base64url')).digest('base64url') }
function same(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
function subset(left: readonly string[], right: readonly string[]): boolean { return left.every(value => right.includes(value)) }
function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}
function summary(value: StoredGrant): GrantSummary {
  return { installationId: value.installationId, extensionId: value.extensionId, grantEpoch: value.grantEpoch,
    scopes: [...value.scopes], origins: [...value.origins], createdAt: value.createdAt }
}
function view(value: Pending): PendingView {
  return { requestId: value.requestId, extensionId: value.input.extensionId, installationId: value.input.installationId,
    scopes: [...value.input.scopes], origins: [...value.input.origins],
    expiresAt: new Date(value.expiresAt).toISOString(), status: value.status }
}
