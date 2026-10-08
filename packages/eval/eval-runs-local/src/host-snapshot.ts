import { z } from 'zod'
import { evalContractDigest, parseResolvedExecutionManifest } from '@changanhua/dsh-eval'
import type { RecoveredEvalPlan } from '@changanhua/dsh-eval-plans'
import type { GateSnapshot, GateCellSnapshot, GateBudgetReceipt } from '@changanhua/dsh-eval-gates'
import type Budget from '@changanhua/dsh-budget'
import type { WorkView } from '@changanhua/dsh-task-queue'
import type { RunRecord, LedgerState } from './ledger.ts'
import { validateBundle } from './evidence.ts'

const id = z.string().min(1)
const receipt = z.object({ identity: z.object({ requestId: id, attemptId: id }), provider: id, model: id, dispatched: z.boolean(),
  reservation: z.object({ scopeId: id, request: z.object({ inputDigest: id }) }).nullable() })
const protocol = z.object({ protocol: z.object({ accounting: z.array(z.object({ evidence: z.array(receipt) })) }) })
const output = z.object({ cell: z.object({ status: z.enum(['completed', 'invalid']), outcome: z.enum(['passed', 'failed', 'invalid']),
  reason: z.string().nullable(), manifest: z.unknown(), evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/u) }).strict() })

/**
 * Capture original retained facts for a trusted verifier. This function does not authenticate a wire caller.
 * @param run Original coordination record owned by the receiving Host.
 * @param recovered Original Plan/Suite admission from the Plan owner.
 * @param state Original private materials from the committed ledger.
 * @param works Actual current Queue Work/Attempt views.
 * @param budget Existing Budget owner, if available; missing or mismatched receipts remain unknown.
 * @param now Retention observation time, excluded from the fact revision.
 * @returns Host-private snapshot; public Consumers must receive the safe view instead.
 */
export function captureHostSnapshot(run: RunRecord, recovered: RecoveredEvalPlan, state: LedgerState,
  works: readonly WorkView[], budget: Budget | undefined, now: number): GateSnapshot {
  const expectedCells = recovered.resolved.plan.routes.flatMap(route => recovered.resolved.suite.cases.flatMap(evalCase =>
    Array.from({ length: recovered.resolved.plan.repeatPolicy.count }, (_, repeatIndex) => ({
      caseId: evalCase.id, routeId: route.id, repeatIndex,
    }))))
  const cells: GateCellSnapshot[] = run.cells.map((cell) => {
    const work = works.find(row => row.work.id === cell.workId)
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- stored kinds can originate outside this compiler graph.
    const valid = work && work.work.kind === 'eval.cell@1'
      && work.work.batchId === run.batchId && evalContractDigest(work.work.resolved) === evalContractDigest({ eval: cell.binding })
    const attempt = valid ? work.attempts.find(row => row.id === (work.state.activeAttemptId ?? work.result?.attemptId))
      ?? work.attempts.at(-1) : undefined
    const parsed = output.safeParse(valid ? work.result?.output : undefined)
    let cellOutput: GateCellSnapshot['work']['output'] = null
    let outputInvalid = false
    if (parsed.success) {
      try {
        const manifest = parsed.data.cell.manifest === null ? null : parseResolvedExecutionManifest(parsed.data.cell.manifest)
        cellOutput = { ...parsed.data.cell, manifest }
      } catch { outputInvalid = true }
    } else if (work?.result) outputInvalid = true
    const retained = attempt && state.bundles.find(row => row.runId === run.runId && row.cellId === cell.id && row.attemptId === attempt.id)
    let status: GateCellSnapshot['evidence']['status'] = retained ? retained.expiresAt <= now ? 'expired' : 'intact' : 'missing'
    const material: GateCellSnapshot['evidence']['materials'][number][] = [], calls: GateBudgetReceipt[] = []
    if (retained && status === 'intact') {
      try {
        const verified = validateBundle(retained.bundle, { ...cell.binding, attemptId: attempt.id, attempt: attempt.ordinal },
          Number.MAX_SAFE_INTEGER, run.plan)
        const bodies = verified.materials.map(row => ({ row, body: JSON.parse(row.content) as Record<string, unknown> }))
        const manifest = bodies.find(item => 'manifest' in item.body)?.body.manifest
        if (outputInvalid || cellOutput && (cellOutput.evidenceDigest !== verified.digest
          || evalContractDigest(cellOutput.manifest) !== evalContractDigest(manifest))) throw new Error('result evidence mismatch')
        for (const item of bodies) {
          material.push(structuredClone(item.row))
          if (item.row.kind !== 'execution' || 'manifest' in item.body) continue
          for (const call of protocol.parse(item.body).protocol.accounting.flatMap(row => row.evidence)) {
            const current = budget?.reservation(call.identity.requestId, call.identity.attemptId)
            const matches = current && call.reservation && current.scopeId === call.reservation.scopeId
              && current.request.inputDigest === call.reservation.request.inputDigest
            calls.push({ ...call.identity, provider: call.provider, model: call.model, dispatched: call.dispatched,
              phase: !call.dispatched ? 'denied' : matches ? current.phase : 'unknown', usage: matches ? current.usage : null })
          }
        }
      } catch { status = 'corrupt'; material.length = 0; calls.length = 0 }
    }
    return { binding: { runId: cell.binding.runId, caseId: cell.binding.caseId, routeId: cell.binding.routeId,
      repeatIndex: cell.binding.repeatIndex }, work: { id: cell.workId,
      status: valid ? work.state.status : cell.workId ? 'missing' : 'submitting',
      attempt: attempt ? { id: String(attempt.id), ordinal: attempt.ordinal, status: attempt.status } : null, output: cellOutput },
    evidence: { status, bundle: retained ? { id: retained.bundle.id, version: '1', digest: retained.bundle.digest } : null,
      receivedAt: retained?.receivedAt ?? null, expiresAt: retained?.expiresAt ?? null, materials: material }, budget: calls }
  })
  const expiresAt = cells.length ? Math.min(...cells.map(cell => cell.evidence.expiresAt ?? 0)) : 0
  const facts = { expiresAt, plan: recovered.resolved.plan, suite: recovered.resolved.suite,
    run: { id: recovered.admission.runId, expectedCells }, cells }
  return { ...structuredClone(facts), revision: evalContractDigest(facts), observedAt: now }
}
