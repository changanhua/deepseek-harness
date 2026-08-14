# 任务队列模块（task-queue）设计 v2

> 状态：待用户审阅（v2：已按 codex CLI 审查意见修订）
> 日期：2026-08-14
> 目标仓库：`changanhua/deepseek-harness`（上游 `deepseek-ai/deepseek-harness`）
> 修订来源：codex CLI 独立审查（HEAD `adfd4d6b6f` 时的文档 v1），全部 P0/P1/P2 意见经逐条仓库验证后吸收

## 0. 摘要

给 DSH 增加一个**跨会话持久化的 host 平面任务队列**（`ctx.taskQueue`）：agent 工具调用或 inbox 文件投递入队，宿主进程内的调度器按并发上限、优先级、延迟时间自动消化，任务由可插拔执行器（`claude` / `codex` / `opencode` / `arkcli` / `shell`）运行，产出物落盘到指定目录。队列状态跨会话、跨进程重启存活，失败任务按指数退避自动重试。

典型用法（用户原始诉求）：把"生成知识库、拆解小说"等批量研究任务派给本机 Claude Code CLI 等外部 agent，用满多供应商闲置 API 额度。模块本身是通用基础设施。

**"确保系统合理使用"是设计目标之一（见第 8 节），但本版修正措辞：机制只能提高采用概率，不承诺保证**——唯一的硬机制是 host 面调度器自治（队列自排干）。

## 1. 背景与动机（v2 修正了对既有能力的描述）

### 1.1 既有能力的准确边界（经仓库验证）

| 既有能力 | 真实语义（v1 文档说错的已纠正） |
|---|---|
| `jobs`（`ctx.jobs`） | **进程内**后台任务注册表（`jobs-local` 为内存实现），进程退出即失；无跨会话持久、无重试 |
| `todo_write` | **持久**（`session.append('todo/write')` 完整快照，可重放），但作用域是单个 agent session，无执行、无重试、无并发、无跨会话可见 |
| goal | **same-session 单目标**，未完成目标阻塞下一目标创建；跨会话 resume 可用但不是任务队列 |
| `schedule` | **会话级持久提醒**（After/At/Every，version-1 change 记录 + flush barrier），触发后注入 agent 上下文——是"提醒"，不是"任务执行流水线" |
| workflow / subagent | 单次编排/委托，无持久队列语义 |

**结论（修正后）**：缺的不是"任何持久化"，而是**一条 host 平面、跨会话、可执行、可重试、有并发上限的批量任务流水线**。job/schedule/todo 各自对，组合起来不等于队列。

### 1.2 目标 / 非目标

**目标（v1）：**
1. 跨会话持久：状态机变更以持久 change 记录为唯一路径，重启后精确重放。
2. 批量投递：agent 工具批量入队 + inbox 目录文件投递（两种入口，一种单写者存储协议，见 §4/§7）。
3. 并发上限：全局 + 每执行器两级。
4. 失败重试：指数退避 + 最大次数，耗尽进死信，可手动重试。
5. 定时/延迟：`delayUntil` 任务级资格门槛（不与 `schedule` 的会话提醒混淆）。
6. 可插拔执行器：注册表 + 5 个 CLI 适配器，全部经 `ctx.subprocess` 运行（§6）。
7. 采用机制：工具可见性 + preset 指令 + pre-step 摘要注入 + 调度器自治（§8，措辞已降级）。

**非目标（v1 明确不做）：**
- 分布式多机队列（单机单进程）
- 网页面板（Client 插件，未来第二个包的候选）
- 任务间依赖 DAG
- 自动额度均衡路由（注册表留接口）
- 周期 cron（`delayUntil` 一次性定时；周期任务未来评估复用 `schedule` 模型）
- 任务执行沙箱化/容器化（信任边界见 §6.3，如实声明）
- 孤儿进程 reattach（v1 只做 kill-or-mark，见 §4.2）

## 2. 总体架构

