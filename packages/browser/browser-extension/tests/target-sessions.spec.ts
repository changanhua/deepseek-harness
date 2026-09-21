import { describe, expect, it, vi } from 'vitest'
import { BrowserSessions } from '../src/sessions.ts'
import { extensionFrameSchema } from '../src/wire.ts'

type Controller = ConstructorParameters<typeof BrowserSessions>[0]

const sessionId = 'session-target'
const installationId = '123e4567-e89b-42d3-a456-426614174000'
const page = { tabId: 7, frameId: 0, documentId: 'document-a', url: 'https://example.test/a' }

const controller = () => ({
  list: vi.fn(async () => ({ items: [] })), create: vi.fn(async () => ({ sessionId })),
  prompt: vi.fn(async () => ({ accepted: true })), cancel: vi.fn(async () => ({ accepted: true })),
  page: vi.fn(async () => ({ records: [], hasMore: false })),
  attachment: vi.fn(async () => ({ attachment: {}, data: '' })),
  follow: vi.fn(async function* () {}),
})

describe('authenticated Session target RPC', () => {
  it('forwards a bounded agent preset on Session creation without accepting owner identity', async () => {
    const c = controller()
    const sessions = new BrowserSessions(c as unknown as Controller, { permit: () => true, send: () => {} })
    await expect(sessions.handle('session.create', {
      sessionId, cwd: 'C:/work', agentPreset: 'browser-assistant',
    })).resolves.toEqual({ sessionId })
    expect(c.create).toHaveBeenCalledWith({ sessionId, cwd: 'C:/work', agentPreset: 'browser-assistant' }, expect.any(AbortSignal))
    await expect(sessions.handle('session.create', {
      sessionId, agentPreset: 'browser-assistant', ownerAgentId: 'forged-owner',
    })).rejects.toMatchObject({ code: 'bad_request' })
    await expect(sessions.handle('session.create', {
      sessionId, agentPreset: '../other',
    })).rejects.toMatchObject({ code: 'bad_request' })
  })

  it('derives installation identity outside the request and routes read, bind, and clear', async () => {
    const c = controller()
    const targets = {
      read: vi.fn(() => ({ revision: 0, binding: null })),
      bind: vi.fn(() => ({ installationId, page, revision: 1, boundAt: 123, boundBy: 'user' as const })),
      clear: vi.fn(() => ({ revision: 2, binding: null })),
    }
    const sessions = new BrowserSessions(c as unknown as Controller, {
      permit: () => true, send: () => {}, installationId, targets,
    })
    await expect(sessions.handle('session.target.read', { sessionId })).resolves.toEqual({ revision: 0, binding: null })
    await expect(sessions.handle('session.target.bind', { sessionId, expectedRevision: 0, page })).resolves.toMatchObject({
      installationId, page, revision: 1, boundBy: 'user',
    })
    expect(targets.bind).toHaveBeenCalledWith(sessionId, { expectedRevision: 0, installationId, page }, expect.any(AbortSignal))
    await expect(sessions.handle('session.target.clear', { sessionId, expectedRevision: 1 })).resolves.toEqual({ revision: 2, binding: null })
    expect(targets.clear).toHaveBeenCalledWith(sessionId, 1, expect.any(AbortSignal))
    await expect(sessions.handle('session.target.bind', {
      sessionId, expectedRevision: 0, installationId: 'attacker-installation', page,
    })).rejects.toMatchObject({ code: 'bad_request' })
  })

  it('fences prompt admission by the target revision while retaining omitted-field compatibility', async () => {
    const c = controller()
    let revision = 0
    const targets = {
      read: vi.fn(() => ({ revision, binding: null })), bind: vi.fn(), clear: vi.fn(),
    }
    const sessions = new BrowserSessions(c as unknown as Controller, {
      permit: () => true, send: () => {}, installationId, targets,
    })
    const request = { requestId: 'prompt-1', sessionId, mode: 'queue',
      content: [{ type: 'text', text: 'hello' }] }
    await expect(sessions.handle('session.prompt', { ...request, expectedTargetRevision: 0 })).resolves.toEqual({ accepted: true })
    expect(targets.read).toHaveBeenLastCalledWith(sessionId, expect.any(AbortSignal))
    expect(c.prompt).toHaveBeenLastCalledWith(request, expect.any(AbortSignal))
    revision = 1
    await expect(sessions.handle('session.prompt', {
      ...request, requestId: 'prompt-stale', expectedTargetRevision: 0,
    })).rejects.toMatchObject({ code: 'target_changed' })
    expect(c.prompt).toHaveBeenCalledTimes(1)
    await expect(sessions.handle('session.prompt', { ...request, requestId: 'prompt-legacy' })).resolves.toEqual({ accepted: true })
    expect(c.prompt).toHaveBeenCalledTimes(2)
  })

  it('publishes the bounded target and slash-command methods on the extension request vocabulary', () => {
    for (const method of ['session.modelCatalog', 'session.selectModel', 'session.target.read', 'session.target.bind', 'session.target.clear', 'commands.execute']) {
      expect(extensionFrameSchema.safeParse({ type: 'request', requestId: installationId, method, params: {} }).success).toBe(true)
    }
  })
})
