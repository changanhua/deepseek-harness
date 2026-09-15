/**
 * 有界整库编排：以当前库检查为准，只为本调用新入队的工作承担取消责任。
 * @module @changanhua/dsh-tool-knowledge-base/build
 */
import { setTimeout as delay } from 'node:timers/promises'
import { canonicalHash } from '@changanhua/dsh-knowledge-base'
import type { KnowledgeToolDependencies } from './index.ts'

type BuildAction = 'generate' | 'review'
type QueueStatus = 'queued' | 'starting' | 'running' | 'unknown' | 'succeeded' | 'failed' | 'canceled'
type BuildDependencies = Pick<KnowledgeToolDependencies, 'repository' | 'queue'>
type BuildRecord = ReturnType<KnowledgeToolDependencies['repository']['get']>

export interface BuildIncomplete { entryId: string; action: BuildAction; reason: string; workId?: string }
export interface KnowledgeBuildResult {
  projectId: string
  status: 'completed' | 'incomplete'
  completed: string[]
  incomplete: BuildIncomplete[]
}

/** 同一仓库同一项目只允许一个自动构建，避免幂等工作被两个调用同时认领。 */
const activeBuilds = new WeakMap<object, Set<string>>()

function terminal(status: QueueStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled'
}

async function waitForTerminal(workId: string, deps: BuildDependencies, signal: AbortSignal): Promise<QueueStatus> {
  for (;;) {
    signal.throwIfAborted()
    const status = deps.queue.status(workId).state.status
    if (terminal(status) || status === 'unknown') return status
    await delay(100, undefined, { signal })
  }
}

async function waitForCleanup(workId: string, deps: BuildDependencies): Promise<void> {
  for (;;) {
    const status = deps.queue.status(workId).state.status
    if (terminal(status) || status === 'unknown') return
    await delay(25)
  }
}

function result(projectId: string, completed: Set<string>, incomplete: BuildIncomplete[]): KnowledgeBuildResult {
  return { projectId, status: incomplete.length ? 'incomplete' : 'completed', completed: [...completed], incomplete }
}

function stop(projectId: string, completed: Set<string>, entryId: string, action: BuildAction, reason: string, workId?: string) {
  return result(projectId, completed, [{ entryId, action, reason, ...(workId === undefined ? {} : { workId }) }])
}

function unknownStage(record: BuildRecord, deps: BuildDependencies): BuildIncomplete | undefined {
  for (const stage of Object.values(record.stages)) {
    if (!stage.workId) continue
    if (deps.queue.status(stage.workId).state.status === 'unknown') {
      return { entryId: stage.prepared.entryId, action: stage.prepared.action as BuildAction, reason: 'queue_unknown', workId: stage.workId }
    }
  }
}

/**
 * 依赖顺序执行 generate/review。unknown 只能由显式 resume 处理，build 绝不重发。
 * @param projectId - 已确认项目。
 * @param deps - 受限仓库及知识 Queue 能力。
 * @param signal - 调用方取消时只取消本调用新建的活动工作。
 * @param maxRevisions - 初次生成之外允许的最多修订数，范围 0–3。
 */
