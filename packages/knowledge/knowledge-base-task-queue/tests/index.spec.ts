import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import LocalTaskQueue from '../../../task-queue/task-queue-local/src/index.ts'
import { createVerifiedOperatorAuthority } from '@changanhua/dsh-task-queue'
import { createKnowledgeStageHandler } from '../src/index.ts'
import type { HandlerDependencies } from '../src/index.ts'
import { startStageRun } from '../src/runner.ts'
import { KnowledgeResultValidationError } from '@changanhua/dsh-knowledge-base'

const prepared = Object.freeze({
  id: 'a'.repeat(64), projectId: 'project-a', entryId: 'entry-a', action: 'generate' as const,
  inputHash: 'b'.repeat(64), expectedHash: null, prompt: 'return one entry JSON',
})

function repository(completed = false, stopped = false) {
  const accepted = vi.fn(async () => ({ ...completedStage(), state: 'completed' as const }))
  return {
    files: { workingDirectory: vi.fn(async () => 'C:/knowledge/project-a') },
    get: vi.fn(() => ({ stages: { [prepared.id]: { prepared } } })),
    bindStage: vi.fn(async () => {}),
    completedStage: vi.fn(async () => completed ? completedStage() : null),
    recoverStage: vi.fn(async () => null),
    generationStop: vi.fn(() => stopped ? { reason: 'HTTP 429', at: '2026-09-08T00:00:00.000Z' } : null),
    pauseGeneration: vi.fn(async (_reason: string) => {}),
    resumeGeneration: vi.fn(async () => {}),
    captureResponse: vi.fn(async () => {}),
    acceptResult: accepted,
    accepted,
  }
}

function completedStage() {
  return { prepared, workId: 'work', owner: { workId: 'work', attemptId: 'attempt' }, responseHash: 'c'.repeat(64), candidate: null, decision: null, state: 'completed' as const }
}

const operator = {
  list: () => [{ work: { id: 'work', kind: 'knowledge.stage@1', intent: { projectId: 'project-a', stageId: prepared.id }, resolved: prepared }, attempts: [{ id: 'attempt' }] }],
  get: () => ({ work: { id: 'work', kind: 'knowledge.stage@1', intent: { projectId: 'project-a', stageId: prepared.id }, resolved: prepared }, attempts: [{ id: 'attempt' }] }),
} as unknown as NonNullable<HandlerDependencies['operator']>

