import { describe, expect, it } from 'vitest'
import { canonicalHash } from '@changanhua/dsh-knowledge-base'
import { executeKnowledgeRequest, parseKnowledgeRequest } from '../src/index.ts'
import { runKnowledgeBuild } from '../src/build.ts'

describe('知识库操作输入', () => {
  it('拒绝未知操作、路径、额外配置和错用参数', () => {
    expect(() => parseKnowledgeRequest('{"action":"shell","command":"anything"}')).toThrow()
    expect(() => parseKnowledgeRequest('{"action":"status","projectId":"../other"}')).toThrow()
    expect(() => parseKnowledgeRequest('{"action":"status","projectId":"game","root":"C:/"}')).toThrow()
    expect(() => parseKnowledgeRequest('{"action":"rollback","projectId":"game"}')).toThrow()
    expect(() => parseKnowledgeRequest('{"action":"export-draft","projectId":"game","version":"../v1"}')).toThrow()
    expect(() => parseKnowledgeRequest('{"action":"diff","projectId":"game","from":"v1","to":"../v2"}')).toThrow()
    expect(parseKnowledgeRequest('{"action":"check","projectId":"game"}')).toEqual({ action: 'check', projectId: 'game' })
  })

  it('来源抓取失败时不写入错误页，不替换已有快照', async () => {
    let ingested = false
    const deps = {
      repository: { ingest: async () => { ingested = true } },
      queue: {},
      fetch: async () => ({ statusCode: 404, url: 'https://example.com/missing', body: { kind: 'text', content: 'not found' }, truncated: false }),
    }
    await expect(executeKnowledgeRequest({
      action: 'fetch', projectId: 'game', sourceId: 'engine', title: '引擎资料', url: 'https://example.com/missing',
    }, deps as never, new AbortController().signal)).rejects.toThrow(/404/)
    expect(ingested).toBe(false)
  })

  it('既有来源 refresh 抓取失败时保留旧快照并记录可用性失败', async () => {
    let failure = ''
    const deps = {
      repository: {
        get: () => ({ latestSources: { engine: 'old' } }),
        recordSourceFailure: async (_projectId: string, sourceId: string, message: string) => { failure = sourceId + ':' + message },
      },
      queue: {},
      fetch: async () => ({ statusCode: 503, url: 'https://example.com/engine', body: { kind: 'text', content: 'busy' }, truncated: false }),
    }
    await expect(executeKnowledgeRequest({
      action: 'fetch', projectId: 'game', sourceId: 'engine', title: '引擎资料', url: 'https://example.com/engine',
    }, deps as never, new AbortController().signal)).rejects.toThrow(/503/)
    expect(failure).toMatch(/^engine:knowledge-base: source HTTP 503$/)
  })

  it('返回压缩工作状态而不是模型完整输入，且取消只委托知识服务', async () => {
    let canceled = '', corrected = '', retried = ''
    const deps = {
      repository: {},
      queue: {
        status: () => ({ work: { id: 'work-1', kind: 'knowledge.stage@1', intent: { projectId: 'game', stageId: 'stage-1' }, resolved: { prompt: '不应出现在状态输出里的大段来源' } },
          state: { status: 'succeeded' }, result: { output: { stageId: 'stage-1' } }, attempts: [] }),
        cancel: async (id: string) => { canceled = id },
        correctStage: async (id: string) => { corrected = id; return { workId: 'work-2', stageId: 'stage-2' } },
        retryStage: async (id: string) => { retried = id },
      },
    }
    const status = await executeKnowledgeRequest({ action: 'work', workId: 'work-1' }, deps as never, new AbortController().signal)
    expect(JSON.stringify(status)).not.toContain('不应出现在状态输出')
    await executeKnowledgeRequest({ action: 'cancel', workId: 'work-1' }, deps as never, new AbortController().signal)
    expect(canceled).toBe('work-1')
    await expect(executeKnowledgeRequest({ action: 'correct', workId: 'work-1' }, deps as never, new AbortController().signal))
      .resolves.toEqual({ workId: 'work-2', stageId: 'stage-2' })
    await executeKnowledgeRequest({ action: 'retry', workId: 'work-1' }, deps as never, new AbortController().signal)
    expect(corrected).toBe('work-1')
    expect(retried).toBe('work-1')
  })

  it('build 只从未通过的条目继续，并在审查失败后至多修订到上限', async () => {
    const spec = {
      id: 'game', title: '游戏原型', readerTask: '写出试玩说明', language: 'zh-CN',
      seeds: [
        { id: 'scope', title: '玩法范围', goal: '确定玩家动作', type: 'method', depends: [], sourceIds: ['manual'], required: true },
        { id: 'playtest', title: '试玩', goal: '验证范围', type: 'case', depends: ['scope'], sourceIds: ['manual'], required: true },
      ],
    }
    const entries: Record<string, { stale: boolean; revision: number; review: { decision: { status: string } } | null }> = {
      scope: { stale: false, revision: 1, review: { decision: { status: 'pass' } } },
    }
    const record = { spec, approvedHash: canonicalHash(spec), entries, stages: {} as Record<string, { prepared: { id: string; entryId: string; action: 'generate' | 'review'; inputHash: string }; workId: string | null; state: string }> }
    const calls: string[] = []
    let serial = 0
    const queue = {
      enqueueStage: async (_projectId: string, entryId: string, action: 'generate' | 'review') => {
        calls.push(action + ':' + entryId)
        const workId = `work-${++serial}`
        const stage = Object.values(record.stages).find(candidate => (
          candidate.prepared.entryId === entryId
          && candidate.prepared.action === action
          && candidate.workId === null
        ))!
        stage.workId = workId
        stage.state = 'completed'
        if (action === 'generate') entries[entryId] = { stale: false, revision: (entries[entryId]?.revision ?? 0) + 1, review: null }
        else entries[entryId]!.review = { decision: { status: entries[entryId]!.revision === 1 ? 'fail' : 'pass' }, stageId: stage.prepared.id } as never
        return { workId, stageId: stage.prepared.id }
      },
      status: () => ({ state: { status: 'succeeded' } }),
      cancel: async () => {},
    }
    const result = await runKnowledgeBuild('game', { repository: {
      generationStop: () => null,
      get: () => record,
      check: async () => ({ entries: spec.seeds.map(seed => ({ id: seed.id, issues: entries[seed.id]?.review?.decision.status === 'pass' ? [] : ['review_not_passed'] })) }),
      prepareStage: async (_projectId: string, entryId: string, action: 'generate' | 'review') => {
        const id = `${action}-${entryId}-${Object.keys(record.stages).length}`
        record.stages[id] = { prepared: { id, entryId, action, inputHash: 'input-' + entryId }, workId: null, state: 'prepared' }
        return record.stages[id].prepared
      },
    } as never, queue: queue as never }, new AbortController().signal, 2)

    expect(result).toEqual({ projectId: 'game', status: 'completed', completed: ['scope', 'playtest'], incomplete: [] })
    expect(calls).toEqual(['generate:playtest', 'review:playtest', 'generate:playtest', 'review:playtest'])
  })

  it('build 遇到结果未知时返回原 workId，重复调用不重发该阶段', async () => {
    const spec = {
      id: 'game', title: '游戏原型', readerTask: '写出试玩说明', language: 'zh-CN',
      seeds: [{ id: 'scope', title: '玩法范围', goal: '确定玩家动作', type: 'method', depends: [], sourceIds: ['manual'], required: true }],
    }
    let enqueues = 0
    const record = { spec, approvedHash: canonicalHash(spec), entries: {}, stages: {} as Record<string, { prepared: { id: string; entryId: string; action: 'generate' | 'review'; inputHash: string }; workId: string | null; state: string }> }
    const queue = {
      enqueueStage: async () => {
        enqueues++
        record.stages.unknown = { prepared: { id: 'unknown', entryId: 'scope', action: 'generate', inputHash: 'input-scope' }, workId: 'work-unknown', state: 'prepared' }
        return { workId: 'work-unknown', stageId: 'stage-unknown' }
      },
      status: () => ({ state: { status: 'unknown' } }),
      cancel: async () => {},
    }
    const deps = { repository: {
      generationStop: () => null, get: () => record,
      check: async () => ({ entries: [{ id: 'scope', issues: ['entry_missing'] }] }),
      prepareStage: async () => ({ id: 'unknown', entryId: 'scope', action: 'generate', inputHash: 'input-scope' }),
    } as never, queue: queue as never }
    const first = await runKnowledgeBuild('game', deps, new AbortController().signal, 2)
    const second = await runKnowledgeBuild('game', deps, new AbortController().signal, 2)

    expect(first).toEqual({ projectId: 'game', status: 'incomplete', completed: [], incomplete: [{ entryId: 'scope', action: 'generate', reason: 'queue_unknown', workId: 'work-unknown' }] })
    expect(second).toEqual(first)
    expect(enqueues).toBe(1)
  })

  it('build 遇到 unresolved 审查或手改冲突时不覆盖条目', async () => {
    const spec = {
      id: 'game', title: '游戏原型', readerTask: '写出试玩说明', language: 'zh-CN',
      seeds: [{ id: 'scope', title: '玩法范围', goal: '确定玩家动作', type: 'method', depends: [], sourceIds: ['manual'], required: true }],
    }
    const entry = { stale: false, revision: 1, review: { decision: { status: 'unresolved' }, stageId: 'review-1' } }
    const repository = {
      generationStop: () => null,
      get: () => ({ spec, approvedHash: canonicalHash(spec), entries: { scope: entry }, stages: {} }),
      check: async () => ({ entries: [{ id: 'scope', issues: ['review_not_passed'] }] }),
      prepareStage: async () => { throw new Error('unresolved 条目不得重入 Queue') },
    }
    const queue = { enqueueStage: async () => { throw new Error('不得覆盖 unresolved') }, status: () => ({ state: { status: 'succeeded' } }), cancel: async () => {} }
    await expect(runKnowledgeBuild('game', { repository, queue } as never, new AbortController().signal)).resolves.toMatchObject({
      status: 'incomplete', incomplete: [{ entryId: 'scope', reason: 'review_unresolved' }],
    })
    repository.check = async () => ({ entries: [{ id: 'scope', issues: ['working_copy_changed'] }] })
    await expect(runKnowledgeBuild('game', { repository, queue } as never, new AbortController().signal)).resolves.toMatchObject({
      status: 'incomplete', incomplete: [{ entryId: 'scope', reason: 'working_copy_changed' }],
    })
  })

  it('同项目并发 build 拒绝第二调用，取消只清理由第一调用新建的工作', async () => {
    const spec = {
      id: 'game', title: '游戏原型', readerTask: '写出试玩说明', language: 'zh-CN',
      seeds: [{ id: 'scope', title: '玩法范围', goal: '确定玩家动作', type: 'method', depends: [], sourceIds: ['manual'], required: true }],
    }
    const stages: Record<string, { prepared: { id: string; entryId: string; action: 'generate'; inputHash: string }; workId: string | null; state: string }> = {}
    let status: 'running' | 'canceled' = 'running', canceled = 0
    let entered!: () => void
    const enteredQueue = new Promise<void>((resolve) => { entered = resolve })
    const repository = {
      generationStop: () => null,
      get: () => ({ spec, approvedHash: canonicalHash(spec), entries: {}, stages }),
      check: async () => ({ entries: [{ id: 'scope', issues: ['entry_missing'] }] }),
      prepareStage: async () => {
        stages.generate = { prepared: { id: 'generate', entryId: 'scope', action: 'generate', inputHash: 'input' }, workId: null, state: 'prepared' }
        return stages.generate.prepared
      },
    }
    const queue = {
      enqueueStage: async () => { stages.generate!.workId = 'work-active'; entered(); return { workId: 'work-active', stageId: 'generate' } },
      status: () => ({ state: { status } }),
      cancel: async () => { canceled++; status = 'canceled' },
    }
    const controller = new AbortController()
    const first = runKnowledgeBuild('game', { repository, queue } as never, controller.signal)
    await enteredQueue
    await expect(runKnowledgeBuild('game', { repository, queue } as never, new AbortController().signal)).rejects.toThrow('already running')
    controller.abort(new Error('stop'))
    await expect(first).rejects.toThrow('The operation was aborted')
    expect(canceled).toBe(1)
  })
})
