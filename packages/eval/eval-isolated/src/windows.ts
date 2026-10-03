/** Windows boundary for Eval roles. This module never inherits model credentials or network capabilities. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import koffi from 'koffi'
import {
  closeHandleChecked, isJobEmpty, loadWin32ProcessBindings, pollProcessExit,
  spawnCurrentTokenJobProcess, terminateJob,
} from '@deepseek-ai/dsh-win32-process'
import type { NativePtr, SpawnedJobProcess } from '@deepseek-ai/dsh-win32-process'

const runFile = promisify(execFile)
const STARTUP_INFO_SIZE = 104
const STARTUP_INFO_EX_SIZE = 112

/** A launch failure is distinct from a child whose effects or cleanup are uncertain. */
export class IsolationError extends Error {
  constructor(readonly code: string, options?: ErrorOptions) { super(code, options); this.name = 'IsolationError' }
}

function bindings() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new IsolationError('isolation-platform-unavailable')
  const kernel = koffi.load('kernel32.dll')
  const userenv = koffi.load('userenv.dll')
  const advapi = koffi.load('advapi32.dll')
  return {
    create: userenv.func('int32 __stdcall CreateAppContainerProfile(str16, str16, str16, void *, uint32, void **)'),
    remove: userenv.func('int32 __stdcall DeleteAppContainerProfile(str16)'),
    sidString: advapi.func('int __stdcall ConvertSidToStringSidW(void *, void **)'),
    freeSid: advapi.func('void * __stdcall FreeSid(void *)'),
    freeLocal: kernel.func('void * __stdcall LocalFree(void *)'),
    initialize: kernel.func('int __stdcall InitializeProcThreadAttributeList(void *, uint32, uint32, size_t *)'),
    update: kernel.func('int __stdcall UpdateProcThreadAttribute(void *, uint32, size_t, void *, size_t, void *, void *)'),
    deleteAttributes: kernel.func('void __stdcall DeleteProcThreadAttributeList(void *)'),
    setError: kernel.func('void __stdcall SetLastError(uint32)'),
    descriptor: advapi.func('int __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(str16,uint32,void **,void *)'),
    protect: advapi.func('int __stdcall SetKernelObjectSecurity(void *,uint32,void *)'),
  }
}

/** Private launch input: paths and descriptors are prepared by the Host, never accepted over the worker protocol. */
export interface WindowsRoleLaunch {
  /** Core Jobs forbid direct task children; Host-launched task Jobs have a distinct AppContainer identity. */
  readonly kind: 'core' | 'task'
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  readonly stdio: { readonly stdin: number
    readonly stdout: number
    readonly stderr: number }
}

/** One fresh AppContainer identity, owned until all of its Jobs are quiescent. */
export class WindowsRoleBoundary {
  private readonly native = bindings()
  private readonly api = loadWin32ProcessBindings()
  private sid: NativePtr | undefined
  private readonly jobs = new Set<SpawnedJobProcess>()
  private closed = false
  private constructor(readonly moniker: string, readonly sidText: string, sid: NativePtr) { this.sid = sid }

  /**
   * Mint a new zero-capability identity. Existing profiles are never adopted.
   * @param moniker Host-generated unique role identity.
   * @returns Boundary owning exactly this AppContainer profile.
   */
  static create(moniker: string): WindowsRoleBoundary {
    const native = bindings()
    const slot = koffi.alloc('void *', 1) as NativePtr
    let sid: NativePtr | undefined
    try {
      const result = native.create(moniker, moniker, 'DSH isolated Eval role', null, 0, slot) as number
      if (result < 0) throw new IsolationError('isolation-profile-create-failed')
      sid = koffi.decode(slot, 'void *') as NativePtr
      if (!native.sidString(sid, slot)) throw new IsolationError('isolation-sid-unavailable')
      const stringPointer = koffi.decode(slot, 'void *') as NativePtr
      let text: string
      try { text = koffi.decode(slot, 'str16') as string } finally { native.freeLocal(stringPointer) }
      return new WindowsRoleBoundary(moniker, text, sid)
    } catch (error) {
      if (sid !== undefined) { native.freeSid(sid); native.remove(moniker) }
      throw error
    } finally { koffi.free(slot) }
  }

