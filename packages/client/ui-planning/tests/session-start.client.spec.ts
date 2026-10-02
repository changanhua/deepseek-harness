import { expect, it } from 'vitest'
import { createPlanningSessionStarter, STEWARD_AGENT_PRESET } from '../src/client/session-start.ts'
import type { PlanningCommand } from '@changanhua/dsh-planning/types'

function setup() {
  let id = 0
  const created = new Set<string>()
  const presets = new Map<string, string | undefined>()
  const bound = new Map<string, PlanningCommand>()
  const messages = new Map<string, { sessionId: string; text: string }>()
  const opened: string[] = []
  const world = { created, presets, bound, messages, opened, loseReply: false, failBinding: false, conflict: false, bindingCalls: 0 }
  const starter = createPlanningSessionStarter({
    newId: () => `id-${++id}`,
    create: async (_workspace, sessionId, agentPreset) => { created.add(sessionId); presets.set(sessionId, agentPreset) },
    bind: async (_workspace, command) => {
      world.bindingCalls++
      if (world.conflict) { world.conflict = false; throw Object.assign(new Error('Board changed'), { code: 'conflict' }) }
      if (world.failBinding) throw new Error('revision changed')
      if (command.kind !== 'bind-session' || !created.has(command.sessionId)) throw new Error('Session is missing')
      bound.set(command.sessionId, command)
    },
    prompt: async (sessionId, text, requestId) => {
      if (!bound.has(sessionId)) throw new Error('Delegation must not precede binding')
      const prior = messages.get(requestId)
      if (prior && (prior.sessionId !== sessionId || prior.text !== text)) throw new Error('request identity changed')
      messages.set(requestId, { sessionId, text })
      if (world.loseReply) { world.loseReply = false; throw new Error('reply lost after acceptance') }
    },
    open: (sessionId) => { opened.push(sessionId) },
    refresh: () => {},
  })
  return { ...world, world, starter }
}
const input = { workspaceId: 'project', boardVersion: 7, subject: { kind: 'plan' as const, id: 'original-goal' }, revision: 'r12', mode: 'steward' as const }

it('binds the original goal before sending the stewardship request', async () => {
  const { starter, created, bound, messages } = setup()
  await starter.start(input)
  expect(created.size).toBe(1)
  expect([...bound.values()]).toMatchObject([{ subject: input.subject, baseRevision: 'r12' }])
  expect([...messages.values()][0]?.text).toContain('project-steward')
  expect([...messages.values()][0]?.text).toContain('original-goal')
})

it('retains the created Session after a definite Board conflict and binds the refreshed version', async () => {
  const { starter, world, created, bound } = setup()
  world.conflict = true
  await expect(starter.start(input)).rejects.toThrow('Board changed')
  await starter.start({ ...input, boardVersion: 8 })
  expect(created.size).toBe(1)
  expect([...bound.values()]).toMatchObject([{ expectedBoardVersion: 8, subject: input.subject, baseRevision: 'r12' }])
})

it('rejects new admissions after disposal', async () => {
  const { starter, created } = setup()
  starter.dispose()
  await expect(starter.start(input)).rejects.toThrow()
  expect(created.size).toBe(0)
})

it('keeps ordinary discussions blank', async () => {
  const { starter, messages, opened } = setup()
  await starter.start({ ...input, mode: undefined })
  expect(messages.size).toBe(0)
  expect(opened).toHaveLength(1)
})

it('composes the stewardship entry on the work-steward preset', async () => {
  const { starter, presets } = setup()
  await starter.start(input)
  expect([...presets.values()]).toEqual([STEWARD_AGENT_PRESET])
})

it('leaves the ordinary entry on the deployment default preset', async () => {
  const { starter, presets } = setup()
  await starter.start({ ...input, mode: undefined })
  expect([...presets.values()]).toEqual([undefined])
})

it('retries an uncertain prompt with the same Session and receipt without rebinding', async () => {
  const { starter, world, messages, created } = setup()
  world.loseReply = true
  await expect(starter.start(input)).rejects.toThrow('reply lost')
  await starter.start(input)
  expect(messages.size).toBe(1)
  expect(created.size).toBe(1)
  expect(world.bindingCalls).toBe(1)
})

it('coalesces simultaneous entry clicks and never prompts after a failed binding', async () => {
  const { starter, world, messages } = setup()
  world.failBinding = true
  const first = starter.start(input)
  const second = starter.start(input)
  expect(first).toBe(second)
  await expect(first).rejects.toThrow('revision changed')
  expect(messages.size).toBe(0)
  world.failBinding = false
  await starter.start(input)
  expect(messages.size).toBe(1)
})