```
                          ┌──────────────────────────────────────────────┐
                          │          DSH Host 进程（Linux 常驻）           │
  会话内 agent 工具 ────────►  @deepseek-ai/dsh-tool-task-queue（工具+钩子）│
  inbox 目录文件投递 ───────►  @deepseek-ai/dsh-task-queue（contract）      │
                          │    @deepseek-ai/dsh-task-queue-local（backend）│
                          │     ├─ Service: ctx.taskQueue                 │
                          │     ├─ 调度循环（并发/优先级/退避/延迟）        │
                          │     ├─ 单写者 change 日志 + 快照 + fsync       │
                          │     ├─ 执行器注册表（claude/codex/.../shell）  │
                          │     └─ 事件：task-queue/*                     │
                          └───────────────┬──────────────────────────────┘
                                          │ 全部经 ctx.subprocess（树终止/敏感 env 清洗）
                                          ▼
                      claude -p / codex exec / opencode / arkcli / shell
                                          │
                                          ▼
                    产出物 → 任务指定 outputDir；运行日志 → runs/<id>/
```

**命名（v2 修正）**：领域名一律 `task-queue` / `taskQueue`，**不用裸 `queue`**——`packages/client/ui-conversation` 已有会话 transient inbox 的 `queue` 概念（`queue/store.ts`），避免 UI/日志/事件命名冲突。

**包结构（v2 修正，完全仿照 jobs 三包模式）**：

| 包 | 目录 | 职责 |
|---|---|---|
| `@deepseek-ai/dsh-task-queue` | `packages/task-queue/task-queue` | contract：Task 类型、状态机、change 记录 schema、Service 接口 |
| `@deepseek-ai/dsh-task-queue-local` | `packages/task-queue/task-queue-local` | durable backend：单写者日志/快照/inbox 扫描/调度循环/执行器注册表 |
| `@deepseek-ai/dsh-tool-task-queue` | `packages/task-queue/tool-task-queue` | agent 面：7 个工具 + pre-step 摘要钩子 |

**与既有 seam 的关系（v2 新增，回应"为何不并入 jobs"）**：jobs 是**进程内、按 agent session 键控**的注册表，其"随进程而逝"正是队列要消灭的属性；两者作用域不同（jobs = 会话内后台命令，taskQueue = host 平面持久批量流水线），因此独立 Service 是必要的。但执行层不另造轮子：**子进程一律走 `ctx.subprocess`**（§6）。

## 3. 任务模型与状态机（v2 修正矛盾）

### 3.1 状态机（超时归属已修正）

```
pending ──领取──► running ──成功──► succeeded
   ▲                 │
   │                 ├──失败(可重试)──► pending（retries+1，退避延迟后）
   │                 │
   │                 ├──失败(耗尽 maxRetries)──► failed（死信）
   │                 │
   │                 └──超时──► 失败路径（同上：可重试→pending；耗尽→failed）
   │
   ├──取消（pending 或 running，显式用户动作）──► canceled
   │
   └──── 手动 queue_retry ── failed（计数清零，回 pending）
```

**v2 关键修正**：**超时走失败路径，不是 canceled**。canceled 是唯一的显式取消终态；超时/崩溃/非零退出码统一进"失败"语义，由 retry 策略决定去向。

**宿主崩溃（进程被杀）时的 running 任务**：重启时一律按"失败一次"处理——retries+1 后回 `pending`（或耗尽进 `failed`）。**v1 不做孤儿 reattach**（v1 文档此设计无法由字段支撑，已删）：boot 时凭持久化的 run record（含 pid）尽力终止疑似孤儿进程，找不到则发出 `orphan-unknown` 告警（记录泄漏），任务照样回队。at-least-once 语义见 §4.3。

### 3.2 任务字段（v2：运行身份全部持久化）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | `tq-<8位随机>`，唯一 |
| `title` | string | 一句话标题（人读） |
| `prompt` | string | 交给执行器的完整指令 |
| `executor` | string | 注册表名；**执行器需在 host 配置中显式启用（§6.3）** |
| `status` | enum | `pending`/`running`/`succeeded`/`failed`/`canceled` |
| `priority` | int | 越小越先（默认 10）；不抢占 running |
| `retries` / `maxRetries` | int | 已重试 / 上限（默认 3） |
| `backoffMs` | int | 退避基数（默认 30s），延迟 = `backoffMs * 2^(retries-1)` |
| `delayUntil` | ISO | 此时间前不可领取（任务级资格门槛，可选） |
| `timeoutMs` | int | 单次执行超时（默认 30min），超时走失败路径 |
| `outputDir` | string | 产出目录（可选；默认 `$DSH_HOME/task-queue/output/<id>/`） |
| `tags` | string[] | 可选自由标签，`queue_list` 过滤用 |
| `createdAt` / `updatedAt` | ISO | 时间戳（诊断用；**全序依据是 seq，不是时间**，见 §4.1） |
| `lastError` | string? | 最近失败原因 |
| `result` | object? | 成功摘要：退出码、产出文件列表、耗时 |
| `source` | enum | `agent-tool` / `inbox`（授权模型按来源区分，§6.3） |
| `ownerSessionId` | string? | 投递时所在会话（结果投递模型用，§7.4） |

