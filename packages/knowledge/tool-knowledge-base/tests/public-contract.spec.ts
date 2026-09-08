import { describe, expect, it } from 'vitest'
import { canonicalHash } from '@changanhua/dsh-knowledge-base'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { createKnowledgeTool, executeKnowledgeRequest } from '../src/index.ts'
import { runKnowledgeBuild } from '../src/build.ts'

const spec = {
  id: 'game', title: '游戏原型', readerTask: '写出试玩说明', language: 'zh-CN',
  seeds: [
    { id: 'scope', title: '范围', goal: '确定范围', type: 'method', depends: [], sourceIds: ['manual'], required: true },
    { id: 'play', title: '试玩', goal: '测试范围', type: 'case', depends: ['scope'], sourceIds: ['manual'], required: true },
  ],
}

function dependencies(overrides: Record<string, unknown> = {}) {
  const old = { sourceId: 'manual', snapshotId: 'old', title: '旧资料', url: 'https://example.com/old' }
  const calls: string[] = []
  const record = {
    spec, approvedHash: canonicalHash(spec), latestSources: { manual: 'old' }, sources: { 'manual:old': old },
    entries: {}, stages: {}, currentRelease: 'v1',
  }
  const repository = {
    create: async (value: typeof spec) => ({ spec: value, approvedHash: null }),
    list: () => [spec], ingest: async (_id: string, value: { sourceId: string; title: string }) => ({ ...value, snapshotId: 'new' }),
    get: () => record, recordSourceFailure: async (_id: string, sourceId: string) => { calls.push('failure:' + sourceId) },
    confirmPlan: async (_id: string, hash: string) => { calls.push('confirm:' + hash) },
    adopt: async () => ({ revision: 4 }), check: async () => ({ publishable: true }),
    publish: async (_id: string, version: string) => ({ version }),
    exportDraft: async (_id: string, version: string) => ({ version, draft: true }),
    rollback: async (_id: string, version: string) => { calls.push('rollback:' + version) },
    diffReleases: (_id: string, from: string, to: string) => ({ from, to }), resumeGeneration: async () => { calls.push('resume-generation') },
    generationStop: () => null, prepareStage: async () => ({ id: 'stage', entryId: 'scope', action: 'generate', inputHash: 'input' }),
    ...overrides,
  }
  const queue = {
    enqueueStage: async (_id: string, entryId: string, action: string) => ({ workId: action + '-' + entryId, stageId: 'stage' }),
    status: (workId: string) => ({ state: { status: 'succeeded' }, result: { workId } }),
    cancel: async (workId: string) => { calls.push('cancel:' + workId) },
    correctStage: async (workId: string) => ({ workId: 'corrected-' + workId, stageId: 'stage-corrected' }),
    retryStage: async (workId: string) => { calls.push('retry:' + workId) },
    resumeStage: async (workId: string) => { calls.push('resume:' + workId) },
    stopGeneration: async () => { calls.push('stop-generation') },
  }
  return { deps: { repository, queue, ...overrides } as never, calls, record }
}

function toolExecution(agent?: ToolRunContext['agent']): ToolRunContext {
  return {
    callId: 'test-call', rootCallId: 'test-call', token: 'test-token', name: 'knowledge_base', arguments: {}, signal: new AbortController().signal, agent,
    deferContext: () => {}, concludeTurn: () => {},
  } as unknown as ToolRunContext
}

