# 任务队列模块（task-queue）设计

> 状态：待用户审阅
> 日期：2026-08-14
> 目标仓库：`changanhua/deepseek-harness`（上游 `deepseek-ai/deepseek-harness`）
> 相关会话决策：形态 = 一个 Host 插件（fork 内一等公民包）；部署 = Linux 常驻服务

## 0. 摘要

给 DSH 增加一个**持久化的通用任务队列**：任何来源（agent 工具调用、JSONL 文件投递）都可以入队任务，宿主进程内的调度器按并发上限、优先级、延迟时间自动消化，任务由可插拔执行器（`claude` / `codex` / `opencode` / `arkcli` / `shell`）运行，产出物落盘到指定目录。队列状态跨会话、跨进程重启存活，失败任务按指数退避自动重试。

典型用法（用户原始诉求）：把"生成知识库、拆解小说"等批量研究任务派给本机 Claude Code CLI 等外部 agent，用满多供应商闲置 API 额度。但模块本身是通用基础设施——批量内容生产、长任务断点续传、定时任务、失败重试都挂在这条流水线上。

**"确保系统合理使用"是设计的一等目标**（见第 8 节）：工具可见性、preset 指令约束、会话开始钩子、调度器自治四条机制共同保证队列不被架设后遗忘。

## 1. 背景与目标

### 1.1 动机

- 用户有多供应商 API 套餐（火山/阿里云/OpenAI/opencodego），额度经常闲置；研究需求多（知识库、小说拆解等批量任务）。
- 现有能力覆盖了"一个长线目标"（goal）、"会话内清单"（todo）、"后台命令"（jobs）、"大规模 fan-out"（workflow），但**没有跨会话的批量任务队列**：`todo_write` 不持久，goal 只追踪单目标，jobs 随进程而逝。
- 队列补的正是这个洞：**一批异构任务、每条各自状态、进程重启不丢、失败自动重试**。

### 1.2 目标 / 非目标

**目标（v1）：**
1. 跨会话持久化：任务状态进程重启后完整恢复，未完成任务自动回队。
2. 批量投递：一次入队多条任务；会话里说一句话，agent 用工具批量写入。
3. 并发上限：全局 + 每执行器两级并发控制，超出排队。
4. 失败重试：指数退避 + 最大次数，耗尽进死信，可手动重试。
5. 定时/延迟：`delayUntil` 支持"明早 9 点跑"。
6. 可插拔执行器：注册表机制，内置 5 个 CLI 适配器，未来可加。
7. 系统合理使用：第 8 节的四条机制，保证 agent 真的会用、用得对。

**非目标（v1 明确不做）：**
- 分布式多机队列（单机单进程）
- 网页面板（Client 插件，未来第二个包的合理候选）
- 任务间依赖 DAG（先做优先级 + 延迟）
- 自动额度均衡路由（用户选择入队时指定执行器；注册表留好接口，未来只是加一个策略函数）
- 周期 cron（`delayUntil` 一次性定时够用；周期任务 v1.1 再议）
- 队列级鉴权/多租户

## 2. 总体架构

```
                         ┌─────────────────────────────────────────────┐
                         │          DSH Host 进程（Linux 常驻）          │
                         │                                             │
  会话内 agent 工具 ───────►  @deepseek-ai/dsh-tool-queue（agent 面工具） │
  JSONL 文件投递 ──────────►  @deepseek-ai/dsh-queue（host 面核心）      │
                         │   ├─ Service: ctx.queue                     │
                         │   ├─ 调度循环（并发/优先级/退避/延迟）        │
                         │   ├─ 持久化：$DSH_HOME/queue/*.jsonl        │
                         │   ├─ 执行器注册表（claude/codex/.../shell）  │
                         │   └─ 事件：queue/*                           │
                         └──────────────┬──────────────────────────────┘
                                        │ spawn 子进程
                                        ▼
                    claude -p / codex exec / opencode / arkcli / shell
                                        │
                                        ▼
                   产出物 → 任务指定 outputDir；运行日志 → runs/<id>/
```

**关键决策（沿袭会话中已确认的结论）：**

