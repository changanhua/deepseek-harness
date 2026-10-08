import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { GateCellIdentity, GateVerifierCell, GateVerifierInput, GateVerifierReport } from '@changanhua/dsh-eval-gates'

function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function key(value: GateCellIdentity): string { return JSON.stringify([value.caseId, value.routeId, value.repeatIndex]) }
const hash = z.string().regex(/^[a-f0-9]{64}$/u)
const commit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u)
const ref = z.object({ id: z.string().min(1), version: z.string().min(1), digest: hash }).strict()
const cell = z.object({ caseId: z.string().min(1), routeId: z.string().min(1), repeatIndex: z.number().int().nonnegative() }).strict()
const inputSchema = z.object({ kind: z.literal('eval-verifier-input'), schemaVersion: z.literal(1), snapshotRevision: hash,
  plan: ref.extend({ expectedCommit: commit, baseline: z.literal('none') }).strict(),
  suite: ref.extend({ sourceRevision: commit }).strict(), verifierPlan: ref,
  expectedCells: z.array(cell).min(1),
  cases: z.array(z.object({ id: z.string().min(1), requiresGrader: z.boolean(),
    criteria: z.array(z.object({ kind: z.enum(['output-equals', 'output-contains']), text: z.string() }).strict()).min(1) }).strict()).min(1),
  cells: z.array(cell.extend({ manifestDigest: hash, subjectOutput: z.string(), graderOutput: z.enum(['PASS', 'FAIL']).nullable(),
    integrity: z.literal('intact'), budget: z.enum(['settled', 'not-required']) }).strict()),
}).strict()
function invalid(input: unknown): GateVerifierReport {
  return { kind: 'eval-verifier-report', schemaVersion: 1, snapshotRevision: '', inputDigest: digest(input), outcome: 'unknown', reason: 'invalid-input',
    cells: [], runtime: { sessionId: 'unbound', profile: 'unbound', configDigest: digest({ kind: 'invalid-input' }) } }
}

function evaluate(cell: GateVerifierCell, input: GateVerifierInput): GateVerifierReport['cells'][number] {
  const definition = input.cases.find(item => item.id === cell.caseId)
  if (!definition) return { caseId: cell.caseId, routeId: cell.routeId, repeatIndex: cell.repeatIndex, outcome: 'unknown', reason: 'invalid-input' }
  const criteria = definition.criteria.every(item => item.kind === 'output-equals' ? cell.subjectOutput === item.text : cell.subjectOutput.includes(item.text))
  if (!criteria || definition.requiresGrader && cell.graderOutput !== 'PASS') return { caseId: cell.caseId, routeId: cell.routeId, repeatIndex: cell.repeatIndex, outcome: 'rejected', reason: 'criteria-failed' }
  return { caseId: cell.caseId, routeId: cell.routeId, repeatIndex: cell.repeatIndex, outcome: 'approved', reason: 'criteria-satisfied' }
}

/**
 * Evaluate the Host-normalized snapshot without loading task code or calling a model.
 * @param input Read-only JSON provided by the Host-owned verifier process wrapper.
 * @returns A bounded deterministic verdict whose caller must still authenticate process provenance.
 */
export function verifySnapshot(input: unknown): GateVerifierReport {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return invalid(input)
  const value = parsed.data, expected = new Set(value.expectedCells.map(key))
  if (value.plan.expectedCommit !== value.suite.sourceRevision || expected.size !== value.expectedCells.length
    || new Set(value.cases.map(item => item.id)).size !== value.cases.length
    || value.cells.length !== expected.size || new Set(value.cells.map(key)).size !== value.cells.length
    || value.cells.some(cell => !expected.has(key(cell)))) return invalid(input)
  const cells = value.cells.map(cell => evaluate(cell, value))
  const rejected = cells.some(cell => cell.outcome === 'rejected')
  const unknown = cells.some(cell => cell.outcome === 'unknown')
  return { kind: 'eval-verifier-report', schemaVersion: 1, snapshotRevision: value.snapshotRevision, inputDigest: digest(input),
    outcome: unknown ? 'unknown' : rejected ? 'rejected' : 'approved', reason: unknown ? 'invalid-input' : rejected ? 'criteria-failed' : 'criteria-satisfied',
    cells, runtime: { sessionId: 'unbound', profile: 'unbound', configDigest: digest({ kind: 'unbound' }) } }
}
