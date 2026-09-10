import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { BrowserPreparations } from '../src/prepared.ts'
import type { BrowserAction, BrowserActionResult } from '@changanhua/dsh-browser'

type PreparedDispatch = Parameters<ConstructorParameters<typeof BrowserPreparations>[0]['dispatch']>[0]

const operation = () => ({ sessionId: SessionId('session-1'), installationId: randomUUID(), action: {
  kind: 'click' as const,
  element: { page: { tabId: 1, frameId: 0, documentId: 'document-1', url: 'https://example.test/a' }, snapshotId: 'snapshot-1', elementId: 'button-1' },
  intent: '打开详细信息',
} })
const description = (action: BrowserAction) => {
  if (action.kind !== 'click') throw new Error('fixture expects a click')
  return { kind: action.kind, page: { ...action.element.page },
    title: '示例页面', target: { tag: 'button', label: '详细信息', type: 'button' }, effect: 'unknown' }
}
const resultIdentity = (request: PreparedDispatch) => ({ requestId: randomUUID(), sessionId: request.operation.sessionId,
  installationId: request.operation.installationId, delivery: 'sent' as const })

describe('BrowserPreparations', () => {
  it('prepares immutable page facts and commits the same ticket only once', async () => {
    const dispatch = vi.fn(async (request: PreparedDispatch): Promise<BrowserActionResult> => request.payload.kind === 'prepare'
      ? { ...resultIdentity(request), outcome: 'observed', value: {
        preparationId: randomUUID(), expiresAt: request.deadline, description: description(request.payload.action),
      } }
      : { ...resultIdentity(request), outcome: 'observed', value: { ok: true } })
    const prepared = new BrowserPreparations({ capacity: 2, requestTTL: 1000, dispatch, permit: () => true })
    const input = operation()
    const ticket = await prepared.prepare(input, new AbortController().signal)
    const [first, second] = await Promise.all([
      prepared.execute(ticket.ticket, new AbortController().signal), prepared.execute(ticket.ticket, new AbortController().signal),
    ])
    expect(first).toMatchObject({ outcome: 'observed' })
    expect(second).toEqual(first)
    expect(dispatch.mock.calls.filter(([request]) => request.payload.kind === 'commit')).toHaveLength(1)
    expect(dispatch.mock.calls[1]?.[0].payload).toMatchObject({ kind: 'commit', action: input.action })
    const committed = dispatch.mock.calls[1]?.[0].payload
    if (committed?.kind !== 'commit') throw new Error('expected a commit')
    expect(committed.preparationId).not.toBe(ticket.ticket)
  })

  it('never dispatches a commit after expiry, revocation, or abort before commit', async () => {
    let permitted = true
    const dispatch = vi.fn(async (request: PreparedDispatch): Promise<BrowserActionResult> => ({
      ...resultIdentity(request), outcome: 'observed', value: {
        preparationId: randomUUID(), expiresAt: Date.now() + 100, description: description(request.payload.action),
      } }))
    const prepared = new BrowserPreparations({ capacity: 2, requestTTL: 1000, dispatch, permit: () => permitted })
    const expired = await prepared.prepare(operation(), new AbortController().signal)
    await new Promise(resolve => setTimeout(resolve, 110))
    expect(await prepared.execute(expired.ticket, new AbortController().signal)).toMatchObject({ delivery: 'not-sent', reason: 'expired' })
    const revoked = await prepared.prepare(operation(), new AbortController().signal)
    permitted = false
    expect(await prepared.execute(revoked.ticket, new AbortController().signal)).toMatchObject({ delivery: 'not-sent', reason: 'unauthorized' })
    permitted = true
    const aborted = await prepared.prepare(operation(), new AbortController().signal)
    const controller = new AbortController(); controller.abort()
    expect(await prepared.execute(aborted.ticket, controller.signal)).toMatchObject({ delivery: 'not-sent', outcome: 'cancelled' })
    expect(await prepared.execute(aborted.ticket, new AbortController().signal)).toMatchObject({ delivery: 'not-sent', outcome: 'cancelled' })
    expect(dispatch.mock.calls.filter(([request]) => request.payload.kind === 'commit')).toHaveLength(0)
  })

  it('retains an unknown commit and never sends it again', async () => {
    const dispatch = vi.fn(async (request: PreparedDispatch): Promise<BrowserActionResult> => request.payload.kind === 'prepare'
      ? { ...resultIdentity(request), outcome: 'observed', value: {
        preparationId: randomUUID(), expiresAt: request.deadline, description: description(request.payload.action),
      } }
      : { ...resultIdentity(request), outcome: 'unknown', reason: 'disconnected' })
    const prepared = new BrowserPreparations({ capacity: 2, requestTTL: 1000, dispatch, permit: () => true })
    const ticket = await prepared.prepare(operation(), new AbortController().signal)
    expect(await prepared.execute(ticket.ticket, new AbortController().signal)).toMatchObject({ outcome: 'unknown' })
    expect(await prepared.execute(ticket.ticket, new AbortController().signal)).toMatchObject({ outcome: 'unknown' })
    expect(dispatch.mock.calls.filter(([request]) => request.payload.kind === 'commit')).toHaveLength(1)
  })

  it('reserves prepare capacity and detaches every returned terminal result', async () => {
    const gate = Promise.withResolvers<undefined>()
    const dispatch = vi.fn(async (request: PreparedDispatch): Promise<BrowserActionResult> => {
      await gate.promise
      return request.payload.kind === 'prepare'
        ? { ...resultIdentity(request), outcome: 'observed', value: {
          preparationId: randomUUID(), expiresAt: request.payload.expiresAt, description: description(request.payload.action),
        } }
        : { ...resultIdentity(request), outcome: 'observed', value: { nested: { stable: true } } }
    })
    const prepared = new BrowserPreparations({ capacity: 1, requestTTL: 1000, dispatch, permit: () => true })
    const source = operation()
    const waiting = prepared.prepare(source, new AbortController().signal)
    source.action.intent = 'caller mutation'
    await expect(prepared.prepare(operation(), new AbortController().signal)).rejects.toMatchObject({ code: 'capacity' })
    gate.resolve(undefined)
    const ticket = await waiting
    const first = await prepared.execute(ticket.ticket, new AbortController().signal)
    ;(first.value as { nested: { stable: boolean } }).nested.stable = false
    expect(await prepared.execute(ticket.ticket, new AbortController().signal)).toMatchObject({ value: { nested: { stable: true } } })
    expect(dispatch.mock.calls[0]?.[0].payload.action).toMatchObject({ intent: '打开详细信息' })
  })
})
