/**
 * 知识库的模型工具与人类命令，共享同一套严格业务请求校验。
 * @module @changanhua/dsh-tool-knowledge-base
 */
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  canonicalHash, impactClosure, knowledgeIdSchema, projectSpecSchema,
} from '@changanhua/dsh-knowledge-base'
import type { KnowledgeRepository, SourceInput, KnowledgeSiyuanProjection } from '@changanhua/dsh-knowledge-base'
import type KnowledgeQueueService from '@changanhua/dsh-knowledge-base-task-queue'
import type { WebFetchResult } from '@deepseek-ai/dsh-web'
import type {} from '@deepseek-ai/dsh-commands'
import { runKnowledgeBuild } from './build.ts'

const project = { projectId: knowledgeIdSchema }
const entry = { ...project, entryId: knowledgeIdSchema }
const source = {
  sourceId: knowledgeIdSchema, title: z.string().min(1).max(240),
  url: z.url().optional(),
}
const requests = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('siyuan-sync'), ...project, version: knowledgeIdSchema }),
  z.strictObject({ action: z.literal('siyuan-status'), ...project }),
  z.strictObject({ action: z.literal('siyuan-verify'), ...project }),
  z.strictObject({ action: z.literal('siyuan-inspect'), ...entry }),
  z.strictObject({ action: z.literal('siyuan-adopt'), ...entry, snapshotHash: z.string().regex(/^[a-f0-9]{64}$/u) }),
  z.strictObject({ action: z.literal('create'), spec: projectSpecSchema }),
  z.strictObject({ action: z.literal('list') }),
  z.strictObject({ action: z.literal('source'), ...project, ...source, text: z.string().min(1).max(200_000) }),
  z.strictObject({ action: z.literal('fetch'), ...project, ...source, url: z.url() }),
  z.strictObject({ action: z.literal('refresh'), ...project, sourceId: knowledgeIdSchema }),
  z.strictObject({ action: z.literal('plan'), ...project }),
  z.strictObject({ action: z.literal('confirm'), ...project, planHash: z.string().regex(/^[a-f0-9]{64}$/u) }),
  z.strictObject({ action: z.literal('generate'), ...entry }),
  z.strictObject({ action: z.literal('review'), ...entry }),
  z.strictObject({ action: z.literal('build'), ...project, maxRevisions: z.number().int().min(0).max(3).default(2) }),
  z.strictObject({ action: z.literal('adopt'), ...entry }),
  z.strictObject({ action: z.literal('status'), ...project }),
  z.strictObject({ action: z.literal('check'), ...project }),
  z.strictObject({ action: z.literal('publish'), ...project, version: knowledgeIdSchema }),
  z.strictObject({ action: z.literal('export-draft'), ...project, version: knowledgeIdSchema }),
  z.strictObject({ action: z.literal('rollback'), ...project, version: knowledgeIdSchema }),
  z.strictObject({ action: z.literal('diff'), ...project, from: knowledgeIdSchema, to: knowledgeIdSchema }),
  z.strictObject({ action: z.literal('work'), workId: z.string().min(1).max(200) }),
  z.strictObject({ action: z.literal('cancel'), workId: z.string().min(1).max(200) }),
  z.strictObject({ action: z.literal('correct'), workId: z.string().min(1).max(200) }),
  z.strictObject({ action: z.literal('retry'), workId: z.string().min(1).max(200) }),
  z.strictObject({ action: z.literal('resume'), workId: z.string().min(1).max(200) }),
  z.strictObject({ action: z.literal('resume-generation') }),
  z.strictObject({ action: z.literal('stop-generation') }),
])
/** 所有入口共享的封闭请求类型。 */
export type KnowledgeRequest = z.infer<typeof requests>
/** Host 组合提供的能力，模型不能改写这些依赖。 */
export interface KnowledgeToolDependencies {
  repository: KnowledgeRepository
  queue: Pick<KnowledgeQueueService, 'enqueueStage' | 'status' | 'cancel' | 'correctStage' | 'retryStage' | 'resumeStage' | 'stopGeneration'>
  fetch?: (url: string, signal: AbortSignal) => Promise<WebFetchResult>
  siyuan?: KnowledgeSiyuanProjection
}

