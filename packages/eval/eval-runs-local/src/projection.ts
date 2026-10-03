import { z } from 'zod'
import { evalContractDigest, resolvedExecutionManifestSchema } from '@changanhua/dsh-eval'
import type { EvalRunView, EvalCellView } from '@changanhua/dsh-eval-runs'
import type { WorkView } from '@changanhua/dsh-task-queue'
import type { LedgerState, RunRecord } from './ledger.ts'
import { validateBundle } from './evidence.ts'

const resultSchema = z.object({ cell: z.object({ status: z.enum(['completed', 'invalid']),
  outcome: z.enum(['passed', 'failed', 'invalid']), reason: z.string().nullable(),
  manifest: resolvedExecutionManifestSchema.nullable(), evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/u) }).strict() })

/** Derive one path-free snapshot from the existing Queue and private evidence owners. */
export function projectRun(run: RunRecord, state: LedgerState, works: readonly WorkView[], now: number): EvalRunView {
  const cells: EvalCellView[] = run.cells.map((cell) => {
    const work = works.find(row => row.work.id === cell.workId)
    const validWork = work?.work.kind === 'eval.cell@1' && evalContractDigest(work.work.resolved) === evalContractDigest({ eval: cell.binding })
    const parsed = resultSchema.safeParse(validWork ? work.result?.output : undefined)
    const output = parsed.success ? parsed.data : undefined
    const attemptId = work?.result?.attemptId ?? work?.attempts.at(-1)?.id
    let inconsistent = validWork && (work.state.status === 'succeeded' && !output || !!work.result && !output)
    let evidence: EvalCellView['evidence'] = work?.result ? 'missing' : 'none'
    const record = state.bundles.find(row => row.runId === run.runId && row.cellId === cell.id
      && row.attemptId === attemptId)
    if (record) {
      if (record.expiresAt <= now) evidence = 'expired'
      else {
        try {
          const bundle = validateBundle(record.bundle, { ...cell.binding, attemptId: record.attemptId, attempt: record.attempt },
            Number.MAX_SAFE_INTEGER, run.plan)
          if (output) {
            const final = bundle.materials.map(row => JSON.parse(row.content) as Record<string, unknown>).find(row => 'manifest' in row)
            if (bundle.digest !== output.cell.evidenceDigest
              || evalContractDigest(final?.manifest) !== evalContractDigest(output.cell.manifest)
              || output.cell.status === 'completed' && (!output.cell.manifest || output.cell.outcome === 'invalid')
              || output.cell.status === 'invalid' && output.cell.outcome !== 'invalid') inconsistent = true
          }
          evidence = 'intact'
        } catch { evidence = 'corrupt' }
      }
    }
    return { id: cell.id, caseId: cell.binding.caseId, routeId: cell.binding.routeId, repeatIndex: cell.binding.repeatIndex,
      workId: cell.workId, status: inconsistent ? 'inconsistent' : validWork ? work.state.status : cell.workId ? 'inconsistent' : 'submitting',
      attempts: validWork ? work.attempts.map(row => ({ id: String(row.id), ordinal: row.ordinal, status: row.status })) : [], evidence,
      outcome: inconsistent ? null : output?.cell.outcome ?? null,
      reason: inconsistent ? 'queue-result-inconsistent' : !validWork && cell.workId ? 'queue-binding-inconsistent' : output && evidence !== 'intact' ? `evidence-${evidence}`
        : work?.state.status === 'unknown' ? 'execution-uncertain' : output?.cell.status === 'invalid' ? 'execution-invalid' : null }
  })
  const attention = run.phase === 'needs-attention' || run.controls.some(row => row.phase === 'needs-attention')
    || cells.some(cell => ['unknown', 'inconsistent'].includes(cell.status) || !['none', 'intact'].includes(cell.evidence))
  const terminal = cells.length > 0 && cells.every(cell => ['succeeded', 'failed', 'canceled'].includes(cell.status))
  const canceled = terminal && cells.every(cell => cell.status === 'canceled')
  const phase: EvalRunView['phase'] = attention ? 'needs-attention' : run.phase !== 'bound' ? 'submitting' : canceled ? 'canceled'
    : terminal ? 'settled' : cells.some(cell => ['running', 'starting'].includes(cell.status)) ? 'running' : 'queued'
  const outcome: EvalRunView['outcome'] = !terminal || attention || canceled ? null : cells.some(cell => cell.outcome === 'invalid') ? 'invalid'
    : cells.every(cell => cell.status === 'succeeded' && cell.outcome === 'passed' && cell.evidence === 'intact') ? 'passed' : 'failed'
  const value = { id: run.runId, requestId: run.requestId, plan: run.plan, phase, outcome, cells,
    controls: run.controls.map(row => ({ operationId: row.operationId, actorId: row.actorId, action: row.action,
      phase: row.phase, reason: row.reason })) }
  return { ...value, revision: evalContractDigest(value) }
}
