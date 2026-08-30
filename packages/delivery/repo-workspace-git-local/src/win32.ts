/** Minimal Windows write-through namespace publication for Attempt lease markers. */

import { mkdtemp, rm, stat } from 'node:fs/promises'
import { join, parse, resolve, toNamespacedPath } from 'node:path'

type MoveFileExW = (existing: string, replacement: string, flags: number) => number
interface Win32ErrnoException extends NodeJS.ErrnoException { dest: string }
interface KoffiLibrary { func(...args: unknown[]): unknown }
interface KoffiModule { default: { load(name: string): KoffiLibrary } }

const MOVEFILE_WRITE_THROUGH = 0x00000008
const ERROR_FILE_NOT_FOUND = 2
const ERROR_PATH_NOT_FOUND = 3
const ERROR_ACCESS_DENIED = 5
const ERROR_NOT_SAME_DEVICE = 17
const ERROR_FILE_EXISTS = 80
const ERROR_INVALID_NAME = 123
const ERROR_ALREADY_EXISTS = 183

let api: Promise<{ move: MoveFileExW; lastError: () => number }> | undefined

async function bindings(): Promise<Awaited<NonNullable<typeof api>>> {
  api ??= import('koffi').then((module) => {
    const { default: koffi } = module as unknown as KoffiModule
    const kernel32 = koffi.load('kernel32.dll')
    return {
      move: kernel32.func('__stdcall', 'MoveFileExW', 'int', ['str16', 'str16', 'uint']) as MoveFileExW,
      lastError: kernel32.func('__stdcall', 'GetLastError', 'uint', []) as () => number,
    }
  })
  return await api
}

function win32Error(code: number, path: string, dest: string): Win32ErrnoException {
  const name = code === ERROR_FILE_NOT_FOUND || code === ERROR_PATH_NOT_FOUND
    ? 'ENOENT'
    : code === ERROR_ACCESS_DENIED
      ? 'EACCES'
      : code === ERROR_NOT_SAME_DEVICE
        ? 'EXDEV'
        : code === ERROR_FILE_EXISTS || code === ERROR_ALREADY_EXISTS
          ? 'EEXIST'
          : code === ERROR_INVALID_NAME ? 'EINVAL' : 'EIO'
  const error = new Error(`MoveFileExW ${name} (Win32 ${String(code)}): ${path} -> ${dest}`) as Win32ErrnoException
  error.code = name
  error.path = path
  error.dest = dest
  return error
}

/**
 * Publish one file or directory without replacement and wait for its namespace move to reach storage.
 *
 * @param existing Source path in the same namespace as `replacement`.
 * @param replacement Unoccupied destination path to publish.
 */
export async function publishNewPathWin32(existing: string, replacement: string): Promise<void> {
  const native = await bindings()
  if (native.move(toNamespacedPath(existing), toNamespacedPath(replacement), MOVEFILE_WRITE_THROUGH) === 0) {
    throw win32Error(native.lastError(), existing, replacement)
  }
}

/**
 * Create every missing directory through a same-parent write-through rename.
 *
 * @param path Directory path whose missing ancestors are published durably.
 */
export async function ensureDurableDirectoryWin32(path: string): Promise<void> {
  const absolute = resolve(path)
  const root = parse(absolute).root
  let current = root
  for (const segment of absolute.slice(root.length).split(/[\\/]+/u).filter(Boolean)) {
    const next = join(current, segment)
    if (!await isDirectory(next)) {
      const staging = await mkdtemp(toNamespacedPath(join(current, '.dsh-worktree-mkdir-')))
      try {
        await publishNewPathWin32(staging, next)
      } catch (error) {
        /* v8 ignore start -- requires another process to win this exact directory-name publication race. */
        await rm(staging, { recursive: true, force: true })
        if (!isCode(error, 'EEXIST') || !await isDirectory(next)) throw error
        /* v8 ignore stop */
      }
    }
    current = next
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path)
    /* v8 ignore next -- callers validate observed ancestors; only a replacement race exposes a non-directory. */
    if (info.isDirectory()) return true
    /* v8 ignore start -- callers validate every observed ancestor; only a replacement race can expose a non-directory here. */
    const error = new Error(`path exists but is not a directory: ${path}`) as NodeJS.ErrnoException
    error.code = 'ENOTDIR'
    throw error
    /* v8 ignore stop */
  } catch (error) {
    /* v8 ignore next -- the false branch requires a host permission/filesystem fault rather than absence. */
    if (isCode(error, 'ENOENT')) return false
    /* v8 ignore next -- paired with the guarded condition above. */
    throw error
  }
}

function isCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