**durable run record（v2 新增，每次 attempt 一条，随 change 记录持久化）**：

| 字段 | 说明 |
|---|---|
| `runId` | `r-<随机>`，唯一标识一次执行 attempt |
| `attempt` | 第几次执行（1 起） |
| `pid` | 子进程 pid（boot 时用于孤儿排查） |
| `startedAt` | 进程启动时间戳 |
| `logPath` | `runs/<taskId>/run-<attempt>.log` |
| `commandFingerprint` | argv 的哈希（诊断与重复检测） |

### 3.3 状态机规则（不可违背）

1. **领取唯一性**：只有 `pending` 且 `delayUntil <= now` 可领取；调度循环单线程，天然互斥。
2. **先持久后动作**：任何状态转移先落 change 记录（含 fsync），成功后才执行副作用（spawn/kill/通知）。**写失败 = 转移未发生**，内存保留旧状态，调度器暂停并告警（§10）。
3. **失败留痕**：`failed` 保留 `lastError`、`result` 与最后一次 run record，供诊断与手动重试。

## 4. 持久化与崩溃恢复（v2 重写协议）

### 4.1 单写者 change 日志（修正多写者竞态）

**v1 文档"外部直接 append 共享 tasks.jsonl"已删除**——外部写者与调度器压缩之间的竞态无法用"重放尾部"闭合。v2 协议：

```
$DSH_HOME/task-queue/
  log.jsonl             # 唯一源真。写者只有调度器（单写者，无锁竞争）
  snapshot.json         # {lastSeq, tasks} 物化快照，加速 boot
  inbox/                # 外部投递入口：每任务一个独立文件（见 §7.3）
  corrupt/              # 坏行隔离区（运营可操作）
  runs/<taskId>/        # 每次执行日志 run-<attempt>.log
  output/<taskId>/      # 默认产出目录
```

**change 记录格式**（借鉴 `schedule` 的 version-1 变更记录模式）：

```jsonc
{ "seq": 41, "version": 1, "op": "created|claimed|succeeded|failed|requeued|canceled|attempt",
  "taskId": "tq-…", "state": { /* op 之后的完整任务快照，含 run record */ }, "at": "ISO" }
```

- **全序依据是 `seq`**（单调递增，快照内持久化 `lastSeq`），`at` 仅诊断；不依赖 wall-clock 排序。
- **追加协议**：open('a') → write → **fsync(file)** → 更新内存 → 发事件。首次创建文件时 fsync 父目录。
- **快照**：定期（行数 > 10000 或文件 > 8MB）与 boot 时生成。用 `writeFileAtomic` 保证 rename 原子性（读者只见旧或新完整内容）；**但 `writeFileAtomic` 明确不保证 crash durability**（源码注释），因此快照写完追加 fsync 文件 + fsync 父目录，并**把 fsync 延迟写入成本记在 §10.5 的取舍里**。
- **重放**：加载 snapshot（若其 lastSeq 与 log 尾部一致则直接信任），否则按 seq 折叠 log 中 seq > lastSeq 的行。行级校验失败（schema 不合法但行尾完整）→ 移入 `corrupt/` 并告警，**不静默丢弃**（运营可恢复）；文件尾半行（崩溃于 write 中途）→ 截断丢弃，该次变更视为未发生（与 §3.3 规则 2 一致）。

### 4.2 崩溃场景矩阵（v2）