/**
 * 将工具文本解析为封闭的知识业务请求。
 *
 * @param value - JSON 请求文本。
 * @returns 校验后的有限业务操作。
 */
export function parseKnowledgeRequest(value: string): KnowledgeRequest { return requests.parse(JSON.parse(value)) }

function snapshotSummary(snapshot: { sourceId: string; snapshotId: string; title: string }) {
  return { sourceId: snapshot.sourceId, snapshotId: snapshot.snapshotId, title: snapshot.title }
}
async function retrieve(
  request: { projectId: string; sourceId: string; title: string; url: string },
  deps: KnowledgeToolDependencies, signal: AbortSignal,
) {
  try {
    if (!deps.fetch) throw new Error('knowledge-base: 当前 Profile 未配置来源抓取能力')
    const response = await deps.fetch(request.url, signal)
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`knowledge-base: source HTTP ${response.statusCode}`)
    }
    if (response.truncated) throw new Error('knowledge-base: 来源响应已截断，未替换快照')
    const snapshot = await deps.repository.ingest(request.projectId, {
      sourceId: request.sourceId, title: request.title, url: response.url,
      text: response.body.content, fetchedAt: new Date().toISOString(),
      extractorVersion: 'dsh-web-body-v1',
    })
    return snapshotSummary(snapshot)
  } catch (error) {
    try {
      const existing = deps.repository.get(request.projectId).latestSources[request.sourceId]
      if (existing) {
        await deps.repository.recordSourceFailure(
          request.projectId, request.sourceId, error instanceof Error ? error.message : String(error),
        )
      }
    } catch {
      // 不能让失败记录掩盖原抓取错误；新来源或未知项目没有旧快照可保留。
    }
    throw error
  }
}

/**
 * 在 Host 边界再次验证并执行知识请求，避免直接调用绕过工具参数限制。
 *
 * @param input - 未信任的业务请求值。
 * @param deps - Host 已组合的仓库、Queue 与可选抓取能力。
 * @param signal - 调用取消信号。
 * @returns 请求对应的压缩业务结果。
 */
