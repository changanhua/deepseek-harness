/** Bounded source observations in the caller's execution world. @module @changanhua/dsh-memory-local/sources */
import { createHash } from 'node:crypto'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import { extractSessionEventText } from '@deepseek-ai/dsh-session-query'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import { realpathNormalize } from '@deepseek-ai/dsh-workspace'
import { MemoryError, memorySourceInputSchema } from '@changanhua/dsh-memory'
import type { MemorySource, MemorySourceInput, MemorySourceObservation } from '@changanhua/dsh-memory'

/** Operation-local capabilities resolved by the Provider after Workspace authorization. */
export interface MemorySourceAccess {
  readonly fs: FileSystem
  readonly query: SessionQueryEngine
  readonly persistence: SessionPersistence
  readonly cwd: string
}

interface Observation { readonly source: MemorySource; readonly text: string }
const hash = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const preview = (text: string): string => Array.from(text).slice(0, 256).join('')

/**
 * Capture provider-computed hashes; failure or cancellation produces no partial candidate.
 * @param access - Caller-scoped filesystem and persisted Session read capabilities.
 * @param sources - Validated locators from the proposed revision.
 * @param maxBytes - Maximum bytes admitted for each source read.
 * @param signal - Optional cancellation propagated without producing partial observations.
 * @returns Complete source fingerprints captured by the provider.
 */
export async function captureMemorySources(
  access: MemorySourceAccess, sources: readonly MemorySourceInput[], maxBytes: number, signal?: AbortSignal,
): Promise<MemorySource[]> {
  const captured: MemorySource[] = []
  for (const source of sources) captured.push((await observe(access, source, maxBytes, signal)).source)
  return captured
}

/**
 * Recheck each stored source without converting missing data into a factual retraction.
 * @param access - Caller-scoped filesystem and persisted Session read capabilities.
 * @param sources - Previously captured fingerprints to compare with current content.
 * @param maxBytes - Maximum bytes admitted for each source read.
 * @param signal - Optional cancellation; cancellation rejects the entire check.
 * @returns Per-source current, changed, or unavailable status; previews accompany current content only.
 */
export async function checkMemorySources(
  access: MemorySourceAccess, sources: readonly MemorySource[], maxBytes: number, signal?: AbortSignal,
): Promise<MemorySourceObservation[]> {
  const results: MemorySourceObservation[] = []
  for (const source of sources) {
    try {
      const locator: MemorySourceInput = source.kind === 'file'
        ? { kind: 'file', path: source.path, ...source.line === undefined ? {} : { line: source.line } }
        : { kind: 'session-event', sessionId: source.sessionId, seq: source.seq }
      const current = await observe(access, locator, maxBytes, signal)
      const expectedEventType = 'eventType' in source ? source.eventType : undefined
      const observedEventType = 'eventType' in current.source ? current.source.eventType : undefined
      const matches = current.source.sha256 === source.sha256 && observedEventType === expectedEventType
      results.push({ source, status: matches ? 'current' : 'changed', ...matches ? { preview: preview(current.text) } : {} })
    } catch (error) {
      signal?.throwIfAborted()
      if (!(error instanceof MemoryError) || error.code !== 'source-unavailable') throw error
      results.push({ source, status: 'unavailable' })
    }
  }
  return results
}

async function observe(access: MemorySourceAccess, input: MemorySourceInput, maxBytes: number, signal?: AbortSignal): Promise<Observation> {
  signal?.throwIfAborted()
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new MemoryError('invalid-input', 'source byte limit must be positive')
  const locator = memorySourceInputSchema.parse(input)
  try {
    if (locator.kind === 'file') {
      const cwd = access.fs.processPathFromHostPath(access.cwd)
      if (cwd === undefined) throw new Error('filesystem cannot map this Workspace')
      const options = signal === undefined ? {} : { signal }
      const root = await access.fs.resolve(cwd, options)
      const target = await access.fs.resolve(locator.path, { cwd, ...options })
      if (!access.fs.contains(root, target)) throw new Error('source is outside the Workspace')
      const info = await access.fs.stat(target, signal)
      if (info?.type !== 'file' || info.size !== undefined && info.size > maxBytes) throw new Error('source is not a bounded regular file')
      const bytes = await access.fs.readBytes(target, signal, maxBytes)
      if (bytes.byteLength > maxBytes) throw new Error('filesystem exceeded source byte limit')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (text.includes('\0')) throw new Error('source contains binary text')
      signal?.throwIfAborted()
      return { source: { ...locator, sha256: hash(bytes) }, text }
    }
    const sessionId = SessionId(locator.sessionId)
    const candidates = await access.query.filterSessions([{ kind: 'id', values: [sessionId] }], signal)
    const header = candidates[0]?.header
    if (candidates.length !== 1 || header?.cwd === undefined || await realpathNormalize(header.cwd) !== access.cwd) throw new Error('source session is outside the Workspace')
    // The query corpus may prefer live events. Only the physical stored prefix
    // can establish that a cited event survives a Host restart.
    const stored = await access.persistence.readFrom(sessionId, locator.seq, signal)
    if (stored.meta.id !== sessionId || stored.meta.cwd === undefined || await realpathNormalize(stored.meta.cwd) !== access.cwd) throw new Error('persisted source changed Workspace')
    const event = stored.events.find(candidate => candidate.seq === locator.seq)
    if (event === undefined || !['user/message', 'assistant/message', 'tool/result'].includes(event.type)) throw new Error('source is not a stored statement or observation')
    const text = extractSessionEventText(event)
    if (text.length === 0 || Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('source event has no bounded text')
    signal?.throwIfAborted()
    return { source: { ...locator, eventType: event.type, sha256: hash(text) }, text }
  } catch (error) {
    signal?.throwIfAborted()
    throw new MemoryError('source-unavailable', 'memory source cannot be read in this Workspace', { cause: error })
  }
}
