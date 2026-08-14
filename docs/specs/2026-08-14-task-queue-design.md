# 任务队列模块（task-queue）设计 v3

> 状态：待用户审阅（v3：已按 codex CLI 两轮审查修订）
> 日期：2026-08-14
> 目标仓库：`changanhua/deepseek-harness`（上游 `deepseek-ai/deepseek-harness`）
> 修订来源：codex CLI 独立审查两轮（v1@`adfd4d6b6f`、v2@`55771d6095`），全部 P0/P1/P2 意见经逐条仓库验证后吸收

## 0. 摘要

给 DSH 增加一个**跨会话持久化的 host 平面任务队列**（`ctx.taskQueue`）：agent 工具调用或 inbox 文件投递入队，宿主进程内的调度器按并发上限、优先级、延迟时间自动消化，任务由可插拔执行器（`claude` / `codex` / `opencode` / `arkcli` / `shell`）运行，产出物落盘到指定目录。队列状态跨会话、跨进程重启存活，失败任务按指数退避自动重试。

**v3 的核心修正（回应第二轮审查的元问题）**：持久状态与不可逆副作用**不再是文档里的一句"先持久后副作用"**，而是被分解为两阶段状态机（starting/running、stopping/canceled）、单一 mutation FIFO、提交不确定时的 faulted 协议、receipt 幂等 admission 与 durable notification outbox（§3/§4/§7）。

## 1. 背景与动机

### 1.1 既有能力的准确边界（经仓库验证）

| 既有能力 | 真实语义 |
|---|---|
| `jobs`（`ctx.jobs`） | **进程内**后台任务注册表（`jobs-local` 内存实现），进程退出即失；状态含 `stopping` 中间态 |
| `todo_write` | **持久**（`session.append('todo/write')` 完整快照），但作用域是单个 agent session，无执行/重试/并发 |
| goal | **same-session 单目标**，未完成目标阻塞下一目标 |
| `schedule` | **会话级持久提醒**（After/At/Every，version-1 change 记录 + flush barrier），是提醒不是执行流水线 |
| workflow / subagent | 单次编排/委托，无持久队列语义 |

**结论**：缺的是**一条 host 平面、跨会话、可执行、可重试、有并发上限的批量任务流水线**。

### 1.2 目标 / 非目标

**目标（v1）：** 跨会话持久、批量投递（工具 + inbox）、两级并发上限、指数退避重试、`delayUntil` 延迟、可插拔执行器（经 `ctx.subprocess`）、采用机制（§8）。

**非目标（v1）：** 分布式多机队列；网页面板；任务依赖 DAG；自动额度均衡路由；周期 cron；执行器容器化；**exec 前发布进程身份的 spawn wrapper**（v1 明确接受无 pid 孤儿窗口，§3.2）。

## 2. 总体架构

```
                          ┌──────────────────────────────────────────────┐
                          │          DSH Host 进程（Linux 常驻）           │
  会话内 agent 工具 ────────►  @deepseek-ai/dsh-tool-task-queue（工具+钩子）│
  inbox 目录文件投递 ───────►  @deepseek-ai/dsh-task-queue（contract）      │
                          │    @deepseek-ai/dsh-task-queue-local（backend）│
                          │     ├─ Service: ctx.taskQueue                 │
                          │     ├─ mutation FIFO（§4.2）                  │
                          │     ├─ 调度循环（并发/优先级/退避/延迟）        │
                          │     ├─ 单写者 segment 日志 + 快照（§4.1）      │
                          │     ├─ 执行器注册表（prepare-only，§6）        │
                          │     └─ 事件：task-queue/*                     │
                          └───────────────┬──────────────────────────────┘
                                          │ 唯一 spawn 点：ctx.subprocess
                                          ▼
                      claude -p / codex exec / opencode / arkcli / shell
                                          │
                                          ▼
                    产出物 → outputDir；运行日志 → runs/<id>/run-<attempt>.log
```

**命名**：领域名一律 `task-queue` / `taskQueue` / `task_queue_*`，**不用裸 `queue`**（`ui-conversation` 已有会话 inbox 的 `queue` 概念）。

**包结构（仿 jobs 三包模式）**：