| 场景 | 恢复行为 |
|---|---|
| 任务 pending，进程被杀 | 重放后仍 pending，正常被领取 |
| 任务 running，宿主进程被杀 | 重放发现 running → 按失败一次处理：retries+1 回 pending 或进 failed；凭 run record 的 pid 尽力终止疑似孤儿，找不到则 `orphan-unknown` 告警 |
| 任务 running，子进程自然死亡（非零退出） | 正常失败路径（结算时写 change 记录） |
| 进程死在 append 半途 | 半行截断丢弃；该变更未发生（§3.3 规则 2 的持久化保证） |
| snapshot 损坏或缺失 | 从 log 全量重放重建 |
| 孤儿锁文件（`writeFileAtomic` 的 `.lock`） | 其文档明示"孤儿锁恢复是运营动作"：检测到锁超时 → 告警并指引运营处理，不自动猜删 |

### 4.3 语义取舍（明确记录）

**at-least-once**：崩溃窗口内任务可能执行两次（重放发现 running 但子进程实际已完成）。理由：v1 面向内容生产类任务，重跑代价 < exactly-once 复杂度（幂等键/两阶段提交）。缓解：`attempt` 递增 + 每次执行独立 `run-<attempt>.log`，重复执行可追溯；未来需要时加幂等键字段。

## 5. 调度策略

调度循环是 `task-queue-local` 内的 `ctx.setInterval`（1s 可配），每 tick：

1. **扫 inbox**（§7.3）：校验新文件 → 转成 `created` change 记录落 log → 删 inbox 文件（**落 log 成功后才删**，不丢任务）。
2. **回收**：扫描 running——`now - startedAt > timeoutMs` → 经 `ctx.subprocess` 终止（树终止）→ 失败路径；宿主重启路径见 §4.2。
3. **领取**：pending 中筛 `delayUntil <= now`，按 `priority` 升序、同优先级 FIFO，直到：
   - 全局 running 数 < `maxConcurrent`（默认 2，可配）；
   - 该执行器 running 数 < 执行器上限（默认 1，可配）。
4. **执行**：先写 `claimed`+`attempt` change 记录（含 run record，§3.2）→ 再经执行器 spawn。
5. **结算**：退出码 0 → `succeeded`；非 0 / 超时 → 失败路径。每次结算发事件。

**与 `dsh-schedule` 的职责边界（v2 写明）**：`schedule` 是会话级持久提醒（触发后注入 agent 上下文，不执行任务）；`delayUntil` 是队列任务级"何时可领取"的资格门槛。两者不合并：调度器只消费自己的任务，不订阅 schedule。

**不抢占**：priority 只影响领取顺序，不打断 running（v1 取舍）。

## 6. 执行器（v2 重写边界）

### 6.1 注册表接口

```ts
// contract 包导出的注册接口（host 面）
taskQueue.registerExecutor(name, handler: (run, task, ctx) => ExecutorRun)
// ExecutorRun = { spawn(): {pid, startedAt}, wait(pid): Promise<{exitCode, durationMs}>, terminate(pid) }
```

任何 host 插件可注册新执行器——加执行器不动调度器一行。

### 6.2 内置 CLI 适配器（命令模板实现时以 `--help` 复核）

| 执行器 | 命令模板 | 备注 |
|---|---|---|
| `claude` | `claude -p <prompt> --output-format json --add-dir <outputDir>` | 允许其写产出目录 |
| `codex` | `codex exec <prompt>` | cwd = outputDir |
| `opencode` | `opencode run <prompt>` | 本机 config 目录有 EEXIST 环境问题，M3 先修 |
| `arkcli` | `arkcli +chat <prompt>` | 走用户 profile |
| `shell` | argv 数组（**不用 shell 字符串插值**） | 见 §6.3 授权限制 |

**通用行为（v2 修正——不再自研 spawn/kill）：**

- **一律经 `ctx.subprocess`**：它提供跨平台 detached tree 管理、`SIGTERM→grace→SIGKILL` 树终止、整树退出等待、spill 日志。队列不直接调用 `child_process`。
- **环境继承**：使用 subprocess 的默认 env 基（**敏感凭据形变量与 `DSH_*` 默认清洗**，`SENSITIVE_ENV_PATTERN`）；执行器需要的显式凭据必须经配置里的 `env` 白名单传入（合并发生在 scrub 之后）。
- stdout/stderr 写 `runs/<taskId>/run-<attempt>.log`；退出码为唯一成败判据。
- 命令一律 **argv 数组**，无 shell 插值。