describe('知识库工具公开操作契约', () => {
  it('SiYuan 操作在未组合能力时失败，模型不能接纳远端编辑或触发迁入', async () => {
    const { deps } = dependencies()
    await expect(executeKnowledgeRequest({ action: 'siyuan-status', projectId: 'game' }, deps, new AbortController().signal)).rejects.toThrow(/未配置思源/)
    const tool = createKnowledgeTool(deps)
    for (const request of [
      { action: 'siyuan-sync', projectId: 'game', version: 'v1' },
      { action: 'siyuan-adopt', projectId: 'game', entryId: 'scope', snapshotHash: 'a'.repeat(64) },
    ]) await expect(tool.execute({ request: JSON.stringify(request) }, toolExecution({} as never))).rejects.toThrow(/人类命令/)
  })
  it('build 拒绝未确认计划与非法修订上限', async () => {
    const record = { spec, approvedHash: null, entries: {}, stages: {} }
    const deps = { repository: { get: () => record, generationStop: () => null }, queue: {} }
    await expect(runKnowledgeBuild('game', deps as never, new AbortController().signal)).rejects.toThrow('confirmed plan')
    await expect(runKnowledgeBuild('game', deps as never, new AbortController().signal, 4)).rejects.toThrow('maxRevisions')
  })

  it('build 在持久停止闸门关闭时不排入任何工作', async () => {
    let enqueued = false
    const record = { spec, approvedHash: canonicalHash(spec), entries: {}, stages: {} }
    const deps = { repository: { get: () => record, generationStop: () => ({ reason: 'operator_stop' }) }, queue: { enqueueStage: async () => { enqueued = true; return { workId: 'never' } } } }
    await expect(runKnowledgeBuild('game', deps as never, new AbortController().signal)).resolves.toEqual({ projectId: 'game', status: 'incomplete', completed: [], incomplete: [{ entryId: 'project', action: 'generate', reason: 'generation_stopped:operator_stop' }] })
    expect(enqueued).toBe(false)
  })
  it('覆盖创建、列表、导入、确认、排程、采纳、状态和发布入口', async () => {
    const { deps, calls } = dependencies()
    const signal = new AbortController().signal
    await expect(executeKnowledgeRequest({ action: 'create', spec }, deps, signal)).resolves.toMatchObject({ projectId: 'game', confirmed: false })
    await expect(executeKnowledgeRequest({ action: 'list' }, deps, signal)).resolves.toEqual({ projects: [{ id: 'game', title: '游戏原型', readerTask: '写出试玩说明' }] })
    await expect(executeKnowledgeRequest({ action: 'source', projectId: 'game', sourceId: 'manual', title: '手册', text: '正文' }, deps, signal)).resolves.toEqual({ sourceId: 'manual', snapshotId: 'new', title: '手册' })
    await expect(executeKnowledgeRequest({ action: 'source', projectId: 'game', sourceId: 'manual', title: '手册', text: '正文', url: 'https://example.com/manual' }, deps, signal)).resolves.toMatchObject({ snapshotId: 'new' })
    await executeKnowledgeRequest({ action: 'confirm', projectId: 'game', planHash: canonicalHash(spec) }, deps, signal)
    await expect(executeKnowledgeRequest({ action: 'plan', projectId: 'game' }, deps, signal)).resolves.toEqual({ workId: 'plan-plan', stageId: 'stage' })
    await expect(executeKnowledgeRequest({ action: 'generate', projectId: 'game', entryId: 'scope' }, deps, signal)).resolves.toEqual({ workId: 'generate-scope', stageId: 'stage' })
    await expect(executeKnowledgeRequest({ action: 'review', projectId: 'game', entryId: 'scope' }, deps, signal)).resolves.toEqual({ workId: 'review-scope', stageId: 'stage' })
    await expect(executeKnowledgeRequest({ action: 'adopt', projectId: 'game', entryId: 'scope' }, deps, signal)).resolves.toEqual({ projectId: 'game', entryId: 'scope', revision: 4, reviewRequired: true })
    ;(deps as { repository: { get: () => { stages: Record<string, unknown> } } }).repository.get().stages = { stage: { prepared: { id: 'stage', entryId: 'scope', action: 'review' }, workId: 'work-stage', state: 'completed' } }
    await expect(executeKnowledgeRequest({ action: 'status', projectId: 'game' }, deps, signal)).resolves.toMatchObject({ confirmed: true, sources: ['manual'], currentRelease: 'v1' })
    await expect(executeKnowledgeRequest({ action: 'check', projectId: 'game' }, deps, signal)).resolves.toEqual({ publishable: true })
    await expect(executeKnowledgeRequest({ action: 'publish', projectId: 'game', version: 'v2' }, deps, signal)).resolves.toEqual({ version: 'v2' })
    await expect(executeKnowledgeRequest({ action: 'export-draft', projectId: 'game', version: 'v2' }, deps, signal)).resolves.toEqual({ version: 'v2', draft: true })
    await expect(executeKnowledgeRequest({ action: 'diff', projectId: 'game', from: 'v1', to: 'v2' }, deps, signal)).resolves.toEqual({ from: 'v1', to: 'v2' })
    await expect(executeKnowledgeRequest({ action: 'rollback', projectId: 'game', version: 'v1' }, deps, signal)).resolves.toEqual({ projectId: 'game', currentRelease: 'v1' })
    await expect(executeKnowledgeRequest({ action: 'resume-generation' }, deps, signal)).resolves.toEqual({ generationResumed: true })
    await expect(executeKnowledgeRequest({ action: 'stop-generation' }, deps, signal)).resolves.toEqual({ generationStopped: true })
    expect(calls).toEqual(expect.arrayContaining(['confirm:' + canonicalHash(spec), 'rollback:v1', 'resume-generation', 'stop-generation']))
  })

  it('抓取成功、截断、缺抓取能力及失败记录保持公开行为', async () => {
    const signal = new AbortController().signal
    const ok = dependencies({ fetch: async () => ({ statusCode: 200, url: 'https://example.com/new', body: { content: '资料' }, truncated: false }) })
    await expect(executeKnowledgeRequest({ action: 'fetch', projectId: 'game', sourceId: 'manual', title: '资料', url: 'https://example.com/new' }, ok.deps, signal)).resolves.toEqual({ sourceId: 'manual', snapshotId: 'new', title: '资料' })
    const truncated = dependencies({ fetch: async () => ({ statusCode: 200, url: 'https://example.com/new', body: { content: '资料' }, truncated: true }) })
    await expect(executeKnowledgeRequest({ action: 'fetch', projectId: 'game', sourceId: 'manual', title: '资料', url: 'https://example.com/new' }, truncated.deps, signal)).rejects.toThrow('截断')
    expect(truncated.calls).toContain('failure:manual')
    const unavailable = dependencies()
    await expect(executeKnowledgeRequest({ action: 'fetch', projectId: 'game', sourceId: 'manual', title: '资料', url: 'https://example.com/new' }, unavailable.deps, signal)).rejects.toThrow('未配置来源抓取能力')
    const stringFailure = dependencies({ fetch: async () => { throw 'network-down' } })
    await expect(executeKnowledgeRequest({ action: 'fetch', projectId: 'game', sourceId: 'manual', title: '资料', url: 'https://example.com/new' }, stringFailure.deps, signal)).rejects.toBe('network-down')
    expect(stringFailure.calls).toContain('failure:manual')
  })

  it('build 发现遗留 unknown 工作时绝不重发', async () => {
    const record = { spec, approvedHash: canonicalHash(spec), entries: {}, stages: {
      old: { prepared: { entryId: 'scope', action: 'generate' }, workId: 'work-lost' },
    } }
    let enqueues = 0
    const deps = { repository: { get: () => record, generationStop: () => null }, queue: {
      status: () => ({ state: { status: 'unknown' } }), enqueueStage: async () => { enqueues++; return { workId: 'new' } },
    } }
    await expect(runKnowledgeBuild('game', deps as never, new AbortController().signal)).resolves.toEqual({ projectId: 'game', status: 'incomplete', completed: [], incomplete: [{ entryId: 'scope', action: 'generate', reason: 'queue_unknown', workId: 'work-lost' }] })
    expect(enqueues).toBe(0)
  })

  it('refresh 只在快照变化时返回依赖闭包，且拒绝无 URL 来源', async () => {
    const signal = new AbortController().signal
    const unchanged = dependencies({ fetch: async () => ({ statusCode: 200, url: 'https://example.com/old', body: { content: '资料' }, truncated: false }), ingest: async () => ({ sourceId: 'manual', snapshotId: 'old', title: '旧资料' }) })
    await expect(executeKnowledgeRequest({ action: 'refresh', projectId: 'game', sourceId: 'manual' }, unchanged.deps, signal)).resolves.toMatchObject({ changed: false, affected: [] })
    const changed = dependencies({ fetch: async () => ({ statusCode: 200, url: 'https://example.com/old', body: { content: '资料' }, truncated: false }) })
    await expect(executeKnowledgeRequest({ action: 'refresh', projectId: 'game', sourceId: 'manual' }, changed.deps, signal)).resolves.toMatchObject({ changed: true, affected: ['play', 'scope'] })
    const missing = dependencies()
    missing.record.sources['manual:old'] = { sourceId: 'manual', snapshotId: 'old', title: '无链接' } as never
    await expect(executeKnowledgeRequest({ action: 'refresh', projectId: 'game', sourceId: 'manual' }, missing.deps, signal)).rejects.toThrow('没有可重新抓取的 URL')
  })

  it('工作控制命令不会暴露队列输入，并传递重试、纠错和恢复', async () => {
    const { deps, calls } = dependencies()
    const signal = new AbortController().signal
    await expect(executeKnowledgeRequest({ action: 'work', workId: 'work-1' }, deps, signal)).resolves.toEqual({ workId: 'work-1', status: 'succeeded', result: { workId: 'work-1' } })
    await expect(executeKnowledgeRequest({ action: 'cancel', workId: 'work-1' }, deps, signal)).resolves.toEqual({ workId: 'work-1', canceled: true })
    await expect(executeKnowledgeRequest({ action: 'correct', workId: 'work-1' }, deps, signal)).resolves.toEqual({ workId: 'corrected-work-1', stageId: 'stage-corrected' })
    await expect(executeKnowledgeRequest({ action: 'retry', workId: 'work-1' }, deps, signal)).resolves.toEqual({ workId: 'work-1', retried: true })
    await expect(executeKnowledgeRequest({ action: 'resume', workId: 'work-1' }, deps, signal)).resolves.toEqual({ workId: 'work-1', resumed: true })
    expect(calls).toEqual(expect.arrayContaining(['cancel:work-1', 'retry:work-1', 'resume:work-1']))
  })

  it('工具入口要求会话并拒绝超过输出上限的结果', async () => {
    const { deps } = dependencies({
      list: () => Array.from(
        { length: 1000 },
        (_value, index) => ({ id: `x${index}`, title: 'x'.repeat(100), readerTask: 'y'.repeat(100) }),
      ),
    })
    const tool = createKnowledgeTool(deps)
    await expect(tool.execute({ request: '{"action":"list"}' }, toolExecution())).rejects.toThrow('需要已建立的会话')
    await expect(tool.execute({ request: '{"action":"list"}' }, toolExecution({} as ToolRunContext['agent']))).rejects.toThrow('结果过大')
    expect(tool.output.render({}, { result: 'ok' })).toEqual([{ type: 'text', text: 'ok' }])
  })

  it('模型工具不能解除生成停止，但可信 Host 仍可恢复', async () => {
    let resumed = 0
    const { deps } = dependencies({ resumeGeneration: async () => { resumed++ } })
    const tool = createKnowledgeTool(deps)
    const signal = new AbortController().signal

    expect(tool.description).toContain('模型工具不能解除停止')
    await expect(tool.execute(
      { request: '{"action":"resume-generation"}' }, toolExecution({} as ToolRunContext['agent']),
    )).rejects.toThrow('模型工具不能解除生成停止')
    expect(resumed).toBe(0)
    await expect(executeKnowledgeRequest({ action: 'resume-generation' }, deps, signal))
      .resolves.toEqual({ generationResumed: true })
    expect(resumed).toBe(1)
  })

})
