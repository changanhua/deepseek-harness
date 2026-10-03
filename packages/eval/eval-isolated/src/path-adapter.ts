/** AppContainer denies DOS volume-name lookup even for files it can read. */
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { fileURLToPath } from 'node:url'
import koffi from 'koffi'

/** Host-observed drive mapping; this is a name translation, never a filesystem grant. */
export interface VolumeMapping { readonly dos: string
  readonly nt: string }

/**
 * Resolve one drive through the Host's DOS device namespace before entering AppContainer.
 * @param drive Absolute drive prefix of the execution volume, such as C:.
 * @returns Actual OS volume identity used to translate normalized NT paths.
 */
export function observeVolumeMapping(drive: string): VolumeMapping {
  if (process.platform !== 'win32' || !/^[a-z]:$/iu.test(drive)) throw new Error('eval-volume-unavailable')
  const query = koffi.load('kernel32.dll').func('uint32 __stdcall QueryDosDeviceW(str16, void *, uint32)')
  const buffer = Buffer.alloc(65536)
  const size = query(drive, buffer, buffer.length / 2) as number
  if (!size || size >= buffer.length / 2) throw new Error('eval-volume-unavailable')
  const nt = buffer.subarray(0, size * 2).toString('utf16le').split('\0')[0]
  if (!nt || !/^\\Device\\[^\\]+$/u.test(nt)) throw new Error('eval-volume-unavailable')
  return Object.freeze({ dos: drive.toUpperCase(), nt })
}

type PathOptions = BufferEncoding | 'buffer' | { encoding?: BufferEncoding | 'buffer' | null } | null
type Canonical = (path: fs.PathLike, options?: PathOptions) => string | Buffer

/**
 * Adapt only this isolated process's realpath APIs to normalized NT names.
 * CreateFile still enforces the AppContainer ACL. A missing mapping or denied open
 * preserves the original error; string normalization is never used as a fallback.
 * @param mapping Host-observed mapping for the execution volume.
 * @returns Restore operation for tests and a controlled process lifecycle.
 */
export function installWindowsPathAdapter(mapping: VolumeMapping): () => void {
  if (process.platform !== 'win32' || !/^[A-Z]:$/u.test(mapping.dos) || !/^\\Device\\[^\\]+$/u.test(mapping.nt)) {
    throw new Error('eval-volume-unavailable')
  }
  const { dos, nt } = mapping
  const kernel = koffi.load('kernel32.dll')
  const open = kernel.func('void * __stdcall CreateFileW(str16, uint32, uint32, void *, uint32, uint32, void *)')
  const final = kernel.func('uint32 __stdcall GetFinalPathNameByHandleW(void *, void *, uint32, uint32)')
  const close = kernel.func('int __stdcall CloseHandle(void *)')
  const originalSync = fs.realpathSync
  const originalAsync = fs.realpath
  const originalPromise = fs.promises.realpath
  const canonical: Canonical = (path, options) => {
    try { return (originalSync.native as Canonical)(path, options) }
    catch (error) {
      if (!['EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
      const input = path instanceof URL ? fileURLToPath(path) : Buffer.isBuffer(path) ? path.toString() : path
      const handle = open(input, 0, 7, null, 3, 0x02000080, null) as bigint | null
      if (handle === null || handle === 0xffff_ffff_ffff_ffffn) throw error
      try {
        const buffer = Buffer.alloc(65536)
        const count = final(handle, buffer, buffer.length / 2, 2) as number
        if (!count || count >= buffer.length / 2) throw error
        const actual = buffer.subarray(0, count * 2).toString('utf16le')
        const prefix = actual.slice(0, nt.length)
        if (prefix.toLowerCase() !== nt.toLowerCase() || (actual.length !== nt.length && actual[nt.length] !== '\\')) throw error
        const normalized = dos + (actual.slice(nt.length) || '\\')
        const encoding = typeof options === 'string' ? options : options?.encoding
        if (encoding === 'buffer') return Buffer.from(normalized)
        return encoding && encoding !== 'utf8' && encoding !== 'utf-8'
          ? Buffer.from(normalized).toString(encoding) : normalized
      } finally { close(handle) }
    }
  }
  const sync = Object.assign(canonical, { native: canonical }) as typeof fs.realpathSync
  type Callback = (error: NodeJS.ErrnoException | null, path?: string | Buffer) => void
  const asynchronous = (path: fs.PathLike, options: PathOptions | Callback, callback?: Callback): void => {
    const cb = typeof options === 'function' ? options : callback
    if (typeof cb !== 'function') throw new TypeError('realpath requires a callback')
    queueMicrotask(() => {
      let value: string | Buffer
      try { value = canonical(path, typeof options === 'function' ? undefined : options) }
      catch (error) { cb(error as NodeJS.ErrnoException); return }
      cb(null, value)
    })
  }
  fs.realpathSync = sync
  fs.realpath = Object.assign(asynchronous, { native: asynchronous }) as typeof fs.realpath
  fs.promises.realpath = (async (path: fs.PathLike, options?: PathOptions) =>
    await Promise.resolve(canonical(path, options))) as typeof fs.promises.realpath
  syncBuiltinESMExports()
  return () => {
    fs.realpathSync = originalSync
    fs.realpath = originalAsync
    fs.promises.realpath = originalPromise
    syncBuiltinESMExports()
  }
}