### 6.3 授权模型（v2 新增，回应 P0-4）

**"模型调了工具 ≠ 人工授权"。** 分层如下：

1. **执行器启用制**：每个执行器在 host 配置（bundle patch 行 config）里显式 `enabled: true` 才可运行；默认全部禁用。启用 = 运营者（你）对该二进制的授权。
2. **来源限制**：`shell` 执行器**只接受 `source: 'inbox'` 的任务**（运营者投递），**模型工具不得入队 shell 任务**（tool 层直接拒绝）。其余 CLI 执行器对两种来源开放，但仅限已启用者。
3. **信任边界（如实声明，v1 不做沙箱化）**：CLI 子进程以 DSH 宿主用户权限运行，**不受 DSH 文件沙箱约束**。缓解仅限：outputDir 约定 + 启用白名单 + 来源限制。执行器容器化/沙箱化是非目标，文档不粉饰此边界。

## 7. 对外接口

### 7.1 Service（host 面，`ctx.taskQueue`）

```
enqueue(spec, source) → {id}          # source: 'agent-tool' | 'inbox'（影响授权，§6.3）
enqueueBatch(specs, source) → {ids}   # 上限 200/次，可配
list(filter?) → TaskSummary[]         # status/executor/tags/limit
get(id) → Task
cancel(id) → ok                       # pending 直接取消；running 经 subprocess 终止后标 canceled
retry(id) → ok                        # failed → pending（计数清零）
stats() → 各状态计数 + 每执行器计数
registerExecutor(name, handler)
pause()/resume()                      # 维护窗口
```

### 7.2 事件（host 面，v2 更名避免与 UI queue 冲突）

`task-queue/created`、`task-queue/started`、`task-queue/succeeded`、`task-queue/failed`、`task-queue/requeued`、`task-queue/canceled`、`task-queue/drained`、`task-queue/orphan-unknown`。payload 只含叶子字段。

### 7.3 inbox 文件投递（v2 重写协议，替代共享文件 append）

外部投递（无会话时下任务）：

1. 生产者在 `$DSH_HOME/task-queue/inbox/` 写入 `<uuid>.tmp`（独占创建 `wx`），完成后 **rename 为 `<uuid>.json`**——原子现身，无半文件。
2. 每个文件一条任务 spec（与 `enqueue` 同一 schema，严格校验）。
3. 调度器每 tick 扫描、校验、转 `created` change 落 log、**落 log 后才删**文件。
4. 校验失败 → 移入 `corrupt/` 告警，不静默丢。

**多写者安全**：每文件唯一名，生产者在 rename 后不再触碰；log 是单写者。压缩只读 log + 快照，不碰 inbox——竞态面被彻底移除。

### 7.4 结果投递模型（v2 新增）

- 任务终态（succeeded/failed/canceled）时，若 `ownerSessionId` 存在，写一条 `$DSH_HOME/task-queue/notes/<sessionId>/<taskId>.json` 投递通知。
- pre-step 摘要钩子（§8.3）在所属会话活跃时读取 notes 与 stats 注入上下文，并消费已读 notes。
- 无 owner 任务：结果仅存于任务记录 + outputDir，通过 `queue_list`/`queue_status` 查询审计。
- 跨会话完成后归属哪个 session、如何通知，由以上最小模型定义；**不复用 tool-jobs 的 owner wakeup**（那是进程内 jobs 注册表的语义）。

### 7.5 工具（agent 面，`@deepseek-ai/dsh-tool-task-queue`）

`queue_enqueue` / `queue_enqueue_batch` / `queue_list` / `queue_status` / `queue_cancel` / `queue_retry` / `queue_stats`。

- `queue_enqueue*` 强制 `source: 'agent-tool'`，**拒绝 executor: 'shell'**（§6.3）。
- description 编码使用时机（§8.1）。

## 8. 采用机制（v2 措辞降级：提高概率，不承诺保证）

### 8.1 工具可见性 + 描述即规范

工具注册进 tool 注册表，模型可见。description 写明何时该用（批量 ≥3 个独立任务、长耗时、需重试、跨会话类工作 → 入队；单条快速交互 → 内联）。**这是提示层，不是保证层。**

