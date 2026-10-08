import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ReasoningEffortId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { ContinuationPolicy, EvalActivationAccess } from '@changanhua/dsh-eval-activation'
import LocalGates, { createLocalVerifierExecution, type GatePolicy } from '../../../eval-gates-local/src/index.ts'
import LocalActivation, { createActivationHost, createActivationRequestFactory } from '../../../eval-activation-local/src/index.ts'
import { createEvalGateSnapshotReader } from '../../../eval-runs-local/src/index.ts'
import * as App from '../../src/index.ts'

export const inject = ['evalRuns', 'workspaceRegistry', 'subprocess', 'storageDomain', 'llm', 'agents', 'goals', 'sessions', 'budget', 'taskQueue']
export interface Config { workspaceId: string; repository: string; live: boolean; gatePolicy: GatePolicy; continuation: ContinuationPolicy }

/** Business owners always run through the real Profile; live runs use its real adapter. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  class Adapter extends LlmAdapter {
    override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
      const effort = ReasoningEffortId('off')
      return Promise.resolve({ provider, id: model, name: model,
        reasoning: { efforts: [{ id: effort, name: 'Off' }], defaultEffort: effort } })
    }
    async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      await appendFile(join(config.repository, 'dispatches.txt'), 'dispatched\n')
      const text = JSON.stringify(options.messages).includes('Grade the subject') ? 'PASS' : 'READY'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  if (!config.live) ctx.llm.registerAdapter(['fixture'], new Adapter())
  // A resumed Agent resolves its model from the Host's normal request seam.
  ctx.on('agent/request', async (_event, next) => ({ ...await next(),
    provider: config.live ? 'deepseek-official' : 'fixture', model: config.live ? 'deepseek-v4-flash' : 'fixture', maxTokens: 64 }))
  const workspace = ctx.workspaceRegistry.get(WorkspaceId(config.workspaceId))
  if (!workspace) throw new Error('missing seeded Workspace')
  const gateAccess = (access: EvalActivationAccess) => ({ workspace, entrypoint: 'cli' as const,
    actorId: access.actorId, authorize: () => access.authorize() })
  await ctx.plugin(LocalGates, { maxDecisions: 8, maxLedgerBytes: 16 * 1024 * 1024, retentionMs: 900000,
    policies: [config.gatePolicy], host: { snapshots: createEvalGateSnapshotReader(ctx), verify: createLocalVerifierExecution(ctx) } })
  await ctx.plugin(LocalActivation, { maxRecords: 8, maxLedgerBytes: 128 * 1024, exclusiveGoalDriver: true,
    host: createActivationHost(ctx, gateAccess) })
  await ctx.plugin(App, { profile: 'eval-recovery', workspaceId: config.workspaceId, actorId: 'operator',
    policyIds: ['fixture'], gatePolicyIds: ['release'], continuationPolicies: [{ id: 'approved', policy: config.continuation }],
    activationRequests: createActivationRequestFactory(ctx, { gateAccess }), maxOutputBytes: 256 * 1024, waitMs: 120000 })
}