export async function executeKnowledgeRequest(
  input: unknown, deps: KnowledgeToolDependencies, signal: AbortSignal,
): Promise<unknown> {
  signal.throwIfAborted()
  const request = requests.parse(input)
  const repo = deps.repository
  switch (request.action) {
    case 'siyuan-sync':
      if (!deps.siyuan) throw new Error('knowledge-base: 当前 Profile 未配置思源')
      return deps.siyuan.sync(await repo.publication(request.projectId, request.version), signal)
    case 'siyuan-status': {
      if (!deps.siyuan) throw new Error('knowledge-base: 当前 Profile 未配置思源')
      const state = deps.siyuan.status(request.projectId)
      return { projectId: request.projectId, currentVersion: state.currentVersion, targetVersion: state.targetVersion,
        rootDocumentId: state.root?.documentId,
        entries: Object.entries(state.entries).map(([id, entry]) => ({
          id, documentId: entry.documentId, candidates: Object.values(entry.candidates).map(candidate => candidate.documentId),
        })) }
    }
    case 'siyuan-verify':
      if (!deps.siyuan) throw new Error('knowledge-base: 当前 Profile 未配置思源')
      return deps.siyuan.verify(request.projectId, signal)
    case 'siyuan-inspect':
      if (!deps.siyuan) throw new Error('knowledge-base: 当前 Profile 未配置思源')
      return deps.siyuan.inspect(request.projectId, request.entryId, signal)
    case 'siyuan-adopt': {
      if (!deps.siyuan) throw new Error('knowledge-base: 当前 Profile 未配置思源')
      const prior = repo.get(request.projectId).entries[request.entryId]
      if (!prior) throw new Error('knowledge-base: 条目不存在')
      await deps.siyuan.accept(request.projectId, request.entryId, request.snapshotHash, async (entry) => {
        await repo.adoptRemote(request.projectId, request.entryId, entry, prior.contentHash)
      }, signal)
      return { projectId: request.projectId, entryId: request.entryId, reviewRequired: true }
    }
    case 'create': {
      const record = await repo.create(request.spec)
      return { projectId: record.spec.id, planHash: canonicalHash(record.spec), confirmed: record.approvedHash !== null }
    }
    case 'list': return { projects: repo.list().map(spec => ({ id: spec.id, title: spec.title, readerTask: spec.readerTask })) }
    case 'source': {
      const imported: SourceInput = {
        sourceId: request.sourceId, title: request.title, text: request.text,
        fetchedAt: new Date().toISOString(), ...(request.url === undefined ? {} : { url: request.url }),
      }
      return snapshotSummary(await repo.ingest(request.projectId, imported))
    }
    case 'fetch': return retrieve(request, deps, signal)
    case 'refresh': {
      const record = repo.get(request.projectId)
      const old = record.sources[`${request.sourceId}:${record.latestSources[request.sourceId]}`]
      if (!old?.url) throw new Error('knowledge-base: 来源没有可重新抓取的 URL')
      const snapshot = await retrieve({ ...request, title: old.title, url: old.url }, deps, signal)
      return {
        ...snapshot, changed: old.snapshotId !== snapshot.snapshotId,
        affected: old.snapshotId === snapshot.snapshotId ? [] : impactClosure(
          record.spec.seeds.filter(seed => seed.sourceIds.includes(request.sourceId)).map(seed => seed.id), record.spec.seeds,
        ),
      }
    }
    case 'plan': return deps.queue.enqueueStage(request.projectId, 'plan', 'plan')
    case 'confirm':
      await repo.confirmPlan(request.projectId, request.planHash)
      return { projectId: request.projectId, confirmed: true }
    case 'generate':
    case 'review': return deps.queue.enqueueStage(request.projectId, request.entryId, request.action)
    case 'build': return runKnowledgeBuild(request.projectId, deps, signal, request.maxRevisions)
    case 'adopt': {
      const adopted = await repo.adopt(request.projectId, request.entryId)
      return { projectId: request.projectId, entryId: request.entryId, revision: adopted.revision, reviewRequired: true }
    }
    case 'status': {
      const record = repo.get(request.projectId)
      return {
        projectId: request.projectId, title: record.spec.title, planHash: canonicalHash(record.spec),
        confirmed: record.approvedHash === canonicalHash(record.spec),
        generationStop: repo.generationStop(), sourceAvailability: record.sourceAvailability,
        seeds: record.spec.seeds, sources: Object.keys(record.latestSources), currentRelease: record.currentRelease,
        stages: Object.values(record.stages).map(stage => ({
          id: stage.prepared.id, entryId: stage.prepared.entryId, action: stage.prepared.action,
          workId: stage.workId, state: stage.state,
        })),
      }
    }
    case 'check': return repo.check(request.projectId)
    case 'publish': return repo.publish(request.projectId, request.version)
    case 'export-draft': return repo.exportDraft(request.projectId, request.version)
    case 'rollback':
      await repo.rollback(request.projectId, request.version)
      return { projectId: request.projectId, currentRelease: request.version }
    case 'diff': return repo.diffReleases(request.projectId, request.from, request.to)
    case 'work': {
      const view = deps.queue.status(request.workId)
      return { workId: request.workId, status: view.state.status, failure: view.state.failure, result: view.result }
    }
    case 'cancel':
      await deps.queue.cancel(request.workId)
      return { workId: request.workId, canceled: true }
    case 'correct': return deps.queue.correctStage(request.workId)
    case 'retry':
      await deps.queue.retryStage(request.workId)
      return { workId: request.workId, retried: true }
    case 'resume':
      await deps.queue.resumeStage(request.workId)
      return { workId: request.workId, resumed: true }
    case 'resume-generation':
      await repo.resumeGeneration()
      return { generationResumed: true }
    case 'stop-generation':
      await deps.queue.stopGeneration()
      return { generationStopped: true }
  }
}

