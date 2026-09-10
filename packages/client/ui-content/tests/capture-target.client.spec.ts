/**
 * The capture entry's selection layer: which finalized assistant nodes offer
 * the capture action, and what the operation id of one attempt looks like.
 */
import { describe, expect, it } from 'vitest'
import type { AssistantMessageNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import { captureKey, captureNonce, captureOperationId, captureTargetOf, findCaptureTarget } from '../src/client/capture-target.ts'
import { chatSnapshot } from '@deepseek-ai/dsh-client-test-runtime'

const MESSAGE_ID = 'm-1' as MessageId

/** One finalized assistant node over the given blocks. */
function node(overrides: Partial<AssistantMessageNode> = {}): AssistantMessageNode {
  return {
    kind: 'assistant',
    seq: 34,
    messageId: MESSAGE_ID,
    time: 1,
    turn: 1,
    step: 2,
    blocks: [{ kind: 'text', text: 'DONE' }],
    ...overrides,
  }
}

/** A Chat projection whose store holds exactly one assistant-step node. */
function snapshotWith(finalNode: AssistantMessageNode): ChatSnapshot {
  return chatSnapshot({
    nodes: {
      get: () => undefined,
      values: () => [{
        key: 'assistant-step:1', kind: 'assistant-step', id: '1', target: 'chat',
        data: { status: 'settled', finalNode },
      } as never],
    },
  })
}

describe('findCaptureTarget', () => {
  it('accepts a settled pure-text assistant message', () => {
    expect(findCaptureTarget(snapshotWith(node()), MESSAGE_ID)).toEqual({ seq: 34, messageId: MESSAGE_ID })
  })

  it('joins consecutive text blocks without rejecting the message', () => {
    const target = findCaptureTarget(snapshotWith(node({
      blocks: [{ kind: 'text', text: 'one' }, { kind: 'text', text: 'two' }],
    })), MESSAGE_ID)
    expect(target).toEqual({ seq: 34, messageId: MESSAGE_ID })
  })

  it('rejects an interrupted message prefix', () => {
    expect(findCaptureTarget(snapshotWith(node({ interrupted: true })), MESSAGE_ID)).toBeUndefined()
  })

  it('rejects reasoning, tool-call, and image blocks individually', () => {
    const reasoning = node({ blocks: [{ kind: 'reasoning', text: 'thinking' }, { kind: 'text', text: 'answer' }] })
    const toolCall = node({ blocks: [{ kind: 'tool-call', callId: 'c', name: 'read', argsRaw: '{}' }] })
    const image = node({ blocks: [{ kind: 'image', attachment: { id: 'att' } as never }] })
    expect(findCaptureTarget(snapshotWith(reasoning), MESSAGE_ID)).toBeUndefined()
    expect(findCaptureTarget(snapshotWith(toolCall), MESSAGE_ID)).toBeUndefined()
    expect(findCaptureTarget(snapshotWith(image), MESSAGE_ID)).toBeUndefined()
  })

  it('rejects blank text and empty block lists', () => {
    expect(findCaptureTarget(snapshotWith(node({ blocks: [{ kind: 'text', text: '   ' }] })), MESSAGE_ID)).toBeUndefined()
    expect(findCaptureTarget(snapshotWith(node({ blocks: [] })), MESSAGE_ID)).toBeUndefined()
  })

  it('rejects synthetic interruption fallbacks without a durable message id', () => {
    const synthetic = { ...node(), messageId: undefined } as unknown as AssistantMessageNode
    expect(findCaptureTarget(snapshotWith(synthetic), MESSAGE_ID)).toBeUndefined()
  })

  it('finds nothing when the addressed message is absent', () => {
    expect(findCaptureTarget(snapshotWith(node()), 'other')).toBeUndefined()
  })
})

describe('captureTargetOf parity with the Host contract', () => {
  it('addresses the capture by the message event sequence', () => {
    expect(captureTargetOf(node())?.seq).toBe(34)
  })
})

describe('captureOperationId', () => {
  it('names the surface, the session, and the event sequence, with one nonce per attempt', () => {
    const target = captureTargetOf(node())!
    expect(captureOperationId('s1', target, 'n1')).toBe('capture-ui:s1:34:n1')
    expect(captureOperationId('s1', target, 'n2')).toBe('capture-ui:s1:34:n2')
    expect(captureOperationId('s1', target, 'n1')).not.toBe(captureKey('s1', target))
  })

  it('stays within the Content identity bound for long session ids', () => {
    const target = captureTargetOf(node())!
    expect(captureOperationId('s'.repeat(600), target, 'n')).toHaveLength(512)
  })

  it('mints a real nonce', () => {
    const [first, second] = [captureTargetOf(node())!, captureTargetOf(node())!]
    expect(captureOperationId('s1', first, captureNonce()))
      .not.toBe(captureOperationId('s1', second, captureNonce()))
  })
})
