/**
 * 能力中文映射（展示层辅助，只读）。
 *
 * Capability 面板的 Skills / Tools 列表标题与副标题基本来自运行时注册表：
 *   - skill 的 description 多为英文或混合，name 是固定 kebab-case 英文；
 *   - tool 的 description 来自 defineTool，几乎全为英文，且无中文字段。
 *
 * 本模块只做"已知能力的展示层中文化"：给内置工具 / 常用内置技能配
 * 中文名 + 一句中文介绍。命中则列表用中文显示，未命中原样回落（方便按需
 * 扩充、不破坏任何运行时行为、不污染模型上下文）。
 *
 * 注意：这只是浏览器渲染层的文案映射，不是给 agent 看的系统提示。
 */

/** 一条中文化记录：中文名 + 一句中文介绍。 */
export interface ZhEntry {
  readonly zh: string
  readonly intro: string
}

/** Skill 中文映射（key = 技能 name）。 */
export const SKILL_ZH: Readonly<Record<string, ZhEntry>> = {
  'llm-batch-task': { zh: 'LLM 批量任务', intro: '把一批语料逐条做相同的 LLM 变换并保存结果的 DSH Workflow 工作流。' },
  'arkcli-chat': { zh: 'arkcli 对话', intro: '通过火山方舟数据面 API 快速对话/推理，支持多模态与流式。' },
  'arkcli-models': { zh: 'arkcli 模型', intro: '列出/搜索火山方舟公共基础模型与其详情。' },
  'arkcli-deploy': { zh: 'arkcli 部署', intro: '一键创建推理接入点（Endpoint）并生成多语言调用示例。' },
  'arkcli-infer-endpoint': { zh: 'arkcli 接入点管理', intro: '对已有推理接入点做查/列/启/停/删/更新的生命周期管理。' },
  'arkcli-auth': { zh: 'arkcli 认证', intro: '交互式登录、SSO、查看状态、退出、生成 API Key。' },
  'arkcli-profile': { zh: 'arkcli 配置档', intro: '管理 profile 切面、默认资源与持久身份。' },
  'arkcli-usage': { zh: 'arkcli 用量', intro: '查询 ARK 推理用量、套餐额度与余额。' },
  'arkcli-billing': { zh: 'arkcli 账单', intro: '查询火山引擎 ARK 拆分账单明细与结算金额。' },
  'arkcli-pricing': { zh: 'arkcli 定价', intro: '查询 ARK 基础模型结算单价与套餐订阅价格。' },
  'arkcli-understand': { zh: 'arkcli 多模态理解', intro: '基于 Responses API 的 12 个多模态理解专项配方。' },
  'arkcli-shared': { zh: 'arkcli 共享协议', intro: 'arkcli 首次配置、认证闸门、命令路由与公共执行协议。' },
  'arkcli-doctor': { zh: 'arkcli 诊断', intro: '统一排查 arkcli/Endpoint/模型的健康度、错误、来源等。' },
  'task-queue-orchestration': { zh: '任务队列编排', intro: 'DSH 持久任务队列的何时用、executor 选择与生命周期监控指南。' },
  'product-agent-routing': { zh: '产品 Agent 路由', intro: '把任务派给本机 Claude Code / Codex CLI 子代理的路由手册。' },
  'byted-web-search': { zh: '豆包搜索', intro: '火山引擎豆包联网搜索 API，返回网页/图片结果。' },
  'find-skills': { zh: '查找技能', intro: '帮你发现并安装能满足某类功能的 agent 技能。' },
  'writing-skills': { zh: '编写技能', intro: '创建、编辑、校验可部署的 agent 技能。' },
  'brainstorming': { zh: '头脑风暴', intro: '创作/功能设计前必须使用的结构化创意探索。' },
  'bmad-prd': { zh: '撰写 PRD', intro: '创建专业产品需求文档（PRD）与结构化产品规划。' },
  'bmad-architecture': { zh: '技术架构', intro: '编写技术架构与解决方案设计文档。' },
  'prompt-engineering-patterns': { zh: '提示词工程', intro: '优化提示词、设计模板、运用高级提示工程模式。' },
  'systematic-debugging': { zh: '系统化排错', intro: '遇到任何 bug / 测试失败时先系统化定位原因。' },
  'test-driven-development': { zh: '测试驱动开发', intro: '先写测试再实现功能的开发纪律。' },
  'executing-plans': { zh: '执行计划', intro: '按书面实现计划在独立会话中执行并设评审检查点。' },
  'writing-plans': { zh: '编写计划', intro: '多步骤任务动手前先写实现计划。' },
  'subagent-driven-development': { zh: '子代理驱动开发', intro: '用独立子代理执行实现计划中的各项任务。' },
  'requesting-code-review': { zh: '请求代码评审', intro: '完成任务/大改动后请他人评审代码是否达标。' },
  'receiving-code-review': { zh: '接收代码评审', intro: '收到评审意见、在动手修改前用技术严谨性核实。' },
  'verification-before-completion': { zh: '完成前验证', intro: '声称完成/修好前先跑验证命令确认。' },
  'using-git-worktrees': { zh: 'Git 工作树', intro: '用独立 worktree 隔离分支工作。' },
  'finishing-a-development-branch': { zh: '收尾开发分支', intro: '实现完成、测试通过后决定如何集成。' },
  'epub-toc-rebuild': { zh: '重建 EPUB 目录', intro: '用 LLM 内容理解重建损坏/缺失的 EPUB 目录。' },
}

