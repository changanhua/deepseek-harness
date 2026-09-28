/** Opt-in external Codex execution through the real Planning and Delivery composition. */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { createVerifiedOperatorAuthority, WorkId } from '@changanhua/dsh-task-queue'
import { AcceptanceClauseId, VerificationCheckId } from '@changanhua/dsh-delivery-protocol'
import { bootExecutionWorld, waitFor, type ExecutionWorld } from './execution-lifecycle.harness.ts'

const enabled = process.env.DSH_PLANNING_CODEX_LIVE === '1'
const artifactRoot = resolve(import.meta.dirname, '../../../../.artifacts/incremental-planning')
const estimate = {
  value: null,
  urgency: null,
  reuse: null,
  compounding: null,
  timeCost: null,
  tokenCost: null,
  risk: null,
  cognitiveCost: null,
  rationale: '',
}

it.skipIf(!enabled)(
  'returns actual Codex execution and independently checked evidence to the frozen plan',
  {
    timeout: 240_000,
    retry: 0,
  },
  async () => {
    const codexHome = process.env.DSH_PLANNING_CODEX_HOME
    if (codexHome === undefined) throw new Error('live acceptance requires an explicitly prepared isolated Codex home')
    const world = await bootExecutionWorld({
      codexEnv: { CODEX_HOME: codexHome },
      codexPermissionMode: 'approve-for-me',
    })
    let reopened: ExecutionWorld | undefined
    const signal = new AbortController().signal
    const operator = world.ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
    const progress: Record<string, unknown> = { transport: 'real-codex-app-server', workspaceId: world.workspaceId }
    const settle = async (id: string | null) => {
      if (id === null) throw new Error('Delivery did not bind a Queue Work')
      const workId = WorkId(id)
      await waitFor(
        () => ['succeeded', 'failed', 'unknown', 'canceled'].includes(operator.get(workId).state.status),
        180_000,
      )
      const work = operator.get(workId)
      progress[id] = { state: work.state, result: work.result }
      expect(work.state.status, `Queue work ${id} must succeed; see execution-live-result.json`).toBe('succeeded')
      return work
    }
    try {
      const plan = await world.planning.execute(
        {
          workspaceId: world.workspaceId,
          command: {
            kind: 'create',
            requestId: 'native-codex-plan',
            expectedBoardVersion: 0,
            title: 'Verify one real execution from a plan',
            intent: 'Create src/accepted.txt containing exactly accepted and a newline.',
            scope: ['Only create src/accepted.txt; preserve src/base.txt.'],
            acceptance: ['Independent verification reads the exact accepted content.'],
            sources: [{ kind: 'manual', text: 'Controlled external-executor acceptance in a disposable Git project.' }],
            lane: 'next',
            estimate,
            reviewAt: null,
          },
        },
        signal,
      )
      if (plan.itemId === undefined || plan.revisionId === undefined) throw new Error('plan has no identity')
      const handoff = await world.planning.handoff(
        { workspaceId: world.workspaceId, itemId: plan.itemId, expectedRevisionId: plan.revisionId },
        signal,
      )
      progress.plan = plan
      progress.handoff = handoff
      if (handoff.caseId === undefined || handoff.contractRevisionId === undefined)
        throw new Error('handoff is not linked')
      const clause = AcceptanceClauseId('actual-file-content')
      const contract = await world.delivery.reviseCase(
        {
          caseId: handoff.caseId,
          expectedHeadRevisionId: handoff.contractRevisionId,
          title: 'Verify one real execution from a plan',
          revision: {
            outcome: 'Create src/accepted.txt containing exactly accepted followed by a newline.',
            context:
              'Disposable acceptance project. Do not modify the controller, configuration, or repository metadata.',
            allowedScope: ['src/accepted.txt'],
            forbiddenScope: ['src/base.txt', 'all other paths'],
            acceptanceClauses: [
              { id: clause, text: 'The checkpoint contains src/accepted.txt with exactly accepted and a newline.' },
            ],
            openDecisions: [],
            baseSelectionRule: { kind: 'ref-head', ref: 'refs/heads/main' },
            verificationSource: {
              kind: 'contract-field',
              checks: [
                {
                  id: VerificationCheckId('read-actual-file'),
                  name: 'Read checkpoint content independently',
                  argv: [
                    'node',
                    '-e',
                    "const fs=require('node:fs');if(fs.readFileSync('src/accepted.txt','utf8')!=='accepted\\n'||fs.readFileSync('src/base.txt','utf8')!=='base\\n')process.exit(1)",
                  ],
                  cwd: '.',
                  timeoutMs: 10_000,
                  severity: 'required',
                  expectedExitCodes: [0],
                },
              ],
            },
            referenceLinks: [],
          },
        },
        signal,
      )
      await world.delivery.recordRequirementDecision(
        {
          caseId: contract.case.id,
          revisionId: contract.revision.id,
          decision: 'approved',
          reason: 'The controller authorizes only this disposable acceptance fixture.',
        },
        signal,
      )
      const packet = await world.delivery.createPacket(
        {
          contractRevisionId: contract.revision.id,
          packet: {
            objective:
              'Create only src/accepted.txt with exactly the bytes accepted followed by one newline. Leave all other files unchanged.',
            allowedPaths: [{ kind: 'subtree', path: 'src' }],
            forbiddenPaths: [{ kind: 'subtree', path: 'src/base.txt' }],
            acceptanceClauseIds: [clause],
            stopConditions: ['Stop after creating the requested file.'],
            executorPreference: { mode: 'required', executorId: 'codex' },
          },
        },
        signal,
      )
      const change = await world.delivery.startChange({ packetId: packet.id, executorId: 'codex' }, signal)
      progress.change = change
      const changed = await settle(change.queueWorkId)
      expect(changed.result).toMatchObject({ output: { completionClaim: { disposition: 'completed' } } })
      const verification = await world.delivery.startVerification(
        { packetId: packet.id, changeBindingId: change.id },
        signal,
      )
      const verified = await settle(verification.queueWorkId)
      expect(verified.result).toMatchObject({ output: { verificationVerdict: { status: 'passed' } } })
      await world.delivery.recordDecision(
        {
          packetId: packet.id,
          changeBindingId: change.id,
          verificationBindingId: verification.id,
          decision: 'accepted',
          reason: 'The independent verifier checked exact file contents in the checkpoint.',
          decisionNonce: 'native-codex-accepted',
        },
        signal,
      )
      const execution = await world.planning.execution({ workspaceId: world.workspaceId, itemId: plan.itemId }, signal)
      expect(execution.handoffs[0]?.handoff.revisionId).toBe(plan.revisionId)
      const result = execution.handoffs[0]?.case?.packets[0]
      expect(result?.acceptanceDecision?.decision).toBe('accepted')
      const evidenceId = result?.verificationVerdict?.evidenceIds[0]
      if (evidenceId === undefined) throw new Error('verified execution has no immutable evidence')
      const evidence = await world.planning.evidence(
        { workspaceId: world.workspaceId, itemId: plan.itemId, evidenceId },
        signal,
      )
      const bytes = Buffer.from(evidence.contentBase64, 'base64')
      expect(evidence.digest).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`)
      await world.close()
      reopened = await world.reopen()
      expect(
        await reopened.planning.evidence(
          { workspaceId: reopened.workspaceId, itemId: plan.itemId, evidenceId },
          signal,
        ),
      ).toEqual(evidence)
      progress.accepted = { plan, handoff, packetId: packet.id, evidenceId, digest: evidence.digest }
    } finally {
      await mkdir(artifactRoot, { recursive: true })
      await writeFile(resolve(artifactRoot, 'execution-live-result.json'), JSON.stringify(progress, null, 2))
      try {
        await reopened?.close()
      } finally {
        await world.dispose()
      }
    }
  },
)
