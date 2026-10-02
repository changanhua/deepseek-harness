import { z } from 'zod'
import { budgetRequestSchema, budgetScopeInputSchema, budgetUsageSchema } from '@changanhua/dsh-budget'

const scopeSchema = budgetScopeInputSchema.extend({ createdAt: z.number().int().nonnegative(), revoked: z.boolean() })
const reservationSchema = z.object({
  scopeId: z.string(), request: budgetRequestSchema,
  phase: z.enum(['reserved', 'dispatched', 'settled', 'released', 'unknown']),
  usage: budgetUsageSchema.nullable(), createdAt: z.number().int().nonnegative(),
  exceptionScopes: z.array(z.string()),
}).strict().superRefine((record, ctx) => {
  if ((record.phase === 'settled') !== (record.usage !== null)) {
    ctx.addIssue({ code: 'custom', message: 'settlement phase and usage disagree' })
  }
})

const totalsSchema = z.object({ requests: z.number().int().nonnegative(), inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(), totalTokens: z.number().int().nonnegative() }).strict()
const snapshotSchema = z.object({
  reference: z.object({ id: z.string(), version: z.literal('1'), digest: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
  scope: scopeSchema, consumed: totalsSchema, reserved: totalsSchema, unknownRequests: z.number().int().nonnegative(),
  deadline: z.number().int().nonnegative().nullable(), remainingMs: z.number().int().nonnegative().nullable(),
}).strict()
const decisionSchema = z.object({
  request: budgetRequestSchema, scopeId: z.string(), kind: z.enum(['allow', 'deny', 'pause', 'ask']),
  reason: z.string(), createdAt: z.number().int().nonnegative(),
  approval: z.enum(['pending', 'allowed-once', 'rejected', 'cancelled', 'unavailable']).nullable(),
  snapshots: z.array(snapshotSchema),
}).strict()

/** Complete atomic budget account; versioned persistence never guesses older or malformed state. */
export const budgetLedgerSchema = z.object({
  version: z.literal(1), scopes: z.array(scopeSchema), reservations: z.array(reservationSchema),
  decisions: z.array(decisionSchema),
  lastClock: z.number().int().nonnegative(),
}).strict().superRefine((state, ctx) => {
  const scopes = new Map(state.scopes.map(scope => [scope.id, scope]))
  const subjects = new Set(state.scopes.map(scope => JSON.stringify([scope.kind, scope.subjectId])))
  const requests = new Set(state.reservations.map(row => JSON.stringify([row.request.requestId, row.request.attemptId])))
  if (scopes.size !== state.scopes.length || subjects.size !== state.scopes.length || requests.size !== state.reservations.length) {
    ctx.addIssue({ code: 'custom', message: 'duplicate budget identity' })
  }
  for (const scope of state.scopes) {
    const visited = new Set<string>([scope.id])
    let parent = scope.parentId
    while (parent !== null) {
      const ancestor = scopes.get(parent)
      if (!ancestor || visited.has(parent)) {
        ctx.addIssue({ code: 'custom', message: 'invalid budget parent chain' })
        break
      }
      visited.add(parent)
      parent = ancestor.parentId
    }
  }
  if (state.reservations.some(row => !scopes.has(row.scopeId))) {
    ctx.addIssue({ code: 'custom', message: 'reservation has no owning scope' })
  }
  if (new Set(state.decisions.map(row => JSON.stringify([row.request.requestId, row.request.attemptId]))).size !== state.decisions.length) {
    ctx.addIssue({ code: 'custom', message: 'duplicate budget decision' })
  }
  for (const row of state.reservations) {
    const ancestors = new Set<string>()
    let current = scopes.get(row.scopeId)
    while (current && !ancestors.has(current.id)) { ancestors.add(current.id); current = scopes.get(current.parentId ?? '') }
    if (row.exceptionScopes.some(id => !ancestors.has(id) || scopes.get(id)?.onExhausted !== 'ask')
      || new Set(row.exceptionScopes).size !== row.exceptionScopes.length) {
      ctx.addIssue({ code: 'custom', message: 'invalid budget exception scope' })
    }
  }
})

/** Atomic scope and reservation snapshot. */
export type BudgetLedger = z.infer<typeof budgetLedgerSchema>

/** Create an empty, unprivileged account without writing storage. */
export function emptyLedger(): BudgetLedger {
  return { version: 1, scopes: [], reservations: [], decisions: [], lastClock: 0 }
}