| 项 | 决策 |
|---|---|
| 插件数量 | **一个核心包 + 一个工具包**（模块化在接口层：Service/Event/注册表，不在包边界） |
| 所在平面 | 核心服务在 **host 组合**（跨会话共享、常驻）；工具行在 **agent preset** |
| 存储 | `$DSH_HOME/queue/` 下 JSONL 追加写（源真）+ 压缩快照 |
| 持久化语义 | at-least-once（见 4.3 崩溃恢复的取舍说明） |
| 对上游 merge | 每处改动都是单行追加或全新目录，冲突面最小化（见第 9 节） |

## 3. 任务模型与状态机

### 3.1 状态机

```
pending ──领取──► running ──成功──► succeeded
   ▲                 │
   │                 ├──失败(可重试)──► pending（retries+1，退避延迟后）
   │                 │
   │                 ├──失败(耗尽 maxRetries)──► failed（死信，保留 lastError/result）
   │                 │
   │                 └──超时/取消(杀进程树)──► canceled（lastError 记被杀原因）
   │
   ├──取消（仅 pending）──► canceled
   │
   └──── 手动 queue_retry ── failed（重试计数清零，回 pending）
```

- 只有 `pending` 且 `delayUntil <= now` 的任务可被领取。
- `running` 任务崩溃（宿主进程被杀）→ 重启后按心跳/pidfile 恢复（4.2）。
- `failed` 不是终点：可手动 `queue_retry` 重新入队，重试计数清零、退避重置。
- `canceled`：终态。`pending` 可直接取消；`running` 的取消 = 杀进程树后标 `canceled`（`lastError` 记被杀原因）。

### 3.2 任务字段（v1）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | `t-<8位随机>`，唯一 |
| `title` | string | 一句话标题（人读） |
| `prompt` | string | 交给执行器的完整指令 |
| `executor` | string | 注册表名：`claude`/`codex`/`opencode`/`arkcli`/`shell` |
| `status` | enum | `pending`/`running`/`succeeded`/`failed`/`canceled` |
| `priority` | int | 越小越先（默认 10）；仅影响领取顺序，不抢占 running |
| `retries` / `maxRetries` | int | 已重试 / 上限（默认 3） |
| `backoffMs` | int | 退避基数（默认 30s），实际延迟 = `backoffMs * 2^(retries-1)` |
| `delayUntil` | ISO | 定时任务：此时间前不可领取（可选） |
| `timeoutMs` | int | 单次执行超时（默认 30min），超时杀进程树 |
| `outputDir` | string | 产出目录（可选；默认 `$DSH_HOME/queue/output/<id>/`） |
| `tags` | string[] | 可选自由标签，用于 `queue_list` 过滤（如 `["novel", "kb"]`） |
| `createdAt` / `updatedAt` | ISO | 时间戳 |
| `lastError` | string? | 最近失败原因（诊断） |
| `result` | object? | 成功摘要：退出码、产出文件列表、耗时 |
| `enqueuedBy` | string | 来源：会话 id 或 `file`（诊断用） |

运行时字段（不持久化）：`pid`（子进程号）、`heartbeatAt`。

### 3.3 状态机规则（不可违背的三条）

1. **领取唯一性**：只有 `pending` 可领取；同一条任务不会有两个执行者（调度器进程内单线程循环，天然互斥）。
2. **重试退避**：`retries` 每 +1，延迟翻倍，直到 `maxRetries` 才进 `failed`。
3. **失败留痕**：`failed` 保留 `lastError` 与 `result`，供诊断与手动重试。

## 4. 持久化与崩溃恢复

### 4.1 文件布局（`$DSH_HOME/queue/`）

```
queue/
  tasks.jsonl           # 源真：每次状态变更追加一行 {taskId, state, at}
                        # state = 该任务变更后的完整快照
  tasks.archive.jsonl   # 压缩时轮转出的历史行
  index.json            # 物化视图：id → 最新快照；原子写（复用 dsh-atomic-write）
  runs/<taskId>/        # 每次执行的运行日志 run-<n>.log（stdout+stderr 合并）
  output/<taskId>/      # 默认产出目录
```