export async function runKnowledgeBuild(
  projectId: string, deps: BuildDependencies, signal: AbortSignal, maxRevisions = 2,
): Promise<KnowledgeBuildResult> {
  if (!Number.isInteger(maxRevisions) || maxRevisions < 0 || maxRevisions > 3) throw new Error('knowledge-base: maxRevisions 必须为 0–3')
  const locks = activeBuilds.get(deps.repository) ?? new Set<string>()
  if (locks.has(projectId)) throw new Error('knowledge-base: build is already running for project')
  locks.add(projectId)
  activeBuilds.set(deps.repository, locks)
  let ownedWorkId: string | undefined
  const completed = new Set<string>()
  try {
    const initial = deps.repository.get(projectId)
    if (initial.approvedHash !== canonicalHash(initial.spec)) throw new Error('knowledge-base: build requires a confirmed plan')
    for (;;) {
      signal.throwIfAborted()
      const gate = deps.repository.generationStop()
      if (gate) return stop(projectId, completed, 'project', 'generate', 'generation_stopped:' + gate.reason)
      let record = deps.repository.get(projectId)
      const unknown = unknownStage(record, deps)
      if (unknown) return result(projectId, completed, [unknown])
      const check = await deps.repository.check(projectId)
      const issues = new Map(check.entries.map(entry => [entry.id, entry.issues]))
      for (const seed of record.spec.seeds) if (issues.get(seed.id)?.length === 0) completed.add(seed.id)
      const conflict = record.spec.seeds.find(seed => issues.get(seed.id)?.includes('working_copy_changed'))
      if (conflict) return stop(projectId, completed, conflict.id, 'generate', 'working_copy_changed')
      const unresolved = record.spec.seeds.find(seed => record.entries[seed.id]?.review?.decision.status === 'unresolved')
      if (unresolved) return stop(projectId, completed, unresolved.id, 'review', 'review_unresolved')
      const next = record.spec.seeds.find(seed => issues.get(seed.id)?.length !== 0
        && seed.depends.every(parent => issues.get(parent)?.length === 0))
      if (!next) return result(projectId, completed, record.spec.seeds.filter(seed => issues.get(seed.id)?.length !== 0).map(seed => ({
        entryId: seed.id, action: 'generate' as const, reason: 'prerequisite_not_passed',
      })))
      const entry = record.entries[next.id]
      const action: BuildAction = entry?.stale || !entry || entry.review?.decision.status === 'fail' ? 'generate' : 'review'
      const priorRevision = entry?.revision ?? 0
      const priorReviewStageId = entry?.review?.stageId ?? null
      const prepared = await deps.repository.prepareStage(projectId, next.id, action)
      record = deps.repository.get(projectId)
      const existing = record.stages[prepared.id]
      if (action === 'generate' && entry?.review?.decision.status === 'fail') {
        const generations = Object.values(record.stages).filter(stage => stage.prepared.entryId === next.id
          && stage.prepared.action === 'generate' && stage.prepared.inputHash === prepared.inputHash && stage.state === 'completed').length
        if (generations >= maxRevisions + 1) return stop(projectId, completed, next.id, action, 'review_failed_max_revisions')
      }
      if (existing?.workId && deps.queue.status(existing.workId).state.status === 'unknown') {
        return stop(projectId, completed, next.id, action, 'queue_unknown', existing.workId)
      }
      let workId: string
      if (existing?.workId) {
        workId = existing.workId
      } else {
        try {
          const enqueued = await deps.queue.enqueueStage(projectId, next.id, action)
          workId = enqueued.workId
          ownedWorkId = workId
        } catch (error) {
          const stopped = deps.repository.generationStop()
          if (stopped) return stop(projectId, completed, next.id, action, 'generation_stopped:' + stopped.reason)
          throw error
        }
      }
      let status = await waitForTerminal(workId, deps, signal)
      while (status === 'failed' && deps.queue.status(workId).state.failure?.category === 'knowledge-validation') {
        const rejected = Object.values(deps.repository.get(projectId).stages).filter(stage =>
          stage.prepared.entryId === next.id
            && (stage.prepared.action === 'generate' || stage.prepared.action === 'review')
            && stage.prepared.inputHash === prepared.inputHash
            && stage.responseHash !== null
            && stage.state === 'prepared').length
        if (rejected <= maxRevisions) {
          const correction = await deps.queue.correctStage(workId)
          ownedWorkId = correction.workId
          workId = correction.workId
          status = await waitForTerminal(workId, deps, signal)
          continue
        }
        return stop(projectId, completed, next.id, action, 'validation_correction_limit', workId)
      }
      ownedWorkId = undefined
      if (status !== 'succeeded') {
        const stopped = deps.repository.generationStop()
        return stop(projectId, completed, next.id, action, stopped ? 'generation_stopped:' + stopped.reason : 'queue_' + status, workId)
      }
      const after = deps.repository.get(projectId).entries[next.id]
      if (action === 'generate' && after?.revision === priorRevision) return stop(projectId, completed, next.id, action, 'generation_no_progress', workId)
      if (action === 'review' && after?.review?.stageId === priorReviewStageId) return stop(projectId, completed, next.id, action, 'review_no_progress', workId)
    }
  } catch (error) {
    if (signal.aborted && ownedWorkId !== undefined) {
      await deps.queue.cancel(ownedWorkId)
      await waitForCleanup(ownedWorkId, deps)
    }
    throw error
  } finally {
    locks.delete(projectId)
    if (locks.size === 0) activeBuilds.delete(deps.repository)
  }
}
