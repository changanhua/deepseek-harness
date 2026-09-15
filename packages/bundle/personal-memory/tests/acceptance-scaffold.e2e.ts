import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createAcceptanceWorld } from './acceptance-world.ts'
import { persistedMemories } from './assertions.ts'

it('omits memory tools, commands, and state in the comparison baseline Web Host', { retry: 0, timeout: 120_000 }, async () => {
  const world = await createAcceptanceWorld(false)
  try {
    const host = await world.start()
    const caller = await world.session(world.a)
    expect(host.ctx.get('projectMemory')).toBeUndefined()
    expect(host.ctx.commands.find(caller, 'memory')).toBeUndefined()
    expect(host.ctx.tools.schemas(caller).some(tool => tool.name.startsWith('memory_'))).toBe(false)
    expect(caller.session.events.some(event => event.type === 'turn/start')).toBe(false)
    await expect(access(join(world.storageRoot, 'project_memory.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally {
    await world.close()
  }
})

it('keeps caller-owned storage across two real Web Host compositions without inference', { retry: 0, timeout: 180_000 }, async () => {
  const world = await createAcceptanceWorld()
  try {
    await writeFile(join(world.a, 'README.md'), 'Run pnpm verify:restart-fixture')
    const first = await world.start()
    const a = await world.session(world.a)
    const proposal = await first.ctx.tools.execute({
      agent: a, name: 'memory_propose', callId: 'restart-fixture' as Parameters<typeof first.ctx.tools.execute>[0]['callId'], signal: new AbortController().signal,
      arguments: {
        topic_key: 'validation.command', kind: 'method', title: 'Project validation',
        statement: 'Run pnpm verify:restart-fixture', sources: [{ kind: 'file', path: 'README.md' }],
        idempotency_key: 'restart-fixture',
      },
    })
    expect(proposal.isError).not.toBe(true)
    const id = (await persistedMemories(world.storageRoot))[0]!.id
    await world.command(a, '/memory accept ' + id + '@1')
    const before = await readFile(join(world.storageRoot, 'project_memory.json'), 'utf8')
    const oldScratch = first.workspaceCwd
    await world.stop()
    await expect(access(oldScratch)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(world.storageRoot, 'project_memory.json'), 'utf8')).toBe(before)
    const second = await world.start()
    const fresh = await world.session(world.a)
    expect(second.workspaceCwd).not.toBe(oldScratch)
    const recalled = await second.ctx.get('projectMemory')!.read(fresh, id)
    expect(recalled).toMatchObject({ id, eligibility: 'usable', memory: { revision: 1, statement: 'Run pnpm verify:restart-fixture' } })
    const b = await world.session(world.b)
    await expect(second.ctx.get('projectMemory')!.read(b, id)).rejects.toMatchObject({ code: 'not-found' })
    expect(fresh.session.events.some(event => event.type === 'turn/start')).toBe(false)
  } finally {
    await world.close()
  }
})
