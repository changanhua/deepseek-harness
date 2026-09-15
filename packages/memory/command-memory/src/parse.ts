/** Strict human command grammar for project memory. @module @changanhua/dsh-command-memory/parse */
import { memoryTimestampSchema } from '@changanhua/dsh-memory'
import assert from 'node:assert/strict'

/** The human-visible list, inspection and exact-revision decision operations. */
export type MemoryCommand =
  | { readonly kind: 'list'; readonly page: number }
  | { readonly kind: 'show'; readonly id: string; readonly revision?: number }
  | { readonly kind: 'accept' | 'reject' | 'retire'; readonly id: string; readonly revision: number; readonly reviewAfter?: string }
  | { readonly kind: 'invalid' }

/**
 * Parse without executing, normalizing only whitespace between grammar tokens.
 * @param raw - Arguments following the human /memory command.
 * @returns The admitted operation or an invalid marker; no operation is executed.
 */
export function parseMemoryCommand(raw: string): MemoryCommand {
  const input = raw.trim()
  if (input === '') return { kind: 'list', page: 1 }
  const parts = input.split(/\s+/u)
  const [action, target, option, value] = parts
  assert(action !== undefined, 'splitting command text always yields an action token')
  if (action === 'list') {
    const page = target === undefined ? 1 : Number(target)
    return parts.length <= 2 && Number.isSafeInteger(page) && page > 0 && page <= 500
      && (target === undefined || /^[1-9][0-9]*$/u.test(target)) ? { kind: 'list', page } : { kind: 'invalid' }
  }
  if (target === undefined) return { kind: 'invalid' }
  const match = /^([a-zA-Z0-9_-]{1,256})(?:@([1-9][0-9]*))?$/u.exec(target)
  const id = match?.[1]
  const revision = match?.[2] === undefined ? undefined : Number(match[2])
  if (id === undefined || revision !== undefined && !Number.isSafeInteger(revision)) return { kind: 'invalid' }
  if (action === 'show' && parts.length === 2) return { kind: 'show', id, ...revision === undefined ? {} : { revision } }
  if (revision === undefined || !['accept', 'reject', 'retire'].includes(action)) return { kind: 'invalid' }
  if (parts.length !== 2 && !(parts.length === 4 && action === 'accept' && option === '--review-after'
    && memoryTimestampSchema.safeParse(value).success)) return { kind: 'invalid' }
  return { kind: action as 'accept' | 'reject' | 'retire', id, revision, ...value === undefined ? {} : { reviewAfter: value } }
}
