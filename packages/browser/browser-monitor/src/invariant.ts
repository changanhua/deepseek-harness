import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { MonitorRecordSchema } from './schemas.ts'

export const name = 'browser-monitor-invariant'
export const inject = ['invariants']

/** Every committed notification must retain the definition's owner and unique durable id. */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'browser_monitors' || change.operation !== 'put') return
    const parsed = MonitorRecordSchema.safeParse(change.value)
    if (!parsed.success || change.table !== 'monitors' || change.key !== parsed.data.id) {
      fail('browser monitor commit does not match its domain key and record contract')
      return
    }
    const record = parsed.data
    const ids = new Set<string>()
    for (const notice of record.outbox) {
      if (notice.monitorId !== record.id || notice.installationId !== record.installationId
        || notice.sessionId !== record.sessionId || ids.has(notice.id)) {
        fail('browser monitor notification changed owner or reused a durable id')
        return
      }
      ids.add(notice.id)
    }
  }, { global: true })
}

/** Reserve this package's companion for the current fiber lifetime. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@changanhua/dsh-browser-monitor', install))
