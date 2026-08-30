/** Package-owned invariant companion for `@deepseek-ai/dsh-delivery-local`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { canonicalJson } from '@deepseek-ai/dsh-delivery-protocol'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'

const PACKAGE_NAME = '@deepseek-ai/dsh-delivery-local'

/** Cordis companion plugin name. */
export const name = 'delivery-local-invariant'
/** Invariant registry required before package ownership can be reserved. */
export const inject = ['invariants']

/** Check every durable Delivery write against the synchronous service projection. */
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('domain/changed', (change: DomainChanged) => {
      if (change.domain !== 'personal_delivery') return
      if (change.operation === 'deleted') {
        return fail(`delivery-local immutable table '${change.table}' emitted a deletion`)
      }
      const value = change.value
      if (!isIdentifiedRecord(value)) {
        return fail(`delivery-local table '${change.table}' emitted a record without an id`)
      }
      const projection = project(ctx, change.table, value.id)
      if (projection === undefined || canonicalJson(projection) !== canonicalJson(value)) {
        return fail(
          `delivery-local table '${change.table}' committed '${value.id}' but the ctx.delivery projection differs`,
        )
      }
    })
  },
  { inject: ['delivery'] },
)

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

function isIdentifiedRecord(value: unknown): value is { readonly id: string } {
  return typeof value === 'object' && value !== null
    && typeof (value as { readonly id?: unknown }).id === 'string'
}

function project(ctx: Context, table: string, id: string): unknown {
  switch (table) {
    case 'contract_revisions': return ctx.delivery.getContractRevision(id as never)
    case 'work_packets': return ctx.delivery.getWorkPacket(id as never)
    case 'dispatch_bindings': return ctx.delivery.getDispatchBinding(id as never)
    case 'acceptance_decisions': return ctx.delivery.snapshot().acceptanceDecisions.find(value => value.id === id)
    case 'delivery_cases': return ctx.delivery.getCase(id as never)
    case 'requirement_decisions': return ctx.delivery.getRequirementDecision(id as never)
    case 'issue_publications': return ctx.delivery.getIssuePublication(id as never)
    default: return undefined
  }
}
