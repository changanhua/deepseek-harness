import { Context, Service } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@changanhua/dsh-browser'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { ActivityEngine } from './engine.ts'
import { activityDomainSpec } from './spec.ts'
import type { ActivityBatch, ActivityQuery, ActivityReceipt, ActivityRecord, ActivityState, ConfigureActivity } from './types.ts'

export type * from './types.ts'
export { ActivitySettingsSchema, ConfigureActivitySchema, ActivityBatchSchema, ActivityQuerySchema } from './schemas.ts'
export { activityDomainSpec } from './spec.ts'

declare module '@deepseek-ai/cordis' { interface Context { browserActivity: BrowserActivity } }

/** Host retention cadence and installation capacity. Collection is opt-in per installation. */
export interface Config { pruneIntervalMs?: number; maxInstallations?: number }

/** Owns bounded raw browser activity independently of the Chrome buffer and curated knowledge. */
export class BrowserActivity extends Service {
  static Config: Schema<Config> = Schema.object({
    pruneIntervalMs: Schema.number().step(1).min(100).max(60000).default(60000),
    maxInstallations: Schema.number().step(1).min(1).max(64).default(64),
  })
  private readonly config: Required<Config>
  private engine?: ActivityEngine
  private phase: 'opening' | 'ready' | 'unavailable' | 'closed' = 'opening'

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'browserActivity')
    this.config = BrowserActivity.Config(config) as Required<Config>
  }

  protected [Service.init](): void {
    this.ctx.inject(['storageDomain', 'browser'], async (ctx) => {
      let stopping = false
      const stopped = () => stopping
      const opening = ctx.storageDomain.open(activityDomainSpec)
      let engine: ActivityEngine | undefined
      let timer: ReturnType<typeof setInterval> | undefined
      ctx.effect(() => async () => {
        stopping = true
        if (timer) clearInterval(timer)
        await engine?.close()
        await opening.then(domain => domain.close(), () => {})
        delete this.engine
        this.phase = 'closed'
      })
      try {
        const domain = await opening
        if (stopped()) return
        engine = new ActivityEngine(domain.table('installations'), ctx.browser, Date.now, this.config.maxInstallations)
        this.engine = engine
        const active = engine
        const tick = () => {
          void Promise.resolve().then(() => active.tick()).then(
            () => { if (!stopped()) this.phase = 'ready' },
            () => { if (!stopped()) this.phase = 'unavailable' },
          )
        }
        await active.tick()
        if (stopped()) return
        this.phase = 'ready'
        timer = setInterval(tick, this.config.pruneIntervalMs)
      } catch (error) {
        await engine?.close()
        if (stopped()) return
        this.phase = 'unavailable'
        ctx.logger.warn('Browser activity activation failed: %s', error instanceof Error ? error.message : 'unknown failure')
      }
    })
  }

  /**
   * Inspect lifecycle readiness without exposing retained activity.
   * @returns The active dependency lifecycle phase.
   */
  status(): { phase: 'opening' | 'ready' | 'unavailable' | 'closed' } { return { phase: this.phase } }
  /**
   * Persist an explicit collection policy or pause under a viewed revision.
   * @param installationId - Authenticated installation owning the policy.
   * @param input - Stable request identity, viewed revision, and collection settings.
   * @param authorize - Dynamic transport authority check repeated at commit.
   * @returns The durable policy projection, including an identical prior receipt.
   */
  configure(installationId: string, input: ConfigureActivity, authorize?: () => void): Promise<ActivityState> {
    return this.ready().configure(installationId, input, authorize)
  }
  /**
   * Resolve policy and sequence before the extension starts collection or recovery.
   * @param installationId - Authenticated installation owning the policy.
   * @param authorize - Dynamic transport authority check.
   * @returns The current policy, or an explicit authorization-change state.
   */
  state(installationId: string, authorize?: () => void): Promise<ActivityState> { return this.ready().state(installationId, authorize) }
  /**
   * Accept a bounded consecutive activity batch under current observation authority.
   * @param installationId - Authenticated installation supplying the facts.
   * @param input - Policy-bound batch with a stable retry identity.
   * @param authorize - Dynamic transport authority check repeated at commit.
   * @returns The durable last-batch receipt.
   */
  append(installationId: string, input: ActivityBatch, authorize?: () => void): Promise<ActivityReceipt> {
    return this.ready().append(installationId, input, authorize)
  }
  /**
   * Search retained raw facts within the current observation authority.
   * @param installationId - Authenticated installation owning the facts.
   * @param input - Text, Session, time, and result-count bounds.
   * @param authorize - Dynamic transport authority check.
   * @returns Detached facts bounded by count and encoded bytes.
   */
  query(installationId: string, input: ActivityQuery, authorize?: () => void): Promise<ActivityRecord['events']> {
    return this.ready().query(installationId, input, authorize)
  }
  private ready(): ActivityEngine {
    if (!this.engine || this.phase !== 'ready') throw new Error('browser_activity_unavailable')
    return this.engine
  }
}

export default BrowserActivity