| 包 | 目录 | 职责 |
|---|---|---|
| `@deepseek-ai/dsh-task-queue` | `packages/task-queue/task-queue` | contract：Task 类型、状态机、change 记录 schema、Service 接口 |
| `@deepseek-ai/dsh-task-queue-local` | `packages/task-queue/task-queue-local` | durable backend：segment 日志/快照/inbox 扫描/FIFO/调度/注册表 |
| `@deepseek-ai/dsh-tool-task-queue` | `packages/task-queue/tool-task-queue` | agent 面：7 个工具 + pre-step 摘要钩子 + system-prompt section |

**与既有 seam 的关系**：jobs 是进程内、按 agent session 键控的注册表——"随进程而逝"正是队列要消灭的属性，独立 Service 必要。执行层不另造轮子：**spawn/terminate/waitForExit 唯一归 `ctx.subprocess`，执行器适配器只产 spawn spec**（§6）。

## 3. 任务模型与状态机（v3：两阶段副作用状态机）

### 3.1 状态机（含副作用中间态）

```
pending ──领取──► starting ──spawn──► running ──成功──► succeeded
   ▲                                    │
   │                                    ├──失败(可重试)──► pending（attempt+1，退避延迟后）
   │                                    │
   │                                    ├──失败(耗尽 maxAttempts)──► failed
   │                                    │
   │                                    └──超时(abort→树终止)──► 失败路径（同上）
   │
   ├──取消（pending）──► canceled
   │
   ├──取消（starting/running）──► stopping ──terminate+waitForExit──► canceled
   │
   └──── 手动 task_queue_retry ── failed（attempt 清零，回 pending）
```

**两阶段副作用状态（v3 新增，回应"pid 不可能在 spawn 前持久化"）**：

| 转移 | 持久化内容 | 副作用 | 崩溃窗口与处理 |
|---|---|---|---|
| pending → `starting` | attempt、runId、logPath、commandFingerprint、plannedStartedAt（**无 pid**） | 无 | 重启见 starting 且无 running 记录 → 按失败一次处理（回 pending），**同时记录 `orphan-unknown` 风险**：spawn 可能已发生但 pid 未及持久化，可能留下未知孤儿（v1 明确接受此窗口，见 §4.3） |
| `starting` → `running` | **pid**、actualStartedAt | spawn（唯一副作用点） | running 已持久 → 重启凭 pid 做 best-effort 孤儿终止（§10.5） |
| running → `stopping` | 取消意图 | 无 | 重启见 stopping → 继续终止路径（凭已持久 pid）→ canceled |
| stopping → `canceled` | 终态 | terminate + waitForExit（幂等） | 终止与结算解耦：先写意图再杀，崩溃后重放意图继续杀 |

**规则（v3）**：
1. **领取唯一性**：只有 `pending` 且 `delayUntil <= now` 可领取；调度循环单线程。
2. **意图先行**：任何不可逆副作用（spawn/terminate）之前，先持久化其意图状态（starting/stopping）。副作用本身可能重复执行，但状态机保证转移有据可查。
3. **结算单写**：succeeded/failed/canceled 只能由 mutation FIFO（§4.2）在副作用完成后写入；失败留痕（lastError、result、run record）。

### 3.2 任务字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | `tq-<8位随机>` |
| `title` | string | 一句话标题 |
| `prompt` | string | 交给执行器的完整指令 |
| `executor` | string | 注册表名；需 host 配置显式启用（§6.3） |
| `status` | enum | `pending`/`starting`/`running`/`stopping`/`succeeded`/`failed`/`canceled` |
| `priority` | int | 越小越先（默认 10）；不抢占 |
| `attempt` / `maxAttempts` | int | **已执行次数 / 总执行上限（默认 3）**。`maxAttempts=3` 示例序列：执行①失败→退避→执行②失败→退避→执行③失败→`failed`。首次执行即 attempt=1；退避延迟 = `backoffMs * 2^(attempt-1)` |
| `backoffMs` | int | 退避基数（默认 30s） |
| `delayUntil` | ISO | 此时间前不可领取（可选） |
| `timeoutMs` | int | 单次执行超时（默认 30min）→ abort 信号 → 失败路径 |
| `outputDir` | string | 产出目录（可选；默认 `$DSH_HOME/task-queue/output/<id>/`） |
| `tags` | string[] | `task_queue_list` 过滤用 |
| `createdAt` / `updatedAt` | ISO | 诊断用；**全序依据是 seq** |
| `lastError` | string? | 最近失败原因 |
| `result` | object? | 成功摘要 |
| `ownerSessionId` | string? | 结果投递用（§7.4；落盘前 **encodeSegment**，§9.4） |
| `receiptId` | string | 幂等 admission 键（§7.3；inbox = 文件 UUID，工具 = 可选 idempotencyKey） |
| `notification` | enum? | `pending`/`acknowledged`（仅终态任务，§7.4） |