- **追加写是唯一的变更路径**：调度器内存里持有 `Map<id, task>`，任何状态变化先 `appendFile` 一行完整快照，再更新内存。写失败 → 调度器暂停、stderr 报警、内存状态保留（见 10.3）。
- **index.json 是优化不是依赖**：boot 时若存在且比 tasks.jsonl 新则直接加载，否则全量重放 jsonl 重建。损坏时同样重放。重放规则：同一 id 取时间戳最新的一行。
- **压缩**：当 tasks.jsonl 行数超过阈值（默认 10000）或文件超过 8MB，把当前快照写回新 tasks.jsonl，旧文件轮转为 archive。压缩用 dsh-atomic-write 保证原子性。**压缩与外部文件投递（7.4）的竞态解法**：压缩前先把文件尾部的追加行全部重放进快照，再执行轮转——任何已落盘的行都不会丢。

### 4.2 崩溃场景矩阵

| 场景 | 恢复行为 |
|---|---|
| 任务 pending，进程被杀 | 重启后重放 jsonl，仍 pending，正常被领取 |
| 任务 running，子进程也死了 | 心跳过期 → 状态回 pending，retries+1（消耗一次重试） |
| 任务 running，子进程还活着（孤儿） | pidfile 命中 → 重新附着，tail 其日志继续计时；附着失败则杀之回队 |
| 进程死在 appendFile 半途 | 半行在重放时被丢弃（校验行尾完整 JSON），丢失的是最后一条变更，语义降级为"那次变更没发生"——at-least-once 的可接受面 |

### 4.3 语义取舍（明确记录）

队列采用 **at-least-once**：崩溃窗口内任务可能被执行两次。理由：v1 面向"研究/内容生产"任务，重跑一次的代价远低于实现 exactly-once（两阶段提交/幂等键）的复杂度。缓解：执行器写 `runs/<taskId>/run-<n>.log` 按次递增，重复执行产物可追溯；未来需要时加幂等键字段即可。

## 5. 调度策略

调度循环是宿主进程内的一个 `ctx.setInterval`（间隔 1s，可配），每 tick 执行：

1. **回收**：扫描 `running`，心跳过期（默认 60s 无更新）→ 按 4.2 恢复；超时（`timeoutMs`）→ 杀进程树 → 失败路径。
2. **领取**：从 `pending` 中筛 `delayUntil <= now`，按 `priority` 升序、同优先级 FIFO，逐条领取直到满足：
   - 全局 `running` 数 < `maxConcurrent`（默认 2，可配）；
   - 该执行器 `running` 数 < 执行器并发上限（默认 1，可配）。
3. **执行**：交给注册表对应执行器（第 6 节），spawn 后登记 `pid`/`heartbeatAt`，写日志文件。
4. **结算**：退出码 0 → `succeeded`；非 0 → 可重试则回 `pending`（带退避），否则 `failed`。每次结算发事件（第 7.2 节）。

**明确不做抢占**：priority 只影响领取顺序，不打断 running 任务（v1 取舍，简单可预测）。

## 6. 执行器注册表与 CLI 适配器

### 6.1 注册表接口

```ts
// 核心包导出的注册接口（host 面）
queue.registerExecutor(name, handler: (task, ctx) => ExecutorRun)
// ExecutorRun = { spawn(): {pid, logPath}, wait(pid): Promise<{exitCode, durationMs}> , kill(pid) }
```

任何 host 插件都能注册新执行器——**加执行器不动调度器一行**。

### 6.2 内置 CLI 适配器（v1，命令模板实现时以 `--help` 复核）

| 执行器 | 命令模板 | 备注 |
|---|---|---|
| `claude` | `claude -p <prompt> --output-format json --add-dir <outputDir>` | 允许其写产出目录 |
| `codex` | `codex exec <prompt>` | cwd 设为 outputDir |
| `opencode` | `opencode run <prompt>` | 本机 config 目录有 EEXIST 环境问题，M3 先修 |
| `arkcli` | `arkcli +chat <prompt>` | 走用户 profile |
| `shell` | 任意命令字符串 | 逃生舱，同时是测试用的 `echo` 执行器 |

**通用行为（所有适配器共享）：**
- spawn 平台适配层：Windows 用 shell 包装（`.ps1` shim 必须经 powershell 解析）；Linux 用 detached process group，`kill` 杀整棵树。
- stdout/stderr 合并写入 `runs/<taskId>/run-<n>.log`；退出码为唯一成败判据。
- 子进程 cwd/环境继承宿主；`outputDir` 在执行前 `mkdir -p`。
- **信任边界（写入文档）**：CLI 执行器是独立子进程，**不在 DSH 文件沙箱内**。队列只能靠"prompt 约定 + outputDir 约定"约束其落盘范围；用户入队即授权该执行器以用户权限运行。v1 不做容器化（非目标）。