### 8.2 preset 指令约束

fork 的 `standard` preset 加使用规范段落：批量先入队再汇报；会话开始 `queue_stats` 看积压；发现 `failed` 主动报告并建议 `queue_retry`；不重复入队（先 `queue_list` 查重）；agent 职责 = 投递、监控、处置失败、汇报。**同为提示层。**

### 8.3 pre-step 摘要注入（v2 修正挂点，与 time-context 同类）

薄 context 插件，挂 `agent/pre-step` 事件（time-context 的同一挂点）：队列非空且距上次注入超阈值时，注入一行状态摘要 + 当前会话的 notes（§7.4）。agent 每次推理前都可能看到队列状态——**降低遗忘概率**，不保证。

### 8.4 调度器自治（唯一的硬机制）

即使无会话活跃、agent 从不查看，host 面调度循环照常消化队列。**队列自排干是机制保证；其余三条是采用概率的放大器。** v2 措辞：不说"确保系统合理使用"，说"最大化采用概率 + 机制兜底"。

## 9. 在 fork 中的落点与上游 merge 策略（v2 修正真实路径）

### 9.1 新增包（全新目录）

`packages/task-queue/{task-queue, task-queue-local, tool-task-queue}`（§2 表格）。

### 9.2 修改的既有文件（v2 全部改为真实存在的路径）

| 文件 | 改动 | 已验证 |
|---|---|---|
| `packages/bundle/base/cordis.patch.yml` | host 组合加 `task-queue-local` 服务行（`@deepseek-ai/dsh-task-queue-local`，含执行器启用配置）。**v1 写的 `apps/cli/config/base.cordis.yml` 不存在** | 文件存在（当前有本地 WIP 修改，注意与其共存） |
| `packages/bundle/base/package.json` | 声明 workspace 依赖（bundle 是 host 行的依赖归属方） | 存在 |
| `apps/cli/config/agent-presets/standard/agent.cordis.yml` | 加 `tool-task-queue` 工具行 + pre-step 钩子行 | 存在 |
| `apps/cli/config/agent-presets/standard/` persona/instructions 文本 | 加 §8.2 规范段落 | 存在 |

**覆盖机制（v2 修正）**：host 层叠是 `base bundle patch` + profile/home 的 `cordis.patch.yml` + `--patch <path>` overlay（`dsh --profile web --patch ./extra.yml`）。**`--config` 入口不存在**，v1 文档写的 `$DSH_HOME/config.yaml` / `dsh --config` 兜底已删；个人 overlay 的正确路径是 profile 的 `cordis.patch.yml` 或 `--patch`。

### 9.3 merge 上游策略（v2 去绝对化）

- 同步：`git fetch upstream && git merge upstream/master`。冲突面 = §9.2 表格里的 4 个文件各自的新增行；`bundle` 的 patch 文件若上游重排，需按新行序重放我们的行。
- 措辞修正：**不承诺"永远无冲突"**；承诺的是"冲突面小且可机械重放"（我们的改动 = 新目录 + 若干单行追加）。
- 兜底：迁移到 profile/home 的 `cordis.patch.yml` 或 `--patch` overlay，零仓库内文件改动。

## 10. 错误处理与边界（v2 补充）

1. **执行器缺失/未启用**：入队时即拒绝（未启用）；运行时 spawn ENOENT → 立即 failed，`lastError` 写明，**不进重试风暴**（配置错误类不重试，与瞬时失败区分）。
2. **超时**：经 `ctx.subprocess` 树终止 → 失败路径。
3. **append/fsync 失败**：转移未发生（§3.3 规则 2）——内存保留旧状态，调度器暂停 + stderr 告警；恢复后 `resume()`。**语义定死：不存在"内存已变但日志没变"的中间态。**
4. **坏行**：移 `corrupt/` 告警（§4.1）；半行截断。
5. **孤儿进程**：boot 时按持久化 run record 的 pid 尽力终止；未知状态 → `orphan-unknown` 告警 + 任务回队（§4.2）。v1 不 reattach。
6. **孤儿 `.lock` 文件**：告警 + 运营手册处理（`writeFileAtomic` 契约如此）。
7. **重复入队**：不强制幂等；规范层查重（§8.2）+ `commandFingerprint` 供诊断。at-least-once 已明示（§4.3）。
8. **危险任务**：授权模型 §6.3（启用制 + shell 仅 inbox + 信任边界如实声明）。
9. **fsync 成本**：每次状态转移一次 fsync 是刻意的正确性开销；任务级批量吞吐上限由并发数决定而非写入次数，30min 级任务下 fsync 占比可忽略。若未来出现高频短任务，再评估组提交（group commit）优化——记录为已知取舍，不提前实现（YAGNI）。

