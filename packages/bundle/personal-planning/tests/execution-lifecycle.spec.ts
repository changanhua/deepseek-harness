import { createHash } from 'node:crypto'
import { createVerifiedOperatorAuthority } from '@changanhua/dsh-task-queue'
import { AcceptanceClauseId, VerificationCheckId } from '@changanhua/dsh-delivery-protocol'
import { describe, expect, it, vi } from 'vitest'
import { bootExecutionWorld, type ExecutionWorld, waitFor } from './execution-lifecycle.harness.ts'

// Only the external Codex app-server transport is replaced. The real runner,
// Queue, Git worktree/checkpoint, evidence provider, and verifier stay active.
vi.mock('@deepseek-ai/dsh-subagent-codex/app-server-run', async () => {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  return {
    CODEX_APP_SERVER_PERMISSION_MODES: ['never'],
    async startCodexAppServerRun(request: { readonly cwd: string }) {
      await fs.mkdir(path.join(request.cwd, 'src'), { recursive: true })
      await fs.writeFile(path.join(request.cwd, 'src', 'accepted.txt'), 'accepted\n')
      return {
        result: Promise.resolve({
          stopReason: 'completed',
          output: [{
            type: 'text',
            text: JSON.stringify({
              disposition: 'completed',
              summary: 'Created the accepted file.',
              completedWork: ['Created src/accepted.txt.'],
              remainingWork: ['None.'],
            }),
          }],
        }),
        async dispose() {},
      }
    },
  }
})

const estimate = { value: null, urgency: null, reuse: null, compounding: null, timeCost: null, tokenCost: null, risk: null, cognitiveCost: null, rationale: '' }

