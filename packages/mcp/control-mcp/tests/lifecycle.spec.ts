import { EventEmitter } from 'node:events'
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
    const spawn = vi.fn(() => child as never)
    const host = await startManagedDshHost({
      runId: 'run-1',
      hostHome: 'C:/isolated-host',
      hostPatch: 'C:/patch.yml',
      executable: 'node.exe',
      cliEntry: 'C:/repo/apps/cli/lib/bin.js',
      spawn,
      startupTimeoutMs: 1000,
    })
    expect(host.origin).toBe('http://127.0.0.1:43122')
    expect(spawn).toHaveBeenCalledWith('node.exe', [
      'C:/repo/apps/cli/lib/bin.js', '--profile', 'web', '--patch', 'C:/patch.yml',
      '--no-open', '--port', '0',
    ], expect.objectContaining({
      env: expect.objectContaining({ DSH_HOME: 'C:/isolated-host', DSH_CONTROL_RUN_ID: 'run-1' }),
      windowsHide: true,
    }))
    await host.stop()
    expect(child.killedSignal).toBe('SIGTERM')
    await host.stop()
    expect(child.killCount).toBe(1)
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
