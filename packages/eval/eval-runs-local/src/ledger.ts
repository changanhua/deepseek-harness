import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { EvalRunError } from '@changanhua/dsh-eval-runs'
import { bundleSchema } from './evidence.ts'

const id = z.string().min(1).max(256)
const hash = z.string().regex(/^[a-f0-9]{64}$/u)
const reference = z.object({ id, version: id, digest: hash }).strict()
export const cellBindingSchema = z.object({ runId: id, resolvedDigest: hash, corePolicyDigest: hash, graderPolicyDigest: hash,
  caseId: id, routeId: id, repeatIndex: z.number().int().nonnegative() }).strict()
const queueStatus = z.enum(['queued', 'starting', 'running', 'unknown', 'succeeded', 'failed', 'canceled'])
const targetSchema = z.object({ workId: id, status: queueStatus, attemptCount: z.number().int().nonnegative(),
  activeAttemptId: id.nullable() }).strict()
const controlSchema = z.object({ operationId: id, actorId: id, intentDigest: hash,
  action: z.enum(['cancel', 'retry', 'resolve-unknown']), cellId: id.nullable(),
  resolution: z.enum(['confirm-failed', 'authorize-retry']).nullable(), evidence: z.string().max(4096).nullable(),
  phase: z.enum(['pending', 'applied', 'needs-attention']), reason: id.nullable(),
  targets: z.array(targetSchema), appliedWorkIds: z.array(id), createdAt: z.number().int().nonnegative() }).strict()
const runSchema = z.object({ key: hash, workspaceId: id, requestId: id, actorId: id, entrypoint: z.enum(['web', 'cli', 'ci']),
  policyId: id, policyDigest: hash, plan: reference, runId: id.nullable(),
  phase: z.enum(['admitting', 'submitting', 'bound', 'needs-attention']), reason: id.nullable(), batchId: id.nullable(),
  cells: z.array(z.object({ id: hash, binding: cellBindingSchema, workId: id.nullable() }).strict()),
  controls: z.array(controlSchema), createdAt: z.number().int().nonnegative() }).strict()
const evidenceSchema = z.object({ runId: id, cellId: hash, attemptId: id, attempt: z.number().int().positive(),
  receivedAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive(), bundle: bundleSchema }).strict()
const ledgerSchema = z.object({ version: z.literal(1), runs: z.array(runSchema), bundles: z.array(evidenceSchema) }).strict()
const spec = defineDomain({ name: 'eval_runs', version: 1, layout: 'single',
  requires: ['single-writer', 'commit-sync', 'private-root'] as const,
  global: { schema: ledgerSchema, initial: { version: 1 as const, runs: [], bundles: [] } }, tables: {} })
export type RunRecord = z.infer<typeof runSchema>
export type ControlRecord = z.infer<typeof controlSchema>
export type EvidenceRecord = z.infer<typeof evidenceSchema>
export type LedgerState = z.infer<typeof ledgerSchema>
export interface LedgerLimits {
  /** Maximum retained coordination records. */
  readonly maxRuns: number
  /** Maximum encoded bytes of the complete retained ledger. */
  readonly maxLedgerBytes: number
  /** Maximum acknowledged private evidence bundles. */
  readonly maxBundles: number
  /** Maximum control intents retained for one run. */
  readonly maxControls: number
}

/** Eval coordination and private evidence commit together; Queue Attempt state is never copied into a second lifecycle store. */
export class RunLedger {
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  private closing = false
  private faulted = false
  private constructor(private readonly domain: Domain<typeof spec>, private readonly limits: LedgerLimits) {}
  /**
   * Open an existing Storage Domain with required durability and confidentiality guarantees.
   * @param ctx Composed Storage Domain owner.
   * @param limits Complete ledger capacity, including wrappers and private material bodies.
   * @returns A caller-owned ledger whose close must follow execution quiescence.
   */
  static async open(ctx: Context, limits: LedgerLimits): Promise<RunLedger> {
    for (const value of [limits.maxRuns, limits.maxLedgerBytes, limits.maxBundles, limits.maxControls]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new EvalRunError('capacity')
    }
    return new RunLedger(await ctx.storageDomain.open(spec), { ...limits })
  }
  /** Return an owned private snapshot; callers cannot mutate the authoritative in-memory record. */
  read(): LedgerState {
    if (this.closed || this.faulted) throw new EvalRunError('unavailable')
    return structuredClone(this.domain.global.get())
  }
  /**
   * Serialize a synchronous domain mutation and publish only after durable commit.
   * @param update Mutate an owned draft; external side effects must run outside this callback.
   * @returns Callback result after commit. Any persistence ambiguity faults this owner until reopen.
   */
  change<T>(update: (draft: LedgerState) => T): Promise<T> {
    if (this.closing) return Promise.reject(new EvalRunError('unavailable'))
    const operation = this.tail.then(async () => {
      const before = this.read(), draft = structuredClone(before)
      const result = update(draft)
      const next = ledgerSchema.parse(draft)
      if (next.runs.length > this.limits.maxRuns || next.bundles.length > this.limits.maxBundles
        || next.runs.some(run => run.controls.length > this.limits.maxControls)
        || Buffer.byteLength(JSON.stringify(next)) > this.limits.maxLedgerBytes) throw new EvalRunError('capacity')
      if (JSON.stringify(next) !== JSON.stringify(before)) {
        try { await this.domain.global.set(next) }
        catch { this.faulted = true; throw new EvalRunError('unavailable') }
      }
      return result
    })
    this.tail = operation.then(() => {}, () => {})
    return operation
  }
  /** Stop admission, drain current writes, and release the existing Storage Domain handle. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closing = true
    await this.tail
    this.closed = true
    await this.domain.close()
  }
}