describe('knowledge.stage@1 Queue bridge', () => {
  it('prepares without starting Codex and persists a compressed accepted result', async () => {
    const repo = repository()
    const start = vi.fn(async () => ({
      result: Promise.resolve({ stopReason: 'completed' as const, output: [{ type: 'text' as const, text: '{"id":"entry-a"}' }] }),
      dispose: vi.fn(async () => {}),
    }))
    const handler = createKnowledgeStageHandler({ repository: repo as never, operator, start }, { permissionMode: 'never', disposeGraceMs: 10 })
    const value = await handler.prepare(prepared, { attemptId: 'attempt' as never, signal: AbortSignal.abort() })
    expect(repo.bindStage).toHaveBeenCalledWith('project-a', prepared.id, 'work')
    expect(start).not.toHaveBeenCalled()
    const live = handler.start(value, { attemptId: 'attempt' as never, signal: new AbortController().signal })
    await expect(live.done).resolves.toMatchObject({ status: 'succeeded', output: { projectId: 'project-a', entryId: 'entry-a', stageId: prepared.id } })
    expect(repo.accepted).toHaveBeenCalledWith('project-a', prepared.id, '{"id":"entry-a"}', { workId: 'work', attemptId: 'attempt' })
  })

  it('replays a verified completed stage without a Codex call', async () => {
    const repo = repository(true)
    const start = vi.fn()
    const handler = createKnowledgeStageHandler({ repository: repo as never, operator, start }, { permissionMode: 'never', disposeGraceMs: 10 })
    const value = await handler.prepare(prepared, { attemptId: 'attempt' as never, signal: new AbortController().signal })
    const live = handler.start(value, { attemptId: 'attempt' as never, signal: new AbortController().signal })
    await expect(live.done).resolves.toMatchObject({ status: 'succeeded' })
    expect(start).not.toHaveBeenCalled()
  })

  it('blocks a stopped project before starting a new Codex stage', async () => {
    const repo = repository(false, true)
    const start = vi.fn()
    const handler = createKnowledgeStageHandler({ repository: repo as never, operator, start }, { permissionMode: 'never', disposeGraceMs: 10 })
    await expect(handler.prepare(prepared, { attemptId: 'attempt' as never, signal: new AbortController().signal }))
      .rejects.toThrow('generation is paused')
    expect(start).not.toHaveBeenCalled()
  })

  it('allows verified completed-stage replay while generation is stopped', async () => {
    const repo = repository(true, true)
    const start = vi.fn()
    const handler = createKnowledgeStageHandler({ repository: repo as never, operator, start }, { permissionMode: 'never', disposeGraceMs: 10 })
    const value = await handler.prepare(prepared, { attemptId: 'attempt' as never, signal: new AbortController().signal })
    await expect(handler.start(value, { attemptId: 'attempt' as never, signal: new AbortController().signal }).done)
      .resolves.toMatchObject({ status: 'succeeded' })
    expect(start).not.toHaveBeenCalled()
  })

  it('uses the real local Queue and does not repeat an unknown attempt', async () => {
    const ctx = new Context()
    const queue = new LocalTaskQueue(ctx, { queueRoot: 'C:/temp/knowledge-queue-test', resourceCapacity: { codex: 1, 'knowledge:project-a': 1 } })
    const repo = repository()
    const start = vi.fn(async () => { throw new Error('transport ownership lost') })
    const operator = queue.forOperator(createVerifiedOperatorAuthority())
    queue.registerHandler(createKnowledgeStageHandler({ repository: repo as never, operator, start }, { permissionMode: 'never', disposeGraceMs: 10 }))
    const id = await operator.enqueue({ kind: 'knowledge.stage@1', title: 'stage', input: { projectId: 'project-a', stageId: prepared.id }, idempotencyKey: 'knowledge:project-a:' + prepared.id })
    await new Promise(resolve => setTimeout(resolve, 20))
    const duplicate = await operator.enqueue({ kind: 'knowledge.stage@1', title: 'stage', input: { projectId: 'project-a', stageId: prepared.id }, idempotencyKey: 'knowledge:project-a:' + prepared.id })
    expect(duplicate).toBe(id)
    expect(operator.get(id).state.status).toBe('unknown')
    expect(operator.get(id).attempts).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('disposes a completed Codex run before accepting its result', async () => {
    const repo = repository()
    const order: string[] = []
    const live = startStageRun(repo as never, prepared, { workId: 'work', attemptId: 'attempt' }, {
      permissionMode: 'never', env: {}, disposeGraceMs: 10, spawn: vi.fn() as never,
    }, async () => ({
      result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '{"id":"entry-a"}' }] }),
      dispose: vi.fn(async () => { order.push('dispose') }),
    }), () => {}, new AbortController().signal)
    repo.accepted.mockImplementation(async () => { order.push('accept'); return completedStage() })
    await expect(live.done).resolves.toMatchObject({ status: 'succeeded' })
    expect(order).toEqual(['dispose', 'accept'])
  })

  it('waits for an unpublished startup to settle after cancellation', async () => {
    const repo = repository()
    const starting = Promise.withResolvers<never>()
    void starting.promise.catch(() => undefined)
    const live = startStageRun(repo as never, prepared, { workId: 'work', attemptId: 'attempt' }, {
      permissionMode: 'never', env: {}, disposeGraceMs: 10, spawn: vi.fn() as never,
    }, () => starting.promise, () => {}, new AbortController().signal)
    const canceled = live.cancel('test')
    let settled = false
    void canceled.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    starting.reject(new Error('startup canceled'))
    await expect(canceled).resolves.toBeUndefined()
  })

  it('does not start Codex when its parent signal is already aborted', async () => {
    const repo = repository()
    const start = vi.fn()
    const signal = AbortSignal.abort('stopped')
    const live = startStageRun(repo as never, prepared, { workId: 'work', attemptId: 'attempt' }, {
      permissionMode: 'never', env: {}, disposeGraceMs: 10, spawn: vi.fn() as never,
    }, start, () => {}, signal)
    await expect(live.done).resolves.toMatchObject({ status: 'canceled' })
    expect(start).not.toHaveBeenCalled()
  })

  it('turns cleanup rejection into an unknown cleanup outcome', async () => {
    const repo = repository()
    const live = startStageRun(repo as never, prepared, { workId: 'work', attemptId: 'attempt' }, {
      permissionMode: 'never', env: {}, disposeGraceMs: 10, spawn: vi.fn() as never,
    }, async () => ({
      result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '{"id":"entry-a"}' }] }),
      dispose: vi.fn(async () => { throw new Error('cleanup failed') }),
    }), () => {}, new AbortController().signal)
    await expect(live.done).resolves.toMatchObject({ status: 'unknown', failure: { category: 'cleanup' } })
    expect(repo.accepted).not.toHaveBeenCalled()
  })

  it('turns a rejected result plus rejected cleanup into an unknown cleanup outcome', async () => {
    const repo = repository()
    const live = startStageRun(repo as never, prepared, { workId: 'work', attemptId: 'attempt' }, {
      permissionMode: 'never', env: {}, disposeGraceMs: 10, spawn: vi.fn() as never,
    }, async () => ({
      result: Promise.reject(new Error('primary result failure')),
      dispose: vi.fn(async () => { throw new Error('cleanup failure') }),
    }), () => {}, new AbortController().signal)
    await expect(live.done).resolves.toMatchObject({ status: 'unknown', failure: { category: 'cleanup' } })
    expect(repo.accepted).not.toHaveBeenCalled()
  })

  it('reports a known result validation rejection as a terminal failure', async () => {
    const repo = repository()
    repo.accepted.mockRejectedValue(new KnowledgeResultValidationError('entry is invalid', 'd'.repeat(64)))
    const live = startStageRun(repo as never, prepared, { workId: 'work', attemptId: 'attempt' }, {
      permissionMode: 'never', env: {}, disposeGraceMs: 10, spawn: vi.fn() as never,
    }, async () => ({
      result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '{"id":"entry-a"}' }] }),
      dispose: vi.fn(async () => {}),
    }), () => {}, new AbortController().signal)
    await expect(live.done).resolves.toMatchObject({ status: 'failed', failure: { category: 'knowledge-validation', sideEffect: 'started' } })
  })

  it('persists an explicit HTTP 429 gate through the quota callback', async () => {
    const repo = repository()
    const live = startStageRun(repo as never, prepared, { workId: 'work', attemptId: 'attempt' }, {
      permissionMode: 'never', env: {}, disposeGraceMs: 10, spawn: vi.fn() as never,
    }, async () => { throw new Error('HTTP status: 429') }, reason => repo.pauseGeneration(reason), new AbortController().signal)
    await expect(live.done).resolves.toMatchObject({ status: 'unknown', failure: { category: 'knowledge-codex-quota' } })
    expect(repo.pauseGeneration).toHaveBeenCalledWith('HTTP status: 429')
  })
})
