# DSH 项目记忆 V1 实施计划

状态：供实施使用的设计草案；本次只制定计划，尚未实现或启用记忆能力。

**目标与完成条件：** 用户在项目的一次会话中确认一条有来源的工作记忆，在同一 Workspace 的新会话及 Host 正常重启后可以查到并使用；来源改变、超过复核期限、发生冲突或用户撤回后，默认召回不再把它作为可用结论。用户能够查看原文依据、记忆版本、确认记录和不可用原因。

**架构：** 新增项目记忆 Definition、Local Provider、模型 Tool Consumer、人工 Command Consumer，以及一个显式启用的个人 Bundle。记忆状态由 Storage Domain 保存；原文件和 Session 日志仍由各自领域保存。模型通过普通工具结果获得记忆，沿用 Session 日志的可重放约束。

**依赖：** 已注册的 Workspace、Storage Domain、持久存储后端、Session Query、同一执行世界的文件系统、Tools、Commands；首版产品载体是本地 Windows 的 `dsh web`。不依赖内容库分支、外部知识库、向量数据库或新的模型服务。

**真实验收路径：** 在启用个人记忆 Bundle 的测试 Web Profile 中，用文件依据提出候选并人工确认；新建会话召回，正常重启后再次召回；修改来源并再次查询，确认旧结论被隔离；接受修订后只使用新版本。外部测试检查持久记录、工具日志、实际输出文件和浏览器操作结果。

**验证预算：** 各工作包只运行相关测试；Task 3 完成最早的真实纵向验证；Task 5 在代码冻结后运行一次构建、类型检查、lint、hygiene、doc-sync 及受影响测试。真实模型调用限于有预算授权的验收；本计划不执行调用。耗时和费用当前未测量，不作保证。

## 1. 产品边界

首版保存四类项目工作记忆：项目事实、已作出的决定、项目内偏好、可复用操作方法。一条记忆表达一个可独立修订的命题。例如“这个项目的验证命令是 `pnpm run test`”，并链接到说明该命令的文件。

项目记忆服务于 Agent 再次处理该项目。正式资料、长篇报告、原始附件以及外部知识库的权威文档继续由原系统保存；本能力保存短结论和来源引用。后续若接入思源或其他知识库，通过独立适配扩展来源类型，不迁移用户原有资料。

首版包含：显式提出候选、人工确认与拒绝、关键词召回、来源复核、修订、撤回、版本历史、同项目隔离、跨会话与重启恢复。模型不自动批准自己提出的记忆。

首版不包含：后台扫描所有历史会话、每轮自动提炼、跨项目共享、Git worktree 自动归并、自动解决语义矛盾、向量与图检索、自动修改 Skill、独立记忆管理页面、外部网页抓取、多人或多 Host 共同写入。人工确认是本版发布策略；以后可以加入明确授权的自动接纳策略，但它不属于本次完成条件。

## 2. 当前代码依据与复用决定

基线是 `C:\Users\xbh\deepseek-harness` 的 `master@d64dad21bf`。检查时只有未跟踪的 `.task3-baseline.log`，不属于本计划。下列判断来自源码和文档，未做新的运行时验收；开始实施时只复核这些相关契约与工作区状态，不重做全仓调研。

| 已有能力 | 本计划如何使用 | 证据 |
| --- | --- | --- |
| Workspace Registry | 使用稳定 WorkspaceId 和已规范化目录；不发明第二套项目身份 | [Workspace](../../packages/workspace/workspace/src/index.ts) |
| Storage Domain | 定义记忆 domain；使用单条记录的原子 `update`；写入失败不更新内存 | [Domain 接口与实现](../../packages/storage/storage-domain/src/domain.ts) |
| Session Query | 精确读取引用事件并核对所属目录，不依赖全文索引开启 | [Session Query](../../packages/session-query/session-query/src/index.ts) |
| 会话查询工具的权限边界 | 参考从 `exec.agent` 获取调用者、核验来源会话的方式；不导入其私有实现 | [Workspace access](../../packages/session-query/tool-session-query/src/workspace-access.ts) |
| 文件系统 Definition | 经 `resolve`、`contains`、`stat`、`readBytes` 读取同一执行世界的文件 | [FileSystem](../../packages/fs/fs/src/index.ts) |
| Commands | 复用 Web 命令入口、`commandId` 和 `command/run` 记录；不新增 UI 状态库 | [Commands](../../packages/interaction/commands/src/index.ts) |
| 第三方 MCP Memory 示例 | 可作为其他选择；当前示例没有替 DSH 定义候选确认、Workspace 权限、失效和修订语义 | [MCP Memory](../user/guide/mcp-memory.md) |
| 现有 Eval | 借用固定用例和证据分类方法；不扩展 Eval 平台作为本功能前置工作 | [Eval](../../packages/eval/README.md) |

