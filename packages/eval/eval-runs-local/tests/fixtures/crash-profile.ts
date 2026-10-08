import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@changanhua/dsh-eval-runs'
import type {} from '@changanhua/dsh-budget'
import { createVerifiedOperatorAuthority } from '@changanhua/dsh-task-queue'

export const inject = ['evalRuns', 'llm', 'workspaceRegistry', 'budget', 'appReady', 'appExit', 'taskQueue']

export function apply(ctx: Context): void {
  ctx.effect(() => {
    const watchdog = setTimeout(() => {
      process.stderr.write(JSON.stringify(ctx.taskQueue.forOperator(createVerifiedOperatorAuthority()).list()))
      ctx.appExit!(2)
    }, 60000)
    return () => { clearTimeout(watchdog) }
  }, 'eval-run-crash-fixture.lifetime')
  const crash = process.env.DSH_EVAL_CRASH === '1'
  const directory = process.cwd()
  class Adapter extends LlmAdapter {
    async * stream(): AsyncIterable<StreamChunk> {
      await appendFile(join(directory, 'dispatches.txt'), 'dispatched\n')
      // Exit without async disposal after the real Budget owner durably marks dispatch.
      process.exit(73)
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  if (crash) ctx.llm.registerAdapter(['fixture'], new Adapter())
  const task = async () => {
    const workspace = ctx.workspaceRegistry.list()[0]
    if (!workspace) throw new Error('missing seeded Workspace')
    const access = { workspace, entrypoint: 'cli' as const, actorId: 'profile-operator', authorize: () => {} }
    const input = { requestId: 'profile-crash', plan: { id: 'plan', version: '1' }, policyId: 'fixture' }
    if (crash) {
      const run = await ctx.evalRuns.start(access, input)
      await writeFile(join(directory, 'before.json'), JSON.stringify(run))
      return
    }
    const before = JSON.parse(await readFile(join(directory, 'before.json'), 'utf8')) as { id: string }
    const run = await ctx.evalRuns.get(access, before.id)
    const repeated = await ctx.evalRuns.start(access, input)
    const budget = ctx.budget.inspect('profile-budget')
    await writeFile(join(directory, 'after.json'), JSON.stringify({ run, repeated, budget }))
    ctx.appExit!(0)
  }
  ctx.effect(() => ctx.appReady!.onReady(() => {
    void task().catch((error: unknown) => { process.stderr.write(String(error)); ctx.appExit!(1) })
  }), 'eval-run-crash-fixture.ready')
}
