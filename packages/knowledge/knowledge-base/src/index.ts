/**
 * Knowledge Base Host 插件：把知识业务仓库安装到当前 Profile 的持久化组合。
 * @module @changanhua/dsh-knowledge-base
 */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { KnowledgeRepository } from './repository.ts'

export * from './model.ts'
export * from './state.ts'
export * from './files.ts'
export { KnowledgeRepository, KnowledgeResultValidationError, renderEntry, parseEntry } from './repository.ts'
export type { SourceInput, KnowledgeCheck } from './repository.ts'

/** 由可信 Profile 指定受管理内容根。 */
export interface Config {
  /** 绝对路径；模型不能通过业务工具覆盖此值。 */
  root: string
}
/** 没有隐式 cwd 默认值，避免文件散落在当前目录。 */
export const Config: z<Config> = z.object({ root: z.string().required() })

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

  /** @param ctx - Profile 上下文。 @param config - 可信根目录配置。 */
  constructor(ctx: Context, private readonly config: Config) { super(ctx, 'knowledgeBase') }
  /** 仅向已组合的 Host 消费者公开仓库，不注册模型工具。 */
  get repository(): KnowledgeRepository { return this.opened }
  protected async [Service.init](): Promise<void> {
    this.opened = await KnowledgeRepository.open(this.ctx.storageDomain, this.config.root)
    this.ctx.effect(() => () => this.opened.close(), 'knowledgeBase.close')
  }
}
