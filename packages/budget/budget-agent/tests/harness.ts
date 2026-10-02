import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import GoalService from '@deepseek-ai/dsh-goal'
import Approval from '@deepseek-ai/dsh-user-approval'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import LocalBudget from '../../budget-local/src/index.ts'
import * as BudgetLlm from '../../budget-llm/src/index.ts'
import * as BudgetAgent from '../src/index.ts'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

export async function setup(requests: number, onExhausted: 'deny' | 'ask') {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const backend = new MemoryStorageBackend()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', { guarantees: ['single-writer', 'commit-sync', 'private-root'], kv: backend.kv, close: () => backend.close() })
  ctx.provide('storageDomain', new DomainFacility(ctx, { backend: 'memory' }))
  await ctx.plugin(LocalBudget, { maxScopes: 20, maxReservations: 40, maxLedgerBytes: 512 * 1024 })
  await ctx.plugin(BudgetLlm)
  await ctx.plugin(BudgetAgent)
  await ctx.plugin(GoalService)
  await ctx.plugin(Approval, { policy: 'ask' })
  await ctx.plugin(AgentLoop, { agents: [] })
  const script = ['first', 'second'].map(text => textResponse(text).map((chunk): StreamChunk => chunk.type === 'usage'
    ? { ...chunk, usage: { ...chunk.usage, totalTokens: chunk.usage.inputTokens + chunk.usage.outputTokens } } : chunk))
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const agent = await ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock', maxTokens: 32 })
  await ctx.budget.createScope({ id: 'session:parent', kind: 'session', subjectId: agent.id, parentId: null,
    limits: { requests, inputTokens: 100000, outputTokens: 100000, totalTokens: 200000, wallTimeMs: 60000 }, onExhausted }, () => {})
  return { ctx, agent, adapter, close: async () => { await ctx.fiber.dispose(); await backend.close() } }
}
