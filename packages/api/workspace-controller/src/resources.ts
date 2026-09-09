/** Project-owned files and Host-owned local service processes. */
import { randomUUID } from 'node:crypto'
import { open, mkdir, realpath, rename, unlink, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import type { SubprocessRuntime, SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import type { ProjectResource, ResourceId, ResourceInput, ResourceView, ResourceList, ResourceFile } from './types.ts'

const name = z.string().trim().min(1)
const serviceFields = { name, cwd: z.string().min(1), command: z.string().trim().min(1),
  url: z.url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol)).optional() }
const inputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('note'), name, content: z.string() }).strict(),
  z.object({ kind: z.literal('file'), name, path: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('service'), ...serviceFields }).strict(),
])
const recordSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.uuid(), kind: z.literal('note'), name, path: z.string().min(1) }).strict(),
  z.object({ id: z.uuid(), kind: z.literal('file'), name, path: z.string().min(1) }).strict(),
  z.object({ id: z.uuid(), kind: z.literal('service'), ...serviceFields }).strict(),
])
const configSchema = z.object({ version: z.literal(1), entries: z.array(recordSchema) }).strict()
  .refine(value => new Set(value.entries.map(entry => entry.id)).size === value.entries.length, 'duplicate resource id')

interface Run {
  workspaceId: WorkspaceId
  entry: ProjectResource
  handle: SubprocessHandle
  status: ResourceView['status']
  error?: string
  exitCode?: number | null
}

/** Bounds supplied by the Workspace Controller's validated configuration. */
export interface ResourceOptions { maxBytes: number; logBytes: number; graceMs: number }

/** Resource storage and process ownership shared by the Workspace Remote operations. */
export class ProjectResources {
  private readonly operations = new Map<WorkspaceId, Promise<unknown>>()
  private readonly runs = new Map<string, Run>()
  private closing?: Promise<void>

  /**
   * @param root - resolves a registered Workspace directory.
   * @param subprocess - current local process provider.
   * @param options - validated read, output and teardown bounds.
   */
  constructor(private readonly root: (id: WorkspaceId) => string | Promise<string>,
    private readonly subprocess: () => SubprocessRuntime, private readonly options: ResourceOptions) {}

  /**
   * Return current disk entries and owned process observations.
   * @param workspaceId - registered project.
   * @returns project resources and their configuration path.
   */
  async list(workspaceId: WorkspaceId): Promise<ResourceList> {
    return this.serial(workspaceId, async (root) => {
      const entries = await this.load(root)
      // A manually removed recipe must not hide a process this Host still owns.
      for (const run of this.runs.values()) {
        if (run.workspaceId === workspaceId && run.status === 'running' && !entries.some(entry => entry.id === run.entry.id)) entries.push(run.entry)
      }
      return { entries: entries.map(entry => this.view(workspaceId, entry)), configPath: join(root, '.dsh', 'resources.json') }
    })
  }

  /**
   * Persist a file reference, Markdown note or service recipe.
   * @param workspaceId - registered project.
   * @param input - validated human input.
   * @returns the saved entry.
   */
  async add(workspaceId: WorkspaceId, input: ResourceInput): Promise<ResourceView> {
    this.checkSize(JSON.stringify(input))
    const value = inputSchema.parse(input)
    return this.serial(workspaceId, root => this.writeTransaction(root, async () => {
      const entries = await this.load(root)
      const id = randomUUID() as ResourceId
      let entry: ProjectResource
      if (value.kind === 'service') {
        await this.existing(root, value.cwd, 'directory')
        entry = { id, ...value }
      } else if (value.kind === 'file') {
        const path = await this.existing(root, value.path, 'file')
        entry = { id, ...value, path: relative(root, path) }
      } else {
        this.checkSize(value.content)
        await this.directory(root, '.dsh')
        const directory = await this.directory(root, '.dsh/resources')
        const path = join(directory, `${id}.md`)
        entry = { id, kind: 'note', name: value.name, path: relative(root, path) }
        this.checkSize(JSON.stringify({ version: 1, entries: [...entries, entry] }))
        const file = await open(path, 'wx', 0o600)
        try { await file.writeFile(value.content, 'utf8') } finally { await file.close() }
      }
      await this.save(root, [...entries, entry])
      return this.view(workspaceId, entry)
    }))
  }

  /**
   * Read a bounded project text file without rendering markup.
   * @param workspaceId - registered project.
   * @param id - resource identity.
   * @returns plain text and its resolved path.
   */
  async read(workspaceId: WorkspaceId, id: ResourceId): Promise<ResourceFile> {
    return this.serial(workspaceId, async (root) => {
      const entry = this.find(await this.load(root), id)
      if (entry.kind === 'service') throw new Error('Service resources have logs, not file contents')
      const path = await this.existing(root, entry.path, 'file')
      const text = await this.readText(path)
      if (text.includes('\0')) throw new Error(`Binary file cannot be previewed: ${path}`)
      return { path, text }
    })
  }