选择“新增记忆领域，复用现有基础设施”。不能把聊天记录搜索直接改名为长期记忆，也不能让第三方 MCP 存储与 DSH 同时成为同一条记忆的写入权威。

## 3. 冻结的数据与行为

### 3.1 项目范围和来源

所有入口从真实 Agent 或人工 CommandInvocation 推导当前 Workspace；工具参数不接受任意 `workspaceId`、本机根路径或操作者身份。没有 cwd、没有注册 Workspace 或目录无法核验时返回 `workspace-unavailable`，不降级成全局记忆。首版按 Workspace 的规范化根目录精确匹配，不把任意子目录或另一 worktree 自动归为同项目。

来源只支持以下两种；模型提交定位信息，服务计算哈希，模型不能自填“验证通过”。

| 来源 | 固定身份 | 创建和召回时的检查 |
| --- | --- | --- |
| 项目文件 | WorkspaceId、项目相对路径、内容 SHA-256；可附行号作为导航提示 | 文件必须位于授权根目录、为普通文件且不超过大小上限；哈希覆盖原始完整字节；行号不作为有效性证据 |
| Session 事件 | SessionId、事件 seq、从持久事件提取的文本摘要哈希 | 精确读取已落盘事件，重新核验调用者与来源会话的目录；引用当前会话时排除未提交的事件 |

引用自然语言偏好时，依据应是用户原话所在事件；引用模型结论或工具输出时，显示来源角色和事件类型。事件仍存在只证明曾说过或观察过，不证明当前事实仍然成立。外部网页 URL 可以出现在正文中，但 V1 不把它当作已复核来源，也不主动访问。

Provider 使用 `ctx.fs` 的权限与范围检查；拒绝越界路径、解析后逃出根目录的链接，以及无权读取的源。V1 只接收文本来源，来源预览按输出预算截断；不保存整份文件或整段会话副本。

### 3.2 记忆记录

一个 `MemoryRecord` 是一条记忆的完整原子聚合，包含如下字段。名称为本计划拟新增契约，不代表仓库已有 API。

| 字段 | 语义 |
| --- | --- |
| `id`, `workspaceId`, `recordVersion` | 稳定身份、项目范围、单记录乐观并发版本 |
| `topicKey` | 项目内稳定主题键，例如 `validation.command`；用于显式修订和同主题冲突分组，不承诺理解任意自然语言矛盾 |
| `revisions[]` | 不可变内容版本：revision、kind、title、statement、tags、适用条件说明、sources、创建者、创建时间 |
| `activeRevision`, `candidateRevision` | 当前已接受版本和至多一个待处理版本；提出修订不会覆盖仍可用的旧版本 |
| `decisions[]` | 对具体 revision 的接受、拒绝、撤回记录及人工 commandId；接受记录保存复核截止时间，可重建历史状态而无需改写内容版本 |
| `receipts[]` | 幂等键、规范化输入摘要和操作结果，与业务变更一次落盘 |

“已接受”表示用户允许复用，不等于“结论已证实”。本版不提供模型自填的置信度分数，不自动生成“已验证”徽章。适用条件文本供人和模型阅读；机器只保证项目范围、来源检查、截止时间与冲突规则，不声称已执行任意自然语言条件。

