import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import WorkObservatoryGateway from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  vi.useRealTimers()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(WorkObservatoryGateway, {
    path: ':memory:',
    staleAfterMs: 30_000,
    sweepIntervalMs: 15_000,
  })
  return ctx
}

describe('WorkObservatoryGateway', () => {
  it('exposes Host-timestamped observation and range methods', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const ctx = await setup()

    expect(ctx.workObservatory.observeClient({
      clientId: 'gateway-client',
      seq: 0,
      visible: true,
      active: true,
      clientObservedAt: 999_999,
    })).toEqual({ accepted: true })
    vi.setSystemTime(5_000)
    ctx.workObservatory.observeClient({
      clientId: 'gateway-client',
      seq: 1,
      visible: false,
      active: false,
      clientObservedAt: 1,
    })

    const result = ctx.workObservatory.range({ from: 0, to: 10_000 })
    expect(result.timeline.humanActive).toEqual([{ start: 1_000, end: 5_000 }])
  })

  it('projects live Session step events into range results', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100)
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('gateway-session'))
    session.append('step/start', { turn: 1, step: 1 })
    vi.setSystemTime(500)
    session.append('step/end', { turn: 1, step: 1 })

    expect(ctx.workObservatory.range({ from: 0, to: 1_000 }).timeline.agentRunning)
      .toEqual([{ start: 100, end: 500 }])
  })

  it('runs the configured stale sweep and keeps last-evidence accounting', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const ctx = await setup()
    ctx.workObservatory.observeClient({
      clientId: 'stale-client',
      seq: 0,
      visible: true,
      active: true,
      clientObservedAt: 1_000,
    })
    vi.advanceTimersByTime(45_000)

    expect(ctx.workObservatory.range({ from: 0, to: 100_000 }).timeline.humanActive).toEqual([])
  })
})
