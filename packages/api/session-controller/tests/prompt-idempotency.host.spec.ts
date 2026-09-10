import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import type { SessionPromptRequest, SessionRequestId } from '../src/types.ts'

const sid = (id: string): SessionId => SessionId(id)
const requestId = (id: string): SessionRequestId => id as SessionRequestId

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  const session = ctx.sessions.create(sid('idempotent'), { meta: { cwd: '/workspace' } })
  const followup = vi.fn((message: UserMessage) => { session.append('user/message', message, { surfaceOp: 'append' }) })
  const steer = vi.fn((message: UserMessage) => { session.append('user/message', message, { surfaceOp: 'append' }) })
  const agent = { id: session.id, session, status: 'idle', ctx, followup, steer } as unknown as Agent
  ctx.agents.register(agent)
  ctx.provide('llm', {
    listProviders: () => [{ id: 'fixture', name: 'fixture' }],
    resolveModelInfo: () => Promise.resolve({ inputModalities: ['image'] }),
  } as never)
  const admit = vi.fn((images: readonly { mediaType: string; name?: string }[]) => Promise.resolve(images.map((image, index) => ({
    attachmentId: AttachmentId(`image-${String(index)}`), mediaType: image.mediaType,
    bytes: 1, width: 1, height: 1, ...image.name === undefined ? {} : { name: image.name },
  }))))
  ctx.provide('attachments', { saveImages: admit } as never)
  const selection: ModelSelectionRef = { current: { provider: 'fixture', model: 'fixture-model' }, assembled: undefined }
  let chain = Promise.resolve()
  const serializeImageAdmission = vi.fn(<Value>(_agent: Agent, operation: () => Promise<Value>) => {
    const result = chain.then(operation)
    chain = result.then(() => undefined, () => undefined)
    return result
  })
  const agents = {
    resolveAgent: () => Promise.resolve({ agent }),
    selectionFor: () => selection,
    serializeImageAdmission,
  } as unknown as ApiSessionAgentController
  const flush = vi.spyOn(ctx.sessions, 'flush').mockResolvedValue(true)
  return {
    ctx,
    agent,
    controller: new SessionCommandController(ctx, agents, '/workspace'),
    followup,
    steer,
    admit,
    flush,
  }
}

function prompt(overrides: Partial<SessionPromptRequest> = {}): SessionPromptRequest {
  return {
    sessionId: sid('idempotent'),
    requestId: requestId('request-1'),
    mode: 'queue',
    content: [{ type: 'text', text: 'continue' }],
    ...overrides,
  }
}

async function expectFailure(operation: Promise<unknown>, code: string): Promise<void> {
  await expect(operation).rejects.toMatchObject({ failure: { code } })
}

