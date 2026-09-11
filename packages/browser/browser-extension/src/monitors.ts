import { z } from 'zod'
import { CreateMonitorSchema, hasNotificationCapacity, type BrowserMonitor, type MonitorRecord } from '@changanhua/dsh-browser-monitor'
import type { GrantSummary } from './grants.ts'

const createSchema = CreateMonitorSchema.omit({ installationId: true })
const controlSchema = z.object({ id: z.uuid({ version: 'v4' }), revision: z.uuid({ version: 'v4' }) }).strict()
const acknowledgeSchema = z.object({ id: z.uuid({ version: 'v4' }), noticeId: z.uuid({ version: 'v4' }) }).strict()
const fail = (code: string) => Object.assign(new Error(code), { code })
type Monitors = Pick<BrowserMonitor, 'create' | 'list' | 'pause' | 'resume' | 'acknowledge'>

/** Installation-bound transport; persisted page results remain hidden after an authorization change. */
export class BrowserMonitors {
  constructor(private readonly monitors: Monitors, private readonly grant: GrantSummary, private readonly permit: () => boolean) {}

  async handle(method: string, params: unknown): Promise<unknown> {
    this.authorize()
    if (method === 'monitor.list') {
      z.object({}).strict().parse(params)
      return { monitors: this.monitors.list(this.grant.installationId)
        .filter(record => this.allows(record.url)).map(record => this.view(record)) }
    }
    if (method === 'monitor.create') {
      const input = createSchema.parse(params)
      const authorize = () => { this.authorize(input.url) }
      const record = await this.monitors.create({ ...input, installationId: this.grant.installationId }, authorize)
      authorize()
      return this.view(record)
    }
    if (method === 'monitor.pause' || method === 'monitor.resume') {
      const input = controlSchema.parse(params)
      const record = this.record(input.id)
      const authorize = () => { this.authorize(record.url) }
      const next = method === 'monitor.pause'
        ? await this.monitors.pause(input.id, this.grant.installationId, input.revision, authorize)
        : await this.monitors.resume(input.id, this.grant.installationId, input.revision, authorize)
      authorize()
      return this.view(next)
    }
    if (method === 'monitor.acknowledge') {
      const input = acknowledgeSchema.parse(params)
      const record = this.record(input.id)
      if (record.grantEpoch !== this.grant.grantEpoch) throw fail('authorization_changed')
      await this.monitors.acknowledge(input.id, this.grant.installationId, input.noticeId, () => { this.authorize(record.url) })
      this.authorize(record.url)
      return { acknowledged: true }
    }
    throw fail('unknown_monitor_method')
  }

  private record(id: string): MonitorRecord {
    const record = this.monitors.list(this.grant.installationId).find(item => item.id === id)
    if (!record || !this.allows(record.url)) throw fail('monitor_not_found')
    return record
  }
  private view(record: MonitorRecord) {
    const authorizationChanged = record.grantEpoch !== this.grant.grantEpoch
    return { id: record.id, revision: record.revision, sessionId: record.sessionId, title: record.title, url: record.url,
      intervalMs: record.intervalMs, missedPolicy: record.missedPolicy, match: record.match, enabled: record.enabled,
      authorizationChanged, nextDue: record.nextDue, checking: record.pending !== null,
      notificationCapacity: !hasNotificationCapacity(record),
      lastSample: authorizationChanged ? null : record.lastSample,
      lastFailure: authorizationChanged ? null : record.lastFailure, outbox: authorizationChanged ? [] : record.outbox }
  }
  private authorize(url?: string): void {
    if (!this.permit() || !['session:interact', 'browser:read', 'browser:observe'].every(scope => this.grant.scopes.includes(scope))
      || url !== undefined && !this.allows(url)) throw fail('observation_not_authorized')
  }
  private allows(raw: string): boolean {
    const url = new URL(raw)
    return this.grant.origins.includes('*') || this.grant.origins.includes(url.origin)
  }
}