**durable run record（每次 attempt 一条，随 change 记录持久化）**：`runId`、`attempt`、`pid`（starting 时为 null）、`startedAt`、`logPath`、`commandFingerprint`。

### 3.3 状态机规则（不可违背）

1. 领取唯一性（§3.1 规则 1）。
2. 意图先行（§3.1 规则 2）——副作用前必有持久化意图，副作用可重放。
3. 结算单写（§3.1 规则 3）——所有 mutation 走 §4.2 FIFO。

## 4. 持久化与崩溃恢复（v3：segment + FIFO + faulted 协议）

### 4.1 单写者 segment 日志（v3 明确轮转协议）

```
$DSH_HOME/task-queue/            # 根目录 0o700（prompt/结果属用户私有数据）
  active.jsonl                   # 活跃写段（唯一可追加段，写者只有 scheduler）
  segments/000001-000100.jsonl   # 不可变已封段（文件名 = 首尾 seq）
  snapshot.json                  # {lastSeq, baseSegment?, tasks} 物化快照
  inbox/                         # 外部投递入口（0o700，§7.3）
  quarantine/                    # 运营隔离区（运行时只读入，不写入坏段）
  runs/<taskId>/                 # 每次执行日志 run-<attempt>.log
  output/<taskId>/               # 默认产出目录
```

**change 记录格式**（借鉴 `schedule` 的 version-1 变更记录模式）：

```jsonc
{ "seq": 41, "version": 1, "op": "created|starting|running|stopping|succeeded|failed|requeued|canceled|notified",
  "taskId": "tq-…", "state": { /* op 之后完整任务快照，含 run record */ }, "at": "ISO" }
```

- **全序依据 `seq`**（单调递增，`snapshot.json` 持久 `lastSeq`），`at` 仅诊断。
- **追加协议**：open('a') → write → **fsync(file)** → 更新内存 → 发事件；首次创建时 fsync 父目录。
- **轮转协议（v3 新增）**：active 行数 > 10000 或 > 8MB 时：
  1. fsync(active) → rename 为 `segments/<firstSeq>-<lastSeq>.jsonl` → fsync(segments 目录)；
  2. 创建新 active（fsync 新文件 + 目录）；
  3. 最后更新 `snapshot.json`（`writeFileAtomic` + fsync 文件 + fsync 父目录；**`writeFileAtomic` 不保证 crash durability，fsync 由我们补**）。
  发布顺序保证：snapshot 永远只引用已封段 + active；任一步崩溃后重放均收敛（snapshot 与 segments 可从 active 尾部增量重放）。
- **快照是缓存**：boot 时 snapshot 的 lastSeq 与 active 尾部一致则信任；否则从 baseSegment 起折叠重放（按 seq 序）。
- **损坏处理（v3 修正，fail-closed）**：重放遇到完整但非法的行 → **直接 faulted**（同 `schedule` 对 corrupt durable stream 的做法：`runtime.ts` 折叠失败即 `faulted=true`），告警并停调；**运行时不得自行跳过坏行**（跳过一个 change 会让后续 seq 建在错误状态上）。恢复是运营动作：把坏段复制到 `quarantine/`、显式重写后重启。文件尾半行（崩溃于 write 中途）→ 截断丢弃，该变更视为未发生（与 §4.2 faulted 判定衔接）。
- **v3 删除 v2 的"孤儿 `.lock`"场景**：`writeFileAtomic` 不产生 `.lock`（只有显式 `withFileLock` 才有）；本设计 snapshot/active 均为单写者，不使用 `withFileLock`，无孤儿锁问题。

