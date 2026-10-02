import { writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@changanhua/dsh-eval-plans'

export const name = 'eval-plan-profile-fixture'
export const inject = ['agents', 'commands', 'llm', 'workspaceRegistry', 'evalPlans', 'sessions']

/** External provider availability is the only mocked boundary; preflight must never call it. */
export async function apply(ctx: Context): Promise<void> {
  let calls = 0
  class Adapter extends LlmAdapter {
    async * stream(): AsyncIterable<StreamChunk> { calls++; throw new Error('Plan preflight must not execute a model'); yield { type: 'finish', reason: { kind: 'stop' } } }
  }
  ctx.llm.registerAdapter(['deepseek-official'], new Adapter())
  const workspace = await ctx.workspaceRegistry.create(process.cwd())
  if (ctx.agents.roots().length === 0) await new Promise<void>((resolve) => {
    const dispose = ctx.on('agent/created', () => { dispose(); resolve() })
  })
  const agent = ctx.agents.roots()[0]!
  const execute = (input: unknown) => ctx.commands.execute(agent, `/eval-plan ${JSON.stringify(input)}`, [], new AbortController().signal)
  const discovered = await execute({ action: 'discover' })
  if (discovered?.result.kind !== 'success') throw new Error(`Plan discovery failed: ${discovered?.result.text}`)
  const cli = JSON.parse(discovered.result.text!) as Array<{ id: string; version: string }>
  const selection = cli[0]!
  const preflight = await execute({ action: 'preflight', id: selection.id, version: selection.version })
  const first = await execute({ action: 'admit', id: selection.id, version: selection.version, requestId: 'profile-request' })
  const replay = await execute({ action: 'admit', id: selection.id, version: selection.version, requestId: 'profile-request' })
  const web = await ctx.evalPlans.discover({ workspace, entrypoint: 'web', authorize: () => {} })
  const ci = await ctx.evalPlans.discover({ workspace, entrypoint: 'ci', authorize: () => {} })
  await ctx.sessions.flush(agent.session)
  await writeFile('plan-evidence.json', JSON.stringify({ calls, cli, web, ci, preflight: preflight?.result, first: first?.result, replay: replay?.result }))
}
