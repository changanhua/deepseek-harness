import { describe, expect, it, vi } from 'vitest'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { BrowserActivity } from '@changanhua/dsh-browser-activity'
import { createActivitySearchTool } from '../src/activity.ts'

const sessionId = SessionId('owning-session')
const execution = (signal = new AbortController().signal) => ({ agent: { session: { id: sessionId } }, signal }) as ToolRunContext

describe('model activity search', () => {
  it('derives Session from the executing Agent and never forwards caller-supplied ownership', async () => {
    const query = vi.fn<BrowserActivity['query']>(async () => [])
    const tool = createActivitySearchTool({ query })
    const input = { installationId: 'installation', query: 'article', limit: 5, sessionId: 'foreign-session' }
    await tool.execute(input, execution())
    expect(query.mock.calls[0]?.slice(0, 2)).toEqual(['installation', { sessionId, query: 'article', since: undefined, limit: 5 }])
    expect(JSON.stringify(tool.parameters)).not.toContain('sessionId')
  })
  it('requires an initiating Agent and observes cancellation before and after the Host read', async () => {
    const query = vi.fn<BrowserActivity['query']>(async () => [])
    const tool = createActivitySearchTool({ query })
    await expect(tool.execute({ installationId: 'installation' }, { signal: new AbortController().signal } as ToolRunContext))
      .rejects.toThrow('initiating agent')
    const before = new AbortController(); before.abort()
    await expect(tool.execute({ installationId: 'installation' }, execution(before.signal))).rejects.toThrow()
    expect(query).not.toHaveBeenCalled()
    const during = new AbortController()
    query.mockImplementationOnce(async (_installation, _query, authorize) => { during.abort(); authorize?.(); return [] })
    await expect(tool.execute({ installationId: 'installation' }, execution(during.signal))).rejects.toThrow()
  })
})
