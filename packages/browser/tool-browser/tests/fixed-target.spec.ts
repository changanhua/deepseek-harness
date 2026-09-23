import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { BrowserActionResult, BrowserOperation } from '@changanhua/dsh-browser'
import { apply } from '../src/index.ts'

const sessionId = SessionId('fixed-target-test')
const page = { tabId: 1, frameId: 0, documentId: 'document', url: 'https://example.test/' }
const agent = { session: { id: sessionId } } as ToolRunContext['agent']

describe('fixed browser target discovery', () => {
  it('exposes only the user-fixed installation and tab', async () => {
    const observed: BrowserActionResult = {
      requestId: 'request', sessionId, installationId: 'installation', outcome: 'observed', delivery: 'sent',
      value: { tabs: [
        { tabId: 1, windowId: 10, url: page.url, title: '固定目标', active: false },
        { tabId: 2, windowId: 11, url: 'https://other.test/', title: '其他窗口活动页', active: true },
      ] },
    }
    const browser = {
      instances: vi.fn(async () => [
        { installationId: 'installation', extensionId: 'extension-a', grantEpoch: 1,
          origins: ['*'], scopes: ['browser:read'], online: true },
        { installationId: 'other-installation', extensionId: 'extension-b', grantEpoch: 1,
          origins: ['*'], scopes: ['browser:read'], online: true },
      ]),
      execute: vi.fn(async (_operation: BrowserOperation, _signal: AbortSignal) => observed),
    }
    const browserTasks = { get: () => undefined, readTarget: () => ({ revision: 1, binding: {
      installationId: 'installation', page, revision: 1, boundAt: 1, boundBy: 'user',
    } }) }
    const registered = new Map<string, ToolDefinition>()
    apply({ sessionProjections: { register: vi.fn(), stateOf: vi.fn() }, inject: vi.fn(), on: vi.fn(), browser, browserTasks,
      tools: { guard: vi.fn(), register: (tool: ToolDefinition) => { registered.set(tool.name, tool) } },
    } as unknown as Context)
    const exec = { agent, signal: new AbortController().signal } as ToolRunContext

    await expect(registered.get('browser_instances')!.execute({}, exec)).resolves.toEqual([
      expect.objectContaining({ installationId: 'installation' }),
    ])
    await expect(registered.get('browser_tabs')!.execute({ installationId: 'installation' }, exec)).resolves.toMatchObject({
      value: { tabs: [{ tabId: 1, title: '固定目标' }] },
    })
    await expect(registered.get('browser_tabs')!.execute({ installationId: 'other-installation' }, exec))
      .rejects.toThrow('fixed browser target belongs to another installation')
  })
})
