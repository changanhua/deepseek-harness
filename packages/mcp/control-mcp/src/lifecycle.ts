/** Own the isolated DSH Web Host used by one control-mcp process. */

import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export interface ManagedHostOptions {
  readonly runId: string
  readonly hostHome?: string
  readonly hostPatch?: string
  readonly executable?: string
  readonly cliEntry?: string
  readonly cwd?: string
  readonly startupTimeoutMs?: number
  readonly killTimeoutMs?: number
  readonly env?: NodeJS.ProcessEnv
  readonly spawn?: typeof nodeSpawn
}

export interface ManagedHost {
  readonly origin: string
  readonly token: string
  readonly home: string
  stop(): Promise<void>
}

interface HostLaunchAnnouncement {
  readonly origin: string
  readonly token: string
}

/** Start one local Web Host and own its child process until disposal. */
export async function startManagedDshHost(options: ManagedHostOptions): Promise<ManagedHost> {
  const home = options.hostHome ?? await mkdtemp(join(tmpdir(), 'dsh-control-host-'))
  const ownsHome = options.hostHome === undefined
  const executable = options.executable ?? process.execPath
  const cliEntry = options.cliEntry ?? process.argv[1]
  if (cliEntry === undefined || cliEntry.length === 0) {
    if (ownsHome) await removeHome(home)
    throw new Error('cannot auto-start DSH Host: CLI entry is unavailable')
  }
  const patch = options.hostPatch ?? defaultHostPatch()
  // `pnpm dsh` runs the source CLI through tsx. Preserve that loader when the
  // managed child also uses the source entry; built CLI entries stay plain
  // Node processes and do not inherit the parent test/runtime flags.
  const nodeArgs = cliEntry.endsWith('.ts') ? process.execArgv : []
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    DSH_HOME: home,
    DSH_CONTROL_RUN_ID: options.runId,
  }
  delete env.DSH_CONTROL_ORIGIN
  delete env.DSH_CONTROL_TOKEN
  const child = (options.spawn ?? nodeSpawn)(executable, [...nodeArgs,
    cliEntry,
    '--profile', 'web',
    '--patch', patch,
    '--no-open',
    '--port', '0',
  ], {
    cwd: options.cwd ?? process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  try {
    const announcement = await readAnnouncement(child, options.startupTimeoutMs ?? 30_000)
    let stopped = false
    return {
      ...announcement,
      home,
      stop: async () => {
        if (stopped) return
        stopped = true
        await stopChild(child, options.killTimeoutMs ?? 5_000)
        if (ownsHome) await removeHome(home)
      },
    }
  } catch (error) {
    await stopChild(child, options.killTimeoutMs ?? 5_000).catch(() => {})
    if (ownsHome) await removeHome(home)
    throw error
  }
}

/** Extract the clean Host origin and launch token from the Web app announcement. */
export function parseHostAnnouncement(line: string): HostLaunchAnnouncement | undefined {
  const match = /^dsh web: (http:\/\/(?:127\.0\.0\.1|localhost):\d+)\/\?token=([^\s()]+)(?:\s|$)/u.exec(line.trim())
  if (match === null) return undefined
  const origin = match[1]
  const token = match[2]
  if (origin === undefined || token === undefined || token.length === 0) return undefined
  return { origin, token }
}

function readAnnouncement(child: ChildProcess, timeoutMs: number): Promise<HostLaunchAnnouncement> {
  return new Promise((resolve, reject) => {
    let output = ''
    let settled = false
    const timer = setTimeout(() => finish(new Error(`DSH Host did not announce readiness within ${String(timeoutMs)}ms`)), timeoutMs)
    const finish = (error?: Error, value?: HostLaunchAnnouncement): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdout?.off('data', onStdout)
      child.stderr?.off('data', onStderr)
      child.off('error', onError)
      child.off('exit', onExit)
      if (error !== undefined) reject(error)
      else if (value !== undefined) resolve(value)
      else reject(new Error('DSH Host exited before announcing readiness'))
    }
    const inspect = (chunk: unknown): void => {
      output += String(chunk)
      for (const line of output.split(/\r?\n/u)) {
        const announcement = parseHostAnnouncement(line)
        if (announcement !== undefined) {
          finish(undefined, announcement)
          return
        }
      }
      if (output.length > 64_000) output = output.slice(-32_000)
    }
    const onStdout = (chunk: unknown): void => inspect(chunk)
    const onStderr = (chunk: unknown): void => inspect(chunk)
    const onError = (error: Error): void => finish(error)
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish(new Error(`DSH Host exited before readiness (code=${String(code)}, signal=${String(signal)})`))
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', onStdout)
    child.stderr?.on('data', onStderr)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

async function stopChild(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve())
  })
  child.kill('SIGTERM')
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    exited,
    new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs) }),
  ])
  if (timer !== undefined) clearTimeout(timer)
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await exited
  }
}

async function removeHome(home: string): Promise<void> {
  await rm(home, { recursive: true, force: true })
}

function defaultHostPatch(): string {
  const candidates = [
    fileURLToPath(new URL('../../host.cordis.patch.yml', import.meta.url)),
    fileURLToPath(new URL('../host.cordis.patch.yml', import.meta.url)),
  ]
  const found = candidates.find(path => existsSync(path))
  if (found !== undefined) return found
  return join(dirname(fileURLToPath(import.meta.url)), 'host.cordis.patch.yml')
}
