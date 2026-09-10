# DSH 知识库生成器实现计划

**Goal / DoD:** 经 DSH Profile 运行可加载的插件，完成规格、来源、生成、检查、有限修订、发布、变更传播及停止恢复。真实 Codex 生成偏 vibe coding 的游戏开发知识库，并以小型摄影主题证明配置复用。交付源码、启动路径、内容文件、检查报告、调用与故障证据。

**基线:** master 的 d64dad21；实现分支 codex/knowledge-base-generator；32 项 Atomic Write 和 Storage Domain 测试通过。原检出仅有无关 .task3-baseline.log，保持不动。

**架构:** knowledge-base 拥有规格、快照、条目、检查、发布与可恢复提交事实；knowledge-base-task-queue 连接 typed Queue 与现有 Codex App Server；tool-knowledge-base 提供模型可调用的业务入口。三个个人包均为 @changanhua、private，通过一个 opt-in Bundle 加载，不修改默认 Profile。文件是可读内容，Domain 是业务提交事实，Queue 是工作尝试事实。

**依赖:** Node/pnpm 使用仓库版本；Codex 使用已配置原生登录与模型。用户授权到自动停止为止，无自设 token/金额总额、无付费后备或额度重置。模型调用仅访问工作项目及指定公开来源，不改真实用户 Profile。

**真实验收入口:** 最早在 M0 组合三个包及本地存储/Queue/Subprocess，经仓库标准 dsh Profile 入口完成 5 个条目和一次真实 Codex 调用；从独立测试进程读取内容和持久状态。正式验收还须建立主知识库、小型跨主题库及六组故障场景。

**验证预算:** 每个包运行聚焦测试与覆盖；稳定集成时运行一次 typecheck/build、相关生成器及 package identity/constraints/文档检查；模型和故障验收只在相关代码变化或失败修复后重跑。普通源测试不替代 built Loader/Profile 和真实 Codex 证据。

## 任务一：业务值与文件提交

依赖：已核对 Storage Domain 和 Atomic Write。业务包位于 packages/knowledge/knowledge-base，包含 model.ts、state.ts、repository.ts、files.ts、index.ts、invariant.ts 及对应测试。共享接口是 ProjectSpec、SourceSnapshot、KnowledgeEntry、检查结果以及基于输入哈希的业务提交身份。

先写 RED 测试，再实现严格 schema、稳定哈希、引用定位、依赖闭包、覆盖计算。文件产出保存在受管理根目录，拒绝路径逃逸和 symlink，提交前检查手改，保留不可变候选和旧发布版本。Domain 中的提交意图允许重启后核对文件并完成提交；不得清除 unknown 来重跑模型。

完成检查：知识值测试、真实临时目录的冲突/中断测试、Domain 重开读取；后续 Queue 与工具共同消费该业务契约。

## 任务二：Queue 与 Codex 接入

依赖任务一的稳定输入/产出契约。Queue 桥接包包含 index.ts、runner.ts、invariant.ts 和 tests；组合用的 cordis.patch.yml 归 tool-knowledge-base。复用 @changanhua/dsh-task-queue、@deepseek-ai/dsh-subagent-codex/app-server-run 及 subprocess。

注册业务 typed WorkKind，准入时冻结输入版本和资源声明。单个项目串行，产出提交可幂等读取，Queue 完成与业务提交之间通过稳定绑定恢复。Codex 每次只负责明确的一段生成或检查，调用前记录业务身份，响应先保存后消费，停止传播并等待子进程释放。配额、异常断流、unknown 和正常完成必须区分，不提供无限重试。

完成检查：真实 Queue 的重复准入、重启、结果接收窗口、取消和 unknown；Loader 组合；一次真实 Codex 结果被严格解析并持久接收。

## 任务三：可调用操作与完整业务闭环

依赖任务一、二。创建 packages/knowledge/tool-knowledge-base/src/index.ts、invariant.ts、tests；同步两个业务包的消费者契约及组合行。提供初始化/来源导入、规划与确认、生成、状态/检查、发布、来源更新、恢复和发布回退的受支持操作。工具在执行处检查作用域和输入，输出业务结果及可取回产物，不要求用户了解内部存储或进程协议。

检查绑定内容、来源、规格与验证器指纹；所有必需条目与检查有效通过才正式发布。来源变更先生成精确影响集合；普通参见关系不传播。手改冲突保留两份内容。回退只切换发布版本，不覆盖工作内容。