## 11. 测试策略（v2 增补授权与多写者）

| 层 | 内容 |
|---|---|
| 单元 | 状态机全转移（含超时→失败、取消→canceled）、退避计算、change 记录 schema、seq 全序折叠 |
| 集成（假执行器） | 入队→领取→成功/失败→重试→死信；inbox 投递→落 log→删文件 |
| 崩溃模拟 | 杀宿主进程：pending 恢复、running 回队、孤儿 pid 终止/告警、半行截断 |
| 多写者 | inbox 并发投递（多文件 rename）+ 压缩并存，验证零丢失 |
| 授权 | shell 仅 inbox、未启用执行器拒绝、模型工具无法入队 shell |
| 安全 | 子进程 env 不含 `DSH_*` 与凭据形变量（scrub 断言） |
| 冒烟（手动，标注成本与局限） | 真实 claude/codex/arkcli 各一条最简 prompt；**仅证明该环境可运行，不替代恢复/授权/多写者测试** |

## 12. 里程碑（v2 验收改为可执行证据）

| 里程碑 | 内容 | 验收证据（可执行命令/观察） |
|---|---|---|
| M1 contract+backend | `task-queue` contract + `task-queue-local`：状态机、change 日志、重放、inbox | `pnpm --filter @deepseek-ai/dsh-task-queue-local test` 全绿；手动杀进程后 `queue_list` 完整 |
| M2 调度器 | tick、并发、优先级、退避、`delayUntil`、超时 | 集成测试全绿；并发上限断言测试通过 |
| M3 执行器 | 5 个适配器经 `ctx.subprocess` + run record + 授权模型 | 冒烟：claude 一条跑通；env scrub 断言通过 |
| M4 集成 wiring | 工具 + pre-step 钩子 + bundle patch 行 + preset 指令 | 会话内说"帮我做这 5 件事"→ 批量入队并被消化；`queue_stats` 可见 |
| M5 Linux 部署 | systemd 常驻 + 跨会话断点续传实测 + 文档 | 重启服务器后：pending 续跑、running 回队、notes 投递 |

## 13. 未来方向（非 v1）

- Client 面板（Slot UI）——届时是第二个包的合理理由
- 周期任务（评估复用 `schedule` 的持久记录模型）、任务依赖 DAG、自动额度均衡路由
- 幂等键（exactly-once）、执行器容器化、组提交优化（§10.9）

## 附：v1 → v2 修订清单（回应 codex 审查）

| 审查意见 | 采纳方式 |
|---|---|
| P0-1 状态机矛盾 | §3.1 超时归失败路径，canceled 仅显式取消 |
| P0-2 多写者竞态 | §4/§7.3 删除共享 append，改单写者 log + inbox 文件协议 |
| P0-3 复用 subprocess | §6.2 一律经 `ctx.subprocess`，env scrub 默认 |
| P0-4 授权模型 | §6.3 启用制 + shell 仅 inbox + 来源字段 |
| P1-1 落点错误 | §9.2 改 `bundle/cordis.patch.yml` + `--patch`，删 `--config` |
| P1-2 jobs seam | §2 写明两作用域差异与"独立 Service 必要、执行层复用" |
| P1-3 schedule 模式 | §4.1 change 记录 + version + flush 语义 |
| P1-4 envelope/全序 | §4.1 seq 全序、version、corrupt 隔离 |
| P1-5 结果投递 | §7.4 notes 投递模型 |
| P2-1 措辞降级 | §8 全节改写 |
| P2-2 命名冲突 | 全部改 `task-queue`/`taskQueue` |
| P2-3 绝对措辞 | §9.3 去绝对化 |
| P2-4 验收标准 | §12 可执行证据 |