function renderResult(value: unknown): string {
  const text = JSON.stringify(value, null, 2)
  if (Buffer.byteLength(text, 'utf8') > 64 * 1024) throw new Error('knowledge-base: 结果过大，请按具体工作查询')
  return text
}

/**
 * 创建只暴露用户可执行知识操作的模型工具，不泄露进程、认证或存储配置。
 *
 * @param deps - Host 已组合的业务依赖。
 * @returns 可注册到 Tools 的知识库工具定义。
 */
export function createKnowledgeTool(deps: KnowledgeToolDependencies): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'knowledge_base',
    description: '创建、维护和发布带来源的知识库，可通过已配置的思源连接阅读和维护。request 是含 action 的 JSON：create 带 spec；source 带 projectId/sourceId/title/text；fetch 带 projectId/sourceId/title/url；refresh 带 projectId/sourceId；plan、status、check、build 带 projectId；confirm 再带 planHash；generate、review、adopt 再带 entryId；publish、export-draft、rollback 带 projectId/version；diff 带 projectId/from/to；work、cancel、retry、correct、resume 带 workId；stop-generation 和 resume-generation 无其它字段。先检查并确认规划，再 build；maxRevisions 为初次生成后的修订次数，0–3，默认2。build 不自动发布，unknown 不自动重发。retry 仅重试明确未启动的失败；correct 仅修正已返回但格式校验失败的响应；resume 仅接收已有可验证结果。全局停止会保留进度并等待活动调用结束；模型工具不能解除停止，只有人类命令或可信 Host 可 resume-generation。思源读操作：siyuan-status、siyuan-verify 带 projectId；siyuan-inspect 再带 entryId。siyuan-sync 带 projectId/version，siyuan-adopt 带 projectId/entryId/snapshotHash，二者只允许人类命令或可信 Host；更新会保留独立候选，不覆盖已有思源正文。',
    parameters: {
      request: { type: 'string', required: true, description: '包含 action 与相应业务字段的 JSON 对象。' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        result: { type: 'string', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: value.result }],
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('knowledge-base: 操作需要已建立的会话')
      const request = parseKnowledgeRequest(args.request)
      if (request.action === 'resume-generation') throw new Error('knowledge-base: 模型工具不能解除生成停止')
      if (request.action === 'siyuan-sync' || request.action === 'siyuan-adopt') throw new Error('knowledge-base: 思源写入与接纳需要人类命令或可信 Host')
      const result = await executeKnowledgeRequest(request, deps, exec.signal)
      return { result: renderResult(result) }
    },
    presentCall: () => ({ card: 'generic', title: '知识库', kind: 'execute' }),
  })
}

/** 函数插件由 Loader 读取整个 namespace。 */
export const name = 'tool-knowledge-base'
/** 生成与持久化不可用时不暴露半工作的工具。 */
export const inject = ['tools', 'knowledgeBase', 'knowledgeQueue']
/** 注册模型工具及可选人类命令，卸载时一起撤销。 */
export function apply(ctx: Context): () => void {
  const deps: KnowledgeToolDependencies = {
    repository: ctx.knowledgeBase.repository, queue: ctx.knowledgeQueue,
    ...(ctx.knowledgeBase.siyuan ? { siyuan: ctx.knowledgeBase.siyuan } : {}),
    fetch: (url, signal) => {
      const web = ctx.get('web')
      if (!web) return Promise.reject(new Error('knowledge-base: 当前 Profile 未配置来源抓取能力'))
      return web.fetch({ url }, signal)
    },
  }
  const disposeTool = ctx.tools.register(createKnowledgeTool(deps))
  const commands = ctx.get('commands')
  const disposeCommand = commands?.register({
    name: 'knowledge', description: '创建、检查、更新和发布知识库。',
    input: { hint: '{"action":"status","projectId":"game-vibe"}' },
    async handler(invocation) {
      try {
        const result = await executeKnowledgeRequest(parseKnowledgeRequest(invocation.rawInput.trim()), deps, invocation.signal)
        return { kind: 'success', text: renderResult(result) }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
  return () => { disposeCommand?.(); disposeTool() }
}