### 4.2 mutation FIFO 与提交不确定协议（v3 新增，回应 P0-2）

**所有 mutation 串行**：enqueue、batch、inbox import、结算（succeeded/failed/canceled/requeued）、cancel 意图、retry、notification ack——全部进入**一个服务级 FIFO**（仿 `schedule` 的 `runScheduleTransaction`，按 service 实例键控）。多个 agent 并发 enqueue、子进程完成回调、scheduler tick 产生的 append 由此串行化。

**append/fsync 失败 ≠ 转移未发生**（v2 该断言在文件系统语义上不成立——write 可能已把完整行交给内核而 fsync 报错，或调用方看到错误但重启后记录实际存在）。协议：

1. FIFO 内 mutation 的 append/fsync 抛错 → 队列进入 **`faulted`**；
2. 拒绝新 mutation（enqueue/cancel/retry 返回 faulted 错误），调度器停转；
3. **判定**：关闭并重读 active 日志，折叠到 lastSeq，按 seq 检查该 change 是否已提交：
   - 已提交 → 重放该 change，内存与其一致，退出 faulted 继续；
   - 未提交且行尾完整 → 该转移确实未发生，退出 faulted 继续；
   - **无法判定**（日志不可读/行损坏）→ 保持 fail-closed，要求重启或运营恢复，**不自动 `resume()`**。
4. 半行截断情形复用第 3 步判定（截断 = 未提交）。

### 4.3 崩溃场景矩阵与语义取舍（v3）

| 场景 | 恢复行为 |
|---|---|
| pending，进程被杀 | 重放后仍 pending |
| starting，进程被杀 | 无 pid → 按失败一次处理（回 pending），发 `orphan-unknown` 风险告警 |
| running，宿主进程被杀 | 凭持久化 pid best-effort 终止孤儿（§10.5），任务按失败一次处理 |
| stopping，宿主进程被杀 | 重放取消意图 → 继续 terminate → canceled |
| spawned 子进程自然失败 | 正常失败路径 |
| active 半行 | 截断丢弃；faulted 判定协议收尾（§4.2） |
| 非法完整行 | fail-closed，运营 quarantine 恢复（§4.1） |

**at-least-once**：崩溃窗口内任务可能执行两次（starting→spawn→running 之间崩溃：spawn 可能已发生，任务回队重跑，同时留下未知孤儿）。理由：内容生产类任务重跑代价 < exactly-once 复杂度。缓解：attempt 递增 + 独立 `run-<attempt>.log` + `orphan-unknown` 告警可追溯。**v1 明确接受无 pid 孤儿窗口**（exec 前发布进程身份的 wrapper 列为非目标）。

## 5. 调度策略

调度循环是 `task-queue-local` 内的 `ctx.setInterval`（1s 可配），每 tick：

1. **扫 inbox**（§7.3）：校验 → 以 receiptId 幂等检查 → FIFO 写 `created` → 成功后删文件。
2. **回收**：running 超时（`now - startedAt > timeoutMs`）→ 触发 subprocess 的 abort 信号（`SubprocessSpawnSpec.signal`，spawn 时由 scheduler 注入 `AbortSignal.timeout(timeoutMs)`）→ 树终止 → 失败路径；starting 超时（spawn 未返回）同理。
3. **领取**：pending 筛 `delayUntil <= now`，按 priority 升序、同优先级 FIFO，直到全局 running+starting 数 < `maxConcurrent`（默认 2）且该执行器数 < 执行器上限（默认 1）。
4. **执行**：FIFO 写 `starting`（run record 无 pid）→ `ctx.subprocess.spawn(spec)` → FIFO 写 `running`（pid）。
5. **结算**：`SubprocessOutcome.exitCode === 0` → `succeeded`；非 0/超时/信号 → 失败路径（attempt+1 回 pending 或进 failed）。

**与 `dsh-schedule` 的职责边界**：schedule 是会话级持久提醒（触发后注入上下文，不执行任务）；`delayUntil` 是任务级"何时可领取"资格门槛。两者不合并。