  /**
   * Remove the registration, retaining its original files.
   * @param workspaceId - registered project.
   * @param id - resource identity; running services must first be stopped.
   */
  async remove(workspaceId: WorkspaceId, id: ResourceId): Promise<void> {
    return this.serial(workspaceId, root => this.writeTransaction(root, async () => {
      if (this.runs.get(this.key(workspaceId, id))?.status === 'running') throw new Error('Stop the service before removing it')
      const entries = await this.load(root)
      this.find(entries, id)
      await this.save(root, entries.filter(entry => entry.id !== id))
      this.runs.delete(this.key(workspaceId, id))
    }))
  }

  /**
   * Start one local foreground command, idempotently while owned.
   * @param workspaceId - registered project.
   * @param id - service resource identity.
   * @returns process observation; running does not imply application health.
   */
  async start(workspaceId: WorkspaceId, id: ResourceId): Promise<ResourceView> {
    return this.serial(workspaceId, async (root) => {
      const key = this.key(workspaceId, id)
      const previous = this.runs.get(key)
      if (previous?.status === 'running') return this.view(workspaceId, previous.entry)
      const entry = this.find(await this.load(root), id)
      if (entry.kind !== 'service') throw new Error('Only service resources can be started')
      const cwd = await this.existing(root, entry.cwd, 'directory')
      const runtime = this.subprocess()
      if (runtime.executionWorld !== 'local') throw new Error('Project services require a local subprocess provider')
      const executable = await runtime.resolveExecutable(process.platform === 'win32' ? 'powershell.exe' : 'sh')
      const argv = process.platform === 'win32'
        ? [executable, '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(entry.command, 'utf16le').toString('base64')]
        : [executable, '-c', entry.command]
      if (this.closing !== undefined) throw new Error('Project resources are closed')
      const handle = runtime.spawn({ argv, cwd, graceMs: this.options.graceMs,
        stdio: { stdin: 'ignore', stdout: { maxBytes: Math.ceil(this.options.logBytes / 2) },
          stderr: { maxBytes: Math.floor(this.options.logBytes / 2) } } })
      const run: Run = { workspaceId, entry, handle, status: 'running' }
      this.runs.set(key, run)
      void handle.done.then(async (outcome) => {
        // An exiting shell may leave descendants; keep ownership until the tree is gone.
        handle.terminate()
        await handle.waitForExit()
        if (run.status === 'running') run.status = outcome.exitCode === 0 ? 'exited' : 'failed'
        run.exitCode = outcome.exitCode
      }, (error: unknown) => { run.status = 'failed'; run.error = String(error) }).catch((error: unknown) => {
        run.error = String(error)
      })
      return this.view(workspaceId, entry)
    })
  }

  /**
   * Terminate only this Host's owned process tree and await exit.
   * @param workspaceId - registered project.
   * @param id - resource identity.
   */
  async stop(workspaceId: WorkspaceId, id: ResourceId): Promise<void> {
    return this.enqueue(workspaceId, async () => {
      const run = this.runs.get(this.key(workspaceId, id))
      if (run === undefined) return
      await this.stopRun(run)
    })
  }

  /** Refuse new operations, drain admitted writes and stop all owned process trees. */
  async dispose(): Promise<void> {
    this.closing ??= (async () => {
      await Promise.allSettled([...this.operations.values()])
      await Promise.all([...this.runs.values()].map(run => this.stopRun(run)))
      this.runs.clear()
    })()
    await this.closing
  }

  private async stopRun(run: Run): Promise<void> {
    run.handle.terminate()
    await run.handle.waitForExit()
    await run.handle.done.catch(() => { /* A spawn failure has no live child; its error stays on the run. */ })
    run.status = 'stopped'
  }

  private serial<T>(workspaceId: WorkspaceId, operation: (root: string) => Promise<T>): Promise<T> {
    return this.enqueue(workspaceId, async () => operation(await realpath(await this.root(workspaceId))))
  }

  private enqueue<T>(workspaceId: WorkspaceId, operation: () => Promise<T>): Promise<T> {
    if (this.closing !== undefined) return Promise.reject(new Error('Project resources are closed'))
    const result = (this.operations.get(workspaceId) ?? Promise.resolve())
      .catch(() => { /* A rejected operation does not block the next explicit operation. */ }).then(operation)
    this.operations.set(workspaceId, result)
    void result.finally(() => { if (this.operations.get(workspaceId) === result) this.operations.delete(workspaceId) })
      .catch(() => { /* The original result carries the failure to its caller. */ })
    return result
  }

  private key(workspaceId: WorkspaceId, id: ResourceId): string { return `${workspaceId}:${id}` }
  private find(entries: ProjectResource[], id: ResourceId): ProjectResource {
    const entry = entries.find(value => value.id === id)
    if (entry === undefined) throw new Error(`Unknown project resource: ${id}`)
    return entry
  }
  private view(workspaceId: WorkspaceId, entry: ProjectResource): ResourceView {
    const run = this.runs.get(this.key(workspaceId, entry.id))
    if (run === undefined) return { ...entry, status: entry.kind === 'service' ? 'stopped' : 'file' }
    const stdout = run.handle.collected.stdout?.readFrom(0)
    const stderr = run.handle.collected.stderr?.readFrom(0)
    return { ...run.entry, status: run.status, pid: run.handle.pid, logs: (stdout?.text ?? '') + (stderr?.text ?? ''),
      logsTruncated: stdout?.lossy === true || stderr?.lossy === true,
      ...(run.error === undefined ? {} : { error: run.error }), ...(run.exitCode === undefined ? {} : { exitCode: run.exitCode }) }
  }

  private contained(root: string, path: string): void {
    const rel = relative(root, path)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Resource path must stay inside the project')
  }
  private async existing(root: string, path: string, kind: 'file' | 'directory'): Promise<string> {
    const lexical = resolve(root, path)
    this.contained(root, lexical)
    const canonical = await realpath(lexical)
    this.contained(root, canonical)
    const metadata = await stat(canonical)
    if (kind === 'file' ? !metadata.isFile() : !metadata.isDirectory()) throw new Error(`Expected ${kind}: ${path}`)
    return canonical
  }
  private async directory(root: string, path: string): Promise<string> {
    try { return await this.existing(root, path, 'directory') } catch (error) {
      if (!missing(error)) throw error
    }
    const target = resolve(root, path)
    this.contained(root, target)
    try { await mkdir(target) } catch (error) { if (!hasCode(error, 'EEXIST')) throw error }
    return this.existing(root, path, 'directory')
  }
  private checkSize(text: string): void {
    if (Buffer.byteLength(text, 'utf8') > this.options.maxBytes) throw new Error(`Resource exceeds ${this.options.maxBytes} bytes`)
  }
  private async readText(path: string): Promise<string> {
    const file = await open(path, 'r')
    try {
      if (!(await file.stat()).isFile()) throw new Error(`Expected file: ${path}`)
      const bytes = Buffer.alloc(this.options.maxBytes + 1)
      let offset = 0
      while (offset < bytes.length) {
        const read = await file.read(bytes, offset, bytes.length - offset, offset)
        if (read.bytesRead === 0) break
        offset += read.bytesRead
      }
      if (offset > this.options.maxBytes) throw new Error(`Resource exceeds ${this.options.maxBytes} bytes: ${path}`)
      return bytes.subarray(0, offset).toString('utf8')
    } finally { await file.close() }
  }
  private async load(root: string): Promise<ProjectResource[]> {
    let path: string
    try {
      await this.existing(root, '.dsh', 'directory')
      path = await this.existing(root, '.dsh/resources.json', 'file')
    } catch (error) { if (missing(error)) return []; throw error }
    return configSchema.parse(JSON.parse(await this.readText(path))).entries.map(entry => ({ ...entry, id: entry.id as ResourceId }))
  }
  private async save(root: string, entries: ProjectResource[]): Promise<void> {
    const text = `${JSON.stringify({ version: 1, entries }, null, 2)}\n`
    this.checkSize(text)
    const directory = await this.directory(root, '.dsh')
    const temporary = join(directory, `resources-${randomUUID()}.tmp`)
    const file = await open(temporary, 'wx', 0o600)
    try {
      try { await file.writeFile(text, 'utf8') } finally { await file.close() }
      await rename(temporary, join(directory, 'resources.json'))
    } finally {
      try { await unlink(temporary) } catch (error) { if (!missing(error)) throw error }
    }
  }

  private async writeTransaction<T>(root: string, operation: () => Promise<T>): Promise<T> {
    const directory = await this.directory(root, '.dsh')
    const path = join(directory, 'resources.lock')
    let lock
    try { lock = await open(path, 'wx', 0o600) } catch (error) {
      if (hasCode(error, 'EEXIST')) throw new Error(`Resource update is busy: ${path}. Retry after the other writer finishes. After a crash, remove this lock only when no writer is active.`)
      throw error
    }
    try { return await operation() } finally { await lock.close(); await unlink(path) }
  }
}

function hasCode(error: unknown, code: string): boolean { return error instanceof Error && 'code' in error && error.code === code }
function missing(error: unknown): boolean { return hasCode(error, 'ENOENT') }
