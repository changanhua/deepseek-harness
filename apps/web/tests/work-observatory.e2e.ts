import { afterEach, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@changanhua/dsh-host-work-observatory'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

let scaffold: WebScaffold | undefined

afterEach(async () => {
  vi.restoreAllMocks()
  await scaffold?.close()
  scaffold = undefined
})

it('composes Host accounting and its browser client into the shipped Web product', async () => {
  scaffold = await launchWebScaffold()
  const { ctx } = scaffold
  expect(ctx.workObservatory.typertRemote.namespace).toBe('workObservatory')
  const session = ctx.sessions.create(SessionId('work-observatory-e2e'), {
    meta: { cwd: scaffold.workspaceCwd },
  })
  vi.spyOn(Date, 'now').mockReturnValue(100)
  await ctx.workObservatory.observeClient({
    clientId: 'browser-e2e', seq: 0, visible: true, active: true, sessionId: session.id,
  })
  vi.mocked(Date.now).mockReturnValue(110)
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  vi.mocked(Date.now).mockReturnValue(130)
  await ctx.workObservatory.observeClient({
    clientId: 'browser-e2e', seq: 1, visible: false, active: false, sessionId: session.id,
  })
  vi.mocked(Date.now).mockReturnValue(150)
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })

  await expect(ctx.workObservatory.readRange({
    from: 0, to: 200, projectPath: scaffold.workspaceCwd,
  })).resolves.toMatchObject({
    summary: { humanActiveMs: 30, pageVisibleMs: 30, agentRunningMs: 40, togetherMs: 20 },
    sessions: [{ sessionId: session.id, humanActiveMs: 30, agentRunningMs: 40 }],
  })

  const boot = [...ctx.loader.entries()].map(entry => entry.options.name)
  expect(boot).toContain('@changanhua/dsh-client-ui-work-observatory')
})
