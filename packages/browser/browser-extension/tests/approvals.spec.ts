import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { BrowserApprovals } from '../src/approvals.ts'
import type { ApprovalOutcome, ApprovalRequestEvent } from '@deepseek-ai/dsh-user-approval/types'

const peer = (id: string) => ({ id, permit: () => true, send: vi.fn() })
const request = (sessionId = 'session-1'): ApprovalRequestEvent => ({ agent: { session: { id: sessionId, events: [{ type: 'approval/asked', data: { id: randomUUID(), toolName: 'browser_action' } }] } }, toolName: 'browser_action' }) as unknown as ApprovalRequestEvent
type ApprovalFrame = { readonly requests: readonly { readonly id: string }[] }
function hasId(value: unknown): value is { readonly id: string } {
  return typeof value === 'object' && value !== null && typeof (value as { readonly id?: unknown }).id === 'string'
}
function frame(value: unknown): ApprovalFrame {
  if (typeof value !== 'object' || value === null || !('requests' in value) || !Array.isArray(value.requests)
    || value.requests.some((request: unknown) => !hasId(request))) throw new Error('expected approval frame')
  return value as ApprovalFrame
}

describe('BrowserApprovals', () => {
  it('answers only the one visible peer and rejects a wrong peer decision', async () => {
    const approvals = new BrowserApprovals({ maxPending: 1, ttl: 1000 })
    const left = peer('left'), right = peer('right')
    approvals.presence(left, 'session-1'); approvals.presence(right, 'session-1')
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'unavailable')
    const pending = approvals.answer(request(), next)
    const sent = frame(left.send.mock.calls[0]?.[0])
    expect(right.send).not.toHaveBeenCalled()
    expect(approvals.decide(right, { sessionId: 'session-1', id: sent.requests[0]?.id ?? '', decision: 'allowed-once' })).toBe(false)
    expect(approvals.decide(left, { sessionId: 'session-1', id: sent.requests[0]?.id ?? '', decision: 'allowed-once' })).toBe(true)
    await expect(pending).resolves.toBe('allowed-once')
    expect(next).not.toHaveBeenCalled()
  })

  it('delegates when visibility is removed and ignores a late approval', async () => {
    const approvals = new BrowserApprovals({ maxPending: 1, ttl: 1000 })
    const visible = peer('visible'); approvals.presence(visible, 'session-1')
    const next = vi.fn(async (): Promise<ApprovalOutcome> => 'rejected')
    const pending = approvals.answer(request(), next)
    const sent = frame(visible.send.mock.calls[0]?.[0])
    approvals.presence(visible, null)
    expect(approvals.decide(visible, { sessionId: 'session-1', id: sent.requests[0]?.id ?? '', decision: 'allowed-once' })).toBe(false)
    await expect(pending).resolves.toBe('rejected')
  })

  it('cancels without delegation and bounds concurrent pending questions', async () => {
    const approvals = new BrowserApprovals({ maxPending: 1, ttl: 1000 })
    const visible = peer('visible'); approvals.presence(visible, 'session-1')
    const abort = new AbortController(); const next = vi.fn(async (): Promise<ApprovalOutcome> => 'unavailable')
    const first = approvals.answer({ ...request(), signal: abort.signal }, next)
    await expect(approvals.answer(request(), vi.fn(async (): Promise<ApprovalOutcome> => 'unavailable'))).resolves.toBe('unavailable')
    abort.abort()
    await expect(first).resolves.toBe('cancelled')
    expect(next).not.toHaveBeenCalled()
  })

  it('concurrent approvals use distinct transport ids even when their Session audit tail is the same', async () => {
    const approvals = new BrowserApprovals({ maxPending: 2, ttl: 1000 })
    const visible = peer('visible'); approvals.presence(visible, 'session-1')
    const sameRequest = request()
    const first = approvals.answer(sameRequest, async () => 'unavailable')
    const second = approvals.answer(sameRequest, async () => 'unavailable')
    const sent = frame(visible.send.mock.calls.at(-1)?.[0])
    expect(sent.requests).toHaveLength(2)
    const [one, two] = sent.requests
    if (one === undefined || two === undefined) throw new Error('missing approval requests')
    expect(one.id).not.toBe(two.id)
    expect(approvals.decide(visible, { sessionId: 'foreign', id: one.id, decision: 'allowed-once' })).toBe(false)
    expect(approvals.decide(visible, { sessionId: 'session-1', id: one.id, decision: 'allowed-once' })).toBe(true)
    expect(approvals.decide(visible, { sessionId: 'session-1', id: two.id, decision: 'rejected' })).toBe(true)
    await expect(first).resolves.toBe('allowed-once'); await expect(second).resolves.toBe('rejected')
    expect(frame(visible.send.mock.calls.at(-1)?.[0]).requests).toEqual([])
  })
  it('expiry cancels the pending question and removes its card without a late Web wait', async () => {
    vi.useFakeTimers()
    try {
      const approvals = new BrowserApprovals({ maxPending: 1, ttl: 1000 })
      const visible = peer('visible'); approvals.presence(visible, 'session-1')
      const next = vi.fn(async (): Promise<ApprovalOutcome> => 'unavailable')
      const pending = approvals.answer(request(), next)
      await vi.advanceTimersByTimeAsync(1000)
      await expect(pending).resolves.toBe('cancelled')
      expect(next).not.toHaveBeenCalled(); expect(frame(visible.send.mock.calls.at(-1)?.[0]).requests).toEqual([])
    } finally { vi.useRealTimers() }
  })
})
