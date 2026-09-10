/// <reference lib="es2024" />
import { describe, expect, test, vi } from 'vitest'
import { createAssistantApproval } from '../src/assistant-approval.js'

const id = '123e4567-e89b-42d3-a456-426614174000'
type Connection = { phase: string; baseUrl?: string; grant?: { installationId: string; grantEpoch: number; scopes: string[] } }
type Binding = { baseUrl: string; installationId: string; sessionId: string }
function harness() {
  let connection: Connection = { phase: 'connected', baseUrl: 'http://localhost:3080', grant: { installationId: 'install', grantEpoch: 1, scopes: ['session:interact'] } }
  let binding: Binding = { baseUrl: 'http://localhost:3080', installationId: 'install', sessionId: 'session-a' }
  const call = vi.fn(async (_method: string, params: { sessionId?: string | null }): Promise<unknown> =>
    ({ sessionId: params.sessionId, requests: [] }))
  const approval = createAssistantApproval({ call, getConnection: () => connection, getBinding: () => binding })
  return { approval, call, connect: (value: Connection) => { connection = value }, bind: (value: Binding) => { binding = value } }
}
describe('native approval transport', () => {
  test('only an actually visible view claims its bound Session, closing the last view withdraws presence', async () => {
    const h = harness(); await h.approval.sync()
    expect(h.call).toHaveBeenLastCalledWith('approval.presence', { sessionId: null })
    await h.approval.setView('one', true); await h.approval.setView('two', true)
    expect(h.call).toHaveBeenLastCalledWith('approval.presence', { sessionId: 'session-a' })
    await h.approval.setView('one', false)
    expect(h.call).toHaveBeenCalledTimes(2)
    await h.approval.setView('two', false)
    expect(h.call).toHaveBeenLastCalledWith('approval.presence', { sessionId: null })
  })
  test('a stale Session response cannot replace the newly selected approval view', async () => {
    const h = harness(); const gate = Promise.withResolvers<unknown>()
    h.call.mockReturnValueOnce(gate.promise)
    const first = h.approval.setView('one', true); await Promise.resolve()
    h.bind({ baseUrl: 'http://localhost:3080', installationId: 'install', sessionId: 'session-b' })
    const second = h.approval.sync()
    gate.resolve({ sessionId: 'session-a', requests: [{ id, toolName: 'browser_action', reason: 'old' }] })
    await first; await second
    expect(h.approval.read()).toEqual({ sessionId: 'session-b', requests: [] })
  })
  test('one current id decides once in flight; another Session, hidden view or an unknown id cannot approve', async () => {
    const h = harness(); await h.approval.setView('one', true)
    h.approval.onEvent({ type: 'approval', sessionId: 'session-other', requests: [{ id, toolName: 'browser_action' }] })
    await expect(h.approval.decide(id, 'allowed-once')).rejects.toMatchObject({ code: 'approval_unavailable' })
    h.approval.onEvent({ type: 'approval', sessionId: 'session-a', requests: [{ id, toolName: 'browser_action' }] })
    const gate = Promise.withResolvers<unknown>(); h.call.mockReturnValueOnce(gate.promise)
    const deciding = h.approval.decide(id, 'allowed-once')
    await expect(h.approval.decide(id, 'allowed-once')).rejects.toMatchObject({ code: 'approval_unavailable' })
    gate.resolve({ accepted: true }); await deciding
    await h.approval.setView('one', false)
    await expect(h.approval.decide(id, 'allowed-once')).rejects.toMatchObject({ code: 'approval_unavailable' })
  })
  test('reconnecting with the same epoch republishes live presence and clears old approval cards', async () => {
    const h = harness(); await h.approval.setView('one', true)
    h.approval.onEvent({ type: 'approval', sessionId: 'session-a', requests: [{ id, toolName: 'browser_action' }] })
    h.connect({ phase: 'offline' }); await h.approval.sync(); expect(h.approval.read().requests).toEqual([])
    h.connect({ phase: 'connected', baseUrl: 'http://localhost:3080', grant: { installationId: 'install', grantEpoch: 1, scopes: ['session:interact'] } }); await h.approval.sync()
    expect(h.call.mock.calls.filter(([method]) => method === 'approval.presence')).toHaveLength(2)
  })
})
