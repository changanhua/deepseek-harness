import { EventEmitter } from 'node:events'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { apply, CONTROL_MCP_STARTUP_SERVICE } from '../src/startup.ts'

class TestStdin extends EventEmitter {
  readableEnded = false
  resume(): this { return this }
  end(): void { this.readableEnded = true; this.emit('end') }
}

afterEach(() => {
  internals.stdin = process.stdin
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

function start(args: string[]) {
  const ctx = new Context()
  const exits: number[] = []
  const stdin = new TestStdin()
  let out = ''
  const capture = { write: (chunk: string) => { out += chunk; return true } }
  internals.stdin = stdin
  internals.stdout = capture
  internals.stderr = capture
  provideCmdline(ctx, {
    args,
    exit: code => void exits.push(code),
    ready: { onReady: (listener) => { listener(); return () => {} } },
  })
  apply(ctx)
  return { ctx, exits, stdin, out: () => out }
}

describe('DSH control MCP startup', () => {
  it('claims stdio only after a normal profile invocation', async () => {
    const running = start([])
    expect(running.ctx.get(CONTROL_MCP_STARTUP_SERVICE)).toEqual({ accepted: true })
    running.stdin.end()
    expect(running.exits).toEqual([0])
    await running.ctx.fiber.dispose()

    const help = start(['--help'])
    expect(help.out()).toContain('dsh --profile control-mcp')
    expect(help.ctx.get(CONTROL_MCP_STARTUP_SERVICE)).toBeUndefined()
    expect(help.exits).toEqual([0])
  })
})
