import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import WorkObservatory from '../src/index.ts'

const contexts: Context[] = []

async function harness(
  pool = new MemoryMediaPool(),
  config: { retentionDays?: number; maxClients?: number; maxQueryRecords?: number } = {},
) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(SessionStore)
  await ctx.plugin(WorkObservatory, {
    retentionDays: config.retentionDays ?? 90,
    maxClients: config.maxClients ?? 2,
    maxQueryRecords: config.maxQueryRecords ?? 100,
  })
  return { ctx, pool, observatory: ctx.workObservatory }
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe('WorkObservatory', () => {
  it('publishes bounded observeClient and readRange Remote methods', async () => {
    const { observatory } = await harness()
    expect(observatory.typertRemote.serviceKey).toBe('workObservatory')
    expect(remoteMethods(observatory)).toEqual([
      { method: 'observeClient', invocation: { kind: 'direct' } },
      { method: 'readRange', invocation: { kind: 'direct' } },
    ])
  })

  it('uses Host time and unions human and Agent intervals per project and Session', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10)
    const { ctx, observatory } = await harness()
    const session = ctx.sessions.create(SessionId('s1'), {
      meta: { createdAt: 10, cwd: 'C:\\repo' },
    })

    await observatory.observeClient({
      clientId: 'browser-1', seq: 0, visible: true, active: true, sessionId: session.id,
    })
    vi.setSystemTime(15)
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    vi.setSystemTime(20)
    await observatory.observeClient({
      clientId: 'browser-1', seq: 1, visible: false, active: false, sessionId: session.id,
    })
    vi.setSystemTime(30)
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    await vi.waitFor(async () => {
      const result = await observatory.readRange({ from: 0, to: 40, projectPath: 'C:\\repo' })
      expect(result.summary).toEqual({
        humanActiveMs: 10,
        pageVisibleMs: 10,
        agentRunningMs: 15,
        togetherMs: 5,
        agentSoloMs: 10,
      })
      expect(result.sessions).toEqual([{
        sessionId: session.id,
        projectPath: 'C:\\repo',
        humanActiveMs: 10,
        agentRunningMs: 15,
        togetherMs: 5,
      }])
    })
  })

  it('includes adjacent Session step boundaries in the next range read', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10)
    const { ctx, observatory } = await harness()
    const session = ctx.sessions.create(SessionId('ordered-step'), {
      meta: { createdAt: 10, cwd: 'C:\\repo' },
    })
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })
    vi.setSystemTime(30)
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

    const result = await observatory.readRange({ from: 0, to: 40 })

    expect(result.summary.agentRunningMs).toBe(20)
  })

  it('rejects duplicate and out-of-order client observations without extending evidence', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10)
    const { observatory } = await harness()
    await expect(observatory.observeClient({
      clientId: 'browser-1', seq: 0, visible: true, active: true,
    })).resolves.toEqual({ accepted: true })
    vi.setSystemTime(15)
    await observatory.observeClient({
      clientId: 'browser-1', seq: 1, visible: true, active: true,
    })
    vi.setSystemTime(20)
    await expect(observatory.observeClient({
      clientId: 'browser-1', seq: 1, visible: false, active: false,
    })).resolves.toEqual({ accepted: false })

    const result = await observatory.readRange({ from: 0, to: 30 })
    expect(result.summary.humanActiveMs).toBe(5)
    expect(result.summary.pageVisibleMs).toBe(5)
  })

  it('bounds concurrent client identities instead of growing state without limit', async () => {
    const { observatory } = await harness()
    await observatory.observeClient({ clientId: 'browser-1', seq: 0, visible: true, active: false })
    await observatory.observeClient({ clientId: 'browser-2', seq: 0, visible: true, active: false })
    await expect(observatory.observeClient({
      clientId: 'browser-3', seq: 0, visible: true, active: false,
    })).rejects.toThrow(/client limit/i)
  })

  it('compacts unchanged heartbeats into the current client state', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const { observatory } = await harness(new MemoryMediaPool(), { maxQueryRecords: 2 })
    await observatory.observeClient({ clientId: 'browser-1', seq: 0, visible: true, active: true })
    for (let seq = 1; seq <= 10; seq += 1) {
      vi.setSystemTime(seq)
      await observatory.observeClient({ clientId: 'browser-1', seq, visible: true, active: true })
    }
    vi.setSystemTime(11)
    await observatory.observeClient({ clientId: 'browser-1', seq: 11, visible: false, active: false })

    const result = await observatory.readRange({ from: 0, to: 20 })
    expect(result.summary.humanActiveMs).toBe(11)
    expect(result.summary.pageVisibleMs).toBe(11)
  })

  it('reopens committed intervals through storageDomain after a Host restart', async () => {
    vi.useFakeTimers()
    const pool = new MemoryMediaPool()
    vi.setSystemTime(100)
    const first = await harness(pool)
    await first.observatory.observeClient({
      clientId: 'browser-1', seq: 0, visible: true, active: true,
    })
    vi.setSystemTime(140)
    await first.observatory.observeClient({
      clientId: 'browser-1', seq: 1, visible: false, active: false,
    })
    await first.ctx.fiber.dispose()
    contexts.splice(contexts.indexOf(first.ctx), 1)

    const second = await harness(pool)
    const result = await second.observatory.readRange({ from: 0, to: 200 })
    expect(result.summary.humanActiveMs).toBe(40)
    expect(result.summary.pageVisibleMs).toBe(40)
  })

  it('prunes evidence older than the configured retention window during later activity', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100)
    const { observatory } = await harness(new MemoryMediaPool(), {
      retentionDays: 1,
      maxQueryRecords: 1,
    })
    await observatory.observeClient({ clientId: 'old', seq: 0, visible: true, active: true })
    vi.setSystemTime(140)
    await observatory.observeClient({ clientId: 'old', seq: 1, visible: false, active: false })
    vi.setSystemTime(2 * 24 * 60 * 60 * 1_000)
    await observatory.observeClient({ clientId: 'new', seq: 0, visible: true, active: false })

    const old = await observatory.readRange({ from: 0, to: 200 })
    expect(old.summary.humanActiveMs).toBe(0)
  })

  it('retains an open Session step across the retention cutoff', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100)
    const { ctx, observatory } = await harness(new MemoryMediaPool(), { retentionDays: 1 })
    const session = ctx.sessions.create(SessionId('long-running'), {
      meta: { createdAt: 100, cwd: 'C:\\repo' },
    })
    session.append('turn/start', { turn: 1 })
    session.append('step/start', { turn: 1, step: 1 })

    const twoDays = 2 * 24 * 60 * 60 * 1_000
    vi.setSystemTime(twoDays)
    await observatory.observeClient({ clientId: 'new', seq: 0, visible: true, active: false })
    const result = await observatory.readRange({ from: twoDays - 1_000, to: twoDays })

    expect(result.summary.agentRunningMs).toBe(1_000)
  })
})
