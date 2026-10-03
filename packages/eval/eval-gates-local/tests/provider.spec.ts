import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { evalContractDigest } from '@changanhua/dsh-eval'
import type { EvalRunAccess } from '@changanhua/dsh-eval-runs'
import { expect, test } from 'vitest'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { verifySnapshot } from '../../eval-verifier/src/verify.ts'
import Gates from '../src/index.ts'
import type { GatePolicy } from '../src/config.ts'
import type { GateRecord } from '../src/ledger.ts'
import type { EvalGateDecision } from '@changanhua/dsh-eval'
import type { VerifierExecution } from '../src/config.ts'
import { snapshot } from './helpers/snapshot.ts'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

test('serializes verifier dispatch, retains decisions across remount, and marks expired evidence stale', async () => {
  const ctx = new Context(), backend = new MemoryStorageBackend()
  try {
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', { guarantees: ['single-writer', 'commit-sync', 'private-root'], kv: backend.kv, close: () => backend.close() })
    ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
    const original = snapshot(), content = JSON.stringify({ protocol: { rawReports: { complete: { output: 'READY' } } } })
    const changed = { ...original, cells: original.cells.map(cell => ({ ...cell, evidence: { ...cell.evidence,
      materials: [{ reference: { id: 'execution', version: '1', digest: sha(content) }, kind: 'execution' as const,
        role: 'subject' as const, executionId: 'subject', content }] } })) }
    const { observedAt: _observed, revision: _revision, ...facts } = changed
    const source = { ...changed, revision: evalContractDigest(facts) }
    let calls = 0, now = 2, reject = false
    const policy: GatePolicy = { id: 'policy', verifierPlan: source.plan.verifierPlanRef, coreDigest: 'a'.repeat(64),
      launch: { executable: 'host-node', entrypoint: 'host-dsh', profile: 'verifier', homeRoot: 'private',
        core: { directory: 'core', digest: 'a'.repeat(64), sourceCommit: 'b'.repeat(40), imageBounds: { maxFiles: 10, maxBytes: 1024 } }, timeoutMs: 1000, graceMs: 100 },
      maxInputBytes: 65536, maxOutputBytes: 65536 }
    const config = { maxDecisions: 4, maxLedgerBytes: 1024 * 1024, retentionMs: 20000,
      policies: [policy, { ...policy, id: 'unavailable' }], host: {
        snapshots: async () => structuredClone(source), now: () => now,
        verify: async (input: Parameters<typeof verifySnapshot>[0]) => {
          calls++
          if (reject) throw new Error('verifier unavailable')
          const inputDigest = sha(JSON.stringify(input)), profilePatch = 'trusted-profile', configuration = { inputDigest }
          const report = { ...verifySnapshot(input), runtime: { sessionId: 'actual-session', profile: 'verifier', configDigest: evalContractDigest(configuration) } }
          const reportText = JSON.stringify(report)
          return { executionId: 'verifier-execution', sessionId: report.runtime.sessionId, inputDigest, report, reportText,
            reportDigest: sha(reportText), profileDigest: sha(profilePatch), configDigest: report.runtime.configDigest,
            verifiedCommit: policy.launch.core.sourceCommit, quiescent: true,
            observer: JSON.stringify({ executionId: 'verifier-execution', sourceCommit: policy.launch.core.sourceCommit, coreDigest: policy.coreDigest,
              profilePatch, configuration, sessionId: report.runtime.sessionId, quiescent: true }),
            workspace: JSON.stringify({ executionId: 'verifier-execution', sourceCommit: policy.launch.core.sourceCommit }) }
        },
      } }
    const access = { workspace: { id: 'workspace' }, actorId: 'operator', entrypoint: 'cli', authorize() {} } as EvalRunAccess
    let owner = await ctx.plugin(Gates, config)
    const [first, repeated] = await Promise.all([ctx.evalGates.evaluate(access, 'run', 'policy'), ctx.evalGates.evaluate(access, 'run', 'policy')])
    expect(first).toMatchObject({ validity: 'current', decision: { decision: 'pass' } })
    expect(repeated).toEqual(first)
    expect(calls).toBe(1)
    await owner.dispose()
    owner = await ctx.plugin(Gates, config)
    expect(await ctx.evalGates.get(access, first.id)).toEqual(first)
    now = 10000
    expect(await ctx.evalGates.get(access, first.id)).toMatchObject({ validity: 'stale', decision: { decision: 'pass' } })
    expect(calls).toBe(1)
    now = 2; reject = true
    const unavailable = await ctx.evalGates.evaluate(access, 'run', 'unavailable')
    expect(unavailable.decision.decision).toBe('needs-attention')
    expect(await ctx.evalGates.get(access, unavailable.id)).toEqual(unavailable)
    await owner.dispose()
    const medium = backend.pool.media.get('eval_gates')
    if (!medium) throw new Error('missing committed Gate medium')
    const committed = structuredClone(medium.global) as { version: 1; records: GateRecord[] }
    const corruptions: ((record: GateRecord) => void)[] = [
      (record) => { record.verifier = null },
      (record) => {
        const decision = record.decision as EvalGateDecision
        const badReport = { ...decision.report.ref, digest: '0'.repeat(64) }
        decision.report.ref = badReport
        if (!decision.verifier) throw new Error('missing verifier receipt')
        decision.verifier.reportRef = badReport
        decision.verifier.evidenceRef = badReport
      },
      (record) => {
        const execution = record.verifier as VerifierExecution
        const report = { ...execution.report, outcome: 'rejected' as const, reason: 'criteria-failed' as const }
        const reportText = JSON.stringify(report)
        record.verifier = { ...execution, report, reportText, reportDigest: sha(reportText) }
      },
    ]
    for (const corrupt of corruptions) {
      const altered = structuredClone(committed)
      const row = altered.records.find(record => record.id === first.id)
      if (!row) throw new Error('missing approved Gate record')
      corrupt(row)
      medium.global = altered
      owner = await ctx.plugin(Gates, config)
      await expect(ctx.evalGates.get(access, first.id)).rejects.toMatchObject({ code: 'blocked' })
      await owner.dispose()
    }
  } finally { await ctx.fiber.dispose(); await backend.close() }
})