  /**
   * Grant access to a newly created Host-owned role directory.
   * @param directory Fresh verified directory; the caller owns containment and link rejection.
   * @param writable Whether this is cell data rather than sealed code.
   */
  async grant(directory: string, writable: boolean): Promise<void> {
    this.assertOpen()
    const systemRoot = process.env.SystemRoot
    if (!systemRoot) throw new IsolationError('isolation-system-root-unavailable')
    await runFile(`${systemRoot}\\System32\\icacls.exe`, [directory, '/grant:r',
      `*${this.sidText}:(OI)(CI)${writable ? 'M' : 'RX'}`], { windowsHide: true })
    this.assertOpen()
  }

  /**
   * Launch suspended, whitelist only the three carrier handles, attach a kill-on-close Job, then resume.
   * @param input Complete allowlisted environment and Host-owned standard streams.
   * @returns Process identity and lifecycle ownership; no child handle is released on timeout.
   */
  launch(input: WindowsRoleLaunch): WindowsRoleProcess {
    this.assertOpen()
    if (!(['core', 'task'] as readonly string[]).includes(input.kind)) throw new IsolationError('isolation-invalid-process-kind')
    // Windows constructs its AppContainer environment before Node starts.
    if (!input.env.LOCALAPPDATA || !input.env.SystemRoot) throw new IsolationError('isolation-environment-incomplete')
    const allocations: NativePtr[] = []
    const alloc = (type: string, count: number): NativePtr => {
      const pointer = koffi.alloc(type, count) as NativePtr
      allocations.push(pointer)
      return pointer
    }
    let attributes: NativePtr | undefined
    let descriptor: NativePtr | undefined
    try {
      const capabilities = alloc('uint8', 24)
      koffi.encode(capabilities, 0, 'void *', this.sid)
      koffi.encode(capabilities, 8, 'void *', null)
      koffi.encode(capabilities, 16, 'uint32', 0)
      koffi.encode(capabilities, 20, 'uint32', 0)
      const size = alloc('size_t', 1)
      koffi.encode(size, 'size_t', 0)
      this.native.initialize(null, 2, 0, size)
      const storage = alloc('uint8', Number(koffi.decode(size, 'size_t')))
      if (!this.native.initialize(storage, 2, 0, size)) throw new IsolationError('isolation-attributes-failed')
      attributes = storage
      if (!this.native.update(attributes, 0, 0x20009, capabilities, 24, null, null)) throw new IsolationError('isolation-capabilities-failed')
      const handles = alloc('void *', 3)
      const descriptors = [input.stdio.stdin, input.stdio.stdout, input.stdio.stderr]
      descriptors.forEach((fd, index) =>{  koffi.encode(handles, index * 8, 'void *', this.api.uvGetOsfhandle(fd)) })
      if (!this.native.update(attributes, 0, 0x20002, handles, 24, null, null)) throw new IsolationError('isolation-handles-failed')
      const extended = alloc('uint8', STARTUP_INFO_EX_SIZE)
      const api = this.api
      const native = this.native
      const descriptorSlot = alloc('void *', 1)
      // OWNER RIGHTS suppresses the owner's implicit WRITE_DAC grant; task children share the normal user SID.
      if (!native.descriptor(`D:P(D;;GA;;;${this.sidText})(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;OW)`, 1, descriptorSlot, null)) {
        throw new IsolationError('isolation-process-protection-failed')
      }
      descriptor = koffi.decode(descriptorSlot, 'void *') as NativePtr
      let processHandle: NativePtr | undefined
      const wrapped = { ...api, setInformationJobObject: (...args: Parameters<typeof api.setInformationJobObject>): number => {
        const [job, kind, original, size] = args
        if (input.kind !== 'core' || kind !== 9) return api.setInformationJobObject(...args)
        const information = Buffer.from(original)
        information.writeUInt32LE(information.readUInt32LE(16) | 8, 16)
        information.writeUInt32LE(1, 40)
        return api.setInformationJobObject(job, kind, information, size)
      }, resumeThread: (thread: NativePtr): number => {
        if (!processHandle || !native.protect(processHandle, 4, descriptor) || !native.protect(thread, 4, descriptor)) return 0xffffffff
        return api.resumeThread(thread)
      }, createProcessW: (...args: Parameters<typeof api.createProcessW>): number => {
        const [app, command, processSecurity, threadSecurity, inherit, flags, env, cwd, startup, info] = args
        const bytes = koffi.decode(startup, 'uint8', STARTUP_INFO_SIZE) as Uint8Array
        koffi.encode(extended, koffi.array('uint8', STARTUP_INFO_SIZE), bytes)
        koffi.encode(extended, 0, 'uint32', STARTUP_INFO_EX_SIZE)
        koffi.encode(extended, STARTUP_INFO_SIZE, 'void *', attributes)
        const result = api.createProcessW(app, command, processSecurity, threadSecurity, inherit,
          flags | 0x00080000 | 0x08000000, env, cwd, extended, info)
        const error = api.getLastError()
        if (result) processHandle = koffi.decode(info, 'void *') as NativePtr
        native.setError(error)
        return result
      } }
      const process = spawnCurrentTokenJobProcess(wrapped, {
        applicationName: input.executable, command: input.executable, args: input.args,
        cwd: input.cwd, env: input.env, stdio: input.stdio,
      })
      this.jobs.add(process)
      return new WindowsRoleProcess(this.api, process, () => { this.jobs.delete(process) })
    } finally {
      if (descriptor !== undefined) this.native.freeLocal(descriptor)
      if (attributes !== undefined) this.native.deleteAttributes(attributes)
      for (const pointer of allocations.reverse()) koffi.free(pointer)
    }
  }