**不抢占**：priority 只影响领取顺序。

## 6. 执行器（v3：prepare-only 接口，spawn 唯一归 scheduler）

### 6.1 注册表接口（v3 修正——适配器不再持有生命周期）

```ts
// contract 包导出（host 面）
taskQueue.registerExecutor(name, adapter: {
  prepare(task, run): Promise<SubprocessSpawnSpec>   // 只产 spec，不碰 child_process
})
```

- **scheduler 唯一调用** `ctx.subprocess.spawn()`，唯一持有 `SubprocessHandle`，唯一负责：注入 `AbortSignal.timeout(timeoutMs)`、terminate、waitForExit、结算。
- 第三方执行器**没有** spawn/kill 入口，绕不过 `ctx.subprocess`——v2 的 `{spawn(), wait(), terminate()}` 接口已删。

### 6.2 内置 CLI 适配器（prepare 产出的 spec 要点）

| 执行器 | argv 模板（实现时以 `--help` 复核） | 备注 |
|---|---|---|
| `claude` | `claude -p <prompt> --output-format json --add-dir <outputDir>` | |
| `codex` | `codex exec <prompt>` | cwd = outputDir |
| `opencode` | `opencode run <prompt>` | 本机 config EEXIST 问题，M3 先修 |
| `arkcli` | `arkcli +chat <prompt>` | 走用户 profile |
| `shell` | argv 数组（无 shell 插值） | §6.3 授权限制 |

**通用行为：**
- spec 的 `env`：默认不传（subprocess 服务的 scrub 后环境）；执行器需要显式凭据 → host 配置 `env` 白名单传入（合并发生在 scrub 之后）。
- spec 的 `stdio`：stdout/stderr 用 `SubprocessCollect`（带 spill 配置，内存有界）——**subprocess 服务不会自动合并写文件**（v2 隐含假设不成立）。
- **运行日志（v3 定义）**：结算后由 scheduler 从 collected reader（`readFrom(0)`）读取，**先 stdout 后 stderr、各带标记头**写入 `runs/<taskId>/run-<attempt>.log`。**明确声明**：不保留 stdout/stderr 时间交错序；背压由 collect 的内存上限 + spill 处理；**日志写失败仅告警不影响任务结算**（日志是诊断产物，非持久事实源）。
- 命令一律 argv 数组，无 shell 插值。

### 6.3 授权模型

1. **执行器启用制**：host 配置（bundle patch 行 config）显式 `enabled: true` 才可运行；默认全禁。启用 = 运营者对该二进制的授权。
2. **来源限制**：`shell` 只接受 inbox 来源任务；**模型工具不得入队 shell**（工具层直接拒绝）。
3. **信任边界（如实声明，v1 不做沙箱化）**：CLI 子进程以 DSH 宿主用户权限运行，不受 DSH 文件沙箱约束。缓解：outputDir 约定 + 启用白名单 + 来源限制 + scrub 后环境。

## 7. 对外接口

### 7.1 Service（host 面，`ctx.taskQueue`，v3 可信入口拆分）

```
// 可信入口（source 由入口代码赋值，不接受调用方传 source）
enqueueFromTool(spec) → {id}            # 拒绝 executor:'shell'；可选 spec.idempotencyKey
enqueueBatchFromTool(specs) → {ids}     # 上限 200/次
// inbox 由 scheduler 内部扫描调用，不对外
list(filter?) → TaskSummary[]           # status/executor/tags/limit
get(id) → Task
cancel(id) → ok                         # pending→canceled；starting/running→stopping 意图
retry(id) → ok                          # failed → pending（attempt 清零）
stats() → 各状态计数 + 每执行器计数
registerExecutor(name, adapter)
pause()/resume()
```

### 7.2 事件（host 面）

`task-queue/created`、`task-queue/started`、`task-queue/succeeded`、`task-queue/failed`、`task-queue/requeued`、`task-queue/canceled`、`task-queue/drained`、`task-queue/orphan-unknown`、`task-queue/faulted`。payload 只含叶子字段。

### 7.3 inbox 幂等 admission（v3 修正重复入队窗口）