同一条记录可以同时有一个 active 版本和一个候选修订。接受修订时，在一次原子写入中将 active 指针移到新版本并记录决策；旧版本保留。拒绝候选不撤销旧版本。撤回 active 后保留历史，默认召回不返回其内容；“撤回”不是删除文件、历史日志或隐私擦除。

### 3.3 失效、冲突和重新确认

每次返回记忆正文前重新检查当前 active revision，并计算本次 `eligibility`。结果为 `usable`、`source-changed`、`source-unavailable`、`review-due`、`conflicted` 或 `withdrawn`；候选与被拒绝版本只在人工查看中出现。

文件哈希变化、来源事件缺失或读取失败、复核期限已到，都会把该条记忆移出可用结果。`source-unavailable` 不能解释为“已经失效的事实”，但同样不能当作已核验内容继续使用。检查失败不删数据，也不静默续期。

接受记忆时复核来源并设置 `reviewAfter`；首版默认 30 天，由插件配置持有，可由人工确认命令为单条记忆缩短或延长。到期后的继续使用需要重新确认；文件变化后的重新确认必须产生一条重新捕获来源的候选版本，不能只刷新旧哈希。

来源健康是读取时的派生观察，不额外维护一套后台状态机。文件恢复为完全相同的字节且其他条件通过时，该记忆可以重新满足来源检查；它不会因此延长复核期限。检查与实际行动间仍可能发生变化，召回结果保留 `checkedAt`，执行代码、部署等动作仍需按任务检查当前事实。

检索对项目中同 `topicKey` 的 active 记录执行冲突检查：若不同记录包含不同规范化命题，整组不给出可用正文。人工选择其中一条，撤回其他记录，或把修正作为同一记录的新版本接纳。该规则应覆盖“旧版本+新版本同时创建”的常见重复问题；不同 topicKey 的语义冲突检测延后。

### 3.4 读写权限与模型入口

拟新增 `ctx.projectMemory`。Definition 提供 `search`、`read`、`propose`、`decide` 四组操作；每次调用都携带由可信入口取得的 Agent，`decide` 额外要求真实命令调用证据。Local Provider 再次核对 Workspace 和作用范围，不只依赖前端过滤。

模型只获得三个工具：

- `memory_search(query, tags?, limit?)`：查询本项目；默认最多 5 条可用记忆。返回 id、revision、正文、来源定位、检查时间、复核期限，以及因失效或冲突被排除的摘要数量。
- `memory_read(id)`：读取一条记忆并重新检查；不可用时只返回状态、原因和来源定位，不返回旧命题正文供模型误用。
- `memory_propose(topic_key, kind, title, statement, sources, tags?, memory_id?, expected_version?, idempotency_key)`：创建或修订候选；不接纳、不改变别的记录，不具有批量写入权限。

人工入口复用 `/memory` 命令，提供 `list`、`show <id>`、`accept <id>@<revision>`、`reject <id>@<revision>`、`retire <id>@<revision>`。`show` 包含完整命题、来源预览、候选与 active 的差异、复核状态和可复制的后续命令；界面不要求用户输入内部 `recordVersion`。变更命令以目标 revision 加服务读取到的 recordVersion 做 CAS，冲突则返回重新查看提示。

`decide` 核验 invocation.commandId 对应当前 Session 中已经存在、命令名与操作参数一致的 `command/run`，并只接受 Command Consumer 的调用路径；不注册模型 approve 工具或公共裸写 API。TypeScript 类型标记不作为安全边界。能力边界假定 Host 插件可信；同进程恶意插件或拥有宿主全部文件写权限的执行器不在此逻辑权限的防护承诺内。

工具提示要求在涉及项目历史决定、偏好、既有方法时先检索，并在使用结论时标注 `memory:<id>@<revision>` 和来源。记忆正文及来源预览是带出处的材料，不能授予工具权限、覆盖当前用户指令或升级为系统指令；人工接纳也不改变这条边界。首版不在每个请求中批量注入记忆，不修改 agent-loop 或系统级 AGENTS。工具结果进入既有 Session 日志；后续正文引用可从实际 `tool/result` 重建，不能只记录一个会变动的外部 ID。