  /** Delete the profile only after every process tree has returned its ownership. */
  close(): void {
    if (this.closed) return
    if (this.jobs.size !== 0) throw new IsolationError('isolation-process-tree-not-quiescent')
    if ((this.native.remove(this.moniker) as number) < 0) throw new IsolationError('isolation-profile-cleanup-uncertain')
    if (this.sid !== undefined) this.native.freeSid(this.sid)
    this.sid = undefined
    this.closed = true
  }

  private assertOpen(): void {
    if (this.closed || this.sid === undefined) throw new IsolationError('isolation-boundary-closed')
  }
}

/** Host-owned process tree. A timeout preserves handles for an explicit stop and later reconciliation. */
export class WindowsRoleProcess {
  private settled: number | undefined
  private waiting = false
  constructor(private readonly api: ReturnType<typeof loadWin32ProcessBindings>,
    private readonly process: SpawnedJobProcess, private readonly release: () => void) {}

  /** OS-observed direct process identity. */
  get pid(): number { return this.process.pid }

  /**
   * Wait for the complete Job, not just its direct process, then release native handles.
   * @param timeoutMs Explicit positive quiescence deadline.
   * @returns Observed direct exit code after the complete tree has stopped.
   */
  async wait(timeoutMs: number): Promise<number> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new IsolationError('isolation-invalid-timeout')
    if (this.settled !== undefined) return this.settled
    if (this.waiting) throw new IsolationError('isolation-wait-already-owned')
    this.waiting = true
    try {
      const deadline = performance.now() + timeoutMs
      let exit: number | undefined
      while (true) {
        exit = pollProcessExit(this.api, this.process.process)
        if (exit !== undefined && isJobEmpty(this.api, this.process.job)) break
        if (performance.now() >= deadline) throw new IsolationError('isolation-quiescence-uncertain')
        await delay(Math.min(20, Math.max(1, deadline - performance.now())))
      }
      closeHandleChecked(this.api, this.process.process, 'Eval role process')
      closeHandleChecked(this.api, this.process.job, 'Eval role Job')
      this.settled = exit
      this.release()
      return exit
    } finally { this.waiting = false }
  }

  /** Request forced termination; the caller must still await wait() before releasing the world. */
  terminate(): void {
    if (this.settled === undefined) terminateJob(this.api, this.process.job, 1)
  }
}
