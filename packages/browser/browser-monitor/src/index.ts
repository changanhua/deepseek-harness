import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createVerifiedOperatorAuthority } from '@changanhua/dsh-task-queue'
import type {} from '@changanhua/dsh-browser'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { MonitorEngine } from './engine.ts'
import { monitorDomainSpec } from './spec.ts'
import type { CreateMonitor, MonitorRecord } from './types.ts'

export type * from './types.ts'
export { CreateMonitorSchema, MonitorRecordSchema } from './schemas.ts'
export { monitorDomainSpec } from './spec.ts'
export { hasNotificationCapacity } from './records.ts'

declare module '@deepseek-ai/cordis' { interface Context { browserMonitor: BrowserMonitor } }

/** Host scan interval and capacity; each Queue attempt has a separate finite read timeout. */
export interface Config { pollIntervalMs?: number; maxMonitors?: number; checkTimeoutMs?: number }

/** Owns persistent plans, accepted comparisons and notification ids, independently of any visible UI. */
export class BrowserMonitor extends Service {
  static Config: Schema<Config> = Schema.object({
    pollIntervalMs: Schema.number().step(1).min(100).max(60000).default(1000),
    maxMonitors: Schema.number().step(1).min(1).max(256).default(64),
    checkTimeoutMs: Schema.number().step(1).min(100).max(120000).default(30000),
  })
  private readonly config: Required<Config>
  private engine?: MonitorEngine
  private phase: 'opening' | 'ready' | 'unavailable' | 'closed' = 'opening'

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'browserMonitor')
    this.config = BrowserMonitor.Config(config) as Required<Config>
  }

  protected [Service.init](): void {
    this.ctx.inject(['storageDomain', 'taskQueue', 'browser'], async (ctx) => {
      let stopping = false
      const isStopping = () => stopping
      const opening = ctx.storageDomain.open(monitorDomainSpec)
      let engine: MonitorEngine | undefined
      let unregister: (() => void) | undefined
      let timer: ReturnType<typeof setInterval> | undefined
      ctx.effect(() => async () => {
        stopping = true
        if (timer) clearInterval(timer)
        unregister?.()
        await engine?.close()
        await opening.then(domain => domain.close(), () => {})
        delete this.engine
        this.phase = 'closed'
      })
      try {
        const domain = await opening
        if (isStopping()) return
        engine = new MonitorEngine(domain.table('monitors'), ctx.browser,
          ctx.taskQueue.forOperator(createVerifiedOperatorAuthority()), this.config)
        const registration = ctx.taskQueue.registerHandler(engine.handler, { activation: 'staged' })
        unregister = registration
        this.engine = engine
        const active = engine
        registration.activate()
        this.phase = 'ready'
        const tick = () => {
          void Promise.resolve().then(() => active.tick()).then(
            () => { if (!isStopping()) this.phase = 'ready' },
            () => { if (!isStopping()) this.phase = 'unavailable' },
          )
        }
        timer = setInterval(tick, this.config.pollIntervalMs)
        tick()
      } catch (error) {
        unregister?.()
        await engine?.close()
        ctx.logger.warn('Browser monitor activation failed: %s', error instanceof Error ? error.message : 'unknown failure')
        this.phase = 'unavailable'
      }
    })
  }

  /**
   * Current lifecycle state; unavailable never means that the page was unchanged.
   * @returns The active dependency lifecycle phase.
   */
  status(): { readonly phase: 'opening' | 'ready' | 'unavailable' | 'closed' } { return { phase: this.phase } }
  /**
   * Persist an explicit plan under the installation's current observation grant.
   * @param input - Immutable plan intent with its stable creation request id.
   * @param authorize - Transport permission check repeated at the commit boundary.
   * @returns The detached durable record, including an identical prior creation.
   */
  create(input: CreateMonitor, authorize?: () => void): Promise<MonitorRecord> { return this.ready().create(input, authorize) }
  /**
   * Return detached definitions and results for one installation; transport callers enforce read access.
   * @param installationId - The authorized browser installation.
   * @returns Its persisted plans, accepted comparisons and pending notifications.
   */
  list(installationId: string): MonitorRecord[] { return this.ready().list(installationId) }
  /**
   * Stop a plan and invalidate its queued and running checks.
   * @param id - The persisted monitor id.
   * @param installationId - The installation owning the plan.
   * @param revision - The viewed revision, when supplied by an interactive caller.
   * @param authorize - Transport permission check repeated before persistence.
   * @returns The paused record after any known Queue cancellation request.
   */
  pause(id: string, installationId: string, revision?: string, authorize?: () => void): Promise<MonitorRecord> {
    return this.ready().pause(id, installationId, revision, authorize)
  }
  /**
   * Bind an explicit resumption to current authority and start a fresh schedule.
   * @param id - The persisted monitor id.
   * @param installationId - The installation owning the plan.
   * @param revision - The viewed revision; stale controls cannot restart a new schedule.
   * @param authorize - Transport permission check repeated before persistence.
   * @returns The resumed record bound to the current observation grant.
   */
  resume(id: string, installationId: string, revision?: string, authorize?: () => void): Promise<MonitorRecord> {
    return this.ready().resume(id, installationId, revision, authorize)
  }
  /**
   * Acknowledge one notification after the receiving surface accepts responsibility for its presentation.
   * @param id - The persisted monitor id.
   * @param installationId - The installation owning the notification.
   * @param noticeId - The stable notification id to remove from the outbox.
   * @param authorize - Transport permission check repeated at the removal boundary.
   */
  acknowledge(id: string, installationId: string, noticeId: string, authorize?: () => void): Promise<void> {
    return this.ready().acknowledge(id, installationId, noticeId, authorize)
  }

  private ready(): MonitorEngine {
    if (!this.engine || this.phase !== 'ready') throw new Error('browser_monitor_unavailable')
    return this.engine
  }
}

export default BrowserMonitor