**producer 协议（防半文件 + power-loss durable）**：
1. 写 `inbox/<uuid>.tmp`（独占 `wx`）→ **fsync(tmp)** → rename 为 `<uuid>.json` → **fsync(inbox 目录)**。仅 rename 原子可见 ≠ power-loss durable，两个 fsync 是协议的组成部分。
2. 文件内容 = 一条任务 spec（同 `enqueueFromTool` schema，严格校验）。

**scheduler 幂等 admission（v3 修正"落 log 后、删除前崩溃 → 重复创建"）**：
1. 每 tick 扫描 inbox；
2. **receiptId = 文件 UUID**；FIFO 写 `created` change 时**同时持久化 receiptId**；
3. 重扫时若该 receiptId 已提交 → **只补删 inbox 文件，不再创建任务**；
4. `created` 提交成功后删除 inbox 文件。
工具入口的 `idempotencyKey` 同机制（已提交则返回既有 task id）。

### 7.4 durable notification outbox（v3 重写，notes 降级为可重建投影）

**事实源 = change 日志，note 文件只是物化投影**：

1. 任务进入终态（succeeded/failed/canceled）时，同一终态 change 内写 `notification: 'pending'`（若 `ownerSessionId` 存在）。
2. 可重建投影：backend 可从日志重建"待通知集合"；`notes/` 目录（若实现）只是加速缓存，**丢失可重建，不作为事实源**。
3. pre-step 钩子（§8.3）：读取该会话 pending 通知 → 注入 agent 上下文 → **等待 session persistence flush 完成**（注入消息已进会话事件日志）→ FIFO 写 `notified` change（`notification: 'acknowledged'`）。
4. **崩溃窗口语义（v3 明确）**：
   - 终态已提交、注入未发生 → 重启后 pending 集合从日志重建，通知不丢；
   - 已注入、ack 未提交 → at-least-once：下次重注入（可能重复，**不静默丢失**）；
   - ack 已提交但注入消息未持久 → 不可能：ack 在 session flush 之后才写。
5. 无 owner 任务：无通知，结果存任务记录 + outputDir，经 `task_queue_list` 审计。

### 7.5 工具（agent 面，`@deepseek-ai/dsh-tool-task-queue`，v3 改名）

`task_queue_enqueue` / `task_queue_enqueue_batch` / `task_queue_list` / `task_queue_status` / `task_queue_cancel` / `task_queue_retry` / `task_queue_stats`。

- 全部经 `enqueueFromTool*` 可信入口；**拒绝 executor: 'shell'**；`maxAttempts` 语义写入 description。
- 工具插件通过 **`ctx.systemPrompt.section()`** 注册使用规范段落（同 `tool-jobs` 先例，name `tool:task-queue`，order 参考 jobs 之后）——**不修改不存在的 persona/instructions 文本文件**（v2 该落点错误）。

## 8. 采用机制（v3 沿用 v2 措辞：提高概率，不承诺保证）

1. **工具可见性**：description 编码使用时机（批量 ≥3 个独立任务、长耗时、需重试、跨会话 → 入队；单条快速交互 → 内联）。
2. **system-prompt section**（§7.5）：批量先入队再汇报；会话开始 `task_queue_stats` 看积压；发现 failed 主动报告并建议 `task_queue_retry`；不重复入队（先 list 查重）；agent 职责 = 投递、监控、处置失败、汇报。
3. **pre-step 摘要注入**：薄 context 插件挂 `agent/pre-step`（同 time-context 挂点），队列非空且距上次注入超阈值时注入一行状态摘要 + 本会话 pending 通知（§7.4）。
4. **调度器自治（唯一硬机制）**：无会话活跃时 host 面调度循环照常消化队列。前三条是采用概率放大器，本条是机制兜底。

## 9. 在 fork 中的落点（v3 修正完整 wiring 清单）

### 9.1 新增包（全新目录）

`packages/task-queue/{task-queue, task-queue-local, tool-task-queue}`（§2 表格）。

### 9.2 修改的既有文件（v3 完整清单，含依赖归属）

**挂载模式（v3 修正）**：照 `tool-jobs` 既有模式——base bundle 挂 model-facing 工具，web overlay 禁用，standard preset 为 Web agent 重挂。

