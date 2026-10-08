import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { RoleChannel } from '../src/channel.ts'
import { runRoleProtocol } from '../src/controller.ts'

test('rejects identity mismatch before input admission while allowing the core to flush and close', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-controller-'))
  const host = await RoleChannel.create(root, 8192), worker = await RoleChannel.connect(root, 8192)
  const running = runRoleProtocol(host, { sessionId: 'subject', maxRequests: 4,
    observe: () => { throw new Error('eval-role-identity-mismatch') }, model: async () => { throw new Error('must not dispatch') },
  }, AbortSignal.timeout(3000))
  try {
    await worker.send({ sequence: 1, kind: 'ready', value: { sessionId: 'subject' } })
    expect((await worker.receive(1, AbortSignal.timeout(1000))).value).toEqual({ canceled: true })
    await worker.waitForCancellation(AbortSignal.timeout(1000))
    await worker.send({ sequence: 2, kind: 'complete', value: { sessionId: 'subject', output: '', flushed: true, canceled: true } })
    await worker.receive(2, AbortSignal.timeout(1000))
    expect(await running).toMatchObject({ status: 'invalid', reason: 'eval-role-identity-mismatch', rawReports: { complete: { flushed: true } } })
  } finally { await running; await worker.close(); await host.close(); await rm(root, { recursive: true, force: true }) }
})

test('retains transport failure as infrastructure uncertainty', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-controller-'))
  const host = await RoleChannel.create(root, 8192)
  try {
    await host.close()
    const result = await runRoleProtocol(host, { sessionId: 'subject', maxRequests: 4,
      model: async () => { throw new Error('must not dispatch') },
    }, AbortSignal.timeout(1000))
    expect(result).toMatchObject({ status: 'uncertain', reason: 'eval-role-transport-uncertain' })
  } finally { await host.close(); await rm(root, { recursive: true, force: true }) }
})

test('refuses a second controller for a channel, including after cancellation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-controller-'))
  const host = await RoleChannel.create(root, 8192)
  const cancellation = new AbortController()
  const binding = { sessionId: 'subject', maxRequests: 4,
    model: async () => { throw new Error('must not dispatch') } }
  const first = runRoleProtocol(host, binding, cancellation.signal)
  try {
    await expect(runRoleProtocol(host, binding, AbortSignal.timeout(100))).rejects.toThrow('eval-role-channel-already-owned')
    cancellation.abort()
    expect(await first).toMatchObject({ status: 'canceled' })
    await expect(runRoleProtocol(host, binding, AbortSignal.timeout(100))).rejects.toThrow('eval-role-channel-already-owned')
  } finally { cancellation.abort(); await first; await host.close(); await rm(root, { recursive: true, force: true }) }
})

test.each(['model-before-ready', 'sequence-gap', 'duplicate-ready', 'wrong-session'])('rejects %s before model dispatch', async (scenario) => {
  const root = await mkdtemp(join(tmpdir(), 'eval-controller-'))
  const host = await RoleChannel.create(root, 8192), worker = await RoleChannel.connect(root, 8192)
  let dispatches = 0
  const running = runRoleProtocol(host, { sessionId: 'subject', maxRequests: 4,
    model: async () => { dispatches++; throw new Error('must not dispatch') } }, AbortSignal.timeout(3000))
  try {
    if (scenario === 'duplicate-ready') {
      await worker.send({ sequence: 1, kind: 'ready', value: { sessionId: 'subject' } })
      await worker.receive(1, AbortSignal.timeout(3000))
    }
    await worker.send({ sequence: scenario === 'sequence-gap' || scenario === 'duplicate-ready' ? 2 : 1,
      kind: scenario === 'model-before-ready' ? 'model' : 'ready',
      value: { sessionId: scenario === 'wrong-session' ? 'forged' : 'subject' } })
    const result = await running
    expect(result).toMatchObject({ status: 'invalid', reason: 'eval-role-protocol-invalid' })
    expect(dispatches).toBe(0)
  } finally { await running; await worker.close(); await host.close(); await rm(root, { recursive: true, force: true }) }
})

test('retains raw role reports without turning a complete message into an attestation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eval-controller-'))
  const host = await RoleChannel.create(root, 8192), worker = await RoleChannel.connect(root, 8192)
  const running = runRoleProtocol(host, { sessionId: 'subject', maxRequests: 4,
    model: async () => ({ status: 'settled', reason: null, chunks: [], evidence: [] }) }, AbortSignal.timeout(3000))
  try {
    for (const frame of [
      { sequence: 1, kind: 'ready', value: { sessionId: 'subject', tools: [{ id: 'forged' }] } },
      { sequence: 2, kind: 'model', value: {} },
      { sequence: 3, kind: 'complete', value: { sessionId: 'subject', output: 'READY', flushed: true } },
    ]) { await worker.send(frame); await worker.receive(frame.sequence, AbortSignal.timeout(3000)) }
    expect(await running).toMatchObject({ status: 'reported', rawReports: {
      ready: { tools: [{ id: 'forged' }] }, complete: { output: 'READY' },
    } })
  } finally { await running; await worker.close(); await host.close(); await rm(root, { recursive: true, force: true }) }
})

test.each(['denied', 'uncertain'] as const)('drains the canceled role after %s accounting without acknowledging a usable model result', async (status) => {
  const root = await mkdtemp(join(tmpdir(), 'eval-controller-'))
  const host = await RoleChannel.create(root, 8192), worker = await RoleChannel.connect(root, 8192)
  const running = runRoleProtocol(host, { sessionId: 'subject', maxRequests: 4,
    model: async () => ({ status, reason: 'accounting', chunks: [], evidence: [] }) }, AbortSignal.timeout(3000))
  try {
    await worker.send({ sequence: 1, kind: 'ready', value: { sessionId: 'subject' } })
    await worker.receive(1, AbortSignal.timeout(3000))
    await worker.send({ sequence: 2, kind: 'model', value: {} })
    expect(await worker.receive(2, AbortSignal.timeout(3000))).toMatchObject({ kind: 'model-result', value: [
      { type: 'finish', reason: { kind: 'error' } },
    ] })
    await worker.waitForCancellation(AbortSignal.timeout(3000))
    await worker.send({ sequence: 3, kind: 'complete', value: { sessionId: 'subject', output: '', flushed: true, canceled: true } })
    await worker.receive(3, AbortSignal.timeout(3000))
    expect(await running).toMatchObject({ status: status === 'denied' ? 'invalid' : 'uncertain', reason: 'accounting' })
  } finally { await running; await worker.close(); await host.close(); await rm(root, { recursive: true, force: true }) }
})
