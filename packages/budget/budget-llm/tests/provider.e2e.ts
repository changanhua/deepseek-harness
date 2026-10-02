import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek'
import { setup } from '../../budget-agent/tests/harness.ts'

test.skipIf(!process.env.DEEPSEEK_API_KEY)('settles one real Provider usage receipt and refuses a second paid request', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-budget-provider-'))
  vi.stubEnv('DSH_HOME', home)
  let h: Awaited<ReturnType<typeof setup>> | undefined
  try {
    h = await setup(1, 'deny')
    const runtime = h.ctx.llm
    await h.ctx.plugin(DeepSeek, { thinking: 'disabled', maxTokens: 32, retryPolicy: { mode: 'normal', maxRetries: 0 } })
    const scope = h.ctx.budget.scopeFor({ kind: 'session', id: h.agent.id })
    if (!scope) throw new Error('missing test budget')
    const options = { provider: 'deepseek-official', model: 'deepseek-v4-flash', maxTokens: 32, reasoningEffort: ReasoningEffortId('off'),
      messages: [createUserMessage({ content: [{ type: 'text', text: 'Reply with exactly OK.' }], source: { kind: 'user' } })],
      signal: AbortSignal.timeout(45000) }
    const collect = async () => {
      const chunks: StreamChunk[] = []
      for await (const chunk of runtime.stream(options)) chunks.push(chunk)
      return chunks
    }
    const first = await h.ctx.budget.withScope(scope.reference, collect)
    expect(first.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    const usage = first.findLast(chunk => chunk.type === 'usage')
    expect(usage?.type).toBe('usage')
    const settled = h.ctx.budget.inspect(scope.reference)
    expect(settled.consumed.requests).toBe(1)
    expect(settled.consumed.inputTokens).toBeGreaterThan(0)
    expect(settled.consumed.outputTokens).toBeGreaterThan(0)
    expect(settled.unknownRequests).toBe(0)
    const second = await h.ctx.budget.withScope(scope.reference, collect)
    expect(second).toMatchObject([{ type: 'finish', reason: { failure: { code: 'BUDGET_EXHAUSTED' } } }])
    expect(h.ctx.budget.inspect(scope.reference).consumed).toEqual(settled.consumed)
  } finally { await h?.close(); vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }) }
}, 60000)
