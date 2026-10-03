import { z } from 'zod'
import type { IsolatedEvalConfig } from '@changanhua/dsh-eval-isolated'
import type { LedgerLimits } from './ledger.ts'

/** Host-owned policy. Wire callers may select only its id, never replace execution configuration. */
export interface RunPolicy {
  /** Approved execution policy identifier selected by Consumers. */
  readonly id: string
  /** Registered Workspace bound to this execution policy. */
  readonly workspaceId: string
  /** Pinned isolated executor configuration; wire callers cannot replace it. */
  readonly execution: Omit<IsolatedEvalConfig, 'receive'> }
/** Explicit deployment limits and approved execution policies. */
export interface Config extends LedgerLimits {
  /** Maximum cells admitted by one run. */
  readonly maxCells: number
  /** Maximum prepared cell work submitted together. */
  readonly maxParallel: number
  /** Maximum bytes in a complete safe response. */
  readonly maxResponseBytes: number
  /** Milliseconds for which retained evidence may authorize a fresh decision. */
  readonly retentionMs: number
  /** Existing Queue resource name charged by each cell. */
  readonly resource: string
  /** Complete Host-approved execution policies; callers select only an id. */
  readonly policies: RunPolicy[]
}
export const startSchema = z.object({ requestId: z.string().min(1).max(256),
  plan: z.object({ id: z.string().min(1).max(256), version: z.string().min(1).max(256) }).strict(),
  policyId: z.string().min(1).max(256) }).strict()
const common = { runId: z.string().min(1).max(256), operationId: z.string().min(1).max(256),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u) }
export const controlSchema = z.discriminatedUnion('action', [
  z.object({ ...common, action: z.literal('cancel') }).strict(),
  z.object({ ...common, action: z.literal('retry'), cellId: z.string().regex(/^[a-f0-9]{64}$/u) }).strict(),
  z.object({ ...common, action: z.literal('resolve-unknown'), cellId: z.string().regex(/^[a-f0-9]{64}$/u),
    resolution: z.enum(['confirm-failed', 'authorize-retry']), evidence: z.string().trim().min(1).max(4096) }).strict(),
])
