/**
 * Knowledge Base Host 插件：把知识业务仓库安装到当前 Profile 的持久化组合。
 * @module @changanhua/dsh-knowledge-base
 */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { KnowledgeRepository } from './repository.ts'
import { randomUUID } from 'node:crypto'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'
import { KnowledgeSiyuanProjection } from './siyuan.ts'
import { createSiyuanGateway } from './siyuan-gateway.ts'

export * from './model.ts'
export * from './state.ts'
export * from './files.ts'
export * from './map.ts'
export { KnowledgeRepository, KnowledgeResultValidationError, renderEntry, parseEntry } from './repository.ts'
export type { SourceInput, KnowledgeCheck } from './repository.ts'
export { KnowledgeSiyuanProjection, markdownIdentity, plainKramdown } from './siyuan.ts'
export type { SiyuanProjectInput, SiyuanConfig } from './siyuan.ts'
export { createSiyuanGateway } from './siyuan-gateway.ts'
export type { SiyuanGateway, SiyuanMcpCall } from './siyuan-gateway.ts'

/** 由可信 Profile 指定受管理内容根。 */
export interface Config {
  /** 绝对路径；模型不能通过业务工具覆盖此值。 */
  root: string
  /** 使用已配置的原生 MCP 服务；省略时保留文件模式。 */
  siyuan?: false | {
    /** 已由 MCP Client 注册的思源服务名称。 */
    serverName: string
    /** 保存知识正文的思源笔记本 ID。 */
    notebook: string
    /** 新建项目文档的绝对人类可读路径。 */
    rootPath: string
    /** 可选的项目 ID 到已有根文档 ID 映射，用于复用指定入口。 */
    projectRoots?: Record<string, string>
  }
}
/** 没有隐式 cwd 默认值，避免文件散落在当前目录。 */
export const Config: z<Config> = z.object({
  root: z.string().required(),
  siyuan: z.union([z.const(false), z.object({
    serverName: z.string().pattern(/^[A-Za-z0-9_-]{1,32}$/u).required(),
    notebook: z.string().required(), rootPath: z.string().required(),
    projectRoots: z.dict(String),
  })]).default(false),
})

declare module '@deepseek-ai/cordis' {
  interface Context { knowledgeBase: KnowledgeBaseService }
}

/** Domain 和内容文件的唯一业务 owner。 */
export default class KnowledgeBaseService extends Service {
  /** Loader 使用 Service 类上的 schema 解析配置。 */
  static Config = Config
  /** 持久层就绪后才能提供业务能力。 */
  static inject = ['storageDomain']
  private opened!: KnowledgeRepository
  private projection?: KnowledgeSiyuanProjection

  /**
   * 以可信的 Profile 配置组合知识仓库及可选思源投影。
   *
   * @param ctx - Profile 上下文。
   * @param config - 受管根目录和可选思源目标配置。
   */
  constructor(ctx: Context, private readonly config: Config) { super(ctx, 'knowledgeBase') }
  /** 仅向已组合的 Host 消费者公开仓库，不注册模型工具。 */
  get repository(): KnowledgeRepository { return this.opened }
  /** 当前 Profile 的思源内容连接；未配置时为 undefined。 */
  get siyuan(): KnowledgeSiyuanProjection | undefined { return this.projection }
  protected async [Service.init](): Promise<void> {
    if (this.config.siyuan) {
      const target = this.config.siyuan
      const gateway = createSiyuanGateway(async (kind, args, signal) => {
        const tools = this.ctx.get('tools')
        if (!tools) throw new Error('knowledge-base: SiYuan requires the configured MCP tools')
        const result = await tools.execute({
          callId: ToolCallId(randomUUID()), name: 'mcp__' + target.serverName + '__' + kind, arguments: args, signal,
        })
        if (result.isError) throw new Error(result.error.message)
        return result.value
      })
      const projection = await KnowledgeSiyuanProjection.open(this.ctx.storageDomain, gateway, target)
      this.projection = projection
      this.ctx.effect(() => () => projection.close(), 'knowledgeBase.siyuan.close')
    }
    this.opened = await KnowledgeRepository.open(this.ctx.storageDomain, this.config.root, this.projection)
    this.ctx.effect(() => () => this.opened.close(), 'knowledgeBase.close')
  }
}