| 文件 | 改动 | 已验证 |
|---|---|---|
| `packages/bundle/base/cordis.patch.yml` | ① host 面服务行 `task-queue-local`（含执行器启用配置）② 工具行 `tool-task-queue`（供 TUI 等非 web 面） | 存在（当前有本地 WIP 改动，注意共存） |
| `packages/bundle/base/package.json` | 声明 `task-queue`、`task-queue-local`、`tool-task-queue` workspace 依赖 | 存在 |
| `packages/bundle/web-app/cordis.patch.yml` | `tool-task-queue` 行 `disabled: true`（web 由 preset 重挂，同 tool-jobs 模式） | 存在 |
| `apps/cli/config/agent-presets/standard/agent.cordis.yml` | 加 `tool-task-queue` 工具行 + pre-step 钩子行 | 存在 |
| `apps/cli/package.json` | **声明 `tool-task-queue` 依赖**（preset 文件属于 apps/cli，其引用的包须可从 CLI 依赖解析——同 `tool-jobs` 在 73 行的先例） | 存在，v2 漏此项 |
| `pnpm-lock.yaml` | 由 `pnpm install` 自动更新（不手改） | — |

**覆盖机制**：host 层叠 = `base bundle patch` + profile/home 的 `cordis.patch.yml` + `--patch <path>` overlay（`dsh --profile web --patch ./extra.yml`）。**`--config` 入口不存在**。

### 9.3 merge 上游策略

- 同步：`git fetch upstream && git merge upstream/master`。冲突面 = §9.2 表内文件的新增行；bundle patch 若上游重排，按新行序重放。
- 措辞：不承诺"永远无冲突"，承诺"冲突面小且可机械重放"。
- 兜底：迁移到 profile/home `cordis.patch.yml` 或 `--patch` overlay，零仓库内改动。

### 9.4 路径与权限（v3 新增）

- **路径安全**：`ownerSessionId`、taskId、receiptId 进入路径前一律 `encodeSegment`（`session-persistence-jsonl/src/format.ts`，防 `../`/绝对路径/NUL/分隔符；SessionId 是未验证 branded string）。
- **目录权限**：`task-queue/` 根、`inbox/`、`notes/`（若实现）、`runs/`、`output/` 均 0o700（prompt 与结果属用户私有数据）；`active.jsonl`、`segments/`、`snapshot.json` 0o600。
- **`source` 赋值**：只能由入口代码（enqueueFromTool / inbox 扫描）赋值，**任何调用方不得从 spec 传入**；Service 拆可信入口（§7.1）后，普通调用方拿不到 inbox 权限。

## 10. 错误处理与边界（v3）

1. **执行器缺失/未启用**：入队即拒（未启用）；spawn ENOENT → 立即 failed，不进重试风暴（配置错误类不重试）。
2. **超时**：`AbortSignal.timeout(timeoutMs)` 注入 spawn spec → subprocess 树终止 → 失败路径。
3. **append/fsync 错误**：§4.2 faulted 协议——进入 faulted、拒绝新 mutation、重读日志判定提交结果；**无法判定则 fail-closed，绝不自动 resume**。
4. **坏行**：完整非法行 → faulted + 运营 quarantine 恢复；半行 → 截断 + §4.2 判定。
5. **孤儿进程**：running 已持久 → boot 时凭 pid best-effort 终止（POSIX kill 进程组 / Windows taskkill /T；这是**唯一**绕开 `ctx.subprocess` 的窄工具，因为 subprocess 无法管理跨重启进程，如实声明）；starting 无 pid → `orphan-unknown` 告警 + 任务回队。
6. **重复入队**：receiptId/idempotencyKey 幂等（§7.3）；at-least-once 语义已明示（§4.3）。
7. **危险任务**：授权模型 §6.3。
8. **fsync 成本**：每次状态转移一次 fsync 是刻意开销；30min 级任务下占比可忽略；高频短任务再评估组提交（记录为已知取舍，YAGNI 不提前实现）。

## 11. 测试策略（v3）