## 7. 对外接口

### 7.1 Service（host 面，`ctx.queue`）

```
enqueue(spec) → {id}            # 单条入队
enqueueBatch(specs) → {ids}     # 批量入队（上限 200/次，可配）
list(filter?) → TaskSummary[]   # 过滤：status/executor/tags/limit
get(id) → Task
cancel(id) → ok                 # pending 直接取消；running 杀进程树后标 canceled
retry(id) → ok                  # failed → pending（计数清零）
stats() → 各状态计数 + 每执行器计数 + 运行时长
registerExecutor(name, handler)
pause()/resume()                # 暂停/恢复领取（维护窗口用）
```

### 7.2 事件（host 面）

`queue/task-created`、`queue/task-started`、`queue/task-succeeded`、`queue/task-failed`、`queue/task-requeued`、`queue/task-canceled`、`queue/drained`。任何 host 插件可订阅；payload 只含叶子字段（id/status/executor/exitCode）。

### 7.3 工具（agent 面，`@deepseek-ai/dsh-tool-queue` 注册进 preset）

`queue_enqueue` / `queue_enqueue_batch` / `queue_list` / `queue_status` / `queue_cancel` / `queue_retry` / `queue_stats`。

**工具的 description 本身就是"合理使用"的第一道闸门**——每个工具描述里编码使用时机（见 8.1）。

### 7.4 无会话时的投递入口

JSONL 文件投递：向 `$DSH_HOME/queue/tasks.jsonl` 追加 `{taskId, state:{status:"pending", ...完整字段}}` 行即可入队（调度循环 tail 该文件，每 tick 检测追加）。这让"没有活跃会话也能下任务"成为可能，且不增加任何协议成本。

## 8. 确保系统合理使用（一等目标）

用户原始问题的另一半："如何确保系统合理使用这个模块"。四条机制，缺一不可：

### 8.1 工具可见性 + 描述即规范

工具注册进 agent 的 tool 注册表，模型推理时天然可见。每个工具 description 写明**何时该用**：

> `queue_enqueue_batch`：当用户一次给出 ≥3 个独立任务，或任务属于长耗时/需要重试/跨会话类（生成、拆解、批量处理）时，用本工具批量入队，而不是逐个内联执行。

### 8.2 preset 指令约束（fork 拥有 preset → 原生内置）

在 fork 的 `standard` preset（`apps/cli/config/agent-presets/standard/`）加入队列使用规范段落（persona/instructions 文本，约 15 行）：

- 批量任务先入队再汇报队列状态；不重复入队已存在任务（先 `queue_list` 查重）。
- 会话开始调用 `queue_stats` 了解积压；发现 `failed` 主动报告并建议 `queue_retry`。
- 队列由调度器自动消化——agent 的职责是**投递、监控、处置失败、汇报**，不是手动派发。
- 单条、快速、交互式任务走内联，不入队（防止队列被琐碎任务污染）。

### 8.3 会话开始钩子

`dsh-tool-queue` 附带一个薄 context 插件（参照 `dsh-time-context` 先例）：会话开始时若队列非空，向 agent 上下文注入一行摘要（各状态计数）。agent 每次醒来都知道队列在不在干活——**不依赖它记性好**。

### 8.4 调度器自治（兜底）

即使没有任何会话活跃、agent 从不主动查看，host 面的调度循环照常消化队列。**"合理使用"不依赖 agent 记得**——队列是自排干的，agent 只是投递与监督者。这是与"纯 skill 约定"方案的本质区别：约定会忘，机制不会。

## 9. 在 fork 中的落点与上游 merge 策略

### 9.1 新增包（全新目录，上游不可能冲突）

```
packages/queue/queue/       → @deepseek-ai/dsh-queue      （host 面核心：Service/调度/持久化/注册表/CLI 适配器）
packages/queue/tool-queue/  → @deepseek-ai/dsh-tool-queue （agent 面：7 个工具 + 会话钩子）
```

