/** Role lifecycle under a pinned, trusted Harness core. Task code cannot execute in this core's process Job. */
import { closeSync, openSync } from 'node:fs'
import { cp, lstat, mkdir, open, readdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { evalContractDigest } from '@changanhua/dsh-eval'
import type { EvalPlan } from '@changanhua/dsh-eval'
import type { BudgetReference } from '@changanhua/dsh-budget'
import { RuntimeImageCache, observeRuntimeTree } from './build.ts'
import type { RuntimeImageBounds } from './build.ts'
import { WindowsRoleBoundary } from './windows.ts'
import type { WindowsRoleProcess } from './windows.ts'
import { observeVolumeMapping } from './path-adapter.ts'
import { RoleChannel } from './channel.ts'
import { createRoleObserver } from './observer.ts'
import { superviseRoleProcess } from './controller.ts'
import type { RoleProtocolResult, SupervisedRoleResult } from './controller.ts'
import { createGuardedModelBroker } from './broker.ts'
import { compareCoreObservation } from './identity.ts'
import type { CoreObservation } from './identity.ts'
import { ownDirectoryCleanup } from './cleanup.ts'
import { runIsolatedTask } from './task.ts'
import type { TaskCustody } from './task.ts'

/** Trusted Host configuration; no field is accepted from a role frame. */
export interface IsolatedRuntimeConfig {
  readonly root: string
  readonly core: Readonly<Record<'subject' | 'grader', { readonly directory: string
    readonly digest: string
    readonly plugins: readonly { readonly id: string
      readonly module: string
      readonly config?: unknown }[] }>>
  readonly imageBounds: RuntimeImageBounds
  readonly maxFrameBytes: number
  readonly maxRequests: number
  readonly executionMs: number
  readonly graceMs: number
  readonly stopMs: number
  readonly maxResponseBytes: number
  readonly maxModelAttempts: number
}

/** Host-only input, derived by the execution owner from its admitted cell and open workspace lease. */
export interface IsolatedRoleInput {
  readonly role: 'subject' | 'grader'
  readonly verifiedCommit: string
  readonly cwd: string
  readonly prompt: string
  readonly route: EvalPlan['routes'][number]
  readonly budget: BudgetReference
  readonly tools: CoreObservation['tools']
  readonly skills: CoreObservation['skills']
  readonly readOnlyInputs?: readonly string[]
}

/** Outside-Agent facts with an authenticated core registry snapshot; private Host paths are omitted. */
export interface IsolatedRoleObservation {
  readonly executionId: string
  readonly sessionId: string
  readonly role: 'subject' | 'grader'
  readonly verifiedCommit: string
  readonly buildDigest: string
  readonly profile: { readonly id: string
    readonly source: string
    readonly digest: string }
  readonly configDigest: string
  readonly pid: number | null
  readonly elapsedMs: number
  readonly actual: CoreObservation | null
}

/** Live custody of a role's world. Unknown process ownership cannot be released. */
export interface IsolatedRoleResult {
  readonly status: SupervisedRoleResult['status']
  readonly reason: string | null
  readonly output: string | null
  readonly observation: IsolatedRoleObservation
  readonly evidence: RoleProtocolResult
  readonly quiescent: boolean
  /** Receiving Host calls this only after accepting all referenced execution material. */
  acknowledgeEvidence(): void
  /** Remove private role state after evidence acknowledgement and observed process-tree quiescence. */
  release(): Promise<void>
}

/** One run's reusable role images and execution-local custody. It creates neither a Queue nor an Agent loop. */
export class IsolatedRoleRuntime {
  private readonly config: IsolatedRuntimeConfig
  private readonly cache: RuntimeImageCache
  private readonly held = new Set<IsolatedRoleResult>()
  private readonly builders = {
    subject: (destination: string, signal: AbortSignal) => this.buildCore('subject', destination, signal),
    grader: (destination: string, signal: AbortSignal) => this.buildCore('grader', destination, signal),
  }
  private async buildCore(role: 'subject' | 'grader', destination: string, signal: AbortSignal): Promise<void> {
    const core = this.config.core[role]
    const source = await observeRuntimeTree(core.directory, this.config.imageBounds, signal)
    if (source.digest !== core.digest) throw new Error('eval-core-identity-mismatch')
    for (const name of await readdir(core.directory)) {
      signal.throwIfAborted()
      await cp(join(core.directory, name), join(destination, name), { recursive: true, force: false, errorOnExist: true })
    }
    if ((await observeRuntimeTree(destination, this.config.imageBounds, signal)).digest !== source.digest) throw new Error('eval-core-identity-mismatch')
  }

  constructor(private readonly ctx: Context, config: IsolatedRuntimeConfig) {
    this.config = structuredClone(config)
    if (!isAbsolute(config.root)) throw new Error('eval-runtime-invalid-config')
    for (const role of ['subject', 'grader'] as const) {
      const core = config.core[role]
      if (!isAbsolute(core.directory) || !/^[a-f0-9]{64}$/u.test(core.digest) || !Array.isArray(core.plugins)) throw new Error('eval-runtime-invalid-config')
    }
    for (const value of [config.maxFrameBytes, config.maxRequests, config.executionMs, config.graceMs,
      config.stopMs, config.maxResponseBytes, config.maxModelAttempts]) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error('eval-runtime-invalid-bound')
    }
    this.cache = new RuntimeImageCache(join(config.root, 'images'), config.imageBounds)
  }

  /**
   * Run one role with Host-held original handles and authenticated observations from the pinned core.
   * @param supplied Exact cell-derived role, route, Budget and workspace binding; never wire-authorized paths.
   * @param signal Queue-owned cancellation, extended only by bounded shutdown time.
   * @returns Retained world/evidence ownership; completed certification belongs to the outer cell owner.
   */
  async run(supplied: IsolatedRoleInput, signal: AbortSignal): Promise<IsolatedRoleResult> {
    const startedAt = performance.now()
    const input = structuredClone(supplied), config = this.config
    const systemRoot = process.env.SystemRoot
    if (!systemRoot) throw new Error('eval-runtime-system-root-unavailable')
    if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('eval-isolation-platform-unavailable')
    const contains = (parent: string, child: string) => {
      const rel = relative(parent, child)
      return !rel || !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
    }
    if (!['subject', 'grader'].includes(input.role) || !isAbsolute(input.cwd)
      || (await lstat(input.cwd)).isSymbolicLink() || await realpath(input.cwd) !== resolve(input.cwd)
      || contains(input.cwd, config.root)) throw new Error('eval-runtime-workspace-refused')
    if (input.cwd.slice(0, 2).toLowerCase() !== config.root.slice(0, 2).toLowerCase()) throw new Error('eval-runtime-volume-mismatch')
    const image = await this.cache.prepare(input.role, input.verifiedCommit, this.builders[input.role], signal)
    const runtime = await this.cache.verify(image, signal)
    const executionId = randomUUID(), sessionId = `eval-${executionId}`
    const directory = join(config.root, 'executions', executionId), home = join(directory, 'home'), data = join(home, 'data')
    const profile = join(home, 'profiles/eval-isolated'), broker = join(data, 'broker')
    await mkdir(broker, { recursive: true })
    await mkdir(profile, { recursive: true })
    const removeDirectory = await ownDirectoryCleanup(directory)
    await this.linkPackages(runtime, home)
    const boundary = WindowsRoleBoundary.create(`dsh.eval.${executionId}`)
    const descriptors: number[] = []
    const tasks: TaskCustody[] = []
    const observer = createRoleObserver(executionId, sessionId)
    const bootstrap = join(directory, 'bootstrap')
    let channel: RoleChannel | undefined, child: WindowsRoleProcess | undefined
    let actual: CoreObservation | null = null, mismatch = false, configDigest = '', profileDigest = ''
    let completed: SupervisedRoleResult | undefined
    const readProfile = async () => {
      const file = await open(join(profile, 'cordis.yml'), 'r')
      try {
        const size = (await file.stat()).size
        if (size > config.maxFrameBytes) throw new Error('eval-runtime-profile-capacity')
        const buffer = Buffer.alloc(size + 1)
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        if (bytesRead !== size) throw new Error('eval-runtime-profile-changed')
        return buffer.subarray(0, size)
      } finally { await file.close() }
    }
    const empty: RoleProtocolResult = { status: 'uncertain', reason: 'eval-role-startup-uncertain',
      rawReports: { ready: null, complete: null }, accounting: [], observations: [], tasks: [] }
    try {
      const rows = this.rows(runtime, data, broker, sessionId, input)
      const patch = JSON.stringify([{ insert: rows }])
      if (Buffer.byteLength(patch) > config.maxFrameBytes) throw new Error('eval-runtime-profile-capacity')
      await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'eval-isolated-profile', private: true,
        dsh: { profile: { bundles: [], patchReload: 'startup' } } }))
      await writeFile(join(profile, 'cordis.patch.yml'), patch)
      await writeFile(bootstrap, observer.bootstrap, { flag: 'wx' })
      channel = await RoleChannel.create(broker, config.maxFrameBytes)
      await boundary.grant(runtime, false)
      await boundary.grant(home, true)
      await boundary.grant(data, true)
      await boundary.grant(input.cwd, true)
      for (const material of input.readOnlyInputs ?? []) {
        if (!isAbsolute(material) || (await lstat(material)).isSymbolicLink() || await realpath(material) !== resolve(material)
          || contains(input.cwd, material) || contains(material, input.cwd)) throw new Error('eval-runtime-readonly-input-refused')
        await boundary.grant(material, false)
      }
      const stdio = { stdin: openSync(bootstrap, 'r'), stdout: openSync(join(directory, 'stdout'), 'wx'), stderr: openSync(join(directory, 'stderr'), 'wx') }
      descriptors.push(...Object.values(stdio))
      child = boundary.launch({ kind: 'core', executable: join(runtime, 'node.exe'),
        args: ['--preserve-symlinks', '--preserve-symlinks-main', '--import', pathToFileURL(join(runtime, 'startup.js')).href,
          join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '--profile', 'eval-isolated'], cwd: input.cwd,
        env: { SystemRoot: systemRoot, LOCALAPPDATA: data, USERPROFILE: home, TEMP: data, TMP: data,
          DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', DSH_EVAL_VOLUME_MAP: JSON.stringify(observeVolumeMapping(runtime.slice(0, 2))) }, stdio })
      completed = await superviseRoleProcess(child, channel, { sessionId, maxRequests: config.maxRequests, observer,
        observe: (observation) => {
          const compared = compareCoreObservation(observation, { sessionId, preset: input.route.preset,
            tools: input.tools, skills: input.skills })
          actual = compared.actual
          if (!compared.valid) { mismatch = true; throw new Error('eval-role-identity-mismatch') }
        },
        ready: async () => {
          await writeFile(bootstrap, '')
          await boundary.grant(home, false)
          const composed = await readProfile()
          profileDigest = createHash('sha256').update(composed).digest('hex')
          configDigest = evalContractDigest({ profileDigest, patchDigest: createHash('sha256').update(patch).digest('hex'),
            route: input.route, core: image.buildDigest })
        },
        model: createGuardedModelBroker(this.ctx, { route: input.route, budget: input.budget, sessionId,
          maxResponseBytes: config.maxResponseBytes, maxAttempts: config.maxModelAttempts }),
        task: async (source, taskSignal) => {
          const task = await runIsolatedTask({ runtime, cwd: input.cwd, directory: join(directory, 'tasks'), source,
            readOnlyInputs: input.readOnlyInputs ?? [], executionMs: config.executionMs, stopMs: config.stopMs,
            maxOutputBytes: config.maxResponseBytes }, taskSignal)
          tasks.push(task)
          return task.result
        },
      }, config, signal)
      if (tasks.some(task => !task.result.quiescent)) completed = {
        ...completed, status: 'uncertain', reason: 'eval-task-quiescence-uncertain', quiescent: false }
      await this.cache.verify(image, new AbortController().signal)
      if (profileDigest && createHash('sha256').update(await readProfile()).digest('hex') !== profileDigest) {
        mismatch = true
      }
    } catch (error) {
      if (completed) completed = { ...completed, status: 'uncertain', reason: error instanceof Error && error.message.startsWith('eval-')
        ? error.message : 'eval-role-observation-uncertain' }
      if (child && !completed?.quiescent) {
        try { child.terminate(); await child.wait(config.stopMs) }
        catch { completed = { status: 'uncertain', reason: 'eval-role-quiescence-uncertain', quiescent: false, exitCode: null, protocol: null } }
      }
      completed ??= { status: 'uncertain', reason: 'eval-role-startup-uncertain', quiescent: true, exitCode: null, protocol: null }
    } finally {
      await writeFile(bootstrap, '').catch(() => {})
    }
    let resourcesClosed = false
    const closeResources = async () => {
      if (resourcesClosed) return
      await channel?.close()
      for (const task of tasks) task.close()
      while (descriptors.length) { const fd = descriptors.at(-1); if (fd === undefined) break; closeSync(fd); descriptors.pop() }
      boundary.close()
      resourcesClosed = true
    }
    if (completed.quiescent) {
      try { await closeResources() }
      catch { completed = { ...completed, status: 'uncertain', reason: 'eval-role-cleanup-uncertain' } }
    }
    const settled = completed
    const protocol = settled.protocol ?? empty
    const report = protocol.rawReports.complete as { output?: unknown } | null
    let accepted = false, released = false
    const result: IsolatedRoleResult = {
      status: mismatch && settled.status !== 'uncertain' && settled.exitCode === 0 && settled.protocol?.rawReports.complete ? 'invalid' : settled.status,
      reason: mismatch && settled.status !== 'uncertain' ? 'eval-role-identity-mismatch' : settled.reason,
      output: typeof report?.output === 'string' ? report.output : null,
      observation: { executionId, sessionId, role: input.role, verifiedCommit: input.verifiedCommit,
        buildDigest: image.buildDigest, profile: { id: 'eval-isolated', source: 'profile:host-pinned-core', digest: profileDigest },
        configDigest, pid: child?.pid ?? null, elapsedMs: Math.ceil(performance.now() - startedAt), actual },
      evidence: protocol, quiescent: settled.quiescent,
      acknowledgeEvidence: () => { accepted = true },
      release: async () => {
        if (released) return
        if (!accepted) throw new Error('eval-evidence-ack-required')
        if (!settled.quiescent) throw new Error('eval-role-quiescence-uncertain')
        await closeResources()
        await removeDirectory()
        released = true
        this.held.delete(result)
      },
    }
    this.held.add(result)
    return result
  }

  private async linkPackages(runtime: string, home: string): Promise<void> {
    const modules = join(runtime, 'node_modules')
    for (const group of await readdir(modules)) {
      const names = group.startsWith('@') ? (await readdir(join(modules, group))).map(name => `${group}/${name}`) : [group]
      for (const name of names) {
        const target = join(home, 'profiles/node_modules', name)
        await mkdir(dirname(target), { recursive: true })
        await symlink(join(modules, name), target, 'junction')
      }
    }
    await mkdir(join(home, 'profiles/eval-isolated/node_modules'), { recursive: true })
    await mkdir(join(home, 'profiles/eval-isolated/.dsh-module-fallback/node_modules'), { recursive: true })
  }

  private rows(runtime: string, data: string, broker: string, sessionId: string, input: IsolatedRoleInput) {
    const extra = this.config.core[input.role].plugins.map((plugin) => {
      if (isAbsolute(plugin.module) || plugin.module.includes(':') || plugin.module.split(/[\\/]/u).some(part => !part || part === '..')) {
        throw new Error('eval-runtime-plugin-path-refused')
      }
      return { id: `extra-${plugin.id}`, name: pathToFileURL(join(runtime, plugin.module)).href, config: plugin.config }
    })
    return [
      { id: 'llm', name: '@deepseek-ai/dsh-llm' }, { id: 'sessions', name: '@deepseek-ai/dsh-session' },
      { id: 'projections', name: '@deepseek-ai/dsh-session-projection' }, { id: 'prompt', name: '@deepseek-ai/dsh-system-prompt' },
      { id: 'tools', name: '@deepseek-ai/dsh-tools', config: { mode: 'native' } }, { id: 'agents', name: '@deepseek-ai/dsh-agent' },
      { id: 'loop', name: '@deepseek-ai/dsh-agent-loop', config: { agents: [] } }, { id: 'skills', name: '@deepseek-ai/dsh-skill' },
      { id: 'persistence', name: '@deepseek-ai/dsh-session-persistence-jsonl', config: { root: join(data, 'sessions'), compression: 'none' } },
      { id: 'presets', name: '@deepseek-ai/dsh-agent-presets', config: { default: input.route.preset.id, includeShippedRoot: false,
        includeUserRoot: false, roots: [{ path: join(runtime, 'presets'), trust: 'system' }] } },
      ...extra,
      { id: 'worker', name: pathToFileURL(join(runtime, 'worker.js')).href, config: { channelDirectory: broker,
        maxFrameBytes: this.config.maxFrameBytes, timeoutMs: this.config.executionMs, cleanupTimeoutMs: this.config.graceMs,
        sessionId, prompt: input.prompt, route: input.route } },
    ]
  }
}
