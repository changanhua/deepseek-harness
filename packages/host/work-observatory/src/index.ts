/** Host-authoritative Work Observatory Remote and lifecycle owner. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import { AgentActivityTracker } from './agent-tracker.ts'
import { HumanActivityTracker } from './client-tracker.ts'
import { WorkObservatoryDatabase } from './database.ts'
import { WorkObservatoryRangeReader } from './range.ts'
import type {
  ClientObservation,
  ClientObservationAck,
  WorkObservatoryRange,
  WorkObservatoryRangeRequest,
} from './types.ts'

export type {
  ClientObservation,
  ClientObservationAck,
  WorkInterval,
  WorkObservatoryRange,
  WorkObservatoryRangeRequest,
} from './types.ts'
export { WORK_OBSERVATORY_SCHEMA_VERSION } from './database.ts'

/** Default age after which missing browser evidence marks a producer stale. */
export const WORK_OBSERVATORY_DEFAULT_STALE_AFTER_MS = 30_000
/** Default cadence for materializing stale producer closure in SQLite. */
export const WORK_OBSERVATORY_DEFAULT_SWEEP_INTERVAL_MS = 15_000

/** Work Observatory Host configuration. */
export interface Config {
  /** Independent SQLite file path; `:memory:` is supported for tests. */
  path: string
  /** Evidence age required before stale browser state is reset. Defaults to 30 seconds. */
  staleAfterMs?: number
  /** Stale-state scan cadence. Defaults to 15 seconds. */
  sweepIntervalMs?: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host-owned Human and Agent wall-clock accounting Remote. */
    workObservatory: WorkObservatoryGateway
  }
}

/** Host Remote owning Work Observatory persistence, capture, and range derivation. */
export class WorkObservatoryGateway extends TypertRemoteService {
  static inject = ['sessions']

  /** Validated plugin configuration. */
  static Config: z<Config> = z.object({
    path: z.string().required(),
    staleAfterMs: z.number().step(1).min(1).default(WORK_OBSERVATORY_DEFAULT_STALE_AFTER_MS),
    sweepIntervalMs: z.number().step(1).min(1).default(WORK_OBSERVATORY_DEFAULT_SWEEP_INTERVAL_MS),
  })

  private readonly human: HumanActivityTracker
  private readonly reader: WorkObservatoryRangeReader

  /**
   * Open the independent store, install Agent projection, and start stale scanning.
   * @param ctx - service fiber context with the live Session store.
   * @param config - validated path and stale timing.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'workObservatory')
    const resolved = config as Required<Config>
    const database = new WorkObservatoryDatabase(resolved.path)
    ctx.effect(() => () => {
      database.close()
    }, 'work-observatory: close database')

    this.human = new HumanActivityTracker(database, resolved.staleAfterMs)
    this.reader = new WorkObservatoryRangeReader(database)
    new AgentActivityTracker(ctx, database)

    ctx.effect(() => {
      const timer = setInterval(() => {
        try {
          this.human.sweepStale(Date.now())
        } catch (error) {
          ctx.logger.warn(`work observatory: stale sweep failed: ${String(error)}`)
        }
      }, resolved.sweepIntervalMs)
      timer.unref()
      return () => { clearInterval(timer) }
    }, 'work-observatory: stale sweep')
  }

  /**
   * Accept one browser snapshot using the Host receive clock.
   * @param input - browser state and monotonic producer sequence.
   * @returns whether this snapshot advanced persisted producer state.
   */
  @Remote('observeClient')
  observeClient(input: ClientObservation): ClientObservationAck {
    return this.human.observe(input, Date.now())
  }

  /**
   * Return normalized Human and Agent timelines and their shared summary algebra.
   * @param input - non-empty Host epoch range.
   * @returns normalized source timelines and derived metric durations.
   */
  @Remote('range')
  range(input: WorkObservatoryRangeRequest): WorkObservatoryRange {
    return this.reader.read(input, Date.now())
  }
}

export default WorkObservatoryGateway