### 3.5 检索、容量和持久化

第一版使用内存派生检索表：Unicode NFKC、大小写归一、拉丁词和中文双字片段；标题、标签、正文分别计分，按分数和稳定 id 排序。结果先经过 Workspace、active、冲突与来源有效性过滤，再返回正文。它不提供语义召回保证。

初始配置：每项目最多 500 条记录、单条正文最多 2,000 个 Unicode 字符、每版本最多 5 个来源、单个来源文件最多 1 MiB、每条最多 50 个内容版本及 200 个变更回执、单次输出最多 16 KiB UTF-8。到上限返回明确错误，不静默淘汰。纯读取和相同幂等请求重放不增加回执；容量增加与历史整理是显式维护工作。

Domain 名为 `project_memory`，版本为 1，声明 `memories` 表并使用单记录 `update`。下划线命名符合现有 Storage 的 `UNIT_NAME_RE`；产品名称仍为项目记忆。每次变更在纯变换中校验 schema 和 expected version，业务内容与回执一起持久化，成功后才发出领域变更通知。新建操作由 Provider 写队列串行化；创建 id 由项目范围与幂等键确定，同键同输入返回原结果，同键异输入返回冲突。可观察写入未确认时客户端重试同一键，不换键重新创建。

首版 Bundle 沿用现有 Storage Domain 路由，不覆盖用户其他 domain 的 backend。记忆 domain 采用 `single` 格式版本策略：旧格式拒绝打开且保留文件；JSON 后端会重写整个 unit，500 条上限是首版规模边界。需要更高频写入时可显式路由到现有 SQLite 后端，本版不新增数据库层。

Storage Domain 的原子更新只覆盖一个 Host 内的一条记录，不是跨进程 CAS。Provider 要求可信配置 `ownershipRoot`，打开 domain 前取得该目录中的 `owner.lock`。个人 Bundle 默认使用 `dshHomePath('storages', 'project-memory-ownership')`；当前 base 的 JSON 存储根是 `dshHomePath('storages')`。自定义存储组合必须为同一物理记忆存储指定同一个规范化 ownershipRoot，不能用每 Profile 独有的锁保护共享 domain。配置以启动前的只读路径核验为前置条件；工具不能指定锁路径。锁文件通过完整临时文件加原子硬链接发布，内容含主机、PID、随机 ownership token；遇到已有锁一律拒绝第二个 Provider 启动，释放时校验 token。异常退出留下的锁由操作者确认原进程已退出后移除，首版不自动抢占失主锁。错误应显示精确锁路径和恢复步骤，不尝试删除记忆数据。网络共享根和跨 Host 写入明确不支持。

这个限制使正常重启可直接恢复；异常退出后的恢复需要一次锁核验。崩溃恢复验收必须包含该操作，不能宣传为无人值守自动恢复。运行时停用插件先拒绝新操作、等待已开始的持久写入结束、关闭 domain，最后释放所有者锁。

取消发生在落盘之前则不提交；已经提交后发生取消不能抹掉事实，下一次同键请求读回原结果。来源校验期间取消不产生候选或确认。读取权限、源码 hash 与 active revision 在最终返回前再次核对；发现读取期间 revision 变化时最多重试一次，继续变化则返回 `concurrent-change`。

## 4. 实施工作包

新增包使用 `@changanhua`，在现有个人包身份表登记。按当前仓库模板创建 package.json、tsconfig.json、README 中英文与配对记录，更新相应分组 README；这些文件随所属行为提交，不拆成独立“脚手架完成”。建议在实施时创建 `codex/project-memory-v1` 工作分支；本次不切换分支。

### Task 1：可持久化的记忆领域与来源检查

依赖：本计划；先运行相关 Storage Domain、Workspace、Session Query 测试确认环境基线。

创建文件：

