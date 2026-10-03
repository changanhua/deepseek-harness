/** Host-launched task code runs under an identity distinct from the pinned Agent core. */
import { closeSync, openSync } from 'node:fs'
import { mkdir, open, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { WindowsRoleBoundary } from './windows.ts'
import type { WindowsRoleProcess } from './windows.ts'
import { observeVolumeMapping } from './path-adapter.ts'

/** Task output is untrusted; exit/quiescence come from the Host's Job owner. */
export interface IsolatedTaskResult {
  readonly id: string
  readonly status: 'exited' | 'canceled' | 'uncertain'
  readonly quiescent: boolean
  readonly exitCode: number | null
  readonly canceled: boolean
  readonly stdout: string
  readonly stderr: string
  readonly elapsedMs: number
}

/** Private retained native ownership, including a task whose stop could not yet be confirmed. */
export interface TaskCustody {
  readonly result: IsolatedTaskResult
  close(): void
}

/**
 * Execute one bounded Node task using only the case workspace and approved read-only materials.
 * @param input Host-owned runtime, workspace, private output root and limits; only source comes from a role frame.
 * @param signal Cell/role cancellation. Completion awaits the entire task Job.
 * @returns Result and native custody; the enclosing role owns evidence and directory retention.
 */
export async function runIsolatedTask(input: { readonly runtime: string
  readonly cwd: string
  readonly directory: string
  readonly readOnlyInputs: readonly string[]
  readonly source: string
  readonly executionMs: number
  readonly stopMs: number
  readonly maxOutputBytes: number }, signal: AbortSignal): Promise<TaskCustody> {
  if (!Number.isSafeInteger(input.maxOutputBytes) || input.maxOutputBytes < 256) throw new Error('eval-task-output-capacity')
  signal.throwIfAborted()
  const systemRoot = process.env.SystemRoot
  if (!systemRoot) throw new Error('eval-task-system-root-unavailable')
  const startedAt = performance.now()
  const id = randomUUID(), directory = join(input.directory, id), data = join(directory, 'data')
  await mkdir(data, { recursive: true })
  const boundary = WindowsRoleBoundary.create(`dsh.eval.task.${id}`)
  const descriptors: number[] = []
  let child: WindowsRoleProcess | undefined, exitCode: number | null = null, stdout = '', stderr = ''
  let uncertain = false
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(input.executionMs)])
  const stop = () => { try { child?.terminate() } catch { /* Job wait determines quiescence. */ } }
  let closed = false
  const close = () => {
    if (closed) return
    if (child && exitCode === null) throw new Error('eval-task-quiescence-uncertain')
    while (descriptors.length) { const fd = descriptors.at(-1); if (fd === undefined) break; closeSync(fd); descriptors.pop() }
    boundary.close()
    closed = true
  }
  const readOutput = async (path: string, maxBytes: number) => {
    const file = await open(path, 'r')
    try {
      const size = (await file.stat()).size
      if (size > maxBytes) throw new Error('eval-task-output-capacity')
      const buffer = Buffer.alloc(size + 1)
      const read = await file.read(buffer, 0, buffer.length, 0)
      if (read.bytesRead !== size) throw new Error('eval-task-output-changed')
      return buffer.subarray(0, size).toString('utf8')
    } finally { await file.close() }
  }
  try {
    await boundary.grant(input.runtime, false)
    await boundary.grant(input.cwd, true)
    await boundary.grant(data, true)
    for (const path of input.readOnlyInputs) await boundary.grant(path, false)
    const source = join(data, 'task.mjs'), stdin = join(directory, 'stdin')
    await writeFile(source, input.source, { flag: 'wx' }); await writeFile(stdin, '', { flag: 'wx' })
    const stdio = { stdin: openSync(stdin, 'r'), stdout: openSync(join(directory, 'stdout'), 'wx'), stderr: openSync(join(directory, 'stderr'), 'wx') }
    descriptors.push(...Object.values(stdio))
    deadline.throwIfAborted()
    child = boundary.launch({ kind: 'task', executable: join(input.runtime, 'node.exe'),
      args: ['--preserve-symlinks', '--preserve-symlinks-main', '--import', pathToFileURL(join(input.runtime, 'startup.js')).href, source],
      cwd: input.cwd, env: { SystemRoot: systemRoot, LOCALAPPDATA: data, USERPROFILE: data, TEMP: data, TMP: data,
        DSH_EVAL_VOLUME_MAP: JSON.stringify(observeVolumeMapping(input.runtime.slice(0, 2))) }, stdio })
    deadline.addEventListener('abort', stop, { once: true })
    if (deadline.aborted) stop()
    try { exitCode = await child.wait(input.executionMs + input.stopMs) }
    catch { stop(); try { exitCode = await child.wait(input.stopMs) } catch { /* Preserve task ownership. */ } }
    if (exitCode !== null) {
      stdout = await readOutput(join(directory, 'stdout'), input.maxOutputBytes)
      stderr = await readOutput(join(directory, 'stderr'), input.maxOutputBytes - Buffer.byteLength(stdout))
      close()
    }
  } catch (error) {
    uncertain = true
    stdout = ''
    if (child && exitCode === null) { stop(); try { exitCode = await child.wait(input.stopMs) } catch { /* Preserve task ownership. */ } }
    if (!child || exitCode !== null) { try { close() } catch { /* Retain custody for a later close attempt. */ } }
    if (error instanceof Error && error.message === 'eval-task-output-capacity') stderr = 'eval-task-output-capacity'
    else stderr = 'eval-task-execution-uncertain'
  } finally { deadline.removeEventListener('abort', stop) }
  const result: IsolatedTaskResult = { id, status: uncertain || exitCode === null ? 'uncertain' : deadline.aborted ? 'canceled' : 'exited',
    quiescent: !child || exitCode !== null, exitCode, canceled: deadline.aborted, stdout, stderr,
    elapsedMs: Math.ceil(performance.now() - startedAt) }
  if (Buffer.byteLength(JSON.stringify(result)) > input.maxOutputBytes) {
    return { result: { ...result, status: 'uncertain', stdout: '', stderr: 'eval-task-output-capacity' }, close }
  }
  return { result, close }
}
