import { Context } from '@deepseek-ai/cordis'
import RuntimeFacts, { factKey } from '@deepseek-ai/dsh-runtime-facts'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import * as RuntimeInspect from '../src/index.ts'
import { inspectCommand } from '../src/command.ts'

const testSignal = new AbortController().signal

class FakeSubprocess extends SubprocessRuntime {
  readonly executionWorld = 'remote' as const

  async resolveExecutable(
    command: string,
    _env?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<string> {
    signal?.throwIfAborted()
    if (command === 'missing') throw new Error('provider detail: API_KEY=should-never-leak')
    return `/remote/bin/${command}`
  }

  spawn(_spec: SubprocessSpawnSpec): SubprocessHandle {
    throw new Error('not used by runtime-inspect tests')
  }

  spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('not used by runtime-inspect tests'))
  }
}

async function boot(): Promise<{
  ctx: Context
  fiber: Awaited<ReturnType<Context['plugin']>>
  call: (args: unknown, signal?: AbortSignal) => Promise<ToolExecutionResult>
}> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(RuntimeFacts)
  await ctx.plugin(FakeSubprocess)
  const fiber = await ctx.plugin(RuntimeInspect)
  let n = 0
  const call = (args: unknown, signal: AbortSignal = testSignal) => ctx.tools.execute({
    signal,
    callId: `runtime-inspect-${++n}` as never,
    name: 'runtime_inspect',
    arguments: args,
  })
  return { ctx, fiber, call }
}

describe('runtime_inspect schema and prompt', () => {
  it('registers a real tagged-union schema and stable guidance', async () => {
    const { ctx, fiber } = await boot()
    const schema = ctx.tools.schemas().find(candidate => candidate.name === 'runtime_inspect')
    expect(schema?.parameters).toMatchObject({
      type: 'object',
      oneOf: [
        { properties: { kind: { const: 'facts' } }, required: ['kind'] },
        { properties: { kind: { const: 'command' } }, required: ['kind', 'command'] },
      ],
    })
    const assembled = await ctx.systemPrompt.assemble()
    expect(assembled.sections.find(section => section.name === 'tool:runtime-inspect')?.text)
      .toBe(RuntimeInspect.RUNTIME_INSPECT_SYSTEM_PROMPT)
    await fiber.dispose()
  })

  it('rejects cross-variant and extra arguments at the registry boundary', async () => {
    const { call, fiber } = await boot()
    const invalid = await call({ kind: 'facts', command: 'codex' })
    expect(invalid.isError).toBe(true)
    const missing = await call({ kind: 'command' })
    expect(missing.isError).toBe(true)
    await fiber.dispose()
  })
})

describe('runtime_inspect facts', () => {
  it('returns sync, async, unknown, and probe-failure states without flattening them', async () => {
    const { ctx, call, fiber } = await boot()
    ctx.runtimeFacts.registerFact({
      key: factKey('host.os'),
      owner: 'test',
      description: 'Host OS.',
      evaluation: 'sync',
      freshness: 'dynamic',
      exposure: 'inspect',
      resolveSync: () => 'linux',
    })
    ctx.runtimeFacts.registerFact({
      key: factKey('web-search.exa.credential-configured'),
      owner: 'test',
      description: 'Safe credential state.',
      evaluation: 'async',
      freshness: 'dynamic',
      exposure: 'inspect',
      resolveAsync: async () => true,
    })
    ctx.runtimeFacts.registerFact({
      key: factKey('net.reachable'),
      owner: 'test',
      description: 'Probe failure fixture.',
      evaluation: 'async',
      freshness: 'dynamic',
      exposure: 'inspect',
      resolveAsync: async () => { throw new Error('probe failed with SECRET=never-render-this') },
    })

    const out = await call({
      kind: 'facts',
      keys: ['host.os', 'web-search.exa.credential-configured', 'net.reachable', 'host.unknown'],
    })
    expect(out.isError).toBe(false)
    expect(out.value).toEqual({
      'host.os': { status: 'ok', value: 'linux' },
      'web-search.exa.credential-configured': { status: 'ok', value: true },
      'net.reachable': { status: 'probe-failure', reason: 'probe failed' },
      'host.unknown': { status: 'unknown' },
    })
    expect(JSON.stringify(out.value)).not.toContain('never-render-this')
    await fiber.dispose()
  })

  it('inspects every registered fact when keys is omitted', async () => {
    const { ctx, call, fiber } = await boot()
    for (const [key, value] of [['host.os', 'linux'], ['host.arch', 'x64']] as const) {
      ctx.runtimeFacts.registerFact({
        key: factKey(key),
        owner: 'test',
        description: key,
        evaluation: 'sync',
        freshness: 'dynamic',
        exposure: 'inspect',
        resolveSync: () => value,
      })
    }
    const out = await call({ kind: 'facts' })
    expect(out.value).toEqual({
      'host.arch': { status: 'ok', value: 'x64' },
      'host.os': { status: 'ok', value: 'linux' },
    })
    await fiber.dispose()
  })
})

describe('runtime_inspect command', () => {
  it('uses subprocess resolution and reports that same seam execution world', async () => {
    const { call, fiber } = await boot()
    const out = await call({ kind: 'command', command: 'codex' })
    expect(out.isError).toBe(false)
    expect(out.value).toEqual({ resolved: '/remote/bin/codex', world: 'remote' })
    await fiber.dispose()
  })

  it('returns a stable unavailable result without leaking provider diagnostics', async () => {
    const { call, fiber } = await boot()
    const out = await call({ kind: 'command', command: 'missing' })
    expect(out.isError).toBe(false)
    expect(out.value).toEqual({
      status: 'unavailable',
      reason: 'executable could not be resolved in the active execution world',
    })
    expect(JSON.stringify(out.value)).not.toContain('API_KEY')
    expect(JSON.stringify(out.value)).not.toContain('should-never-leak')
    await fiber.dispose()
  })

  it('preserves caller cancellation instead of reporting unavailable', async () => {
    const { ctx, fiber } = await boot()
    const controller = new AbortController()
    controller.abort()
    await expect(inspectCommand(ctx, 'codex', controller.signal)).rejects.toThrow()
    await fiber.dispose()
  })
})

describe('runtime_inspect lifecycle', () => {
  it('withdraws both the tool and its prompt section when the plugin unloads', async () => {
    const { ctx, fiber } = await boot()
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('runtime_inspect')
    expect((await ctx.systemPrompt.assemble()).sections.map(section => section.name))
      .toContain('tool:runtime-inspect')

    await fiber.dispose()

    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('runtime_inspect')
    expect((await ctx.systemPrompt.assemble()).sections.map(section => section.name))
      .not.toContain('tool:runtime-inspect')
  })
})