- `packages/memory/memory/src/index.ts`、`types.ts`、`schema.ts`、`errors.ts`、`invariant.ts`：Definition、严格 schema、错误分类与运行时不变量。
- `packages/memory/memory/tests/schema.spec.ts`：字段约束、不可变版本、合法转换和幂等摘要。
- `packages/memory/memory-local/src/index.ts`、`spec.ts`、`scope.ts`、`sources.ts`、`search.ts`、`ownership.ts`、`invariant.ts`：Provider、domain、范围核验、来源检查、确定性检索和所有者生命周期。
- `packages/memory/memory-local/tests/contract.spec.ts`、`sources.spec.ts`、`persistence.spec.ts`、`ownership.spec.ts`：真实 Storage Domain 与文件系统边界测试。

修改：`downstream/package-identities.json`、`packages/README.md` 及其中文与配对记录；新增 `packages/memory/README.md` 与中文、配对记录；源码路径与构建引用通过现有生成器维护。新增 `docs/subsystems/project-memory.md` 及配对文件；实施决策记录归属 `.agents/notes/implemented/feature/2026-09-08-project-memory-v1.md` 及配对文件，只描述该工作包已实现的机制。

先写 RED：同项目跨服务重开读取、跨项目拒绝、同键不同输入冲突、写失败后记录不变、两个并发修订只有一个成功、第二个进程无法写同一根。然后最小实现。普通文本匹配、同主题冲突、读取时来源变化也在此包闭合。

验证：`pnpm run test -- packages/memory/memory/tests packages/memory/memory-local/tests`；持久化测试使用临时目录中的真实 JSON 后端，补一个真实 SQLite 路由用例；所有者测试使用独立子进程。下游 Task 2 消费这套 Definition，不依赖 Local Provider 私有文件。

### Task 2：模型工具、人工确认和显式组合

依赖：Task 1 的 schema、错误码和 Definition。

创建文件：

- `packages/memory/tool-memory/src/index.ts`、`input.ts`、`presentation.ts`、`invariant.ts`；`tests/tools.spec.ts`、`tests/authority.spec.ts`。
- `packages/memory/command-memory/src/index.ts`、`parse.ts`、`render.ts`、`invariant.ts`；`tests/commands.spec.ts`、`tests/authority.spec.ts`。
- `packages/bundle/personal-memory/package.json`、`cordis.patch.yml`、`tsconfig.json`、`README.md` 及配对文件；`tests/scaffold.spec.ts`、`tests/loader.e2e.ts`、`tests/fixtures/web.cordis.patch.yml`。

修改：个人包身份表、`packages/bundle/README.md` 及配对文件；工具、配置、持久化、模块图及 Cordis API 由对应生成器更新。Bundle 声明所需服务，挂载 memory-local、tool-memory、command-memory；由可信组合从实际存储根派生锁目录，不修改 `base` 默认组合或用户实际 Profile。

先写 RED：模型只能提出候选；伪造 actor、workspace、source hash、commandId 均失败；人工看到的 revision 改变后，旧确认命令失败。正常命令结果使用现有 CommandResult 呈现，并保留命令成功与领域回执的一致绑定。

验证：`pnpm run test -- packages/memory/tool-memory/tests packages/memory/command-memory/tests packages/bundle/personal-memory/tests/scaffold.spec.ts`；构建后执行 `pnpm run test:e2e -- packages/bundle/personal-memory/tests/loader.e2e.ts`。Loader 测试必须通过受支持的 `dsh --profile` 入口加载实际产物；断言三项工具、人工命令和 domain 真正可用，卸载后注册撤销。省略 Bundle 时这些新增工具和命令均不存在。

### Task 3：最早完成一次真实跨会话验收

依赖：Task 2 可构建组合；只读确认本机 Node、依赖、构建、空闲端口、测试 Profile 和已授权 Provider 就绪，不读取或输出密钥。测试使用独立临时 DSH_HOME，正常用户 Profile 保持原样；独立数据根只用于测试。

