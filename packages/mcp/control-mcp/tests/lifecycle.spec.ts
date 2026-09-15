import { EventEmitter } from 'node:events'
import type { spawn as nodeSpawn } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { parseHostAnnouncement, startManagedDshHost } from '../src/lifecycle.ts'

describe('managed DSH Host lifecycle', () => {
  it('parses only the loopback Web readiness line', () => {
    expect(parseHostAnnouncement('dsh web: http://127.0.0.1:43122/?token=abc123')).toEqual({
      origin: 'http://127.0.0.1:43122', token: 'abc123',
    })
    expect(parseHostAnnouncement('dsh web: http://0.0.0.0:43122/?token=abc123')).toBeUndefined()
  })

  it('starts from the CLI profile and terminates the child on stop', async () => {
    const child = new FakeChild()
    const spawn = vi.fn<typeof nodeSpawn>(() => child as never)
    const host = await startManagedDshHost({
      runId: 'run-1',
      hostHome: 'C:/isolated-host',
      hostPatch: 'C:/patch.yml',
      executable: 'node.exe',
      cliEntry: 'C:/repo/apps/cli/lib/bin.js',
      spawn: spawn as unknown as typeof nodeSpawn,
      startupTimeoutMs: 1000,
    })
    expect(host.origin).toBe('http://127.0.0.1:43122')
    const [command, args, options] = spawn.mock.calls[0]!
    expect(command).toBe('node.exe')
    expect(args).toEqual([
      'C:/repo/apps/cli/lib/bin.js', '--profile', 'web', '--patch', 'C:/patch.yml',
      '--no-open', '--port', '0',
    ])
    expect(options?.env?.DSH_HOME).toBe('C:/isolated-host')
    expect(options?.env?.DSH_CONTROL_RUN_ID).toBe('run-1')
    expect(options?.windowsHide).toBe(true)
    const stop = host.stop()
    expect(host.stop()).toBe(stop)
    await stop
    expect(child.killedSignal).toBe('SIGTERM')
    await host.stop()
    expect(child.killCount).toBe(1)
  })

  it('preserves the source loader when the managed Host uses a TypeScript CLI entry', async () => {
    const child = new FakeChild()
    const spawn = vi.fn<typeof nodeSpawn>(() => child as never)
    const originalArgs = process.execArgv
    process.execArgv = ['--inspect=9229', '--test', '--import', 'tsx/esm', '--loader=fixture-loader']
    try {
      const host = await startManagedDshHost({
        runId: 'run-source',
        hostHome: 'C:/isolated-host',
        hostPatch: 'C:/patch.yml',
        executable: process.execPath,
        cliEntry: 'C:/repo/apps/cli/src/bin.ts',
        spawn: spawn as unknown as typeof nodeSpawn,
        startupTimeoutMs: 1000,
      })
      expect(spawn.mock.calls[0]?.[1]).toEqual([
        '--import', 'tsx/esm', '--loader=fixture-loader',
        'C:/repo/apps/cli/src/bin.ts', '--profile', 'web', '--patch', 'C:/patch.yml',
        '--no-open', '--port', '0',
      ])
      await host.stop()
    } finally {
      process.execArgv = originalArgs
    }
  })
})

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  killedSignal: NodeJS.Signals | undefined
  killCount = 0

  constructor() {
    super()
    queueMicrotask(() => this.stdout.write('dsh web: http://127.0.0.1:43122/?token=abc123\n'))
  }

  kill(signal: NodeJS.Signals): boolean {
    this.killCount++
    this.killedSignal = signal
    this.signalCode = signal
    queueMicrotask(() => this.emit('exit', null, signal))
    return true
  }
}
