import { z } from 'zod'
import type { EvalEvidenceView, EvalModelCall } from '@changanhua/dsh-eval-runs'
import type { EvidenceRecord, RunRecord } from './ledger.ts'
import { validateBundle } from './evidence.ts'

const text = z.string().min(1)
const identity = z.object({ id: text, digest: z.string().regex(/^[a-f0-9]{64}$/u) })
const usage = z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative() })
const observation = z.object({ executionId: text, sessionId: text, role: z.enum(['subject', 'grader']), verifiedCommit: text,
  buildDigest: text, profile: identity, elapsedMs: z.number().nonnegative(),
  actual: z.object({ preset: identity, tools: z.array(identity), skills: z.array(identity) }).nullable() })
const dispatch = z.object({ identity: z.object({ requestId: text, attemptId: text }), provider: text, model: text,
  dispatched: z.boolean(), reservation: z.object({
    phase: z.enum(['reserved', 'dispatched', 'settled', 'released', 'unknown']), usage: usage.nullable(),
  }).nullable() })
const execution = z.object({ protocol: z.object({ accounting: z.array(z.object({ evidence: z.array(dispatch) })) }) })

/**
 * Resolve an exact retained Attempt into safe facts; private paths, prompts and traces never cross this projection.
 * @param run Original admitted run and Plan identity.
 * @param cell Exact cell owned by the run.
 * @param attempt Real Queue Attempt, not a caller-asserted ordinal.
 * @param record Private retained material, if present.
 * @param now Current retention observation time.
 * @returns Availability and allowlisted facts only after whole-bundle verification.
 */
export function projectEvidence(run: RunRecord, cell: RunRecord['cells'][number], attempt: { id: string; ordinal: number },
  record: EvidenceRecord | undefined, now: number): EvalEvidenceView {
  const base = { runId: cell.binding.runId, cellId: cell.id, attemptId: attempt.id,
    bundle: record ? { id: record.bundle.id, digest: record.bundle.digest } : null,
    receivedAt: record?.receivedAt ?? null, expiresAt: record?.expiresAt ?? null, materials: [], roles: [] }
  if (!record) return { ...base, availability: 'missing' }
  if (record.expiresAt <= now) return { ...base, availability: 'expired' }
  try {
    const bundle = validateBundle(record.bundle, { ...cell.binding, attemptId: attempt.id, attempt: attempt.ordinal },
      Number.MAX_SAFE_INTEGER, run.plan)
    const roles: EvalEvidenceView['roles'][number][] = []
    for (const material of bundle.materials) {
      if (material.kind !== 'observer') continue
      const observed = z.object({ observation }).parse(JSON.parse(material.content)).observation
      if (observed.executionId !== material.executionId || observed.role !== material.role
        || roles.some(row => row.role === observed.role)) throw new Error('observer binding')
      const executions = bundle.materials.filter(row => row.kind === 'execution' && row.executionId === observed.executionId)
      const calls: EvalModelCall[] = []
      for (const item of executions) {
        const body: unknown = JSON.parse(item.content)
        if (body && typeof body === 'object' && 'manifest' in body) continue
        for (const call of execution.parse(body).protocol.accounting.flatMap(row => row.evidence)) {
          calls.push({ ...call.identity, provider: call.provider, model: call.model, dispatched: call.dispatched,
            phase: call.reservation?.phase ?? (call.dispatched ? 'unknown' : 'denied'), usage: call.reservation?.usage ?? null })
        }
      }
      roles.push({ role: observed.role, executionId: observed.executionId, sessionId: observed.sessionId,
        verifiedCommit: observed.verifiedCommit, buildDigest: observed.buildDigest, profile: observed.profile,
        elapsedMs: observed.elapsedMs, preset: observed.actual?.preset ?? null,
        tools: observed.actual?.tools ?? [], skills: observed.actual?.skills ?? [], calls })
    }
    return { ...base, availability: 'intact', roles, materials: bundle.materials.map(row => ({
      reference: { id: row.reference.id, digest: row.reference.digest }, kind: row.kind, role: row.role,
      executionId: row.executionId, bytes: Buffer.byteLength(row.content),
    })) }
  } catch { return { ...base, availability: 'corrupt' } }
}
