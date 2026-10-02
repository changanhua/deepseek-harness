import { expect, it, vi } from 'vitest'
import { createThinkingController } from '../src/client/thinking-controller.ts'
import type { AdvanceThinkingInput, ThinkingCaseView } from '@changanhua/dsh-planning-remote/types'

it('resumes the same durable Session and prompt identity and does not resend after acceptance', async () => {
  let view = { design: { case: { version: 0 } }, runs: [{ id: 'run', version: 0, sessionId: 'session', presetId: 'thinking-desk',
    startup: { phase: 'prepared', promptRequestId: 'prompt', promptText: 'Question', bindCommand: { requestId: 'bind' } } }] } as unknown as ThinkingCaseView
  const remote = {
    thinkingCase: vi.fn(async () => ({ ok: true as const, value: view })),
    advanceThinking: vi.fn(async (input: AdvanceThinkingInput) => {
      view = structuredClone(view)
      view.runs[0]!.startup.phase = input.phase; view.runs[0]!.version++
      return { ok: true as const, value: view }
    }),
    execute: vi.fn(async () => ({ ok: true as const, value: { boardVersion: 1 } })),
  }
  const native = { create: vi.fn(async () => 'session'), prompt: vi.fn(async () => {}), open: vi.fn() }
  const controller = createThinkingController(remote as never, native)
  await controller.open({ workspaceId: 'workspace', subject: { kind: 'plan', id: 'plan' } })
  expect(await controller.resume('run')).toBe(true)
  expect(native.create).toHaveBeenCalledWith({ workspaceId: 'workspace', sessionId: 'session', agentPreset: 'thinking-desk' })
  expect(native.prompt).toHaveBeenCalledWith('session', 'Question', 'prompt', expect.any(AbortSignal))
  expect(await controller.resume('run')).toBe(true)
  expect(native.prompt).toHaveBeenCalledTimes(1)
  expect(remote.execute).toHaveBeenCalledTimes(1)
})

it('durably blocks a confirmed binding conflict and never sends the prompt on repeated resume', async () => {
  let view = { design: { case: { version: 0 }, currentRevision: 'new' }, runs: [{ id: 'run', version: 1, sessionId: 'session',
    startup: { phase: 'session-created', promptRequestId: 'prompt', promptText: 'Question', bindCommand: { requestId: 'bind' } } }] } as unknown as ThinkingCaseView
  const remote = {
    thinkingCase: vi.fn(async () => ({ ok: true as const, value: view })),
    advanceThinking: vi.fn(async (input: AdvanceThinkingInput) => {
      view = structuredClone(view); view.runs[0]!.startup.phase = input.phase
      view.runs[0]!.startup.blockedReason = input.blockedReason
      return { ok: true as const, value: view }
    }),
    execute: vi.fn(async () => ({ ok: false as const, error: { code: 'conflict', message: 'base revision changed' } })),
  }
  const native = { create: vi.fn(async () => 'session'), prompt: vi.fn(async () => {}), open: vi.fn() }
  const controller = createThinkingController(remote as never, native)
  await controller.open({ workspaceId: 'workspace', subject: { kind: 'plan', id: 'plan' } })
  expect(await controller.resume('run')).toBe(false)
  expect(view.runs[0]!.startup.phase).toBe('blocked')
  expect(await controller.resume('run')).toBe(false)
  expect(remote.execute).toHaveBeenCalledTimes(1)
  expect(native.prompt).not.toHaveBeenCalled()
})