describe('Session prompt idempotency', () => {
  it('serializes concurrent identical text and image requests into one admission', async () => {
    const fixture = await harness()
    const text = prompt()
    await expect(Promise.all([fixture.controller.prompt(text), fixture.controller.prompt(text)]))
      .resolves.toEqual([{ accepted: true }, { accepted: true }])
    expect(fixture.followup).toHaveBeenCalledOnce()
    expect(fixture.flush).toHaveBeenCalledTimes(2)

    const image = prompt({
      requestId: requestId('image-1'),
      content: [{ type: 'image', mediaType: 'image/png', data: 'AQ==', name: 'one.png' }],
    })
    await expect(Promise.all([fixture.controller.prompt(image), fixture.controller.prompt(image)]))
      .resolves.toEqual([{ accepted: true }, { accepted: true }])
    expect(fixture.followup).toHaveBeenCalledTimes(2)
    expect(fixture.admit).toHaveBeenCalledOnce()
    await fixture.ctx.fiber.dispose()
  })

  it('rejects changed mode, zone, or content before a retry can promote another attachment', async () => {
    const fixture = await harness()
    const first = prompt({
      requestId: requestId('image-conflict'),
      clientTimeZone: 'UTC',
      content: [{ type: 'image', mediaType: 'image/png', data: 'AQ==', name: 'one.png' }],
    })
    await fixture.controller.prompt(first)
    const initialAdmissions = fixture.admit.mock.calls.length
    await expectFailure(fixture.controller.prompt(prompt({
      requestId: first.requestId,
      mode: 'steer',
      clientTimeZone: 'UTC',
      content: [{ type: 'image', mediaType: 'image/png', data: 'AQ==', name: 'one.png' }],
    })), 'request-conflict')
    await expectFailure(fixture.controller.prompt(prompt({
      requestId: first.requestId,
      clientTimeZone: 'Asia/Tokyo',
      content: [{ type: 'image', mediaType: 'image/png', data: 'AQ==', name: 'one.png' }],
    })), 'request-conflict')
    await expectFailure(fixture.controller.prompt(prompt({
      requestId: first.requestId,
      clientTimeZone: 'UTC',
      content: [{ type: 'image', mediaType: 'image/png', data: 'Ag==', name: 'one.png' }],
    })), 'request-conflict')
    expect(fixture.admit).toHaveBeenCalledTimes(initialAdmissions)
    await fixture.ctx.fiber.dispose()
  })

  it('finds the request in durable message history even after its queued occurrence is removed', async () => {
    const fixture = await harness()
    const value = prompt()
    await fixture.controller.prompt(value)
    fixture.agent.session.append('agent/inbox/spliced', {
      target: 'next-turn', start: 0, removedCount: 1, inserted: [], outcome: 'canceled',
    })
    await expect(fixture.controller.prompt(value)).resolves.toEqual({ accepted: true })
    expect(fixture.followup).toHaveBeenCalledOnce()
    await fixture.ctx.fiber.dispose()
  })

  it('retries a failed flush without admitting the already durable prompt again', async () => {
    const fixture = await harness()
    fixture.flush.mockRejectedValueOnce(new Error('storage offline'))
    const value = prompt()
    await expectFailure(fixture.controller.prompt(value), 'agent-busy')
    expect(fixture.followup).toHaveBeenCalledOnce()
    await expect(fixture.controller.prompt(value)).resolves.toEqual({ accepted: true })
    expect(fixture.followup).toHaveBeenCalledOnce()
    expect(fixture.flush).toHaveBeenCalledTimes(2)
    await fixture.ctx.fiber.dispose()
  })

  it('restores an inserted durable request after rebuilding the controller and Agent', async () => {
    const fixture = await harness()
    const value = prompt()
    await fixture.controller.prompt(value)
    const message = fixture.followup.mock.calls[0]?.[0]
    if (message === undefined) throw new Error('missing durable prompt')
    const restored = fixture.ctx.sessions.create(sid('restored'), { meta: { cwd: '/workspace' } })
    restored.append('agent/inbox/spliced', {
      target: 'next-turn', start: 0, inserted: [message],
    })
    const followup = vi.fn()
    const agent = { id: restored.id, session: restored, status: 'idle', ctx: fixture.ctx, followup } as unknown as Agent
    fixture.ctx.agents.register(agent)
    const controller = new SessionCommandController(fixture.ctx, {
      resolveAgent: () => Promise.resolve({ agent }),
      selectionFor: () => ({ current: { provider: 'fixture', model: 'fixture-model' } }),
      serializeImageAdmission: <Value>(_agent: Agent, operation: () => Promise<Value>) => operation(),
    } as unknown as ApiSessionAgentController, '/workspace')
    await expect(controller.prompt(prompt({ sessionId: restored.id }))).resolves.toEqual({ accepted: true })
    expect(followup).not.toHaveBeenCalled()
    await fixture.ctx.fiber.dispose()
  })

  it('does not let a fork seed reserve the child request id', async () => {
    const fixture = await harness()
    await fixture.controller.prompt(prompt())
    const seed = [...fixture.agent.session.events]
    const child = fixture.ctx.sessions.create(sid('child'), {
      seed,
      meta: { cwd: '/workspace', seedLength: seed.length },
    })
    const childFollowup = vi.fn((message: UserMessage) => { child.append('user/message', message, { surfaceOp: 'append' }) })
    const childAgent = { id: child.id, session: child, status: 'idle', ctx: fixture.ctx, followup: childFollowup } as unknown as Agent
    fixture.ctx.agents.register(childAgent)
    const childController = new SessionCommandController(fixture.ctx, {
      resolveAgent: () => Promise.resolve({ agent: childAgent }),
      selectionFor: () => ({ current: { provider: 'fixture', model: 'fixture-model' } }),
      serializeImageAdmission: <Value>(_agent: Agent, operation: () => Promise<Value>) => operation(),
    } as unknown as ApiSessionAgentController, '/workspace')
    await expect(childController.prompt(prompt({ sessionId: child.id }))).resolves.toEqual({ accepted: true })
    expect(childFollowup).toHaveBeenCalledOnce()
    await fixture.ctx.fiber.dispose()
  })
  it('freezes caller input before asynchronous Agent lookup and admission', async () => {
    const fixture = await harness()
    const value = prompt()
    const accepted = fixture.controller.prompt(value)
    ;(value.content[0] as { text: string }).text = 'changed by caller'
    await accepted
    expect(fixture.followup.mock.calls[0]?.[0].content).toEqual([{ type: 'text', text: 'continue' }])
    await expect(fixture.controller.prompt(prompt())).resolves.toEqual({ accepted: true })
    expect(fixture.followup).toHaveBeenCalledOnce()
    await fixture.ctx.fiber.dispose()
  })
  it('cancellation during image promotion prevents a later inbox insertion', async () => {
    const fixture = await harness()
    const cancellation = new AbortController()
    const admit = fixture.admit.getMockImplementation()!
    fixture.admit.mockImplementationOnce(async (images) => {
      const result = await admit(images)
      cancellation.abort(new Error('browser authorization withdrawn'))
      return result
    })
    await expect(fixture.controller.prompt(prompt({ content: [{ type: 'image', mediaType: 'image/png', data: 'AQ==' }] }), cancellation.signal)).rejects.toThrow()
    expect(fixture.followup).not.toHaveBeenCalled()
    await fixture.ctx.fiber.dispose()
  })
})
