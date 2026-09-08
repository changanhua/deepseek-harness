import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('知识工具插件公开注册', () => {
  it('在可选 Web 与 Commands 存在或缺失时保持工具和人类入口的可用边界', async () => {
    const registered: Array<{
      execute: (args: { request: string }, exec: { agent: object; signal: AbortSignal }) => Promise<{ result: string }>
      presentCall: (args: { request: string }) => unknown
    }> = []
    let command: { handler: (invocation: { rawInput: string; signal: AbortSignal }) => Promise<{ kind: string; text: string }> } | undefined
    let webEnabled = false
    const fetched: string[] = []
    const repository = {
      list: () => [{ id: 'game', title: '游戏原型', readerTask: '写出试玩说明' }],
      get: () => ({
        spec: { title: '游戏原型', seeds: [] }, approvedHash: null, latestSources: { manual: 'old' },
        sources: { 'manual:old': { title: '资料', url: 'https://example.test/manual', snapshotId: 'old' } },
        stages: {}, sourceAvailability: {}, currentRelease: null,
      }),
      recordSourceFailure: async () => {},
    }
    const tools = {
      register: (tool: (typeof registered)[number]) => {
        registered.push(tool)
        return () => { registered.splice(registered.indexOf(tool), 1) }
      },
    }
    const commands = {
      register: (value: NonNullable<typeof command>) => {
        command = value
        return () => { command = undefined }
      },
    }
    const ctx = {
      knowledgeBase: { repository }, knowledgeQueue: {}, tools,
      get: (name: string) => {
        if (name === 'commands') return commands
        if (name === 'web' && webEnabled) return {
          fetch: async ({ url }: { url: string }) => {
            fetched.push(url)
            if (url.endsWith('/failure')) throw 'network failure'
            return { statusCode: 200, url, body: { content: '资料正文' }, truncated: false }
          },
        }
      },
    }

    const dispose = apply(ctx as never)
    const tool = registered[0]!
    const signal = new AbortController().signal
    await expect(tool.execute({ request: '{"action":"fetch","projectId":"game","sourceId":"manual","title":"资料","url":"https://example.test/manual"}' }, { agent: {}, signal }))
      .rejects.toThrow('未配置来源抓取能力')
    webEnabled = true
    const listed = await tool.execute({ request: '{"action":"list"}' }, { agent: {}, signal })
    expect(listed.result).toContain('游戏原型')
    expect(tool.presentCall({ request: '{"action":"list"}' })).toEqual({ card: 'generic', title: '知识库', kind: 'execute' })
    const human = command!
    await expect(human.handler({ rawInput: '{"action":"fetch","projectId":"game","sourceId":"manual","title":"资料","url":"https://example.test/failure"}', signal }))
      .resolves.toEqual({ kind: 'error', text: 'network failure' })
    expect(fetched).toEqual(['https://example.test/failure'])
    dispose()
    expect(registered).toEqual([])
    expect(command).toBeUndefined()
  })

  it('在 Commands 不存在时仍可注册并释放工具', () => {
    const registered: unknown[] = []
    const dispose = apply({
      knowledgeBase: { repository: {} }, knowledgeQueue: {},
      tools: { register: (tool: unknown) => { registered.push(tool); return () => { registered.pop() } } },
      get: () => undefined,
    } as never)

    expect(registered).toHaveLength(1)
    dispose()
    expect(registered).toHaveLength(0)
  })
})