/** Tool 中文映射（key = 工具 name）。 */
export const TOOL_ZH: Readonly<Record<string, ZhEntry>> = {
  'read': { zh: '读取文件', intro: '按行号读取文本文件内容。' },
  'read_image': { zh: '读取图片', intro: '直接读取并返回图片本身（需模型支持图像输入）。' },
  'modlens_read_image': { zh: '读图(识别)', intro: '通过视觉桥逐字转录图片，用于截图/图表识别。' },
  'write': { zh: '写入文件', intro: '创建或整体替换一个 UTF-8 文本文件。' },
  'edit': { zh: '编辑文件', intro: '用文本精确替换对已有文件做定向修改。' },
  'glob': { zh: '查找文件', intro: '按 glob 路径模式查找文件。' },
  'grep': { zh: '搜索内容', intro: '用正则搜索文件内容并返回带行号的匹配。' },
  'pwsh': { zh: '执行命令', intro: '执行一条 PowerShell 命令并返回输出。' },
  'web_search': { zh: '联网搜索', intro: '搜索网络获取当前信息并返回来源链接。' },
  'ask_user_question': { zh: '询问用户', intro: '需要确认/选择/补充信息时向用户提问。' },
  'todo_write': { zh: '任务清单', intro: '记录并更新当前多步工作的结构化任务列表。' },
  'create_goal': { zh: '创建目标', intro: '为跨轮次的长目标创建持久同会话目标。' },
  'get_goal': { zh: '读取目标', intro: '读取当前同会话目标的 id/阶段/已完成轮次等。' },
  'update_goal': { zh: '更新目标', intro: '更新目标（编辑/暂停/恢复/完成/受阻）。' },
  'exit_plan_mode': { zh: '退出规划模式', intro: '在规划模式下提交完整计划供用户审阅并退出。' },
  'subagent': { zh: '子代理', intro: '把自包含任务委托给后台子代理并行处理。' },
  'subagent_fork': { zh: '子代理(继承)', intro: '委托一个继承本会话上下文的子代理做后续分析。' },
  'send_message': { zh: '发送消息', intro: '给后台子代理发消息，延续同一会话。' },
  'list_agents': { zh: '列出子代理', intro: '列出可延续的后台子代理。' },
  'interrupt_agent': { zh: '中断子代理', intro: '请求取消某个正在运行的后台子代理的当前轮。' },
  'skill': { zh: '加载技能', intro: '加载某个可用技能的完整说明。' },
  'job_kill': { zh: '终止后台任务', intro: '请求取消某个正在运行的后台任务。' },
  'job_list': { zh: '后台任务列表', intro: '列出后台任务（运行中与已完成）及其状态。' },
  'job_output': { zh: '读取任务输出', intro: '读取后台任务的输出。' },
  'task_queue_stats': { zh: '队列概览', intro: '查看持久任务队列的服务状态与各状态计数。' },
  'task_queue_executors': { zh: '队列执行器', intro: '列出任务队列已注册的执行器及其可用性。' },
  'task_queue_list': { zh: '队列列表', intro: '按状态/执行器/标签过滤列出队列中的任务。' },
  'task_queue_enqueue': { zh: '入队任务', intro: '把一个持久、跨会话的任务放入队列。' },
  'task_queue_enqueue_batch': { zh: '批量入队', intro: '一次入队最多 200 个独立任务。' },
  'task_queue_status': { zh: '队列任务详情', intro: '按 id 获取某个队列任务的完整记录。' },
  'task_queue_retry': { zh: '重试任务', intro: '重试一个失败的任务（重置尝试次数）。' },
  'task_queue_cancel': { zh: '取消任务', intro: '取消一个待办/启动中/运行中的任务。' },
  'task_queue_dismiss': { zh: '收尾任务', intro: '软收尾一个终态任务并保留其记录。' },
  'task_queue_undismiss': { zh: '恢复任务', intro: '把已收尾的任务恢复到待关注状态。' },
  'workflow': { zh: '工作流', intro: '运行一个编排多个子代理的 JS 工作流脚本。' },
  'ralph': { zh: 'Ralph 循环', intro: '向前台全新 agent 循环执行一个不可变目标。' },
}

/** 取 Skill 中文映射；未命中返回 undefined。
 * @param name - skill name to look up.
 * @returns the Chinese entry, or undefined when unmapped. */
export function skillZh(name: string): ZhEntry | undefined {
  return SKILL_ZH[name]
}

/** 取 Tool 中文映射；未命中返回 undefined。
 * @param name - tool name to look up.
 * @returns the Chinese entry, or undefined when unmapped. */
export function toolZh(name: string): ZhEntry | undefined {
  return TOOL_ZH[name]
}