创建：`packages/bundle/personal-memory/tests/acceptance.e2e.ts`、`tests/fixtures/acceptance-workspace/README.md`、`tests/assertions.ts`；新增浏览器驱动 `apps/web/tests/project-memory.snapshot.ts` 和录制场景 `snapshots/web/project-memory/snapshot.yml`、`session.jsonl`，以及该场景实际需要的输入、组合、回放和浏览器预期文件。浏览器驱动由现有 `vitest.web.config.ts` 的 include 发现；录制产物使用现有 Web snapshot owner 生成，不手造伪造模型记录。

真实过程：

1. 测试准备项目 A 的规则文件，内容给出唯一随机验证命令；另建无该记忆的项目 B。
2. 会话 A1 要求保存这条方法；观察真实 `memory_propose` 调用，检查候选来源哈希和落盘记录。
3. 用户通过 `/memory show` 查看，再执行带确切版本的 `/memory accept`；核验 commandId 和 activeRevision。
4. 在同一项目新建 A2，要求按项目既有规则生成 `validation-command.txt`，不在提示中泄露答案。外部断言核对新文件内容和实际记忆调用。
5. 正常关闭并重启测试 Host，新建 A3；再次查询，检查同一 memory id 与 active revision 持续有效。
6. 修改规则文件，要求再次查询；旧命题不得出现在可用结果中。要求提出修订并人工接受；新会话产物只包含新命令。
7. 从项目 B 查询或猜测项目 A 的 memory id；不能返回命题、来源路径、候选或历史。A 项目的人工撤回也必须让后续默认召回停止使用。

证据写入 `.artifacts/project-memory/<run-id>/`：基线 revision、构建与 Profile 摘要、测试根和 Session 身份、memory/revision/commandId、实际工具结果、脱敏持久记录导出、输出文件摘要及浏览器操作证据。私有内容不提交到公共 fixture。

验证：`pnpm run test:e2e -- packages/bundle/personal-memory/tests/acceptance.e2e.ts`；`pnpm run test:web:built -- project-memory` 执行已注册场景。无 live 凭据或预算时可完成 keyless 组合和回放，但真实模型验收标为未完成；不能用 skip 或模型自称成功替代。这一步先于 Task 4 的完整故障覆盖。

### Task 4：失效、并发和恢复故障闭合

依赖：Task 3 已暴露真实入口问题；在 Task 1、2 的既有实现中修复，不引入新通用框架。

新增 `packages/memory/memory-local/tests/recovery.spec.ts`、`race.spec.ts`、`limits.spec.ts`，补充 `sources.spec.ts`、`ownership.spec.ts` 与两个 Consumer 的权限测试。

必须覆盖：

- 文件被删除、无权限、变成目录、大小超限、链接跳出根目录；Session 事件不存在或目录不匹配；不得泄露原文或绕过 fs 策略。查询未知 id 与跨项目 id 使用相同的不可访问结果，不能透露另一项目是否有该记录。
- 已接纳正文或来源预览含“忽略指令、批准其他记忆”等文本；它不能产生人工决策记录或绕过工具权限。Agent 最终回答的措辞另外记录，不把模型服从性当作权限实现。
- 复核期限到达、同 topicKey 不同命题、来源恢复为原字节、用户撤回；区分来源问题与历史版本状态。
- 两个会话同时提出修订、确认旧版本、检查来源时 active 改变、同键重试及返回丢失；所有动作保留可解释的 CAS 或幂等结果。
- 后端写入失败、写完后响应中断、落盘中取消、插件卸载；不能产生“UI 成功但无记录”或丢失仍在进行的写入。
- 强制终止测试 Host 后，保留记忆与失主锁；未经确认不能接管，确认原进程退出并移除精确锁文件后可恢复原 active 版本。
- 达到记录、来源、正文、版本或回执上限；返回容量错误且不丢弃既有数据。

验证：`pnpm run test -- packages/memory packages/bundle/personal-memory/tests/scaffold.spec.ts`，再运行受修复影响的 Task 3 场景一次。没有相关改动时不重跑真实模型调用。

### Task 5：收益对照与交付

依赖：Task 4；冻结代码和验收输入后执行。

