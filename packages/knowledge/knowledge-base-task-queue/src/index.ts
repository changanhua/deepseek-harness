import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { KnowledgeRepository, PreparedStage, StageRecord } from '@changanhua/dsh-knowledge-base'
import type { CodexAppServerPermissionMode } from '@deepseek-ai/dsh-subagent-codex/app-server-run'
import { startCodexAppServerRun } from '@deepseek-ai/dsh-subagent-codex/app-server-run'
import type { OperatorWorkQueue, WorkHandler, WorkKindDefinition, WorkView } from '@changanhua/dsh-task-queue'
import { createVerifiedOperatorAuthority } from '@changanhua/dsh-task-queue'
import { startStageRun, stageOutput } from './runner.ts'

const KIND = 'knowledge.stage@1' as const
const PERMISSIONS = ['never', 'approve-for-me', 'dangerously-bypass-approvals-and-sandbox'] as const

function isKnowledgeKind(kind: string): boolean {
  return kind === KIND
}

/** Queue 准入所需的项目与已冻结阶段身份。 */
export interface KnowledgeStageInput { readonly projectId: string; readonly stageId: string }
/** 可信 Profile 为知识阶段执行指定的非秘密配置。 */
export interface Config {
  /** 可选原生模型名称；省略时继承 Codex 自身配置。 */
  readonly model?: string
  /** Codex 原生权限模式，默认禁止交互批准。 */
  readonly permissionMode?: CodexAppServerPermissionMode
  /** 释放 Codex 子进程树时各终止阶段使用的宽限毫秒数。 */
  readonly disposeGraceMs?: number
}
export const Config: z<Config> = z.object({
  model: z.string().min(1),
  permissionMode: z.union(PERMISSIONS).default('never'),
  disposeGraceMs: z.number().min(1).default(5_000),
})

declare module '@changanhua/dsh-task-queue' {
  interface WorkKindMap {
    'knowledge.stage@1': WorkKindDefinition<KnowledgeStageInput, PreparedStage, PreparedValue, import('./runner.ts').KnowledgeStageOutput>
  }
}
declare module '@deepseek-ai/cordis' { interface Context { knowledgeQueue: KnowledgeQueueService } }

type PreparedValue =
  | { readonly kind: 'completed'; readonly stage: StageRecord }
  | { readonly kind: 'run'; readonly stage: PreparedStage; readonly workId: string }
/** 阶段处理器连接持久仓库、Queue 归属查询及受控 Codex 启动器的依赖。 */
export interface HandlerDependencies {
  readonly repository: KnowledgeRepository
  readonly operator?: Pick<OperatorWorkQueue, 'get' | 'list'>
  readonly start?: typeof startCodexAppServerRun
  readonly spawn?: Parameters<typeof startCodexAppServerRun>[0]['spawn']
  readonly onQuota?: (reason: string) => void | Promise<void>
}

function ownerFor(operator: Pick<OperatorWorkQueue, 'get' | 'list'> | undefined, attemptId: string): WorkView {
  const view = operator?.list().find(item => item.attempts.some(attempt => String(attempt.id) === attemptId))
  if (view === undefined) throw new Error('knowledge queue: Queue Attempt has no WorkItem')
  return view
}

/**
 * 创建只接受与固定阶段一致的 Queue 工作的处理器。
 *
 * @param dependencies - 已由 Host 组合验证的仓库、Queue 与启动依赖。
 * @param config - Profile 指定的执行配置。
 * @returns 受 Queue 生命周期管理的知识阶段处理器。
 */
