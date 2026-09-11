import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { ActivityRecordSchema } from './schemas.ts'

export const name = 'browser-activity-invariant'
export const inject = ['invariants']

const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'browser_activity' || change.operation !== 'put') return
    const parsed = ActivityRecordSchema.safeParse(change.value)
    if (!parsed.success || change.table !== 'installations' || change.key !== parsed.data.installationId) {
      fail('browser activity commit does not match its installation key and record contract')
      return
    }
    const record = parsed.data
    if (record.events.length > record.policy.maxEvents || Buffer.byteLength(JSON.stringify(record), 'utf8') > 4 * 1024 * 1024
      || new Set(record.events.map(event => event.id)).size !== record.events.length) {
      fail('browser activity exceeded its retention capacity or reused an event identity')
    }
  }, { global: true })
}

/** Reserve the activity companion for this fiber lifetime. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@changanhua/dsh-browser-activity', install))
