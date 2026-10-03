import type { Context } from '@deepseek-ai/cordis'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { EvalGateError } from '@changanhua/dsh-eval-gates'

const hash = z.string().regex(/^[a-f0-9]{64}$/u)
const record = z.object({ id: z.string().min(1), runId: z.string().min(1), workspaceId: z.string().min(1), policyId: z.string().min(1),
  policyDigest: hash, snapshotRevision: hash, createdAt: z.number().int().nonnegative(),
  /** Retain the exact Host snapshot and verifier material, not only references. */
  snapshot: z.unknown(), policy: z.unknown(), verifierInput: z.unknown().nullable(), verifier: z.unknown().nullable(),
  manifests: z.array(z.unknown()), decision: z.unknown() }).strict()
const stateSchema = z.object({ version: z.literal(1), records: z.array(record) }).strict()
const spec = defineDomain({ name: 'eval_gates', version: 1, layout: 'single', requires: ['single-writer', 'commit-sync', 'private-root'] as const,
  global: { schema: stateSchema, initial: { version: 1 as const, records: [] } }, tables: {} })
export type GateRecord = z.infer<typeof record>

/** Private durable decision owner. Gate records are append-only by idempotency key. */
export class GateLedger {
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  private faulted = false
  private constructor(private readonly domain: Domain<typeof spec>, private readonly maxRecords: number,
    private readonly maxBytes: number) {}
  static async open(ctx: Context, maxRecords: number, maxBytes: number): Promise<GateLedger> {
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new EvalGateError('blocked')
    return new GateLedger(await ctx.storageDomain.open(spec), maxRecords, maxBytes)
  }
  read(): GateRecord[] { if (this.closed || this.faulted) throw new EvalGateError('unavailable'); return structuredClone(this.domain.global.get().records) }
  change<T>(update: (records: GateRecord[]) => T): Promise<T> {
    const next = this.tail.then(async () => {
      if (this.closed) throw new EvalGateError('unavailable')
      const before = this.read(), draft = structuredClone(before), value = update(draft)
      if (draft.length > this.maxRecords || Buffer.byteLength(JSON.stringify({ version: 1, records: draft })) > this.maxBytes) throw new EvalGateError('blocked')
      if (JSON.stringify(before) !== JSON.stringify(draft)) {
        try { await this.domain.global.set(stateSchema.parse({ version: 1, records: draft })) }
        catch (error) { this.faulted = true; throw error }
      }
      return value
    })
    this.tail = next.then(() => {}, () => {})
    return next
  }
  async close(): Promise<void> { if (!this.closed) { await this.tail; this.closed = true; await this.domain.close() } }
}