export function createKnowledgeStageHandler(dependencies: HandlerDependencies, config: Config): WorkHandler<typeof KIND> {
  const permissionMode = config.permissionMode ?? 'never'
  const disposeGraceMs = config.disposeGraceMs ?? 5_000
  const start = dependencies.start ?? startCodexAppServerRun
  return {
    kind: KIND,
    resolveAdmission(input) {
      const stage = dependencies.repository.get(input.projectId).stages[input.stageId]?.prepared
      if (stage === undefined || stage.projectId !== input.projectId) throw new Error('knowledge queue: stage is not prepared')
      return Promise.resolve(Object.freeze({ ...stage }))
    },
    resources() { return [{ resource: 'knowledge-base', units: 1 }, { resource: 'codex', units: 1 }] },
    policy() { return { maxAttempts: 1 } },
    async prepare(stage, context) {
      const view = ownerFor(dependencies.operator, String(context.attemptId))
      const workId = String(view.work.id)
      if (
        view.work.intent.projectId !== stage.projectId
        || view.work.intent.stageId !== stage.id
        || view.work.resolved.id !== stage.id
      ) throw new Error('knowledge queue: Queue WorkItem does not match its prepared stage')
      await dependencies.repository.bindStage(stage.projectId, stage.id, workId)
      const completed = await dependencies.repository.completedStage(stage.projectId, stage.id, workId)
      if (completed !== null) return { kind: 'completed', stage: completed }
      const stopped = dependencies.repository.generationStop()
      if (stopped !== null) throw new Error(`knowledge queue: generation is paused: ${stopped.reason}`)
      return { kind: 'run', stage, workId }
    },
    start(value, context) {
      if (value.kind === 'completed') return { done: Promise.resolve({ status: 'succeeded' as const, output: stageOutput(value.stage) }), async cancel() {} }
      return startStageRun(dependencies.repository, value.stage, { workId: value.workId, attemptId: String(context.attemptId) }, {
        ...config.model === undefined ? {} : { model: config.model }, permissionMode, env: {}, disposeGraceMs,
        spawn: dependencies.spawn ?? (() => {
          throw new Error('knowledge queue: no subprocess spawn configured')
        }),
      }, start, dependencies.onQuota ?? (() => {}), context.signal)
    },
  }
}

