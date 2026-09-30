/** Versioned persisted data and deterministic projections. No domain payloads or evidence bytes. */
import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { brandString } from '@deepseek-ai/dsh-brand'
import { canonicalDigest } from '@changanhua/dsh-delivery-protocol'
import type { Config, SafetyActionId, SafetyApprovalId, SafetyExecutionId, SafetyLeaseId, SafetyExecution, SafetyApproval, RiskCost, SafetySnapshot } from './types.ts'

const text = z.string().min(1).max(256)
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const timestamp = count.positive()
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u)
const dimensions = z.record(text, count)
export const targetSchema = z.object({ kind: text, id: text }).strict()
export const evidenceSchema = z.object({ uri: z.string().min(1).max(2048), digest }).strict()
export const costSchema = z.object({
  actions: count.positive(), externalWrites: count, resourceSpend: count, domainUnits: dimensions,
}).strict()
export const budgetSchema = z.object({
  maxActions: count, maxExternalWrites: count, maxResourceSpend: count,
  maxUnknownActions: count, maxConsecutiveFailures: count, maxRuntimeMs: count.positive(), domainLimits: dimensions,
}).strict()
export const draftSchema = z.object({
  domain: text, subjectRef: targetSchema, scopeDigest: digest, policyDigest: digest,
  startsAt: timestamp, expiresAt: timestamp, budget: budgetSchema,
}).strict().refine(v => v.expiresAt > v.startsAt, 'approval window must be positive')
export const proofSchema = z.object({
  kind: z.literal('human'), actorId: text, draftDigest: digest, evidenceRefs: z.array(evidenceSchema).min(1),
}).strict()
export const approvalSchema = z.object({
  ...draftSchema.shape,
  id: text.transform(v => brandString<SafetyApprovalId>(v)),
  createdAt: timestamp, approvedBy: proofSchema, revoked: z.boolean(),
}).strict()
export const actionSchema = z.object({
  id: text.transform(v => brandString<SafetyActionId>(v)), idempotencyKey: text,
  executionId: text.transform(v => brandString<SafetyExecutionId>(v)), domain: text, kind: text,
  targetRef: targetSchema, parametersDigest: digest, requestDigest: digest,
  approvalArtifactId: text.transform(v => brandString<SafetyApprovalId>(v)), riskCost: costSchema,
  phase: z.enum(['PREPARED', 'SENT', 'UNKNOWN', 'RECONCILING', 'CONFIRMED', 'NOT_APPLIED', 'CANCELLED']),
  preparedAt: timestamp, sentAt: timestamp.nullable(), sentRevision: count.positive().nullable(), settledAt: timestamp.nullable(),
  evidenceRefs: z.array(evidenceSchema),
}).strict()
const leaseSchema = z.object({
  id: text.transform(v => brandString<SafetyLeaseId>(v)), owner: text,
  executionId: text.transform(v => brandString<SafetyExecutionId>(v)),
  approvalArtifactId: text.transform(v => brandString<SafetyApprovalId>(v)),
  targetRef: targetSchema, acquiredAt: timestamp, expiresAt: timestamp, released: z.boolean(),
}).strict()
export const executionSchema = z.object({
  id: text.transform(v => brandString<SafetyExecutionId>(v)), idempotencyKey: text, requestDigest: digest,
  approvalArtifactId: text.transform(v => brandString<SafetyApprovalId>(v)), domain: text,
  targetRef: targetSchema, revision: count, createdAt: timestamp,
  control: z.enum(['active', 'paused', 'aborted', 'completed']),
  hardBlock: text.nullable(), lease: leaseSchema.nullable(), actions: z.array(actionSchema),
}).strict()
export const stateSchema = z.object({ approvals: z.array(approvalSchema), executions: z.array(executionSchema) }).strict()
export const settlementSchema = z.object({
  outcome: z.enum(['CONFIRMED', 'NOT_APPLIED', 'UNKNOWN']), evidenceRefs: z.array(evidenceSchema),
}).strict().refine(v => v.outcome === 'UNKNOWN' || v.evidenceRefs.length > 0, 'terminal settlement requires evidence')
export const intentInputSchema = z.object({ idempotencyKey: text, kind: text, targetRef: targetSchema, riskCost: costSchema }).strict()
export type DurableState = z.infer<typeof stateSchema>
export const safetyDomain = defineDomain({
  name: 'side_effect_safety', version: 1,
  global: { schema: stateSchema, initial: { approvals: [], executions: [] } }, tables: {},
})
export class SafetyError extends Error {
  constructor(readonly code: string) { super(`side-effect-safety: ${code}`) }
}
export function fail(code: string): never { throw new SafetyError(code) }
export const same = (a: unknown, b: unknown): boolean => canonicalDigest(a) === canonicalDigest(b)
export function approvalDraft(a: SafetyApproval) {
  return { domain: a.domain, subjectRef: a.subjectRef, scopeDigest: a.scopeDigest, policyDigest: a.policyDigest,
    startsAt: a.startsAt, expiresAt: a.expiresAt, budget: a.budget }
}
export function intentDigest(a: z.infer<typeof actionSchema>): string {
  return canonicalDigest({ kind: a.kind, targetRef: a.targetRef, parametersDigest: a.parametersDigest, riskCost: a.riskCost })
}
export function spent(e: SafetyExecution): RiskCost {
  const result = { actions: 0, externalWrites: 0, resourceSpend: 0, domainUnits: Object.create(null) as Record<string, number> }
  for (const a of e.actions) {
    if (a.sentAt === null) continue
    for (const key of ['actions', 'externalWrites', 'resourceSpend'] as const) result[key] += a.riskCost[key]
    for (const [key, value] of Object.entries(a.riskCost.domainUnits)) result.domainUnits[key] = (result.domainUnits[key] ?? 0) + value
  }
  return result
}
export function budgetAllows(e: SafetyExecution, approval: SafetyApproval, cost: RiskCost): boolean {
  const used = spent(e), b = approval.budget
  return used.actions + cost.actions <= b.maxActions && used.externalWrites + cost.externalWrites <= b.maxExternalWrites
    && used.resourceSpend + cost.resourceSpend <= b.maxResourceSpend
    && Object.entries(cost.domainUnits).every(([key, value]) => {
      const limit = b.domainLimits[key]
      return Object.hasOwn(b.domainLimits, key) && limit !== undefined && (used.domainUnits[key] ?? 0) + value <= limit
    })
}
export function projection(e: SafetyExecution, a: SafetyApproval, now: number, owner: string): SafetySnapshot {
  const used = spent(e)
  const unresolved = e.actions.filter(v => ['SENT', 'UNKNOWN', 'RECONCILING'].includes(v.phase)).map(v => v.id)
  const reasons: string[] = []
  let failures = 0
  const sendOrder = e.actions.flatMap(action => action.sentRevision === null ? [] : [{ action, revision: action.sentRevision }])
  for (const { action } of sendOrder.sort((left, right) => right.revision - left.revision)) {
    if (action.phase === 'CONFIRMED') break
    if (action.phase === 'NOT_APPLIED') failures++
  }
  if (e.hardBlock) reasons.push(e.hardBlock)
  if (a.revoked || now < a.startsAt || now >= a.expiresAt) reasons.push('approval-invalid')
  if (now - e.createdAt >= a.budget.maxRuntimeMs) reasons.push('runtime-budget')
  if (used.actions >= a.budget.maxActions || used.externalWrites > a.budget.maxExternalWrites
    || used.resourceSpend > a.budget.maxResourceSpend || failures >= a.budget.maxConsecutiveFailures && failures > 0) reasons.push('budget-exhausted')
  if (unresolved.length) reasons.push('unresolved-action')
  if (unresolved.length > a.budget.maxUnknownActions) reasons.push('unknown-budget')
  const blocked = reasons.length > 0
  const paused = e.control === 'paused' || e.control === 'aborted' || e.lease === null || e.lease.released
    || e.lease.expiresAt <= now || e.lease.owner !== owner
  const breaker = unresolved.length ? 'RECONCILING' : e.control === 'completed' ? 'COMPLETED'
    : blocked ? 'BLOCKED' : paused ? 'PAUSED' : e.actions.length ? 'RUNNING' : 'READY'
  if (paused && !unresolved.length && e.control !== 'completed') reasons.push('paused-or-lease-invalid')
  return { execution: structuredClone(e), breaker, reasons, spent: used, unresolved }
}
/** Validate all retained data and relationships before publication and on reopen. */
export function validateState(state: DurableState, limits: Config): void {
  stateSchema.parse(state)
  if (state.approvals.length > limits.maxApprovals || state.executions.length > limits.maxExecutions
    || Buffer.byteLength(JSON.stringify(state)) > limits.maxTotalBytes) fail('storage-limit')
  const approvals = new Map(state.approvals.map(a => [a.id, a]))
  if (approvals.size !== state.approvals.length || new Set(state.executions.map(e => e.id)).size !== state.executions.length
    || new Set(state.executions.map(e => e.idempotencyKey)).size !== state.executions.length
    || new Set(state.executions.map(e => e.approvalArtifactId)).size !== state.executions.length) fail('ledger-inconsistent')
  for (const a of state.approvals) {
    if (a.expiresAt <= a.startsAt || a.approvedBy.draftDigest !== canonicalDigest(approvalDraft(a))) fail('ledger-inconsistent')
    if (a.approvedBy.evidenceRefs.length > limits.maxEvidenceRefs) fail('storage-limit')
    checkRecord(a, limits)
  }
  for (const e of state.executions) {
    const a = approvals.get(e.approvalArtifactId)
    if (!a || e.domain !== a.domain || !same(e.targetRef, a.subjectRef)
      || e.requestDigest !== canonicalDigest({ approvalId: e.approvalArtifactId })
      || new Set(e.actions.map(v => v.id)).size !== e.actions.length
      || new Set(e.actions.map(v => v.idempotencyKey)).size !== e.actions.length) fail('ledger-inconsistent')
    if (e.actions.length > limits.maxActionsPerExecution) fail('storage-limit')
    if (e.lease && (e.lease.executionId !== e.id || e.lease.approvalArtifactId !== a.id
      || !same(e.lease.targetRef, e.targetRef) || e.lease.expiresAt <= e.lease.acquiredAt
      || e.lease.acquiredAt < a.startsAt || e.lease.expiresAt > a.expiresAt)) fail('ledger-inconsistent')
    for (const action of e.actions) {
      if (action.executionId !== e.id || action.approvalArtifactId !== a.id || action.domain !== a.domain
        || !same(action.targetRef, e.targetRef) || action.requestDigest !== intentDigest(action)
        || (['PREPARED', 'CANCELLED'].includes(action.phase) !== (action.sentAt === null))
        || (action.sentAt === null) !== (action.sentRevision === null)
        || action.sentRevision !== null && action.sentRevision > e.revision
        || (['CONFIRMED', 'NOT_APPLIED'].includes(action.phase) && (!action.evidenceRefs.length || action.settledAt === null))) fail('ledger-inconsistent')
      if (action.evidenceRefs.length > limits.maxEvidenceRefs) fail('storage-limit')
    }
    const sendRevisions = e.actions.flatMap(action => action.sentRevision === null ? [] : [action.sentRevision])
    if (new Set(sendRevisions).size !== sendRevisions.length) fail('ledger-inconsistent')
    const used = spent(e)
    const amounts = [used.actions, used.externalWrites, used.resourceSpend, ...Object.values(used.domainUnits)]
    if (amounts.some(value => !Number.isSafeInteger(value) || value < 0)
      || used.actions > a.budget.maxActions || used.externalWrites > a.budget.maxExternalWrites
      || used.resourceSpend > a.budget.maxResourceSpend
      || Object.entries(used.domainUnits).some(([key, value]) => !Object.hasOwn(a.budget.domainLimits, key)
        || value > (a.budget.domainLimits[key] ?? -1))
      || e.control === 'completed' && (!e.actions.length || e.hardBlock !== null
        || e.actions.some(action => !['CONFIRMED', 'NOT_APPLIED'].includes(action.phase)))) fail('ledger-inconsistent')
    checkRecord(e, limits)
  }
}
function checkRecord(value: unknown, limits: Config): void {
  if (Buffer.byteLength(JSON.stringify(value)) > limits.maxRecordBytes) fail('storage-limit')
}