命名与结构完全仿照 `packages/jobs/{jobs,jobs-local,tool-jobs}` 先例。

### 9.2 修改的既有文件（每处一行，冲突 = 一行 keep-both）

| 文件 | 改动 |
|---|---|
| `apps/cli/config/base.cordis.yml` | host 组合加一行 `- id: queue / name: '@deepseek-ai/dsh-queue'`（服务行必须在 host 平面——与 jobs 注册表同理） |
| `apps/cli/package.json` | 声明两个 workspace 依赖（仓库内已交付配置的依赖归属约定，见 `.agents/notes`） |
| `apps/cli/config/agent-presets/standard/agent.cordis.yml` | 加 `tool-queue` 工具行 + context 钩子行 |
| `apps/cli/config/agent-presets/standard/` persona/instructions 文本 | 加 8.2 的使用规范段落 |

### 9.3 merge 上游策略

- 常规同步：`git fetch upstream && git merge upstream/master`；冲突只可能出现在上面 4 个文件的同一行附近，解法恒定：**双方行都保留**（我们加的行与上游改的行不重叠）。
- 兜底（极端情况上游大改 base.cordis.yml）：把我们的行迁到 `$DSH_HOME/config.yaml` 个人 overlay（`dsh --config` 的 Include 补丁机制已存在），零仓库冲突。
- 队列包本身在全新目录 `packages/queue/`，上游除非同名加包，否则永远无冲突。

## 10. 错误处理与边界

1. **执行器缺失**（如 `claude` 不在 PATH）：spawn ENOENT → 立即 failed，`lastError` 写清楚"可执行文件未找到"，**不进重试风暴**（区分配置错误与瞬时错误，前者不重试）。
2. **超时**：杀进程树 → 走失败路径（可重试则回队）。
3. **磁盘写失败**：appendFile 报错 → 调度器暂停 + stderr 报警 + 内存态保留；恢复磁盘后手动 `resume()`。
4. **JSONL 损坏**：重放时丢弃不完整行并告警（4.2）。
5. **重复入队**：不强制幂等；规范层面要求 agent 先 `queue_list` 查重（8.2）。at-least-once 语义已在 4.3 明示。
6. **孤儿进程**：pidfile 附着或杀之（4.2）。
7. **恶意/危险 prompt**：CLI 执行器跑在用户权限下（6.2 信任边界），入队即授权；v1 不设内容闸门（非目标）。

## 11. 测试策略（沿袭仓库 vitest 惯例）

| 层 | 内容 |
|---|---|
| 单元 | 状态机全转移、优先级排序、退避计算、jsonl 重放/压缩/损坏行丢弃 |
| 集成 | 假执行器（`shell` echo）端到端：入队→领取→成功/失败→重试→死信 |
| 崩溃模拟 | 起子进程后杀宿主进程，重启验证 pending 恢复、running 回队、孤儿附着 |
| 并发 | 验证全局/每执行器上限不被突破 |
| 冒烟（手动，标注成本） | 真实 `claude`/`codex`/`arkcli` 各一条最简 prompt（消耗额度，不纳入 CI） |

## 12. 里程碑

| 里程碑 | 内容 | 验收 |
|---|---|---|
| M1 核心骨架 | `packages/queue/queue`：状态机 + JSONL 持久化 + 重放恢复 + 事件 | 单测全绿；杀进程重启后队列完整 |
| M2 调度器 | tick 循环、并发、优先级、退避、`delayUntil`、超时/心跳 | 集成测试全绿 |
| M3 执行器 | `shell` + 4 个 CLI 适配器 + 日志 + pidfile | 手动冒烟：claude 跑通一条 |
| M4 集成 wiring | tool-queue 工具 + 会话钩子 + base.cordis.yml 行 + preset 指令 | 会话内说"帮我做这 5 件事"→ 批量入队并被消化 |
| M5 Linux 部署 | systemd 常驻 + 跨会话断点续传实测 + 文档 | 重启服务器后队列自动续跑 |

## 13. 未来方向（非 v1）

- Client 面板（Slot UI 展示队列状态）——届时才是第二个包的合理理由
- 周期 cron、任务依赖 DAG、自动额度均衡路由、幂等键（exactly-once）
- 队列级限额/审批（危险执行器准入）