describe('personal planning execution lifecycle', () => {
  it('keeps the frozen handoff attached to the accepted Delivery Case through a Planning revision and Host reopen', { timeout: 30_000 }, async () => {
    const first = await bootExecutionWorld()
    const worlds: ExecutionWorld[] = [first]
    const signal = new AbortController().signal
    try {
      const created = await first.planning.execute({
        workspaceId: first.workspaceId,
        command: {
          kind: 'create', requestId: 'execution-lifecycle-create', expectedBoardVersion: 0,
          itemId: 'accepted-plan', lane: 'inbox', title: 'Accept one governed plan',
          intent: 'Create src/accepted.txt through the governed Delivery lifecycle.',
          scope: ['src/accepted.txt'], acceptance: ['The accepted file exists in the verified checkpoint.'],
          sources: [{ kind: 'manual', text: 'operator prepared this exact plan revision' }], estimate, reviewAt: null,
        },
      }, signal)
      if (created.itemId === undefined || created.revisionId === undefined) throw new Error('Planning create did not allocate the exact item revision')
      const frozen = await first.planning.handoff({
        workspaceId: first.workspaceId,
        itemId: created.itemId,
        expectedRevisionId: created.revisionId,
      }, signal)
      expect(frozen.phase).toBe('linked')
      expect(frozen.caseId).toBeDefined()
      expect(frozen.contractRevisionId).toBeDefined()
      expect(await first.planning.execution({ workspaceId: first.workspaceId, itemId: created.itemId }, signal)).toMatchObject({ available: true, handoffs: [{ handoff: { revisionId: created.revisionId }, case: { lane: 'shaping' } }] })

      const clauseId = AcceptanceClauseId('planning-accepted-file')
      const revised = await first.delivery.reviseCase({
        caseId: frozen.caseId, expectedHeadRevisionId: frozen.contractRevisionId,
        title: 'Accept one governed plan',
        revision: {
          outcome: 'Create the accepted file from the frozen Planning handoff.',
          context: 'The Delivery contract adds the executable scope, base, and independent verifier.',
          allowedScope: ['src/accepted.txt'], forbiddenScope: ['outside the Attempt-owned worktree'],
          acceptanceClauses: [{ id: clauseId, text: 'The verifier reads accepted content from the checkpoint.' }],
          openDecisions: [], baseSelectionRule: { kind: 'ref-head', ref: 'refs/heads/main' },
          verificationSource: {
            kind: 'contract-field', checks: [{
              id: VerificationCheckId('accepted-content'), name: 'Accepted file has the required content',
              argv: ['node', '-e', "const fs=require('node:fs');if(fs.readFileSync('src/accepted.txt','utf8').trim()!=='accepted')process.exit(1)"],
              cwd: '.', timeoutMs: 5_000, severity: 'required', expectedExitCodes: [0],
            }],
          },
          referenceLinks: [],
        },
      }, signal)
      await first.delivery.recordRequirementDecision({
        caseId: revised.case.id, revisionId: revised.revision.id, decision: 'approved',
        reason: 'A human approved the exact executable Delivery revision.',
      }, signal)
      const packet = await first.delivery.createPacket({
        contractRevisionId: revised.revision.id,
        packet: {
          objective: 'Create src/accepted.txt.', allowedPaths: [{ kind: 'subtree', path: 'src' }], forbiddenPaths: [],
          acceptanceClauseIds: [clauseId], stopConditions: ['Stop after the checkpoint contains the accepted file.'],
          executorPreference: { mode: 'required', executorId: 'codex' },
        },
      }, signal)
      const operator = first.ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
      const change = await first.delivery.startChange({ packetId: packet.id, executorId: 'codex' }, signal)
      if (change.queueWorkId === null) throw new Error('change dispatch did not bind Queue work')
      await waitFor(() => operator.get(change.queueWorkId as never).state.status === 'succeeded')
      const verification = await first.delivery.startVerification({ packetId: packet.id, changeBindingId: change.id }, signal)
      if (verification.queueWorkId === null) throw new Error('verification dispatch did not bind Queue work')
      await waitFor(() => operator.get(verification.queueWorkId as never).state.status === 'succeeded')
      expect(operator.get(verification.queueWorkId as never).result).toMatchObject({ output: { verificationVerdict: { status: 'passed' } } })
      await expect(first.delivery.recordDecision({
        packetId: packet.id, changeBindingId: change.id, verificationBindingId: verification.id,
        decision: 'accepted', reason: 'Human acceptance follows the independent content-reading verifier.', decisionNonce: 'planning-execution-accepted',
      }, signal)).resolves.toMatchObject({ decision: 'accepted' })

      const accepted = await first.planning.execution({ workspaceId: first.workspaceId, itemId: created.itemId }, signal)
      expect(accepted.handoffs).toMatchObject([{
        handoff: { revisionId: created.revisionId, caseId: frozen.caseId, contractRevisionId: frozen.contractRevisionId },
        case: { case: { id: frozen.caseId }, lane: 'accepted', packets: [{ acceptanceDecision: { decision: 'accepted' }, verificationVerdict: { status: 'passed' } }] },
      }])
      expect(accepted.handoffs[0]?.case?.packets[0]?.verificationVerdict?.evidenceIds.length).toBeGreaterThan(0)
      const evidenceId = accepted.handoffs[0]!.case!.packets[0]!.verificationVerdict!.evidenceIds[0]!
      const originalEvidence = await first.planning.evidence({ workspaceId: first.workspaceId, itemId: created.itemId, evidenceId }, signal)
      const evidenceBytes = Buffer.from(originalEvidence.contentBase64, 'base64')
      expect(evidenceBytes.byteLength).toBe(originalEvidence.byteLength)
      expect(originalEvidence.digest).toBe(`sha256:${createHash('sha256').update(evidenceBytes).digest('hex')}`)
      expect(originalEvidence.provenance).toBeDefined()

      const changedPlan = await first.planning.execute({
        workspaceId: first.workspaceId,
        command: {
          kind: 'revise', requestId: 'execution-lifecycle-revise', expectedBoardVersion: (await first.planning.snapshot(first.workspaceId, signal)).version,
          itemId: created.itemId, expectedRevisionId: created.revisionId,
          title: 'Accept a later plan revision', intent: 'This revised Planning head must not rewrite the earlier Delivery handoff.',
          scope: ['src/later.txt'], acceptance: [], sources: [{ kind: 'manual', text: 'later planning edit' }], estimate, reviewAt: null,
        },
      }, signal)
      expect(changedPlan.revisionId).not.toBe(created.revisionId)
      expect(
        (await first.planning.execution({ workspaceId: first.workspaceId, itemId: created.itemId }, signal))
          .handoffs[0]?.handoff.revisionId,
      ).toBe(created.revisionId)

      await first.close()
      const reopened = await first.reopen(); worlds.push(reopened)
      const recovered = await reopened.planning.execution({
        workspaceId: reopened.workspaceId,
        itemId: created.itemId,
      }, signal)
      expect(recovered.handoffs).toMatchObject([{
        handoff: { revisionId: created.revisionId, caseId: frozen.caseId },
        case: { lane: 'accepted', packets: [{ acceptanceDecision: { decision: 'accepted' } }] },
      }])
      expect(recovered.handoffs[0]?.case?.packets[0]?.verificationVerdict?.evidenceIds.length).toBeGreaterThan(0)
      expect(await reopened.planning.evidence({
        workspaceId: reopened.workspaceId,
        itemId: created.itemId,
        evidenceId,
      }, signal)).toEqual(originalEvidence)
    } finally {
      await Promise.allSettled(worlds.map(world => world.close()))
      await first.dispose()
    }
  })
})