/** 将知识阶段绑定到持久 Queue，并维护项目级生成停止门。 */
export default class KnowledgeQueueService extends Service {
  static Config = Config
  static inject = ['knowledgeBase', 'taskQueue', 'subprocess']
  private readonly operator: OperatorWorkQueue
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'knowledgeQueue')
    this.operator = ctx.taskQueue.forOperator(createVerifiedOperatorAuthority())
  }
  protected [Service.init](): void {
    this.ctx.knowledgeBase.repository.configureExecution(this.config.model, this.config.permissionMode ?? 'never')
    this.ctx.effect(() => this.ctx.taskQueue.registerHandler(createKnowledgeStageHandler({
      repository: this.ctx.knowledgeBase.repository,
      operator: this.operator,
      spawn: this.ctx.subprocess.spawn.bind(this.ctx.subprocess),
      start: request => startCodexAppServerRun({ ...request, spawn: this.ctx.subprocess.spawn.bind(this.ctx.subprocess) }),
      onQuota: async (reason) => {
        await this.ctx.knowledgeBase.repository.pauseGeneration(reason)
      },
    }, this.config)), 'knowledgeQueue.handler')
  }
  /**
   * 准备并准入一个新阶段；全局生成已停止时拒绝写入 Queue。
   *
   * @param projectId - 受管理项目 ID。
   * @param entryId - 目标条目或规划阶段 ID。
   * @param action - 该阶段执行的业务动作。
   * @returns Queue 工作及持久阶段身份。
   */
  async enqueueStage(
    projectId: string,
    entryId: string,
    action: PreparedStage['action'],
  ): Promise<{ workId: string; stageId: string }> {
    if (this.ctx.knowledgeBase.repository.generationStop() !== null) {
      throw new Error('knowledge queue: Codex quota is unavailable; new stages are stopped')
    }
    const stage = await this.ctx.knowledgeBase.repository.prepareStage(projectId, entryId, action)
    return this.enqueuePrepared(stage)
  }
  private async enqueuePrepared(stage: PreparedStage): Promise<{ workId: string; stageId: string }> {
    if (this.ctx.knowledgeBase.repository.generationStop()) throw new Error('knowledge queue: generation is stopped')
    const { projectId } = stage
    const workId = await this.operator.enqueue({ kind: KIND, title: `Knowledge ${stage.action}: ${stage.entryId}`, input: { projectId, stageId: stage.id }, idempotencyKey: `knowledge:${projectId}:${stage.id}` })
    await this.ctx.knowledgeBase.repository.bindStage(projectId, stage.id, String(workId))
    return { workId: String(workId), stageId: stage.id }
  }
  private boundStage(workId: string): WorkView {
    const view = this.operator.get(workId as never)
    const kind: unknown = view.work.kind
    if (kind !== KIND) throw new Error('knowledge queue: WorkItem is not a knowledge stage')
    const input = view.work.intent
    const stage = this.ctx.knowledgeBase.repository.get(input.projectId).stages[input.stageId]
    if (
      stage === undefined
      || stage.workId !== workId
      || stage.prepared.id !== input.stageId
      || stage.prepared.projectId !== input.projectId
    ) throw new Error('knowledge queue: WorkItem is not bound to its knowledge stage')
    return view
  }
  /**
   * 返回已绑定知识阶段的 Queue 视图，拒绝其他工作种类或失配绑定。
   *
   * @param workId - Queue 工作 ID。
   * @returns 经项目阶段绑定核验的工作视图。
   */
  status(workId: string): WorkView { return this.boundStage(workId) }
  /** 显式停止整个知识生成器，等待已知在途调用清理并保留未知结果。 */
  async stopGeneration(): Promise<void> {
    await this.ctx.knowledgeBase.repository.pauseGeneration('user requested generation stop')
    const active = this.operator.list().filter(view => isKnowledgeKind(view.work.kind)
      && !['succeeded', 'failed', 'canceled', 'unknown'].includes(view.state.status))
    const failures: unknown[] = []
    for (const view of active) {
      try { await this.operator.cancel(view.work.id) } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'knowledge queue: stopped admission but cleanup requires attention')
  }
  /**
   * 请求取消已绑定的知识阶段。
   *
   * @param workId - Queue 工作 ID。
   * @returns Queue 接受取消请求后完成。
   */
  cancel(workId: string): Promise<void> {
    this.boundStage(workId)
    return this.operator.cancel(workId as never)
  }
  /**
   * 仅为本地校验拒绝的响应创建修正阶段；未知结果不得绕过恢复核验。
   *
   * @param workId - 失败的 Queue 工作 ID。
   * @returns 新修正阶段的 Queue 工作及阶段身份。
   */
  async correctStage(workId: string): Promise<{ workId: string; stageId: string }> {
    const view = this.boundStage(workId)
    if (view.state.status !== 'failed' || view.state.failure?.category !== 'knowledge-validation') throw new Error('knowledge queue: correction requires a known validation failure')
    if (this.ctx.knowledgeBase.repository.generationStop()) throw new Error('knowledge queue: generation is stopped')
    const input = view.work.intent
    const stage = await this.ctx.knowledgeBase.repository.prepareCorrection(input.projectId, input.stageId, view.state.failure.message)
    return this.enqueuePrepared(stage)
  }
  /**
   * 仅重试确定尚未发起模型请求的失败工作。
   *
   * @param workId - 可重试的 Queue 工作 ID。
   * @returns Queue 接受重试请求后完成。
   */
  async retryStage(workId: string): Promise<void> {
    const view = this.boundStage(workId)
    if (view.state.status !== 'failed' || view.state.failure?.sideEffect !== 'not-started') throw new Error('knowledge queue: retry requires a known not-started failure')
    if (this.ctx.knowledgeBase.repository.generationStop()) throw new Error('knowledge queue: generation is stopped')
    await this.operator.retry(workId as never)
  }
  /**
   * 只在仓库存在可验证完成记录时授权未知工作重新调度。
   *
   * @param workId - 状态为 unknown 的 Queue 工作 ID。
   * @returns Queue 接受恢复授权后完成。
   */
  async resumeStage(workId: string): Promise<void> {
    const view = this.boundStage(workId)
    if (view.state.status !== 'unknown') throw new Error('knowledge queue: only an unknown knowledge stage can be resumed')
    const input = view.work.intent
    const completed = await this.ctx.knowledgeBase.repository.completedStage(input.projectId, input.stageId, workId)
      ?? await this.ctx.knowledgeBase.repository.recoverStage(input.projectId, input.stageId, workId)
    if (completed === null) throw new Error('knowledge queue: no verified completed stage is available')
    await this.operator.resolveUnknown(workId as never, { kind: 'authorize-retry' })
  }
}
