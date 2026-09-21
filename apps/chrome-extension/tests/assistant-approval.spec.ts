/// <reference lib="es2024" />
import { describe, expect, test, vi } from 'vitest'
import { createAssistantApproval } from '../src/assistant-approval.js'

const id = '123e4567-e89b-42d3-a456-426614174000'
type Connection = { phase: string; baseUrl?: string; grant?: { installationId: string; grantEpoch: number; scopes: string[] } }
type Binding = { baseUrl: string; installationId: string; sessionId: string }
type Approval = {
  sync: (surfaceId?: string) => Promise<void>
  setView: (surfaceId: string, visible: boolean) => Promise<void>
  read: (surfaceId: string) => { sessionId: string | null; requests: unknown[] }
  onEvent: (frame: unknown) => void
  decide: (surfaceId: string, id: string, decision: string) => Promise<unknown>
}
function harness() {
  let connection: Connection = { phase: 'connected', baseUrl: 'http://localhost:3080', grant: { installationId: 'install', grantEpoch: 1, scopes: ['session:interact'] } }
  const bindings = new Map<string, Binding>([['one', { baseUrl: 'http://localhost:3080', installationId: 'install', sessionId: 'session-a' }]])
  const call = vi.fn(async (_method: string, params: { surfaceId: string; sessionId?: string | null }): Promise<unknown> =>
    ({ surfaceId: params.surfaceId, sessionId: params.sessionId, requests: [] }))
  const approval = createAssistantApproval({ call, getConnection: () => connection,
    getBinding: (surfaceId: string) => bindings.get(surfaceId) ?? null }) as Approval
  return { approval, call, connect: (value: Connection) => { connection = value },
    bind: (surfaceId: string, value: Binding) => { bindings.set(surfaceId, value) } }
}
describe('native approval transport', () => {
  test('each visible surface claims only its own bound Session and withdraws independently', async () => {
    const h = harness(); await h.approval.sync()
    expect(h.call).not.toHaveBeenCalled()
    h.bind('two', { baseUrl: 'http://localhost:3080', installationId: 'install', sessionId: 'session-b' })
    await h.approval.setView('one', true); await h.approval.setView('two', true)
    expect(h.call).toHaveBeenCalledWith('approval.presence', { surfaceId: 'one', sessionId: 'session-a' })
    expect(h.call).toHaveBeenCalledWith('approval.presence', { surfaceId: 'two', sessionId: 'session-b' })
    await h.approval.setView('one', false)
    expect(h.call).toHaveBeenLastCalledWith('approval.presence', { surfaceId: 'one', sessionId: null })
    expect(h.approval.read('two')).toEqual({ sessionId: 'session-b', requests: [] })
  })
  test('a stale Session response cannot replace the newly selected approval view', async () => {
    const h = harness(); const gate = Promise.withResolvers<unknown>()
    h.call.mockReturnValueOnce(gate.promise)
    const first = h.approval.setView('one', true); await Promise.resolve()
    h.bind('one', { baseUrl: 'http://localhost:3080', installationId: 'install', sessionId: 'session-b' })
    const second = h.approval.sync('one')
    gate.resolve({ surfaceId: 'one', sessionId: 'session-a', requests: [{ id, toolName: 'browser_action', reason: 'old' }] })
    await first; await second
    expect(h.approval.read('one')).toEqual({ sessionId: 'session-b', requests: [] })
  })
  test('one current id decides once in flight; another Session, hidden view or an unknown id cannot approve', async () => {
    const h = harness(); await h.approval.setView('one', true)
    h.approval.onEvent({ type: 'approval', surfaceId: 'one', sessionId: 'session-other', requests: [{ id, toolName: 'browser_action' }] })
    await expect(h.approval.decide('one', id, 'allowed-once')).rejects.toMatchObject({ code: 'approval_unavailable' })
    h.approval.onEvent({ type: 'approval', surfaceId: 'one', sessionId: 'session-a', requests: [{ id, toolName: 'browser_action' }] })
    const gate = Promise.withResolvers<unknown>(); h.call.mockReturnValueOnce(gate.promise)
    const deciding = h.approval.decide('one', id, 'allowed-once')
    await expect(h.approval.decide('one', id, 'allowed-once')).rejects.toMatchObject({ code: 'approval_unavailable' })
    gate.resolve({ accepted: true }); await deciding
    await h.approval.setView('one', false)
    await expect(h.approval.decide('one', id, 'allowed-once')).rejects.toMatchObject({ code: 'approval_unavailable' })
  })
  test('reconnecting with the same epoch republishes live presence and clears old approval cards', async () => {
    const h = harness(); await h.approval.setView('one', true)
    h.approval.onEvent({ type: 'approval', surfaceId: 'one', sessionId: 'session-a', requests: [{ id, toolName: 'browser_action' }] })
    h.connect({ phase: 'offline' }); await h.approval.sync(); expect(h.approval.read('one').requests).toEqual([])
    h.connect({ phase: 'connected', baseUrl: 'http://localhost:3080', grant: { installationId: 'install', grantEpoch: 1, scopes: ['session:interact'] } }); await h.approval.sync()
    const presence = h.call.mock.calls.filter(([method]) => method === 'approval.presence')
    expect(presence).toHaveLength(3)
    expect(presence[1]?.[1]).toEqual({ surfaceId: 'one', sessionId: null })
  })
})
