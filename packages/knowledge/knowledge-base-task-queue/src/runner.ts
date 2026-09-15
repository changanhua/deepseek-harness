import type { PreparedStage, StageRecord, KnowledgeRepository } from '@changanhua/dsh-knowledge-base'
import { KnowledgeResultValidationError } from '@changanhua/dsh-knowledge-base'
import type { CodexAppServerRunHandle, CodexAppServerStartRequest } from '@deepseek-ai/dsh-subagent-codex/app-server-run'
import type { LiveAttempt, WorkFailure } from '@changanhua/dsh-task-queue'

export interface KnowledgeStageOutput {
  readonly projectId: string
  readonly entryId: string
  readonly stageId: string
  readonly action: PreparedStage['action']
  readonly responseHash: string
  readonly artifactHash: string | null
}

export interface StartKnowledgeCodex {
  (request: CodexAppServerStartRequest): Promise<CodexAppServerRunHandle>
}

class CleanupFailure extends Error {
  constructor(primary: unknown, cleanup: unknown) {
    const primaryMessage = primary instanceof Error ? primary.message : 'Codex cleanup failed'
    const cleanupMessage = cleanup instanceof Error ? cleanup.message : String(cleanup)
    super(`${primaryMessage}; cleanup failed: ${cleanupMessage}`, { cause: new AggregateError([primary, cleanup]) })
  }
}

export function stageOutput(stage: StageRecord): KnowledgeStageOutput {
  if (stage.responseHash === null) throw new Error('knowledge queue: completed stage has no response artifact')
  return Object.freeze({
    projectId: stage.prepared.projectId,
    entryId: stage.prepared.entryId,
    stageId: stage.prepared.id,
    action: stage.prepared.action,
    responseHash: stage.responseHash,
    artifactHash: stage.candidate?.artifactHash ?? null,
  })
}

export function unknownFailure(category: string, error: unknown): WorkFailure {
  return {
    category,
    sideEffect: 'unknown',
    retriable: false,
    message: error instanceof Error ? error.message : String(error),
  }
}

export function modelText(output: readonly { readonly type: string; readonly text?: string }[]): string {
  if (output.length !== 1 || output[0]?.type !== 'text' || typeof output[0].text !== 'string') {
    throw new Error('knowledge queue: Codex must return exactly one text response')
  }
  return output[0].text
}

export function isQuotaFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /\bHTTP(?:\s+status)?\s*:?\s*429\b/iu.test(message)
    || /Product subagent failure \(product: Codex; stage: [a-z-]+; category: limit(?:;|\))/u.test(message)
}

export function startStageRun(
  repository: KnowledgeRepository,
  stage: PreparedStage,
  owner: { readonly workId: string; readonly attemptId: string },
  request: Omit<CodexAppServerStartRequest, 'prompt' | 'signal' | 'cwd'>,
  start: StartKnowledgeCodex,
  onQuota: (reason: string) => void | Promise<void>,
  parentSignal: AbortSignal,
): LiveAttempt<'knowledge.stage@1'> {
  const controller = new AbortController()
  const isCanceled = () => controller.signal.aborted
  const abort = () => { controller.abort(parentSignal.reason) }
  if (parentSignal.aborted) abort()
  else parentSignal.addEventListener('abort', abort, { once: true })
  let handle: CodexAppServerRunHandle | undefined
  let cleanupStarted = false
  const requireDispose = async (current: CodexAppServerRunHandle, primary: unknown): Promise<void> => {
    cleanupStarted = true
    try {
      await current.dispose()
    } catch (cleanup) {
      throw new CleanupFailure(primary, cleanup)
    }
  }
  const done = Promise.resolve().then(async () => {
    try {
      if (isCanceled()) return { status: 'canceled' as const }
      const cwd = await repository.files.workingDirectory(stage.projectId)
      const stopped = repository.generationStop()
      if (stopped !== null) return { status: 'failed' as const, failure: {
        category: 'knowledge-generation-stopped', sideEffect: 'not-started' as const, retriable: false, message: stopped.reason,
      } }
      if (isCanceled()) return { status: 'canceled' as const }
      handle = await start({
        ...request,
        prompt: [{ type: 'text', text: stage.prompt }],
        signal: controller.signal,
        cwd,
      })
      const result = await handle.result
      if (isCanceled() || result.stopReason === 'aborted') {
        await requireDispose(handle, new Error('Codex run was canceled'))
        return { status: 'canceled' as const }
      }
      if (result.stopReason !== 'completed') {
        const failure = new Error(result.diagnostic ?? `Codex stopped: ${result.stopReason}`)
        await requireDispose(handle, failure)
        if (result.stopReason === 'max-tokens') return { status: 'failed' as const, failure: {
          category: 'knowledge-context-limit', sideEffect: 'started' as const, retriable: false, message: failure.message,
        } }
        throw failure
      }
      const raw = modelText(result.output)
      await repository.captureResponse(stage.projectId, stage.id, raw, owner)
      await requireDispose(handle, new Error('Codex completed before result acceptance'))
      const completed = await repository.acceptResult(stage.projectId, stage.id, raw, owner)
      return { status: 'succeeded' as const, output: stageOutput(completed) }
    } catch (error) {
      if (handle !== undefined && !cleanupStarted) {
        try {
          await requireDispose(handle, error)
        } catch (cleanup) {
          error = cleanup
        }
      }
      if (error instanceof KnowledgeResultValidationError) {
        return { status: 'failed' as const, failure: {
          category: 'knowledge-validation', sideEffect: 'started' as const, retriable: false,
          message: error.message + '; response artifact: ' + error.responseHash,
        } }
      }
      if (error instanceof CleanupFailure) {
        return { status: 'unknown' as const, failure: unknownFailure('cleanup', error) }
      }
      if (isCanceled()) return { status: 'canceled' as const }
      if (isQuotaFailure(error)) await onQuota(error instanceof Error ? error.message : String(error))
      return { status: 'unknown' as const, failure: unknownFailure(isQuotaFailure(error) ? 'knowledge-codex-quota' : 'knowledge-codex', error) }
    } finally {
      parentSignal.removeEventListener('abort', abort)
    }
  })
  return Object.freeze({
    done,
    async cancel(): Promise<void> {
      controller.abort('knowledge stage canceled')
      const outcome = await done
      if (outcome.status === 'unknown' && outcome.failure.category === 'cleanup') throw new Error(outcome.failure.message)
    },
  })
}
