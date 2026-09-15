import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryError } from '@changanhua/dsh-memory'
import Commands from '@deepseek-ai/dsh-commands'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createMemoryHarness } from '../../memory-local/tests/harness.ts'
import * as MemoryCommands from '../src/index.ts'
import { parseMemoryCommand } from '../src/parse.ts'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const dispose of cleanup.splice(0).reverse()) await dispose() })

async function harness(config: MemoryCommands.Config = {}) {
  const memory = await createMemoryHarness()
  cleanup.push(memory.dispose)
  await memory.ctx.plugin(Commands)
  const fiber = await memory.ctx.plugin(MemoryCommands, config)
  const caller = memory.agent()
  const run = (line: string) => memory.ctx.commands.execute(caller, line, [], new AbortController().signal)
  const propose = (key = 'save', statement = '运行 pnpm test', amendment?: { memoryId: string; expectedVersion: number }) =>
    memory.ctx.projectMemory.propose(caller, {
      topicKey: 'validation.command', kind: 'method', title: '验证命令', statement,
      sources: [{ kind: 'file', path: 'README.md' }], tags: [], conditions: '', idempotencyKey: key, ...amendment,
    })
  return { ...memory, caller, run, propose, fiber }
}

describe('human project memory commands', () => {
  it('accepts an explicit future deadline and records its exact human arguments', async () => {
    const { caller, run, propose, records } = await harness()
    const { id } = await propose()
    const result = await run(`/memory accept ${id}@1 --review-after 2099-01-01T00:00:00Z`)
    expect(result?.result.kind).toBe('success')
    expect((await records(caller))[0]?.decisions[0]?.reviewAfter).toBe('2099-01-01T00:00:00Z')
  })

  it('returns a useful bounded error when a reviewed claim exceeds the human result budget', async () => {
    const { run, propose } = await harness({ maxOutputBytes: 1024 })
    const { id } = await propose('long', '项目'.repeat(900))
    const result = await run(`/memory show ${id}`)
    expect(result?.result.kind).toBe('error')
    expect(result?.result.text).toContain('内容超过输出上限')
  })

  it('refuses to render mismatched inspection and read versions', async () => {
    const { ctx, run, propose } = await harness()
    const { id } = await propose()
    await run(`/memory accept ${id}@1`)
    const read = ctx.projectMemory.read.bind(ctx.projectMemory)
    vi.spyOn(ctx.projectMemory, 'read').mockImplementationOnce(async (...args) => {
      await propose('amend', '新的验证命令', { memoryId: id, expectedVersion: 2 })
      return read(...args)
    })
    const result = await run(`/memory show ${id}`)
    expect(result?.result.kind).toBe('error')
    expect(result?.result.text).toContain('记忆已变化')
  })

  it('fails closed for an empty provider inspection, a closing provider, and an unexpected backend error', async () => {
    const { ctx, run, propose } = await harness()
    const { id } = await propose()
    vi.spyOn(ctx.projectMemory, 'inspect').mockResolvedValueOnce([])
    expect((await run(`/memory show ${id}`))?.result.text).toContain('没有可访问')
    vi.spyOn(ctx.projectMemory, 'inspect').mockRejectedValueOnce(new MemoryError('closed', 'provider closing'))
    expect((await run(`/memory show ${id}`))?.result.text).toContain('记忆操作未完成')
    vi.spyOn(ctx.projectMemory, 'inspect').mockRejectedValueOnce(new Error('test backend refused'))
    await expect(run(`/memory show ${id}`)).rejects.toThrow('test backend refused')
  })

  it('normalizes whitespace consistently while preserving the source preview', async () => {
    const { run, propose } = await harness()
    const { id } = await propose()
    const shown = await run(`/memory show\t${id}`)
    expect(shown?.result.kind).toBe('success')
    expect(shown?.result.text).toContain('项目验证命令是 pnpm test。')
    expect(shown?.result.text).toContain('内容一致')
  })

  it('rejects invalid calendar dates and unsupported offsets at command admission', () => {
    for (const date of ['2099-02-30T00:00:00.000Z', '2099-09-08T00:00:00+08:00']) {
      expect(parseMemoryCommand(`accept memory-id@1 --review-after ${date}`)).toEqual({ kind: 'invalid' })
    }
    expect(parseMemoryCommand('accept memory-id@1 --review-after 2099-09-08T00:00:00Z')).toMatchObject({ kind: 'accept' })
  })

  it('refuses extra revision tokens in a purported human decision before inspecting history', async () => {
    const { ctx, caller, human, propose } = await harness()
    const { id } = await propose()
    const commandId = human(caller, `accept ${id}@1@extra`)
    await expect(ctx.projectMemory.inspect(caller, { id, commandId })).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('shows candidate text and source preview, then records an exact human acceptance', async () => {
    const { ctx, caller, run, propose, records } = await harness()
    const { id } = await propose()
    const shown = await run(`/memory show ${id}`)
    expect(shown?.result.kind).toBe('success')
    expect(shown?.result.text).toContain('运行 pnpm test')
    expect(shown?.result.text).toContain('项目验证命令是 pnpm test。')
    const accepted = await run(`/memory accept ${id}@1`)
    expect(accepted?.result.kind).toBe('success')
    const saved = await records(caller)
    expect(saved[0]).toMatchObject({ activeRevision: 1, candidateRevision: null })
    expect(saved[0]?.decisions[0]?.commandId).toBe(accepted?.commandId)
    expect(await ctx.projectMemory.read(caller, id)).toMatchObject({ eligibility: 'usable' })
  })

  it('rejects an old confirmation target after a newer revision is accepted', async () => {
    const { caller, run, propose, records } = await harness()
    const { id } = await propose()
    await run(`/memory accept ${id}@1`)
    await propose('revision-two', '运行 pnpm run test:focused', { memoryId: id, expectedVersion: 2 })
    expect((await run(`/memory accept ${id}@2`))?.result.kind).toBe('success')
    expect((await run(`/memory accept ${id}@1`))?.result.kind).toBe('error')
    expect((await records(caller))[0]).toMatchObject({ activeRevision: 2, recordVersion: 4 })
  })

  it('refuses acceptance after source changes and keeps the candidate pending', async () => {
    const { caller, cwd, run, propose, records } = await harness()
    const { id } = await propose()
    await writeFile(join(cwd, 'README.md'), '规则已经更新')
    const result = await run(`/memory accept ${id}@1`)
    expect(result?.result.kind).toBe('error')
    expect((await records(caller))[0]).toMatchObject({ candidateRevision: 1, activeRevision: null })
  })

  it('supports rejection, retirement, and reading a historical version', async () => {
    const { caller, run, propose, records } = await harness()
    const { id } = await propose()
    await run(`/memory accept ${id}@1`)
    await propose('revision-two', '另一个方法', { memoryId: id, expectedVersion: 2 })
    expect((await run(`/memory reject ${id}@2`))?.result.kind).toBe('success')
    expect((await run(`/memory retire ${id}@1`))?.result.kind).toBe('success')
    expect((await records(caller))[0]).toMatchObject({ activeRevision: null, candidateRevision: null })
    const old = await run(`/memory show ${id}@1`)
    expect(old?.result.kind).toBe('success')
    expect(old?.result.text).toContain('运行 pnpm test')
  })

  it('lists pending memories without a model turn, including subsequent pages', async () => {
    const { caller, run, propose } = await harness()
    for (let index = 0; index < 21; index++) await propose(`item-${index}`)
    const first = await run('/memory')
    const next = await run('/memory list 2')
    expect(first?.result.kind).toBe('success')
    expect(next?.result.kind).toBe('success')
    expect(next?.result.text).toContain('第 2 页')
    expect(caller.session.events.filter(event => event.type === 'turn/start')).toEqual([])
    expect(Buffer.byteLength(first?.result.text ?? '', 'utf8')).toBeLessThanOrEqual(16 * 1024)
  })

  it('rejects unsupported commands without mutating a candidate', async () => {
    const { caller, run, propose, records } = await harness()
    const { id } = await propose()
    for (const line of ['/memory approve all', `/memory accept ${id}`, `/memory accept ${id}@1 --force`]) {
      expect((await run(line))?.result.kind).toBe('error')
    }
    expect((await records(caller))[0]).toMatchObject({ recordVersion: 1, activeRevision: null })
  })

  it('removes the human command on plugin unload', async () => {
    const { ctx, caller, fiber } = await harness()
    expect(ctx.commands.find(caller, 'memory')).toBeDefined()
    await fiber.dispose()
    expect(ctx.commands.find(caller, 'memory')).toBeUndefined()
  })
})
