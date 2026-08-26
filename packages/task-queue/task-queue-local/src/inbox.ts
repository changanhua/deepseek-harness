/**
 * Inbox scanning and admission (§7.3).
 *
 * The producer writes `inbox/<uuid>.tmp` (exclusive `wx`) → fsync(tmp) →
 * rename to `<uuid>.json` → fsync(inbox dir); both fsyncs are part of the
 * power-loss-durable protocol, so the scheduler only ever observes either a
 * missing file or a complete `<uuid>.json`. Scanning enforces:
 *
 *  - basename is a strict UUID (never an arbitrary filename as a receipt);
 *  - content parses to a strict task-spec schema — failures move the file to
 *    `quarantine/` and warn, never enqueuing;
 *  - `receiptId = basename`; a `(source:'inbox', receiptId)` already committed
 *    means "delete the file only", never a duplicate task;
 *  - the file is deleted only after the `created` change is committed.
 *
 * Producers wanting to drop a task into the queue write one line of JSON
 * matching {@link EnqueueSpec} to `inbox/<uuid>.tmp`, fsync, rename to
 * `<uuid>.json`, and fsync the inbox directory.
 * @module @deepseek-ai/dsh-task-queue-local/inbox
 */

import { readdir, readFile, rename } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { EnqueueSpec } from '@deepseek-ai/dsh-task-queue'
import { inboxPath, quarantinePath } from './paths.ts'

/** Strict UUID v4-ish shape (8-4-4-4-12 hex); rejects any other basename. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A parsed inbox entry: its receipt id plus the validated spec or a reason. */
export type InboxParse =
  | { kind: 'ok'; receiptId: string; spec: EnqueueSpec }
  | { kind: 'invalid-filename'; name: string }
  | { kind: 'invalid-content'; receiptId: string; reason: string }

/**
 * Whether one inbox basename is a strict UUID (eligible as a receipt id).
 * @param name - the basename to test.
 * @returns `true` when the basename matches the strict UUID shape.
 */
export function isUuidName(name: string): boolean {
  return UUID_RE.test(name)
}

/**
 * Validate an inbox file's parsed content against the enqueue schema.
 * @param value - the parsed JSON content of an inbox entry.
 * @returns the validated enqueue spec, or a rejection reason string.
 */
export function validateInboxSpec(value: unknown): { spec: EnqueueSpec } | { reason: string } {
  if (typeof value !== 'object' || value === null) return { reason: 'spec is not an object' }
  const v = value as Record<string, unknown>
  if (typeof v.title !== 'string' || v.title.length === 0) return { reason: 'missing string title' }
  if (typeof v.prompt !== 'string' || v.prompt.length === 0) return { reason: 'missing string prompt' }
  if (typeof v.executor !== 'string' || v.executor.length === 0) return { reason: 'missing string executor' }
  const spec: EnqueueSpec = { title: v.title, prompt: v.prompt, executor: v.executor }
  if (v.priority !== undefined) {
    if (typeof v.priority !== 'number' || !Number.isSafeInteger(v.priority)) return { reason: 'invalid priority' }
    spec.priority = v.priority
  }
  if (v.maxAttempts !== undefined) {
    if (typeof v.maxAttempts !== 'number' || !Number.isSafeInteger(v.maxAttempts) || v.maxAttempts < 1) return { reason: 'invalid maxAttempts' }
    spec.maxAttempts = v.maxAttempts
  }
  if (v.backoffMs !== undefined) {
    if (typeof v.backoffMs !== 'number' || !Number.isFinite(v.backoffMs) || v.backoffMs < 0) return { reason: 'invalid backoffMs' }
    spec.backoffMs = v.backoffMs
  }
  if (v.delayUntil !== undefined) {
    if (typeof v.delayUntil !== 'string') return { reason: 'invalid delayUntil' }
    spec.delayUntil = v.delayUntil
  }
  if (v.timeoutMs !== undefined) {
    if (typeof v.timeoutMs !== 'number' || !Number.isFinite(v.timeoutMs) || v.timeoutMs <= 0) return { reason: 'invalid timeoutMs' }
    spec.timeoutMs = v.timeoutMs
  }
  if (v.workspaceDir !== undefined) {
    if (typeof v.workspaceDir !== 'string') return { reason: 'invalid workspaceDir' }
    spec.workspaceDir = v.workspaceDir
  }
  if (v.outputDir !== undefined) {
    if (typeof v.outputDir !== 'string') return { reason: 'invalid outputDir' }
    spec.outputDir = v.outputDir
  }
  if (v.tags !== undefined) {
    if (!Array.isArray(v.tags) || !v.tags.every(tag => typeof tag === 'string')) return { reason: 'invalid tags' }
    spec.tags = v.tags as string[]
  }
  if (v.ownerSessionId !== undefined) {
    if (typeof v.ownerSessionId !== 'string') return { reason: 'invalid ownerSessionId' }
    spec.ownerSessionId = v.ownerSessionId
  }
  return { spec }
}

/**
 * List inbox entries, classifying each by filename and content.
 * @param root - the queue root directory.
 * @returns one classified entry per eligible inbox file.
 */
export async function scanInbox(root: string): Promise<InboxParse[]> {
  const inboxDir = join(root, 'inbox')
  const names = await readdir(inboxDir)
  const results: InboxParse[] = []
  for (const name of names) {
    // Only files that look like inbox entries matter; ignore `.tmp` in-flight
    // producer files and stray artifacts.
    if (!name.endsWith('.json')) continue
    const stem = name.slice(0, -'.json'.length)
    if (!isUuidName(stem)) {
      results.push({ kind: 'invalid-filename', name })
      continue
    }
    const receiptId = stem
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(inboxPath(root, name), 'utf8'))
    } catch {
      results.push({ kind: 'invalid-content', receiptId, reason: 'file is not valid JSON' })
      continue
    }
    const validated = validateInboxSpec(parsed)
    if ('reason' in validated) {
      results.push({ kind: 'invalid-content', receiptId, reason: validated.reason })
      continue
    }
    results.push({ kind: 'ok', receiptId, spec: validated.spec })
  }
  return results
}

/**
 * Move a rejected inbox file to `quarantine/`, avoiding collisions.
 * @param root - the queue root directory.
 * @param name - the inbox filename to quarantine (with its `.json` suffix).
 */
export async function quarantineInboxFile(root: string, name: string): Promise<void> {
  const target = quarantinePath(root, name)
  await rename(inboxPath(root, name), target)
}

/**
 * Return the basename of a path for diagnostics.
 * @param path - the full path whose basename to extract.
 * @returns the basename component.
 */
export function nameOf(path: string): string {
  return basename(path)
}
