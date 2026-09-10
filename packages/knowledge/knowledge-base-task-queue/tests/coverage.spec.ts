import { Context, Service } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it, vi } from 'vitest'
import type { PreparedStage, StageRecord } from '@changanhua/dsh-knowledge-base'
import type { CodexAppServerStartRequest, CodexAppServerRunHandle } from '@deepseek-ai/dsh-subagent-codex/app-server-run'
vi.mock('@deepseek-ai/dsh-subagent-codex/app-server-run', async importOriginal => ({
  ...await importOriginal<typeof import('@deepseek-ai/dsh-subagent-codex/app-server-run')>(),
  startCodexAppServerRun: vi.fn(),
}))
import KnowledgeQueueService, { Config, createKnowledgeStageHandler } from '../src/index.ts'
import * as KnowledgeQueueInvariant from '../src/invariant.ts'
import { isQuotaFailure, modelText, stageOutput, startStageRun, unknownFailure } from '../src/runner.ts'

const prepared: PreparedStage = Object.freeze({
  id: 'a'.repeat(64), projectId: 'project-a', entryId: 'entry-a', action: 'generate' as const,
  inputHash: 'b'.repeat(64), expectedHash: null, prompt: 'return one entry JSON',
})

function completed(overrides: Partial<StageRecord> = {}): StageRecord {
  return {
    prepared, workId: 'work-a', owner: { workId: 'work-a', attemptId: 'attempt-a' },
    responseHash: 'c'.repeat(64), candidate: {
      entry: { id: 'entry-a', title: 'Entry A', type: 'method', seedIds: ['entry-a'], depends: [], related: [], conditions: 'For a test project', body: 'A supported procedure.', citations: [{ sourceId: 'source-a', snapshotId: 'e'.repeat(64), quote: 'A supported procedure.' }] },
      artifactHash: 'd'.repeat(64), contentHash: 'e'.repeat(64), inputHash: prepared.inputHash, revision: 1, stale: false, review: null,
    }, decision: null, execution: null,
    state: 'completed' as const, ...overrides,
  }
}

function view(overrides: Record<string, unknown> = {}) {
  const state: { status: string; failure?: { category: string; sideEffect: string; message: string } } = { status: 'failed', failure: { category: 'knowledge-validation', sideEffect: 'started', message: 'invalid response' } }
  return {
    work: {
      id: 'work-a', kind: 'knowledge.stage@1',
      intent: { projectId: prepared.projectId, stageId: prepared.id }, resolved: prepared,
    },
    state,
    attempts: [{ id: 'attempt-a' }], result: null,
    ...overrides,
  }
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    files: { workingDirectory: vi.fn(async () => 'C:/knowledge/project-a') },
    get: vi.fn(() => ({ stages: { [prepared.id]: { prepared, workId: 'work-a' } } })),
    bindStage: vi.fn(async () => {}),
    completedStage: vi.fn(async (): Promise<StageRecord | null> => null),
    recoverStage: vi.fn(async (): Promise<StageRecord | null> => null),
    generationStop: vi.fn((): { reason: string; at: string } | null => null), pauseGeneration: vi.fn(async () => {}),
    resumeGeneration: vi.fn(async () => {}), configureExecution: vi.fn(),
    prepareStage: vi.fn(async () => prepared), prepareCorrection: vi.fn(async () => prepared),
    captureResponse: vi.fn(async () => {}), acceptResult: vi.fn(async () => completed()),
    ...overrides,
  }
}

function operator(current = view()) {
  return {
    list: vi.fn(() => [current]), get: vi.fn(() => current), enqueue: vi.fn(async () => 'work-new'),
    cancel: vi.fn(async (_workId: string) => {}), retry: vi.fn(async () => {}), resolveUnknown: vi.fn(async () => {}),
  }
}

