import { execFile as execFileCallback, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { Readable } from 'node:stream'
import type { Writable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessCollectedOutputs,
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'

const execFile = promisify(execFileCallback)

class TestSubprocessHandle implements SubprocessHandle {
  readonly collected: SubprocessCollectedOutputs = {}
  readonly done: Promise<SubprocessOutcome>
  readonly pid: number
  readonly stdin: Writable | undefined
  readonly stdout: Readable | undefined
  readonly stderr: Readable | undefined
  waitForExitCalls = 0

  constructor(
    private readonly child: ReturnType<typeof spawn>,
    spec: SubprocessSpawnSpec,
  ) {
    this.pid = child.pid ?? -1
    this.stdin = spec.stdio.stdin === 'pipe' ? child.stdin ?? undefined : undefined
    this.stdout = spec.stdio.stdout === 'pipe' ? child.stdout ?? undefined : undefined
    this.stderr = spec.stdio.stderr === 'pipe' ? child.stderr ?? undefined : undefined
    this.done = new Promise<SubprocessOutcome>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (exitCode, signal) => { resolve({ exitCode, signal }) })
    })
    if (typeof spec.stdio.stdin === 'object') child.stdin?.end(spec.stdio.stdin.data)
    else if (spec.stdio.stdin === 'ignore') child.stdin?.end()
    const abort = () => { this.terminate() }
    if (spec.signal?.aborted === true) abort()
    else spec.signal?.addEventListener('abort', abort, { once: true })
    void this.done.then(
      () => { spec.signal?.removeEventListener('abort', abort) },
      () => { spec.signal?.removeEventListener('abort', abort) },
    )
  }

  terminate(): void {
    this.child.kill()
  }

  async waitForExit(signal?: AbortSignal): Promise<boolean> {
    this.waitForExitCalls += 1
    if (signal?.aborted === true) return false
    if (signal === undefined) {
      await this.done.catch(() => undefined)
      return true
    }
    return await Promise.race([
      this.done.then(() => true, () => true),
      new Promise<false>((resolve) => {
        signal.addEventListener('abort', () => { resolve(false) }, { once: true })
      }),
    ])
  }
}

/** Test-only local subprocess provider that executes the production package's exact argv. */
export class TestSubprocessRuntime extends SubprocessRuntime {
  readonly executionWorld = 'local' as const
  readonly specs: SubprocessSpawnSpec[] = []
  readonly handles: TestSubprocessHandle[] = []

  constructor(
    ctx: Context,
    private readonly shouldFail?: (spec: SubprocessSpawnSpec) => boolean,
  ) {
    super(ctx)
  }

  async resolveExecutable(command: string, _env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    return command
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    if (spec.stdio.stdout !== 'pipe' || spec.stdio.stderr !== 'pipe') {
      throw new Error('repo-workspace test subprocess accepts only piped Git output')
    }
    this.specs.push(spec)
    const fail = this.shouldFail?.(spec) === true
    const child = spawn(fail ? process.execPath : spec.argv[0] as string, fail ? ['-e', 'process.exit(1)'] : spec.argv.slice(1), {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      shell: false,
      stdio: 'pipe',
      windowsHide: true,
    })
    const handle = new TestSubprocessHandle(child, spec)
    this.handles.push(handle)
    return handle
  }

  spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('repo-workspace tests do not spawn terminals'))
  }
}

export interface ScriptedSubprocessStep {
  readonly stdout?: string | Uint8Array
  readonly stderr?: string | Uint8Array
  readonly exitCode?: number | null
  readonly signal?: NodeJS.Signals | null
  readonly omitStdout?: boolean
  readonly omitStderr?: boolean
  readonly doneError?: Error
  /** Deferred whole-tree quiescence result for await-ownership tests. */
  readonly waitForExit?: Promise<boolean>
  readonly check?: (spec: SubprocessSpawnSpec) => void
}

class ScriptedSubprocessHandle implements SubprocessHandle {
  readonly pid = 1
  readonly stdin = undefined
  readonly collected: SubprocessCollectedOutputs = {}
  readonly stdout: Readable | undefined
  readonly stderr: Readable | undefined
  readonly done: Promise<SubprocessOutcome>
  terminateCalls = 0
  waitForExitCalls = 0
  private readonly waitForExitResult: Promise<boolean>

  constructor(step: ScriptedSubprocessStep) {
    this.stdout = step.omitStdout === true ? undefined : scriptedStream(step.stdout)
    this.stderr = step.omitStderr === true ? undefined : scriptedStream(step.stderr)
    this.done = step.doneError === undefined
      ? Promise.resolve({
        exitCode: step.exitCode === undefined ? 0 : step.exitCode,
        signal: step.signal ?? null,
      })
      : Promise.reject(step.doneError)
    this.waitForExitResult = step.waitForExit ?? Promise.resolve(true)
  }

  terminate(): void {
    this.terminateCalls += 1
  }

  waitForExit(): Promise<boolean> {
    this.waitForExitCalls += 1
    return this.waitForExitResult
  }
}

/** Queue-driven subprocess provider for Git error and output-boundary tests. */
export class ScriptedSubprocessRuntime extends SubprocessRuntime {
  readonly executionWorld = 'local' as const
  readonly specs: SubprocessSpawnSpec[] = []
  readonly handles: ScriptedSubprocessHandle[] = []
  private readonly steps: ScriptedSubprocessStep[] = []

  queue(...steps: ScriptedSubprocessStep[]): void {
    this.steps.push(...steps)
  }

  async resolveExecutable(command: string, _env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    return command
  }

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const step = this.steps.shift()
    if (step === undefined) throw new Error(`no scripted subprocess result for ${spec.argv.join(' ')}`)
    step.check?.(spec)
    this.specs.push(spec)
    const handle = new ScriptedSubprocessHandle(step)
    this.handles.push(handle)
    return handle
  }

  spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('repo-workspace tests do not spawn terminals'))
  }
}

function scriptedStream(value: string | Uint8Array | undefined): Readable {
  if (value === undefined) return Readable.from([])
  return Readable.from([typeof value === 'string' ? value : Buffer.from(value)])
}

/** Execute one Git fixture command outside the production provider. */
export async function fixtureGit(repository: string, ...args: string[]): Promise<string> {
  const result = await execFile('git', ['-C', repository, ...args], { encoding: 'utf8' })
  return result.stdout.trim()
}
