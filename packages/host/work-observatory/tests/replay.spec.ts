import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { AgentActivityTracker } from '../src/agent-tracker.ts'
import { WorkObservatoryDatabase } from '../src/database.ts'

const databases: WorkObservatoryDatabase[] = []

function events(...entries: Array<[type: 'step/start' | 'step/end', time: number, step?: number]>): SessionEvent[] {
  return entries.map(([type, time, step = 1], seq) => ({
    type,
    seq,
    time,
    data: { turn: 1, step },
  }))
}

function header(id: string, seedLength?: number): SessionHeader {
  return {
    version: 0,
    id: SessionId(id),
    createdAt: 0,
    ...(seedLength === undefined ? {} : {
      parentSession: SessionId('parent'),
      seedLength,
    }),
  }
}

function contextWith(existing: Session[], database = new WorkObservatoryDatabase(':memory:')) {
  const ctx = new Context()
  databases.push(database)
  ctx.provide('sessions', { list: () => [...existing] } as never)
  new AgentActivityTracker(ctx, database)
  return { ctx, database }
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('AgentActivityTracker replay and recovery', () => {
  it('replays the same canonical log twice without duplicating its row', () => {
    const log = events(['step/start', 100], ['step/end', 500])
    const session = Session.create(SessionId('replay'), log, header('replay'))
    const { database } = contextWith([session])
    const second = new Context()
    second.provide('sessions', { list: () => [session] } as never)
    new AgentActivityTracker(second, database)

    expect(database.queryAgentIntervals(0, 1_000, 1_000)).toEqual([{ start: 100, end: 500 }])
  })

  it('skips a child Session inherited prefix and counts only its own events', () => {
    const child = Session.create(
      SessionId('child'),
      events(
        ['step/start', 100, 1],
        ['step/end', 200, 1],
        ['step/start', 300, 2],
        ['step/end', 500, 2],
      ),
      header('child', 2),
    )

    const { database } = contextWith([child])

    expect(database.queryAgentIntervals(0, 1_000, 1_000)).toEqual([{ start: 300, end: 500 }])
  })

  it('replays all history for a resumed root Session without a fork seed boundary', () => {
    const root = Session.create(
      SessionId('root-resume'),
      events(['step/start', 100], ['step/end', 500]),
      header('root-resume'),
    )

    const { database } = contextWith([root])

    expect(database.queryAgentIntervals(0, 1_000, 1_000)).toHaveLength(1)
  })

  it('conservative-closes startup orphan rows when no live Session owns them', () => {
    const database = new WorkObservatoryDatabase(':memory:')
    database.projectAgentEvent('orphan', events(['step/start', 100])[0]!)

    contextWith([], database)

    expect(database.queryAgentIntervals(0, 1_000, 1_000)).toEqual([{ start: 100, end: 100 }])
  })

  it('reopens a reconciled row when a live canonical log still has an open step', () => {
    const database = new WorkObservatoryDatabase(':memory:')
    database.projectAgentEvent('live-open', events(['step/start', 100])[0]!)
    const live = Session.create(SessionId('live-open'), events(['step/start', 100]), header('live-open'))

    contextWith([live], database)

    expect(database.queryAgentIntervals(0, 1_000, 1_000)).toEqual([{ start: 100, end: 1_000 }])
  })

  it('repairs a stale close with the canonical historical step/end time', () => {
    const database = new WorkObservatoryDatabase(':memory:')
    database.projectAgentEvent('repair', events(['step/start', 100])[0]!)
    database.reconcileOpenAgentSteps()
    const historical = Session.create(
      SessionId('repair'),
      events(['step/start', 100], ['step/end', 500]),
      header('repair'),
    )

    contextWith([historical], database)

    expect(database.queryAgentIntervals(0, 1_000, 1_000)).toEqual([{ start: 100, end: 500 }])
  })

  it('continues replay after one malformed event fails projection', () => {
    const database = new WorkObservatoryDatabase(':memory:')
    const malformed = Session.create(
      SessionId('malformed-replay'),
      events(
        ['step/start', 100, 1],
        ['step/end', 50, 1],
        ['step/start', 200, 2],
        ['step/end', 300, 2],
      ),
      header('malformed-replay'),
    )

    contextWith([malformed], database)

    expect(database.queryAgentIntervals(0, 1_000, 1_000)).toEqual([
      { start: 100, end: 1_000 },
      { start: 200, end: 300 },
    ])
  })
})