| 层 | 内容 |
|---|---|
| 单元 | 状态机全转移（starting→running 两阶段、stopping 取消路径、超时→失败）、退避序列（maxAttempts 语义）、change schema、seq 折叠 |
| 集成（假执行器） | 入队→starting→running→结算全链路；inbox 投递→receipt 幂等→删除 |
| 崩溃模拟 | 杀宿主进程于：pending/starting/running/stopping/active 半行 各点 → 验证恢复矩阵 §4.3 |
| faulted 协议 | 注入 append 失败 → 断言 faulted、拒绝新 mutation、判定路径正确（已提交/未提交/不可判定） |
| 幂等 | 同 receiptId 重复扫描不重复创建；idempotencyKey 返回既有 id |
| outbox | 终态→注入→flush→ack 全链；杀进程于各窗口 → 验证不静默丢失（允许重复） |
| 授权 | shell 仅 inbox、未启用执行器拒绝、工具无法入队 shell、source 不可伪造 |
| 安全 | 子进程 env 不含 `DSH_*` 与凭据形变量；路径 encodeSegment 断言 |
| 冒烟（手动） | 真实 claude/codex/arkcli 各一条最简 prompt；**仅证明该环境可运行，不替代上述测试** |

## 12. 里程碑（v3 验收 = 可执行证据）

| 里程碑 | 内容 | 验收证据 |
|---|---|---|
| M1 contract+backend | 状态机（两阶段）、segment 日志+轮转、快照重放、inbox receipt、FIFO+faulted | `pnpm exec vitest run packages/task-queue/...` 全绿；杀进程矩阵测试通过 |
| M2 调度器 | tick、并发、优先级、退避、`delayUntil`、超时 abort | 集成测试全绿 |
| M3 执行器 | 5 个 prepare-only 适配器 + 运行日志 + 授权模型 | 冒烟：claude 一条跑通；env scrub 断言通过 |
| M4 集成 wiring | 工具 + system-prompt section + pre-step 钩子 + bundle/preset wiring | **验收 fixture 显式启用一个安全假执行器**（默认全禁的前置条件）；会话内"帮我做这 5 件事"→ 批量入队并被消化 |
| M5 Linux 部署 | systemd 常驻 + 跨会话断点续传实测 + 文档 | 重启服务器：pending 续跑、running/starting 按矩阵恢复、通知 outbox 不丢 |

## 13. 未来方向（非 v1）

- Client 面板（Slot UI）
- 周期任务（评估复用 `schedule` 持久记录模型）、任务依赖 DAG、自动额度均衡路由
- exec 前发布进程身份的 spawn wrapper（消除无 pid 孤儿窗口）、幂等键（exactly-once）、执行器容器化、组提交优化

## 附：v2 → v3 修订清单（回应 codex 第二轮审查）

| 审查意见 | 采纳方式 |
|---|---|
| P0-1 pid 无法 spawn 前持久化 | §3.1 starting→running 两阶段 + stopping 中间态（仿 jobs `stopping`）；明确接受无 pid 孤儿窗口 |
| P0-2 fsync 失败≠转移未发生 | §4.2 mutation FIFO（仿 schedule transaction）+ faulted + 重读判定协议 |
| P0-3 inbox 重复入队 | §7.3 receiptId 幂等 admission + producer fsync 协议 |
| P0-4 notes 非可靠 outbox | §7.4 通知状态进 change 日志，notes 降级可重建投影，session flush 后 ack |
| P1-1 轮转/损坏协议未闭合 | §4.1 immutable segments + 发布顺序 + fail-closed（仿 schedule faulted）；删除孤儿 .lock 场景 |
| P1-2 执行器接口复制生命周期 | §6.1 prepare-only 接口，scheduler 唯一 spawn；§6.2 定义日志合并/背压/写失败 |
| P1-3 wiring 清单不全 | §9.2 补 `apps/cli/package.json`、web-app overlay 禁用、systemPrompt.section 替代 instructions 文件 |
| P1-4 路径/权限缺失 | §9.4 encodeSegment + 目录权限 + source 由入口赋值 + 可信入口拆分 |
| P2 命名/off-by-one/测试命令/验收前置 | §7.5 `task_queue_*`；§3.2 `maxAttempts`+示例序列；§12 `pnpm exec vitest`；M4 fixture 显式启用假执行器 |