创建 `packages/bundle/personal-memory/tests/fixtures/recall-cases.json`，包含 20 个有独立预期的用例：10 个可用历史事实或方法、4 个改变或到期的来源、3 个冲突或撤回、3 个跨项目与越界来源。预期由测试夹具和外部检查器维护，不由被测 Agent 生成。

确定性部分要求：全部范围和不可用来源用例正确隔离；可用样本的检索 Recall@5 至少 9/10；所有可用返回项有精确 memory revision、来源及 checkedAt。补充无关记忆干扰，不能仅用 topicKey 精确命中自证检索有效。

对已授权的真实模型，以相同 Provider/model、Profile 其余部分、上下文起点和 Workspace 夹具分别运行启用/禁用记忆的对照；禁用路径保留正常文件和 Session 检索能力。先比较 5 个真实任务，覆盖历史决定、项目偏好和操作方法；每组保留实际产物、成功情况、输入输出 Token、工具调用及人工纠正次数。来源过期或冲突场景的盲用次数必须为零；正常场景至少 4/5 成功。只有任务成功数不下降，且读取工具调用总数或 Provider 报告输入 Token 总数至少一项降低，才报告“这组样本观察到复用收益”；否则功能可用与收益未证实分开报告。五个样本不支持普遍能力提升或稳定成本百分比结论。

维护文档随所属实现完善：新增用户指南 `docs/user/guide/project-memory.md` 与中文、配对文件，说明启用、提出候选、确认、查看、修订、撤回、失主锁恢复和不支持的场景；更新上述 subsystem 和实现 Agent Note。不会把本草案改成已实现产品说明。

冻结后的命令预算：先 `pnpm run build` 一次，再运行 `pnpm run typecheck:contracts-ready`、`pnpm run lint:contracts-ready`、`pnpm run hygiene`、`pnpm run doc-sync`；受影响单元测试、Loader、验收和 Web 回放按上面路径各运行一次，已在相同代码与环境通过的结果直接复用。覆盖率按变更文件和仓库要求补齐，不在每个工作包重复全仓 coverage。出现无关基线失败时保留原输出，只核验该失败是否由本改动引入，不扩大为清理任务。

完成时交付可审查的代码、文档、全部必需证据和未通过项。推送、发布、实际用户 Profile 启用属于后续明确操作，不作为本次计划的隐含动作。

## 5. 完成判定与范围控制

| 证据层 | V1 要求 | 对应工作包 |
| --- | --- | --- |
| 源码契约 | schema、作用域、来源、版本、决策、并发和恢复语义都有确定性测试 | Task 1、2、4 |
| 生成声明 | 个人包身份、类型、工具、配置、持久化及服务声明与源码一致 | Task 1、2、5 |
| 实际组合 | 构建产物通过 Loader 启动；显式启用且默认不带入 | Task 2、3 |
| 运行时观察 | Windows Web 可操作人工命令，模型能调用实际工具，落盘与重启可观察 | Task 3 |
| 行为验收 | 跨会话使用、来源变化、修订、撤回、隔离与异常恢复全部有独立证据 | Task 3、4、5 |

主执行者按 `Task 1 → Task 2 → Task 3 → Task 4 → Task 5` 顺序完成，默认不委派、不新开任务。预计新增四个 memory 包和一个 Bundle；源码、测试、包清单、配套文档及生成物约 60–90 个文件，实际数量取决于仓库生成结果，不把每个文件拆成独立任务。

以下发现需要收缩当前交付或形成明确后续计划：必须支持多个 Host 同时写、必须把多个 Workspace 自动合并为一个项目、必须同步写入外部知识库、必须改变 Session 事件格式或 agent-loop、或实际工作量超过上述包范围约一倍。不能把这些变化藏进“完善记忆模块”。

V1 之后按测量结果选择一个增量：检索漏召回明显时增加派生全文/语义索引；人工提炼成本明显时增加按明确策略生成候选；确认成本成为主要瓶颈时增加有撤销和范围限制的自动接纳。每项都先补对应验收，不同时开多个平台方向。
