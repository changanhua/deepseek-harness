import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'memory-loader-probe'
export const inject = ['agents', 'tools', 'commands', 'workspaceRegistry', 'sessions']

export async function apply(ctx) {
  await ctx.workspaceRegistry.create(process.cwd())
  const pending = new Set()
  ctx.effect(() => () => Promise.allSettled([...pending]))
  ctx.on('agent/created', ({ agent }) => {
    const work = inspect(agent).catch(error => {
      appendFileSync(join(process.cwd(), 'memory-loader-proof.jsonl'), JSON.stringify({ error: String(error) }) + '\n')
    })
    pending.add(work)
    void work.then(() => pending.delete(work))
  }, { global: true })
  appendFileSync(join(process.cwd(), 'memory-loader-ready'), 'ready\n')

  async function inspect(agent) {
    const report = {
      sessionId: agent.session.id,
      tools: ctx.tools.schemas(agent).map(item => item.name).filter(name => name.startsWith('memory_')).sort(),
      command: ctx.commands.find(agent, 'memory') !== undefined,
      memoryPresent: ctx.get('projectMemory') !== undefined,
    }
    if (report.memoryPresent) {
      const result = await ctx.tools.execute({
        agent, name: 'memory_propose', callId: 'memory-loader-call', signal: new AbortController().signal,
        arguments: {
          topic_key: 'validation.command', kind: 'method', title: 'Validation command',
          statement: 'Run pnpm test', sources: [{ kind: 'file', path: 'README.md' }], idempotency_key: 'loader-proposal',
        },
      })
      if (result.isError) throw new Error(result.content.map(block => block.type === 'text' ? block.text : '').join('\n'))
      const created = JSON.parse(result.value)
      const accepted = await ctx.commands.execute(agent, `/memory accept ${created.id}@1`, [], new AbortController().signal)
      if (accepted?.result.kind !== 'success') throw new Error(JSON.stringify(accepted))
      const recalled = await ctx.get('projectMemory').read(agent, created.id)
      report.id = created.id
      report.commandId = accepted.commandId
      report.eligibility = recalled.eligibility
      report.statement = recalled.memory?.statement
      report.recordVersion = recalled.recordVersion
      await ctx.sessions.flush(agent.session)
    }
    appendFileSync(join(process.cwd(), 'memory-loader-proof.jsonl'), JSON.stringify(report) + '\n')
  }
}
