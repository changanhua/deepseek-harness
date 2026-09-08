/** Durable memory identity and append-only content invariants. @module @changanhua/dsh-memory-local/invariant */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { canonicalMemoryJson, memoryRecordSchema } from '@changanhua/dsh-memory'
import type { MemoryRecord } from '@changanhua/dsh-memory'
import type {} from '@deepseek-ai/dsh-storage-domain'

/** Cordis companion identity. */
export const name = 'memory-local-invariant'
/** Registry required before installing the domain observer. */
export const inject = ['invariants']

/** Compare committed records with the previously observed immutable content prefix. */
const install: InvariantInstaller = (ctx, fail) => {
  const previous = new Map<string, MemoryRecord>()
  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'project_memory') return
    if (change.table !== 'memories' || change.operation !== 'put') return fail('memory domain cannot delete history or write another table')
    const parsed = memoryRecordSchema.safeParse(change.value)
    if (!parsed.success || parsed.data.id !== change.key) return fail('memory write has inconsistent content or record identity')
    const record = parsed.data
    const before = previous.get(record.id)
    if (before !== undefined) {
      if (record.workspaceId !== before.workspaceId || record.topicKey !== before.topicKey || record.recordVersion !== before.recordVersion + 1) return fail('memory write changed ownership or skipped a record version')
      if (canonicalMemoryJson(record.revisions.slice(0, before.revisions.length)) !== canonicalMemoryJson(before.revisions)) return fail('memory write replaced immutable claim content')
      if (canonicalMemoryJson(record.receipts.slice(0, before.receipts.length)) !== canonicalMemoryJson(before.receipts)) return fail('memory write replaced committed receipts')
      if (canonicalMemoryJson(record.decisions.slice(0, before.decisions.length)) !== canonicalMemoryJson(before.decisions)) return fail('memory write replaced human decisions')
    }
    previous.set(record.id, record)
  })
}

/** Register domain checks under this provider's package identity. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register('@changanhua/dsh-memory-local', install))
