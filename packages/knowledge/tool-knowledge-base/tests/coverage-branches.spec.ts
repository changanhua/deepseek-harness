import { describe, expect, it } from 'vitest'
import { canonicalHash } from '@changanhua/dsh-knowledge-base'
import { runKnowledgeBuild } from '../src/build.ts'

const spec = {
  id: 'game', title: '游戏原型', readerTask: '写出试玩说明', language: 'zh-CN',
  seeds: [{ id: 'scope', title: '玩法范围', goal: '确定玩家动作', type: 'method', depends: [], sourceIds: ['manual'], required: true }],
}

describe('知识库构建的可恢复 Queue 边界', () => {
  it('遇到准备后已绑定的 unknown 工作时保留工作身份而不再次排队', async () => {
    const record = { spec, approvedHash: canonicalHash(spec), entries: {}, stages: {} as Record<string, unknown> }
    let enqueued = 0
    const result = await runKnowledgeBuild('game', {
      repository: {
        generationStop: () => null, get: () => record,
        check: async () => ({ entries: [{ id: 'scope', issues: ['entry_missing'] }] }),
        prepareStage: async () => {
          record.stages.generate = {
            prepared: { id: 'generate', entryId: 'scope', action: 'generate', inputHash: 'input' },
            workId: 'work-lost', state: 'prepared', responseHash: null,
          }
          return (record.stages.generate as { prepared: unknown }).prepared
        },
      } as never,
      queue: {
        enqueueStage: async () => { enqueued++; return { workId: 'new-work' } },
        status: () => ({ state: { status: 'unknown' } }), cancel: async () => {},
      } as never,
    }, new AbortController().signal)

    expect(result).toEqual({
      projectId: 'game', status: 'incomplete', completed: [],
      incomplete: [{ entryId: 'scope', action: 'generate', reason: 'queue_unknown', workId: 'work-lost' }],
    })
    expect(enqueued).toBe(0)
  })

  it('复用已完成的工作后仍要求生成实际推进条目版本', async () => {
    const record = {
      spec, approvedHash: canonicalHash(spec),
      entries: { scope: { stale: true, revision: 1, review: null } },
      stages: { generate: { prepared: { id: 'generate', entryId: 'scope', action: 'generate', inputHash: 'input' }, workId: 'work-done', state: 'prepared' } },
    }
    let enqueued = 0
    const result = await runKnowledgeBuild('game', {
      repository: {
        generationStop: () => null, get: () => record,
        check: async () => ({ entries: [{ id: 'scope', issues: ['entry_missing'] }] }),
        prepareStage: async () => record.stages.generate.prepared,
      } as never,
      queue: {
        enqueueStage: async () => { enqueued++; return { workId: 'new-work' } },
        status: () => ({ state: { status: 'succeeded' } }), cancel: async () => {},
      } as never,
    }, new AbortController().signal)

    expect(result).toMatchObject({ incomplete: [{ reason: 'generation_no_progress', workId: 'work-done' }] })
    expect(enqueued).toBe(0)
  })

  it('在排队失败后若停止闸门关闭便报告停止而不泄漏原始错误', async () => {
    let checks = 0
    const result = await runKnowledgeBuild('game', {
      repository: {
        generationStop: () => (++checks === 1 ? null : { reason: 'operator_stop' }),
        get: () => ({ spec, approvedHash: canonicalHash(spec), entries: {}, stages: {} }),
        check: async () => ({ entries: [{ id: 'scope', issues: ['entry_missing'] }] }),
        prepareStage: async () => ({ id: 'generate', entryId: 'scope', action: 'generate', inputHash: 'input' }),
      } as never,
      queue: {
        enqueueStage: async () => { throw new Error('Queue unavailable') },
        status: () => ({ state: { status: 'queued' } }), cancel: async () => {},
      } as never,
    }, new AbortController().signal)

    expect(result).toMatchObject({ incomplete: [{ reason: 'generation_stopped:operator_stop' }] })
  })

  it('在校验纠错次数耗尽时保留失败工作的身份', async () => {
    const stages = {
      rejected: {
        prepared: { id: 'rejected', entryId: 'scope', action: 'generate', inputHash: 'input' },
        workId: null, state: 'prepared', responseHash: 'response',
      },
      plan: {
        prepared: { id: 'plan', entryId: 'scope', action: 'plan', inputHash: 'input' },
        workId: null, state: 'prepared', responseHash: 'response',
      },
    }
    const record = { spec, approvedHash: canonicalHash(spec), entries: {}, stages }
    const result = await runKnowledgeBuild('game', {
      repository: {
        generationStop: () => null, get: () => record,
        check: async () => ({ entries: [{ id: 'scope', issues: ['entry_missing'] }] }),
        prepareStage: async () => ({ id: 'new', entryId: 'scope', action: 'generate', inputHash: 'input' }),
      } as never,
      queue: {
        enqueueStage: async () => ({ workId: 'work-invalid' }),
        status: () => ({ state: { status: 'failed', failure: { category: 'knowledge-validation' } } }),
        correctStage: async () => ({ workId: 'corrected' }), cancel: async () => {},
      } as never,
    }, new AbortController().signal, 0)

    expect(result).toMatchObject({ incomplete: [{ reason: 'validation_correction_limit', workId: 'work-invalid' }] })
  })

  it('不把未满足前置条件的条目误排入 Queue', async () => {
    const blocked = { ...spec, seeds: [{ ...spec.seeds[0], id: 'blocked', depends: ['missing'] }] }
    const result = await runKnowledgeBuild('game', {
      repository: {
        generationStop: () => null,
        get: () => ({ spec: blocked, approvedHash: canonicalHash(blocked), entries: {}, stages: {} }),
        check: async () => ({ entries: [{ id: 'blocked', issues: ['entry_missing'] }] }),
        prepareStage: async () => { throw new Error('blocked entry must not be prepared') },
      } as never,
      queue: { enqueueStage: async () => { throw new Error('blocked entry must not enqueue') }, status: () => ({ state: { status: 'queued' } }), cancel: async () => {} } as never,
    }, new AbortController().signal)

    expect(result).toMatchObject({ incomplete: [{ entryId: 'blocked', reason: 'prerequisite_not_passed' }] })
  })

  it('审查已完成却未写入新审查阶段时返回 no-progress', async () => {
    const entry = { stale: false, revision: 1, review: { decision: { status: 'pass' }, stageId: 'review-old' } }
    const record = { spec, approvedHash: canonicalHash(spec), entries: { scope: entry }, stages: {} }
    const result = await runKnowledgeBuild('game', {
      repository: {
        generationStop: () => null, get: () => record,
        check: async () => ({ entries: [{ id: 'scope', issues: ['review_pending'] }] }),
        prepareStage: async () => ({ id: 'review-new', entryId: 'scope', action: 'review', inputHash: 'input' }),
      } as never,
      queue: { enqueueStage: async () => ({ workId: 'review-work' }), status: () => ({ state: { status: 'succeeded' } }), cancel: async () => {} } as never,
    }, new AbortController().signal)

    expect(result).toMatchObject({ incomplete: [{ reason: 'review_no_progress', workId: 'review-work' }] })
  })

  it('达到审查失败的生成修订上限时不再排队', async () => {
    const record = {
      spec, approvedHash: canonicalHash(spec),
      entries: { scope: { stale: false, revision: 1, review: { decision: { status: 'fail' } } } },
      stages: {
        prior: { prepared: { id: 'prior', entryId: 'scope', action: 'generate', inputHash: 'input' }, workId: null, state: 'completed' },
      },
    }
    let enqueued = false
    const result = await runKnowledgeBuild('game', {
      repository: {
        generationStop: () => null, get: () => record,
        check: async () => ({ entries: [{ id: 'scope', issues: ['review_not_passed'] }] }),
        prepareStage: async () => ({ id: 'next', entryId: 'scope', action: 'generate', inputHash: 'input' }),
      } as never,
      queue: {
        enqueueStage: async () => { enqueued = true; return { workId: 'unexpected' } },
        status: () => ({ state: { status: 'queued' } }), cancel: async () => {},
      } as never,
    }, new AbortController().signal, 0)

    expect(result).toMatchObject({ incomplete: [{ reason: 'review_failed_max_revisions' }] })
    expect(enqueued).toBe(false)
  })

  it('排队失败且停止闸门仍开放时保留 Queue 错误', async () => {
    await expect(runKnowledgeBuild('game', {
      repository: {
        generationStop: () => null,
        get: () => ({ spec, approvedHash: canonicalHash(spec), entries: {}, stages: {} }),
        check: async () => ({ entries: [{ id: 'scope', issues: ['entry_missing'] }] }),
        prepareStage: async () => ({ id: 'generate', entryId: 'scope', action: 'generate', inputHash: 'input' }),
      } as never,
      queue: {
        enqueueStage: async () => { throw new Error('Queue unavailable') },
        status: () => ({ state: { status: 'queued' } }), cancel: async () => {},
      } as never,
    }, new AbortController().signal)).rejects.toThrow('Queue unavailable')
  })

  it('Queue 失败后若停止闸门关闭则以停止原因收束', async () => {
    let calls = 0
    const result = await runKnowledgeBuild('game', {
      repository: {
        generationStop: () => (++calls > 1 ? { reason: 'operator_stop' } : null),
        get: () => ({ spec, approvedHash: canonicalHash(spec), entries: {}, stages: {} }),
        check: async () => ({ entries: [{ id: 'scope', issues: ['entry_missing'] }] }),
        prepareStage: async () => ({ id: 'generate', entryId: 'scope', action: 'generate', inputHash: 'input' }),
      } as never,
      queue: {
        enqueueStage: async () => ({ workId: 'failed-work' }),
        status: () => ({ state: { status: 'failed' } }), cancel: async () => {},
      } as never,
    }, new AbortController().signal)

    expect(result).toMatchObject({ incomplete: [{ reason: 'generation_stopped:operator_stop' }] })
  })

  it('取消已入队工作时等待 Queue 收束后才返回中止', async () => {
    let status: 'running' | 'canceled' = 'running'
    let entered!: () => void
    const enteredQueue = new Promise<void>((resolve) => { entered = resolve })
    const controller = new AbortController()
    const running = runKnowledgeBuild('game', {
      repository: {
        generationStop: () => null,
        get: () => ({ spec, approvedHash: canonicalHash(spec), entries: {}, stages: {} }),
        check: async () => ({ entries: [{ id: 'scope', issues: ['entry_missing'] }] }),
        prepareStage: async () => ({ id: 'generate', entryId: 'scope', action: 'generate', inputHash: 'input' }),
      } as never,
      queue: {
        enqueueStage: async () => { entered(); return { workId: 'active-work' } },
        status: () => ({ state: { status } }),
        cancel: async () => { setTimeout(() => { status = 'canceled' }, 30) },
      } as never,
    }, controller.signal)
    await enteredQueue
    controller.abort(new Error('stop'))

    await expect(running).rejects.toThrow('stop')
    expect(status).toBe('canceled')
  })

  it('不同项目并发时释放一个项目不会解除另一个项目的构建锁', async () => {
    const firstSpec = { ...spec, id: 'first' }
    const secondSpec = { ...spec, id: 'second' }
    let firstStarted = false
    let status: 'running' | 'canceled' = 'running'
    let entered!: () => void
    const enteredQueue = new Promise<void>((resolve) => { entered = resolve })
    const controller = new AbortController()
    const repository = {
      generationStop: () => (firstStarted ? { reason: 'operator_stop' } : null),
      get: (projectId: string) => ({
        spec: projectId === 'first' ? firstSpec : secondSpec,
        approvedHash: canonicalHash(projectId === 'first' ? firstSpec : secondSpec), entries: {}, stages: {},
      }),
      check: async () => ({ entries: [{ id: 'scope', issues: ['entry_missing'] }] }),
      prepareStage: async () => ({ id: 'generate', entryId: 'scope', action: 'generate', inputHash: 'input' }),
    }
    const queue = {
      enqueueStage: async () => { firstStarted = true; entered(); return { workId: 'first-work' } },
      status: () => ({ state: { status } }), cancel: async () => { status = 'canceled' },
    }
    const first = runKnowledgeBuild('first', { repository, queue } as never, controller.signal)
    await enteredQueue
    await expect(runKnowledgeBuild('second', { repository, queue } as never, new AbortController().signal))
      .resolves.toMatchObject({ projectId: 'second', incomplete: [{ reason: 'generation_stopped:operator_stop' }] })
    controller.abort(new Error('stop'))
    await expect(first).rejects.toThrow('The operation was aborted')
  })
})
