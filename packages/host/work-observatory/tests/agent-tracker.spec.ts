import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { AgentActivityTracker } from '../src/agent-tracker.ts'
import { WorkObservatoryDatabase } from '../src/database.ts'

const databases: WorkObservatoryDatabase[] = []

function stepEvent(
  type: 'step/start' | 'step/end',
  seq: number,
  time: number,
  turn = 1,
  step = 1,
): SessionEvent<'step/start' | 'step/end'> {
  return { type, seq, time, data: { turn, step } }
}

function setup(existing: Session[] = []) {
  const ctx = new Context()
  ctx.provide('sessions', { list: () => [...existing] } as never)
  const database = new WorkObservatoryDatabase(':memory:')
  databases.push(database)
  new AgentActivityTracker(ctx, database)
  return { ctx, database }
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('AgentActivityTracker live projection', () => {
  it('projects one canonical step/start to step/end bracket', () => {
    const { ctx, database } = setup()
    const session = Session.create(SessionId('basic'))

    ctx.emit('session/event', session, stepEvent('step/start', 0, 100))
    ctx.emit('session/event', session, stepEvent('step/end', 1, 500))

    expect(database.queryAgentIntervals(0, 1_000, 1_000)).toEqual([{ start: 100, end: 500 }])
  })

  it('keeps sequential steps in one Session as distinct rows', () => {
    const { ctx, database } = setup()
    const session = Session.create(SessionId('sequential'))

    ctx.emit('session/event', session, stepEvent('step/start', 0, 100, 1, 1))
    ctx.emit('session/event', session, stepEvent('step/end', 1, 200, 1, 1))
    ctx.emit('session/event', session, stepEvent('step/start', 2, 300, 1, 2))
    ctx.emit('session/event', session, stepEvent('step/end', 3, 400, 1, 2))

    expect(database.queryAgentIntervals(0, 1_000, 1_000)).toEqual([
      { start: 100, end: 200 },
      { start: 300, end: 400 },
    ])
  })

  it('retains overlapping raw rows from different Sessions', () => {
    const { ctx, database } = setup()
    const first = Session.create(SessionId('first'))
    const second = Session.create(SessionId('second'))

    ctx.emit('session/event', first, stepEvent('step/start', 0, 100))
    ctx.emit('session/event', second, stepEvent('step/start', 0, 150))
    ctx.emit('session/event', first, stepEvent('step/end', 1, 300))
    ctx.emit('session/event', second, stepEvent('step/end', 1, 250))

    expect(database.queryAgentIntervals(0, 1_000, 1_000)).toHaveLength(2)
  })

  it('uses tool events only as low-frequency evidence within one step', () => {
    const { ctx, database } = setup()
    const session = Session.create(SessionId('tools'))
    const start = stepEvent('step/start', 0, 100)
    const call: SessionEvent<'tool/call'> = {
      type: 'tool/call',
      seq: 1,
      time: 200,
      data: { turn: 1, step: 1, callId: 'call-1' as never, name: 'one', arguments: '{}' },
    }
    const secondCall: SessionEvent<'tool/call'> = {
      type: 'tool/call',
      seq: 2,
      time: 250,
      data: { turn: 1, step: 1, callId: 'call-2' as never, name: 'two', arguments: '{}' },
    }

    ctx.emit('session/event', session, start)
    ctx.emit('session/event', session, call)
    ctx.emit('session/event', session, secondCall)

    database.reconcileOpenAgentSteps()
    expect(database.queryAgentIntervals(0, 1_000, 1_000)).toEqual([{ start: 100, end: 250 }])
  })

  it('does not write token-level assistant/chunk evidence', () => {
    const { ctx, database } = setup()
    const session = Session.create(SessionId('chunks'))
    ctx.emit('session/event', session, stepEvent('step/start', 0, 100))
    ctx.emit('session/event', session, {
      type: 'assistant/chunk',
      seq: 1,
      time: 900,
      data: { turn: 1, step: 1, chunk: { type: 'text', text: 'x' } as never },
    })

    database.reconcileOpenAgentSteps()
    expect(database.queryAgentIntervals(0, 1_000, 1_000)).toEqual([{ start: 100, end: 100 }])
  })

  it('uses step/end as the authoritative close after intermediate evidence', () => {
    const { ctx, database } = setup()
    const session = Session.create(SessionId('authoritative-end'))
    ctx.emit('session/event', session, stepEvent('step/start', 0, 100))
    ctx.emit('session/event', session, {
      type: 'tool/call',
      seq: 1,
      time: 200,
      data: { turn: 1, step: 1, callId: 'call-1' as never, name: 'one', arguments: '{}' },
    })
    ctx.emit('session/event', session, stepEvent('step/end', 2, 500))

    expect(database.queryAgentIntervals(0, 1_000, 1_000)).toEqual([{ start: 100, end: 500 }])
  })

  it('contains projection failures so later Session observers still run', () => {
    const { ctx } = setup()
    const session = Session.create(SessionId('containment'))
    let laterObserverCalls = 0
    ctx.on('session/event', () => { laterObserverCalls += 1 })

    expect(() => {
      ctx.emit('session/event', session, stepEvent('step/start', 0, 100))
      ctx.emit('session/event', session, stepEvent('step/end', 1, 50))
    }).not.toThrow()
    expect(laterObserverCalls).toBe(2)
  })

  it('conservatively closes a disposed Session that still has an open step', () => {
    const { ctx, database } = setup()
    const session = Session.create(SessionId('disposed'))
    ctx.emit('session/event', session, stepEvent('step/start', 0, 100))
    ctx.emit('session/disposed', session)

    expect(database.queryAgentIntervals(0, 1_000, 1_000)).toEqual([{ start: 100, end: 100 }])
  })
})