describe('knowledge Queue coverage contracts', () => {
  it('validates configuration and registers its explained empty invariant', async () => {
    expect(Config({})).toEqual({ permissionMode: 'never', disposeGraceMs: 5_000 })
    expect(Config({ model: 'model-a', permissionMode: 'approve-for-me', disposeGraceMs: 1 })).toMatchObject({ model: 'model-a', permissionMode: 'approve-for-me', disposeGraceMs: 1 })
    expect(() => Config({ model: '', permissionMode: 'unsafe', disposeGraceMs: 0 } as never)).toThrow()

    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    const fiber = await ctx.plugin(KnowledgeQueueInvariant)
    expect(() => ctx.invariants.register('@changanhua/dsh-knowledge-base-task-queue', () => {})).toThrow(/already registered/)
    await fiber.dispose()
    await ctx.fiber.dispose()
  })

  it('defines admission, resources, policy, defaults, and rejects absent or mismatched stages', async () => {
    const repo = repository()
    const op = operator()
    const handler = createKnowledgeStageHandler({ repository: repo as never, operator: op as never }, {})
    const admission = { signal: new AbortController().signal }
    await expect(handler.resolveAdmission({ projectId: 'project-a', stageId: prepared.id }, admission)).resolves.toEqual(prepared)
    expect(handler.resources(prepared)).toEqual([{ resource: 'knowledge-base', units: 1 }, { resource: 'codex', units: 1 }])
    expect(handler.policy(prepared)).toEqual({ maxAttempts: 1 })
    expect(() => handler.resolveAdmission({ projectId: 'project-a', stageId: 'missing' }, admission)).toThrow('stage is not prepared')
    repo.get.mockReturnValue({ stages: { [prepared.id]: { prepared: { ...prepared, projectId: 'other' }, workId: 'work-a' } } })
    expect(() => handler.resolveAdmission({ projectId: 'project-a', stageId: prepared.id }, admission)).toThrow('stage is not prepared')
    const noOwner = createKnowledgeStageHandler({ repository: repo as never }, {})
    await expect(noOwner.prepare(prepared, { attemptId: 'attempt-a' as never } as never)).rejects.toThrow('Attempt has no WorkItem')
  })

  it('rejects attempt ownership disagreement before binding a stage', async () => {
    const repo = repository()
    for (const current of [
      view({ work: { ...view().work, intent: { projectId: 'other', stageId: prepared.id } } }),
      view({ work: { ...view().work, intent: { projectId: prepared.projectId, stageId: 'other' } } }),
      view({ work: { ...view().work, resolved: { ...prepared, id: 'other' } } }),
    ]) {
      const handler = createKnowledgeStageHandler({ repository: repo as never, operator: operator(current) as never }, {})
      await expect(handler.prepare(prepared, { attemptId: 'attempt-a' as never } as never)).rejects.toThrow('does not match')
    }
    expect(repo.bindStage).not.toHaveBeenCalled()
  })

  it('returns a completed replay with a no-op cancellation and sends configured model to a new run', async () => {
    const done = completed()
    const repo = repository({ completedStage: vi.fn(async () => done) })
    const op = operator()
    const handler = createKnowledgeStageHandler({ repository: repo as never, operator: op as never }, { model: 'model-a', permissionMode: 'approve-for-me', disposeGraceMs: 7 })
    const value = await handler.prepare(prepared, { attemptId: 'attempt-a' as never } as never)
    const replay = handler.start(value, { attemptId: 'attempt-a' as never, signal: new AbortController().signal })
    await expect(replay.done).resolves.toMatchObject({ status: 'succeeded', output: { artifactHash: 'd'.repeat(64) } })
    await expect(replay.cancel('unused')).resolves.toBeUndefined()

    const start = vi.fn(async (_request: CodexAppServerStartRequest): Promise<CodexAppServerRunHandle> => ({ result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '{"id":"entry-a"}' }] }), dispose: vi.fn(async () => {}) }))
    const running = createKnowledgeStageHandler({ repository: repository() as never, operator: op as never, start }, { model: 'model-a', permissionMode: 'approve-for-me', disposeGraceMs: 7 })
    const runValue = await running.prepare(prepared, { attemptId: 'attempt-a' as never } as never)
    await running.start(runValue, { attemptId: 'attempt-a' as never, signal: new AbortController().signal }).done
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ model: 'model-a', permissionMode: 'approve-for-me', disposeGraceMs: 7, env: {} }))
  })

  it('fails closed when no subprocess was injected and uses the default quota callback safely', async () => {
    const op = operator()
    const noSpawn = createKnowledgeStageHandler({ repository: repository() as never, operator: op as never, start: async (request) => {
      expect(() => request.spawn({ argv: ['codex'], cwd: request.cwd, stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }, graceMs: 1 })).toThrow('no subprocess spawn configured')
      throw new Error('HTTP 429')
    } }, {})
    const value = await noSpawn.prepare(prepared, { attemptId: 'attempt-a' as never } as never)
    await expect(noSpawn.start(value, { attemptId: 'attempt-a' as never, signal: new AbortController().signal }).done)
      .resolves.toMatchObject({ status: 'unknown', failure: { category: 'knowledge-codex-quota' } })
  })

  it('exposes only bound knowledge-stage work and forwards public lifecycle operations', async () => {
    const repo = repository()
    const current = view()
    const op = operator(current)
    const taskQueue = { forOperator: vi.fn(() => op), registerHandler: vi.fn(() => () => {}) }
    const ctx = new Context()
    ctx.provide('knowledgeBase', { repository: repo } as never)
    ctx.provide('taskQueue', taskQueue as never)
    ctx.provide('subprocess', { spawn: vi.fn() } as never)
    await ctx.plugin(KnowledgeQueueService, { model: 'configured-model', permissionMode: 'approve-for-me', disposeGraceMs: 3 })
    const service = ctx.knowledgeQueue
    expect(repo.configureExecution).toHaveBeenCalledWith('configured-model', 'approve-for-me')
    expect(taskQueue.registerHandler).toHaveBeenCalledOnce()
    expect(service.status('work-a')).toBe(current)
    await service.cancel('work-a')
    expect(op.cancel).toHaveBeenCalledWith('work-a')
    await expect(service.correctStage('work-a')).resolves.toEqual({ workId: 'work-new', stageId: prepared.id })
    expect(repo.prepareCorrection).toHaveBeenCalledWith('project-a', prepared.id, 'invalid response')
    await service.retryStage('work-a').catch(() => undefined)

    current.state = { status: 'failed', failure: { sideEffect: 'not-started', category: 'launch', message: 'no start' } }
    await service.retryStage('work-a')
    expect(op.retry).toHaveBeenCalledWith('work-a')
    current.state = { status: 'unknown' }
    repo.completedStage.mockResolvedValueOnce(completed())
    await service.resumeStage('work-a')
    expect(op.resolveUnknown).toHaveBeenCalledWith('work-a', { kind: 'authorize-retry' })
    await ctx.fiber.dispose()
  })

  it('rejects stopped admission and invalid public lifecycle state, kind, or binding', async () => {
    const repo = repository({ generationStop: vi.fn(() => ({ reason: 'quota' })) })
    const current = view()
    const op = operator(current)
    const ctx = new Context()
    ctx.provide('knowledgeBase', { repository: repo } as never)
    ctx.provide('taskQueue', { forOperator: () => op, registerHandler: () => () => {} } as never)
    ctx.provide('subprocess', { spawn: vi.fn() } as never)
    await ctx.plugin(KnowledgeQueueService, {})
    const service = ctx.knowledgeQueue
    await expect(service.enqueueStage('project-a', 'entry-a', 'generate')).rejects.toThrow('new stages are stopped')
    await expect(service.correctStage('work-a')).rejects.toThrow('generation is stopped')
    await expect(service.retryStage('work-a')).rejects.toThrow('not-started')
    await expect(service.resumeStage('work-a')).rejects.toThrow('only an unknown')
    current.work.kind = 'other@1'
    expect(() => service.status('work-a')).toThrow('not a knowledge stage')
    current.work.kind = 'knowledge.stage@1'
    repo.get.mockReturnValue({ stages: { [prepared.id]: { prepared, workId: 'other-work' } } })
    expect(() => service.status('work-a')).toThrow('not bound')
    await ctx.fiber.dispose()
  })

  it('enqueues stages with stable identity and only resumes an unknown stage with a verified record', async () => {
    const repo = repository()
    const current = view({ state: { status: 'unknown' } })
    const op = operator(current)
    const ctx = new Context()
    ctx.provide('knowledgeBase', { repository: repo } as never)
    ctx.provide('taskQueue', { forOperator: () => op, registerHandler: () => () => {} } as never)
    ctx.provide('subprocess', { spawn: vi.fn() } as never)
    await ctx.plugin(KnowledgeQueueService, {})
    const service = ctx.knowledgeQueue
    await expect(service.enqueueStage('project-a', 'entry-a', 'generate')).resolves.toEqual({ workId: 'work-new', stageId: prepared.id })
    expect(op.enqueue).toHaveBeenCalledWith(expect.objectContaining({ title: 'Knowledge generate: entry-a', idempotencyKey: `knowledge:project-a:${prepared.id}` }))
    expect(repo.bindStage).toHaveBeenCalledWith('project-a', prepared.id, 'work-new')
    await expect(service.resumeStage('work-a')).rejects.toThrow('no verified completed stage')
    repo.recoverStage.mockResolvedValueOnce(completed())
    await service.resumeStage('work-a')
    expect(op.resolveUnknown).toHaveBeenCalledTimes(1)
    await ctx.fiber.dispose()
  })

  it('stops admission before canceling only known active knowledge work and preserves unknown work', async () => {
    const repo = repository()
    const active = [
      view({ work: { ...view().work, id: 'queued' }, state: { status: 'queued' } }),
      view({ work: { ...view().work, id: 'running' }, state: { status: 'running' } }),
      view({ work: { ...view().work, id: 'unknown' }, state: { status: 'unknown' } }),
      view({ work: { ...view().work, id: 'succeeded' }, state: { status: 'succeeded' } }),
      view({ work: { ...view().work, id: 'other', kind: 'other@1' }, state: { status: 'running' } }),
    ]
    const op = operator(active[0])
    op.list.mockReturnValue(active)
    const ctx = new Context()
    ctx.provide('knowledgeBase', { repository: repo } as never)
    ctx.provide('taskQueue', { forOperator: () => op, registerHandler: () => () => {} } as never)
    ctx.provide('subprocess', { spawn: vi.fn() } as never)
    await ctx.plugin(KnowledgeQueueService, {})
    await ctx.knowledgeQueue.stopGeneration()
    expect(repo.pauseGeneration).toHaveBeenCalledWith('user requested generation stop')
    expect(op.cancel.mock.calls.map(([id]) => id)).toEqual(['queued', 'running'])
    await ctx.fiber.dispose()
  })

  it('reports all stop cleanup failures after persisting the generation gate', async () => {
    const repo = repository()
    const op = operator(view({ state: { status: 'starting' } }))
    op.cancel.mockRejectedValueOnce(new Error('first cleanup')).mockRejectedValueOnce(new Error('second cleanup'))
    op.list.mockReturnValue([view({ work: { ...view().work, id: 'one' }, state: { status: 'starting' } }), view({ work: { ...view().work, id: 'two' }, state: { status: 'stopping' } })])
    const ctx = new Context()
    ctx.provide('knowledgeBase', { repository: repo } as never)
    ctx.provide('taskQueue', { forOperator: () => op, registerHandler: () => () => {} } as never)
    ctx.provide('subprocess', { spawn: vi.fn() } as never)
    await ctx.plugin(KnowledgeQueueService, {})
    await expect(ctx.knowledgeQueue.stopGeneration()).rejects.toThrow('cleanup requires attention')
    expect(repo.pauseGeneration).toHaveBeenCalledBefore(op.cancel)
    expect(op.cancel).toHaveBeenCalledTimes(2)
    await ctx.fiber.dispose()
  })

  it('checks the generation gate again after preparation and before Queue admission', async () => {
    const gate = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce({ reason: 'operator stop' })
    const repo = repository({ generationStop: gate })
    const op = operator()
    const ctx = new Context()
    ctx.provide('knowledgeBase', { repository: repo } as never)
    ctx.provide('taskQueue', { forOperator: () => op, registerHandler: () => () => {} } as never)
    ctx.provide('subprocess', { spawn: vi.fn() } as never)
    await ctx.plugin(KnowledgeQueueService, {})
    await expect(ctx.knowledgeQueue.enqueueStage('project-a', 'entry-a', 'generate')).rejects.toThrow('generation is stopped')
    expect(op.enqueue).not.toHaveBeenCalled()
    expect(repo.bindStage).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('wires the service handler to the injected subprocess and persists a quota gate', async () => {
    const repo = repository()
    const current = view()
    const op = operator(current)
    const registered = vi.fn((_handler: ReturnType<typeof createKnowledgeStageHandler>) => () => {})
    const ctx = new Context()
    ctx.provide('knowledgeBase', { repository: repo } as never)
    ctx.provide('taskQueue', { forOperator: () => op, registerHandler: registered } as never)
    const spawn = vi.fn()
    ctx.provide('subprocess', { spawn } as never)
    await ctx.plugin(KnowledgeQueueService, {})
    const handler = registered.mock.calls[0]?.[0]
    if (!handler) throw new Error('knowledge handler was not registered')
    const appServer = await import('@deepseek-ai/dsh-subagent-codex/app-server-run')
    vi.mocked(appServer.startCodexAppServerRun).mockRejectedValueOnce(new Error('HTTP 429'))
    const value = await handler.prepare(prepared, { attemptId: 'attempt-a' as never, signal: new AbortController().signal })
    await expect(handler.start(value, { attemptId: 'attempt-a' as never, signal: new AbortController().signal }).done)
      .resolves.toMatchObject({ failure: { category: 'knowledge-codex-quota' } })
    expect((vi.mocked(appServer.startCodexAppServerRun).mock.calls[0]?.[0] as { spawn: unknown }).spawn).toEqual(expect.any(Function))
    expect(repo.pauseGeneration).toHaveBeenCalledWith('HTTP 429')
    await ctx.fiber.dispose()
  })

  it('uses the default permission mode when a service is constructed from an unnormalized configuration', () => {
    const repo = repository()
    const op = operator()
    const ctx = new Context()
    ctx.provide('knowledgeBase', { repository: repo } as never)
    ctx.provide('taskQueue', { forOperator: () => op, registerHandler: () => () => {} } as never)
    ctx.provide('subprocess', { spawn: vi.fn() } as never)
    class InitializableQueue extends KnowledgeQueueService {
      initialize() { this[Service.init]() }
    }
    const service = new InitializableQueue(ctx, {})
    service.initialize()
    expect(repo.configureExecution).toHaveBeenCalledWith(undefined, 'never')
  })

  it('rejects correction and retry states independently from the stopped gate', async () => {
    const repo = repository()
    const current = view({ state: { status: 'failed', failure: { category: 'other', sideEffect: 'not-started', message: 'other' } } })
    const op = operator(current)
    const ctx = new Context()
    ctx.provide('knowledgeBase', { repository: repo } as never)
    ctx.provide('taskQueue', { forOperator: () => op, registerHandler: () => () => {} } as never)
    ctx.provide('subprocess', { spawn: vi.fn() } as never)
    await ctx.plugin(KnowledgeQueueService, {})
    await expect(ctx.knowledgeQueue.correctStage('work-a')).rejects.toThrow('known validation failure')
    repo.generationStop.mockReturnValueOnce({ reason: 'quota', at: '2026-09-08T00:00:00.000Z' })
    await expect(ctx.knowledgeQueue.retryStage('work-a')).rejects.toThrow('generation is stopped')
    await ctx.fiber.dispose()
  })

  it('maps output and runner helper contracts including malformed model responses', () => {
    expect(stageOutput(completed())).toMatchObject({ projectId: 'project-a', artifactHash: 'd'.repeat(64) })
    expect(stageOutput(completed({ candidate: null }))).toMatchObject({ artifactHash: null })
    expect(() => stageOutput(completed({ responseHash: null }))).toThrow('no response artifact')
    expect(unknownFailure('x', 'plain')).toEqual(expect.objectContaining({ category: 'x', message: 'plain' }))
    expect(unknownFailure('x', new Error('error'))).toEqual(expect.objectContaining({ message: 'error' }))
    expect(modelText([{ type: 'text', text: 'ok' }])).toBe('ok')
    for (const output of [[], [{ type: 'image', text: 'x' }], [{ type: 'text' }], [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]]) {
      expect(() => modelText(output)).toThrow('exactly one text')
    }
    expect(isQuotaFailure(new Error('HTTP 429'))).toBe(true)
    expect(isQuotaFailure('HTTP status: 429')).toBe(true)
    expect(isQuotaFailure('Product subagent failure (product: Codex; stage: turn; category: limit)')).toBe(true)
    expect(isQuotaFailure('limit reached')).toBe(false)
    expect(isQuotaFailure('HTTP 500')).toBe(false)
  })

  it('rechecks stop and cancellation after asynchronous workspace preparation, before native startup', async () => {
    for (const cause of ['quota', 'cancel'] as const) {
      const repo = repository()
      const directory = Promise.withResolvers<string>()
      repo.files.workingDirectory.mockReturnValueOnce(directory.promise)
      const parent = new AbortController()
      const start = vi.fn()
      const live = startStageRun(repo as never, prepared, { workId: 'work-a', attemptId: 'attempt-a' }, {
        permissionMode: 'never', env: {}, disposeGraceMs: 1, spawn: vi.fn() as never,
      }, start, () => {}, parent.signal)
      await Promise.resolve()
      expect(repo.files.workingDirectory).toHaveBeenCalledOnce()
      if (cause === 'quota') repo.generationStop.mockReturnValue({ reason: 'HTTP 429', at: '2026-09-08T00:00:00.000Z' })
      else parent.abort('user canceled while preparing workspace')
      directory.resolve('C:/knowledge/project-a')
      await expect(live.done).resolves.toMatchObject(cause === 'quota'
        ? { status: 'failed', failure: { category: 'knowledge-generation-stopped', sideEffect: 'not-started' } }
        : { status: 'canceled' })
      expect(start).not.toHaveBeenCalled()
    }
  })

  it('maps aborted, non-completed, invalid output, capture, quota, and cancellation runner outcomes', async () => {
    const run = async (result: unknown, options: {
      readonly repo?: ReturnType<typeof repository>
      readonly quota?: (reason: string) => void | Promise<void>
      readonly signal?: AbortSignal
    } = {}) => {
      const repo = options.repo ?? repository()
      const live = startStageRun(repo as never, prepared, { workId: 'work-a', attemptId: 'attempt-a' }, { permissionMode: 'never', env: {}, disposeGraceMs: 1, spawn: vi.fn() as never }, async () => ({ result: Promise.resolve(result) as never, dispose: vi.fn(async () => {}) }), options.quota ?? (() => {}), options.signal ?? new AbortController().signal)
      return live.done
    }
    await expect(run({ stopReason: 'aborted', output: [] })).resolves.toMatchObject({ status: 'canceled' })
    await expect(run({ stopReason: 'failed', output: [] })).resolves.toMatchObject({ status: 'unknown', failure: { category: 'knowledge-codex', message: 'Codex stopped: failed' } })
    await expect(run({ stopReason: 'failed', diagnostic: 'diagnostic', output: [] })).resolves.toMatchObject({ failure: { message: 'diagnostic' } })
    await expect(run({ stopReason: 'completed', output: [] })).resolves.toMatchObject({ failure: { category: 'knowledge-codex' } })
    const captureRepo = repository({ captureResponse: vi.fn(async () => { throw new Error('capture failed') }) })
    await expect(run({ stopReason: 'completed', output: [{ type: 'text', text: 'x' }] }, { repo: captureRepo })).resolves.toMatchObject({ failure: { message: 'capture failed' } })
    const quota = vi.fn(async () => {})
    const quotaRepo = repository()
    const quotaLive = startStageRun(quotaRepo as never, prepared, { workId: 'work-a', attemptId: 'attempt-a' }, { permissionMode: 'never', env: {}, disposeGraceMs: 1, spawn: vi.fn() as never }, async () => { throw new Error('HTTP 429') }, quota, new AbortController().signal)
    await expect(quotaLive.done).resolves.toMatchObject({ failure: { category: 'knowledge-codex-quota' } })
    expect(quota).toHaveBeenCalledWith('HTTP 429')

    const result = Promise.withResolvers<Awaited<CodexAppServerRunHandle['result']>>()
    const started = Promise.withResolvers<undefined>()
    const dispose = vi.fn(async () => {})
    const live = startStageRun(repository() as never, prepared, { workId: 'work-a', attemptId: 'attempt-a' }, { permissionMode: 'never', env: {}, disposeGraceMs: 1, spawn: vi.fn() as never }, async () => {
      started.resolve(undefined)
      return { result: result.promise, dispose }
    }, () => {}, new AbortController().signal)
    await started.promise
    const cancel = live.cancel('manual')
    result.resolve({ stopReason: 'aborted', output: [] })
    await expect(cancel).resolves.toBeUndefined()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('turns startup errors, abort races, cleanup failures, and explicit cancellation into their durable outcomes', async () => {
    const request = { permissionMode: 'never' as const, env: {}, disposeGraceMs: 1, spawn: vi.fn() as never }
    const startup = startStageRun(repository() as never, prepared, { workId: 'work-a', attemptId: 'attempt-a' }, request, async () => { throw 'plain startup failure' }, () => {}, new AbortController().signal)
    await expect(startup.done).resolves.toMatchObject({ status: 'unknown', failure: { message: 'plain startup failure' } })

    const controller = new AbortController()
    const delayed = Promise.withResolvers<CodexAppServerRunHandle>()
    const starting = Promise.withResolvers<undefined>()
    void delayed.promise.catch(() => undefined)
    const aborted = startStageRun(repository() as never, prepared, { workId: 'work-a', attemptId: 'attempt-a' }, request, () => {
      starting.resolve(undefined)
      return delayed.promise
    }, () => {}, controller.signal)
    await starting.promise
    controller.abort('stop')
    delayed.reject('late failure')
    await expect(aborted.done).resolves.toMatchObject({ status: 'canceled' })

    const nonErrorResult = Promise.withResolvers<Awaited<CodexAppServerRunHandle['result']>>()
    nonErrorResult.reject('primary')
    const cleanup = startStageRun(repository() as never, prepared, { workId: 'work-a', attemptId: 'attempt-a' }, request, async () => ({ result: nonErrorResult.promise, dispose: vi.fn(async () => { throw 'cleanup' }) }), () => {}, new AbortController().signal)
    await expect(cleanup.done).resolves.toMatchObject({ status: 'unknown', failure: { category: 'cleanup', message: 'Codex cleanup failed; cleanup failed: cleanup' } })
    await expect(cleanup.cancel('manual')).rejects.toThrow('cleanup failed')

    const quota = vi.fn()
    const stringQuota = startStageRun(repository() as never, prepared, { workId: 'work-a', attemptId: 'attempt-a' }, request, async () => { throw 'HTTP 429' }, quota, new AbortController().signal)
    await expect(stringQuota.done).resolves.toMatchObject({ failure: { category: 'knowledge-codex-quota', message: 'HTTP 429' } })
    expect(quota).toHaveBeenCalledWith('HTTP 429')

    const unknown = startStageRun(repository() as never, prepared, { workId: 'work-a', attemptId: 'attempt-a' }, request, async () => { throw new Error('HTTP 500') }, () => {}, new AbortController().signal)
    await unknown.done
    await expect(unknown.cancel('manual')).resolves.toBeUndefined()
  })

  it('pauses generation for the standard Codex limit diagnostic, but not for a max-tokens result', async () => {
    const request = { permissionMode: 'never' as const, env: {}, disposeGraceMs: 1, spawn: vi.fn() as never }
    const diagnostic = 'Product subagent failure (product: Codex; stage: turn; category: limit)'
    const pause = vi.fn(async () => {})
    const quota = startStageRun(repository() as never, prepared, { workId: 'work-a', attemptId: 'attempt-a' }, request, async () => { throw new Error(diagnostic) }, pause, new AbortController().signal)
    await expect(quota.done).resolves.toMatchObject({ status: 'unknown', failure: { category: 'knowledge-codex-quota', message: diagnostic } })
    expect(pause).toHaveBeenCalledWith(diagnostic)

    const noPause = vi.fn(async () => {})
    const dispose = vi.fn(async () => {})
    const context = startStageRun(repository() as never, prepared, { workId: 'work-a', attemptId: 'attempt-a' }, request, async () => ({ result: Promise.resolve({ stopReason: 'max-tokens', diagnostic, output: [] }), dispose }), noPause, new AbortController().signal)
    await expect(context.done).resolves.toMatchObject({ status: 'failed', failure: { category: 'knowledge-context-limit', sideEffect: 'started', message: diagnostic } })
    expect(dispose).toHaveBeenCalledOnce()
    expect(noPause).not.toHaveBeenCalled()
  })
})
