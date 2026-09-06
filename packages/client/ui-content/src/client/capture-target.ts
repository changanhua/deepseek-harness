/**
 * Pure selection between the Chat projection and a capture command. The
 * capture wire contract addresses a session by id and an assistant message by
 * its canonical decimal event sequence, while the assistant-actions slot only
 * hands over the durable provider message id, so the entry resolves one from
 * the other here. The Host re-verifies the source against the real session;
 * this is only the button's visibility and addressing, read from the existing
 * AssistantMessageNode projection — never from raw session events.
 * @module @changanhua/dsh-client-ui-content/client/capture-target
 */

import type {
  AssistantChatData, AssistantMessageNode, ChatSnapshot,
} from '@deepseek-ai/dsh-client-ui-chat/client'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'

/** One capturable assistant message: its event sequence and source message id. */
export interface CaptureTarget {
  readonly seq: number
  readonly messageId: string
}

/**
 * Find the settled, pure-text assistant message behind a finalized action
 * strip. A target requires a durable messageId, no interruption, and every
 * block plain text with at least one non-blank character: reasoning, tool
 * calls, images, mixed content, and interrupted prefixes are all ineligible,
 * matching the Host source resolver's contract.
 * @param snapshot - the current Chat projection.
 * @param messageId - the durable message id the action strip addresses.
 * @returns the capture target, or undefined when nothing qualifies.
 */
export function findCaptureTarget(snapshot: ChatSnapshot, messageId: string): CaptureTarget | undefined {
  for (const node of snapshot.nodes.values()) {
    if (node.kind !== 'assistant-step') continue
    const final = (node.data as AssistantChatData).finalNode
    if (final?.messageId !== messageId) continue
    return captureTargetOf(final)
  }
  return undefined
}

/** Reduce one finalized assistant node to a capture target, or nothing. */
export function captureTargetOf(final: AssistantMessageNode): CaptureTarget | undefined {
  if (final.messageId === undefined || final.interrupted === true) return undefined
  // Every block must be plain text and at least one must carry content, so a
  // single pass rejects mixed blocks and blank captures alike.
  let hasText = false
  for (const block of final.blocks) {
    if (block.kind !== 'text') return undefined
    if (block.text.trim().length > 0) hasText = true
  }
  if (!hasText) return undefined
  return { seq: final.seq, messageId: final.messageId }
}

/**
 * Operation id for one capture attempt. The prefix and source address are
 * stable so a retry after a transport failure is recognizable, while the
 * nonce is fresh per attempt: every click that starts a new attempt owns a
 * new operation id, and an in-flight one keeps its own. The body hash is
 * deliberately absent — source addressing is the Host's decision, and the
 * client must not derive authority from content.
 * @param sessionId - owning session.
 * @param target - resolved capture target of the addressed message.
 * @returns an operation id within the Content identity bound.
 */
export function captureOperationId(sessionId: string, target: CaptureTarget, nonce: string): string {
  return `capture-ui:${sessionId}:${target.seq}:${nonce}`.slice(0, 512)
}

/** Fresh nonce for one capture attempt. */
export function captureNonce(): string {
  return randomUUID()
}

/** In-flight capture key for one (session, message) pair. */
export function captureKey(sessionId: string, target: CaptureTarget): string {
  return `${sessionId}:${target.seq}`
}
