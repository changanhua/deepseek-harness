import { createHash } from 'node:crypto'
import type { Browser, BrowserInstance } from '@changanhua/dsh-browser'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { ActivityBatchSchema, ActivityQuerySchema, ActivityRecordSchema, ConfigureActivitySchema } from './schemas.ts'
import { appendActivity, configureActivity, pruneActivity } from './records.ts'
import type { ActivityBatch, ActivityQuery, ActivityReceipt, ActivityRecord, ActivityState, ConfigureActivity } from './types.ts'

type Table = KvTable<string, ActivityRecord>
type Authorize = () => void
const allowed = () => {}
const QUERY_BYTES = 256 * 1024

/** The Host owns retained activity; upload receipts and admission are bounded independently. */
export class ActivityEngine {
  private chain: Promise<void> = Promise.resolve()
  private pending = 0
  private stopping = false
  private faulted = false
  private ticking?: Promise<void>

  constructor(private readonly table: Table, private readonly browser: Pick<Browser, 'instances' | 'isAuthorized'>,
    private readonly now: () => number = Date.now, private readonly maxInstallations = 64) {
    for (const [key, record] of table.entries()) {
      if (key !== record.installationId || !ActivityRecordSchema.safeParse(record).success) throw new Error('invalid_activity_store')
    }
  }

  /** Configure with a viewed revision and stable request id, so a lost response cannot restart collection. */
  configure(installationId: string, input: ConfigureActivity, authorize: Authorize = allowed): Promise<ActivityState> {
    const request = ConfigureActivitySchema.parse(input)
    const digest = createHash('sha256').update(JSON.stringify(request)).digest('hex')
    return this.serial(async () => {
      const grant = await this.grant(installationId, authorize)
      if (!request.settings.origins.every(origin => this.allows(grant, origin))) throw new Error('observation_not_authorized')
      const previous = this.table.get(installationId)
      if (previous?.configuration?.id === request.requestId) {
        if (previous.configuration.digest !== digest) throw new Error('activity_configuration_conflict')
        return this.view(previous, grant)
      }
      if ((previous?.policy.revision ?? null) !== request.expectedRevision) throw new Error('activity_configuration_changed')
      if (!previous && [...this.table.entries()].length >= this.maxInstallations) throw new Error('activity_capacity')
      const next = configureActivity(installationId, request.settings, grant.grantEpoch, previous, this.now())
      next.configuration = { id: request.requestId, digest }
      await this.persist(pruneActivity(next, this.now()), authorize)
      return this.view(next, grant)
    })
  }

  /** Resolve the Host policy before collecting or replaying a buffered batch. */
  state(installationId: string, authorize: Authorize = allowed): Promise<ActivityState> {
    return this.serial(async () => {
      const grant = await this.grant(installationId, authorize)
      return this.view(this.table.get(installationId), grant)
    })
  }

  /** Persist one consecutive batch under current authority; exact last-batch retries return its receipt. */
  append(installationId: string, input: ActivityBatch, authorize: Authorize = allowed): Promise<ActivityReceipt> {
    const batch = ActivityBatchSchema.parse(input)
    return this.serial(async () => {
      const grant = await this.grant(installationId, authorize)
      const previous = this.table.get(installationId)
      if (!previous) throw new Error('activity_not_configured')
      if (!previous.policy.origins.every(origin => this.allows(grant, origin))) throw new Error('observation_not_authorized')
      const next = appendActivity(previous, batch, grant.grantEpoch, this.now())
      if (next !== previous) await this.persist(next, authorize)
      if (!next.lastBatch) throw new Error('invalid_activity_receipt')
      return { sequence: next.sequence, accepted: next.lastBatch.accepted }
    })
  }

  /** Search bounded raw facts without exposing records collected under an older authorization epoch. */
  query(installationId: string, input: ActivityQuery, authorize: Authorize = allowed): Promise<ActivityRecord['events']> {
    const query = ActivityQuerySchema.parse(input)
    return this.serial(async () => {
      const grant = await this.grant(installationId, authorize, false)
      const record = this.table.get(installationId)
      if (!record) return []
      const needle = query.query?.toLocaleLowerCase()
      const found: ActivityRecord['events'] = []
      let bytes = 2
      for (const event of pruneActivity(record, this.now()).events.toReversed()) {
        if (event.grantEpoch !== grant.grantEpoch || !this.allows(grant, new URL(event.url).origin)
          || query.sessionId !== undefined && event.sessionId !== query.sessionId
          || query.since !== undefined && event.at < query.since
          || needle && !`${event.title}\n${event.url}\n${event.text ?? ''}`.toLocaleLowerCase().includes(needle)) continue
        const size = Buffer.byteLength(JSON.stringify(event), 'utf8') + 1
        if (bytes + size > QUERY_BYTES) break
        found.push(structuredClone(event)); bytes += size
        if (found.length >= query.limit) break
      }
      this.assertOpen(); authorize()
      if (!this.browser.isAuthorized(grant)) throw new Error('observation_not_authorized')
      return found
    })
  }

  /** Retention runs without a surface or active collection policy; overlapping timer ticks coalesce. */
  tick(): Promise<void> {
    if (this.ticking) return this.ticking
    this.ticking = this.serial(async () => {
      for (const [, record] of this.table.entries()) {
        const next = pruneActivity(record, this.now())
        if (next.events.length !== record.events.length) await this.persist(next, allowed)
      }
    }).finally(() => { delete this.ticking })
    return this.ticking
  }

  /** Fence new work before the storage owner drains this activation. */
  async close(): Promise<void> { this.stopping = true; await this.chain }

  private view(record: ActivityRecord | undefined, grant: BrowserInstance): ActivityState {
    if (!record) return { revision: null, policy: null, sequence: 0, authorizationChanged: false }
    const authorizationChanged = record.policy.grantEpoch !== grant.grantEpoch
      || !record.policy.origins.every(origin => this.allows(grant, origin))
    return { revision: record.policy.revision, policy: authorizationChanged ? null : structuredClone(record.policy),
      sequence: authorizationChanged ? 0 : record.sequence, authorizationChanged }
  }
  private allows(grant: BrowserInstance, origin: string): boolean { return grant.origins.includes('*') || grant.origins.includes(origin) }
  private async grant(installationId: string, authorize: Authorize, requireOnline = true): Promise<BrowserInstance> {
    this.assertOpen(); authorize()
    const grant = (await this.browser.instances()).find(item => item.installationId === installationId)
    this.assertOpen(); authorize()
    if (!grant || !this.browser.isAuthorized(grant) || requireOnline && !grant.online
      || !['browser:read', 'browser:observe'].every(scope => grant.scopes.includes(scope))) throw new Error('observation_not_authorized')
    return grant
  }
  private async persist(record: ActivityRecord, authorize: Authorize): Promise<void> {
    this.assertOpen(); authorize()
    const parsed = ActivityRecordSchema.parse(record)
    try { await this.table.put(record.installationId, parsed) }
    catch (error) { this.faulted = true; throw error }
    this.assertOpen(); authorize()
  }
  private assertOpen(): void {
    if (this.stopping || this.faulted) throw new Error('browser_activity_unavailable')
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen()
    if (this.pending >= 128) throw new Error('activity_busy')
    this.pending += 1
    const result = this.chain.then(() => { this.assertOpen(); return operation() })
    this.chain = result.then(allowed, allowed).finally(() => { this.pending -= 1 })
    return result
  }
}
