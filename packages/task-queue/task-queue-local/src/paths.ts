/**
 * On-disk layout and path safety for the task-queue durable backend.
 *
 * Every untrusted id (taskId, ownerSessionId, receiptId) is a branded/untrusted
 * string and MUST run through {@link encodeSegment} before touching the
 * filesystem. Directory trees hold user-private prompt/result content and are
 * created `0o700`; files are created `0o600` (§9.4). Windows does not enforce
 * POSIX modes; the constants remain the contract on POSIX platforms.
 * @module @deepseek-ai/dsh-task-queue-local/paths
 */

import { join } from 'node:path'

/** Directory mode for user-private queue directories (§9.4). */
export const DIR_MODE = 0o700
/** File mode for user-private queue files (§9.4). */
export const FILE_MODE = 0o600

/**
 * Encode an arbitrary string as one safe path segment, injectively over all JS
 * (UTF-16) strings — mirrors `encodeSegment` in the session-persistence format
 * module so every id entering a path is neutralized against `../`, absolute
 * paths, NUL, and separators. Safe code units stay literal; every other unit
 * becomes `~XXXX`. `.` and `..` are special-cased to prevent traversal.
 * @param raw - the string to encode; throws on the empty string.
 * @returns the escaped single path segment.
 */
export function encodeSegment(raw: string): string {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch
    } else {
      out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
    }
  }
  return out
}

/** All immediate sub-path names under the queue root. */
export interface QueuePaths {
  root: string
  active: string
  segmentsDir: string
  snapshot: string
  inboxDir: string
  quarantineDir: string
  runsDir: string
  outputDir: string
}

/**
 * Resolve the fixed layout under one queue root.
 * @param root - the queue root directory.
 * @returns the fixed sub-path object for that root.
 */
export function queuePaths(root: string): QueuePaths {
  return {
    root,
    active: join(root, 'active.jsonl'),
    segmentsDir: join(root, 'segments'),
    snapshot: join(root, 'snapshot.json'),
    inboxDir: join(root, 'inbox'),
    quarantineDir: join(root, 'quarantine'),
    runsDir: join(root, 'runs'),
    outputDir: join(root, 'output'),
  }
}

/**
 * Sealed-segment file path for an inclusive `[firstSeq, lastSeq]` range.
 * @param root - the queue root directory.
 * @param firstSeq - the segment's first (inclusive) seq.
 * @param lastSeq - the segment's last (inclusive) seq.
 * @returns the `segments/<first>-<last>.jsonl` path.
 */
export function segmentPath(root: string, firstSeq: number, lastSeq: number): string {
  return join(root, 'segments', `${firstSeq}-${lastSeq}.jsonl`)
}

/**
 * Inbox file path for one UUID basename.
 * @param root - the queue root directory.
 * @param basename - the inbox filename (already includes its `.json` suffix).
 * @returns the `inbox/<basename>` path.
 */
export function inboxPath(root: string, basename: string): string {
  return join(root, 'inbox', basename)
}

/**
 * Quarantine file path for a rejected inbox file.
 * @param root - the queue root directory.
 * @param basename - the inbox filename to quarantine (with its `.json` suffix).
 * @returns the `quarantine/<basename>` path.
 */
export function quarantinePath(root: string, basename: string): string {
  return join(root, 'quarantine', basename)
}

/**
 * Per-task run-log directory (`runs/<taskId>`).
 * @param root - the queue root directory.
 * @param taskId - the task id, encoded into one safe path segment.
 * @returns the `runs/<encoded-taskId>` directory path.
 */
export function runDir(root: string, taskId: string): string {
  return join(root, 'runs', encodeSegment(taskId))
}

/**
 * One attempt's run log path (`runs/<taskId>/run-<attempt>.log`).
 * @param root - the queue root directory.
 * @param taskId - the task id, encoded into one safe path segment.
 * @param attempt - the 1-based attempt number.
 * @returns the attempt's run log file path.
 */
export function runLogPath(root: string, taskId: string, attempt: number): string {
  return join(runDir(root, taskId), `run-${attempt}.log`)
}

/**
 * Default per-task output directory (`output/<taskId>`).
 * @param root - the queue root directory.
 * @param taskId - the task id, encoded into one safe path segment.
 * @returns the `output/<encoded-taskId>` directory path.
 */
export function taskOutputDir(root: string, taskId: string): string {
  return join(root, 'output', encodeSegment(taskId))
}
