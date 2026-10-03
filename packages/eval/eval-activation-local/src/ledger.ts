import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { EvalActivationError } from '@changanhua/dsh-eval-activation'

const text = z.string().min(1).max(4096)
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
const record = z.object({ id: text, key: digest, grantId: text, actorId: text, workspaceId: text, sessionId: text,
  goalId: text, goalRevision: z.number().int().positive(), decisionDigest: digest, gateId: text, budgetRef: z.object({ id: text, version: z.literal('1'), digest }).strict(),
  expiresAt: z.number().int().nonnegative(), workId: text, attemptId: text, terminalDigest: digest,
  followup: z.string().min(1).max(16384), messageId: text.nullable(), round: z.number().int().positive().nullable(),
  phase: z.enum(['pending', 'resuming', 'followup-pending', 'consumed', 'blocked', 'needs-attention']), reason: text.nullable(),
  createdAt: z.number().int().nonnegative() }).strict()
const schema = z.object({ version: z.literal(1), records: z.array(record) }).strict()
const spec = defineDomain({ name: 'eval_activation', version: 1, layout: 'single',
  requires: ['single-writer', 'commit-sync', 'private-root'] as const,
  global: { schema, initial: { version: 1 as const, records: [] } }, tables: {} })
export type ActivationRecord = z.infer<typeof record>
export type ActivationLedgerState = z.infer<typeof schema>

export class ActivationLedger {
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  private faulted = false
  private constructor(private readonly domain: Domain<typeof spec>, private readonly maxRecords: number,
    private readonly maxBytes: number) {}
  static async open(ctx: Context, limits: { readonly maxRecords: number; readonly maxLedgerBytes: number }): Promise<ActivationLedger> {
    for (const value of [limits.maxRecords, limits.maxLedgerBytes]) if (!Number.isSafeInteger(value) || value < 1) throw new EvalActivationError('blocked')
    return new ActivationLedger(await ctx.storageDomain.open(spec), limits.maxRecords, limits.maxLedgerBytes)
  }
  read(): ActivationLedgerState {
    if (this.closed || this.faulted) throw new EvalActivationError('unavailable')
    return structuredClone(this.domain.global.get())
  }
  change<T>(update: (draft: ActivationLedgerState) => T): Promise<T> {
    const current = this.tail.then(async () => {
      const before = this.read(), draft = structuredClone(before), result = update(draft), next = schema.parse(draft)
      if (next.records.length > this.maxRecords || Buffer.byteLength(JSON.stringify(next)) > this.maxBytes) throw new EvalActivationError('blocked')
      if (JSON.stringify(before) !== JSON.stringify(next)) {
        try { await this.domain.global.set(next) }
        catch (error) { this.faulted = true; throw error }
      }
      return result
    })
    this.tail = current.then(() => {}, () => {})
    return current
  }
  async close(): Promise<void> { if (!this.closed) { await this.tail; this.closed = true; await this.domain.close() } }
}