完成检查：六组需求场景和一个记录会话场景；真实 DSH 入口可启动、查询并读取生成产物。

## 任务四：内容与交付验证

依赖前述闭环。创建包内示例配置、公开来源清单和验收 fixture；实际生成主知识库以及小型摄影库。游戏开发主题覆盖玩法表达、原型范围、引擎与 AI 工具、任务拆分、素材许可、试玩/定位、版本回退、构建发布检查。固定主张引用抽样及读者输出：玩法说明、三阶段 AI 迭代任务、试玩和回退清单。

同期补充包 READMEs、Agent Note、个人包身份、Host tsconfig、生成 aliases、lockfile 和需要更新的目录/目录生成物；按各归属规则验证中英文文档。稳定候选进行一次独立持久化/恢复审查，根代理处理发现并运行受影响检查。

完成证据明确区分：源码测试、生成声明、Loader 组合、运行状态、真实 Codex 内容、独立产物验收。若自动停止，保留当前分支、运行身份、已完成证据和下一条命令；目标维持未完成。

## 当前进度

- [x] Goal 启动；隔离 worktree 和依赖就绪。
- [x] 32 项持久化依赖基线测试通过。
- [x] 业务值、文件提交和持久阶段归属；核心聚焦测试与覆盖通过。
- [x] Queue/Codex 最小真实切片；原生登录 canary 完成生成、审查与发布。
- [x] 规划、生成、审查、有限修订、检查、草稿、正式发布、diff、回退、停止和恢复操作。
- [x] 真实 Loader 的五条目来源更新与手改保护；built dsh 的三个强杀恢复窗口。
- [x] 主来源输入逐字核验；读者任务样例准备完成。
- [x] 主库 30 条目、小型摄影库 4 条目的真实 Codex 生成、审查与本地正式发布。
- [x] 每库 10 项固定主张引用核对、独立工程审查；交付报告与源码检查点已保存。

来源证据、命令输出和中间产物保存在 `.artifacts/knowledge-base/`。该目录属于本次隔离验收，不能视为已修改用户日常 Profile。完整交付状态以最后的内容检查与交付报告为准。

### 2026-09-08 自动停止检查点

工程实现已有 147 项测试通过，四项覆盖率均为 100%；Host/Client 构建、291 个编译 companion 独立加载、模型契约快照及三组 built dsh 强杀恢复均通过。独立工程复核发现的停止门和恢复入口问题已修复。

真实 Codex 在台北时间 08:04 返回 `category: limit`，插件已持久停止准入。主库 24/30 条通过审查，导出明确标记的部分草稿，未正式发布；摄影配置已准备但 0/4 条生成。主库固定抽样完成 7/10，摄影抽样未开始。因此 M5 与整个 Goal 尚未完成。

`web-build-check` 工作 `a6cdf28a-4c77-4049-b650-8a0677ca1223` 保持 unknown，没有响应或候选证据；未擅自重试、解除停止或切换后端。继续条件、缺项和数据路径见 `.artifacts/knowledge-base/stopped-delivery/continuation.md`。之后只执行了本地检查、草稿导出和检查点保存，Queue 日志仍停在序号 204。

### 恢复后的最终验收

Goal 明确恢复后，账户只读额度查询显示已用 2% 且未命中限制。通过 Queue 可信操作者入口对上述确切 unknown 工作执行 `authorize-retry`，保留原尝试；成功取得响应后继续其余内容，没有重做原先已通过的 24 条。

主库 30/30 条通过，发布 v1；实际引用 14 份来源，最长依赖 14 层。摄影 4/4 条通过，最终发布 v2。摄影输入中的 Adobe 导航节选被实际裁切正文替代，旧快照和 v1 保留；真实 v1→v2 对比显示 3 条内容改变，回退 v1 时工作文件保持不变，随后恢复 v2。

每库 10 项固定主张—引用样本完成 Codex 核对，覆盖本次使用的 concept/method/opinion 类型，并记录许可和托管等适用条件差异。真人试玩、拍摄与法律判断不在已验证结果中；自动全库语义重复和矛盾检查继续标为 not_run。完整发布、检查、来源、抽样和读者任务产物位于 `.artifacts/knowledge-base/delivery/`。思源执行状态更新稿已保存，因当前 MCP 不可用尚未回写；原需求修订已在启动前完成。
