# 任务队列模块（task-queue）设计 v4

> 状态：待用户审阅（v4：已按 codex 第三轮独立复审修订）。日期：2026-08-14。目标仓库：`changanhua/deepseek-harness`（上游 `deepseek-ai/deepseek-harness`）。修订来源：codex 独立审查三轮（v1@`adfd4d6b6f`、v2@`55771d6095`、v3@`3e551aab1f`），全部意见经逐条仓库验证后吸收。

## 0. 摘要

给 DSH 增加一个**跨会话持久化的 host 平面任务队列**（`ctx.taskQueue`）：agent 工具调用或 inbox 文件投递入队，宿主进程内的调度器按并发上限、优先级、延迟时间自动消化，任务由可插拔执行器（`claude` / `codex` / `opencode` / `arkcli` / `shell`）运行，产出物落盘到指定目录。队列状态跨会话、跨进程重启存活，失败任务按指数退避自动重试。

**v4 的核心修正（回应第三轮审查）**：跨重启恢复**绝不信号裸 PID**；通知由独立 outbox record 建模并按 `notificationId` 做 CAS ack；pre-step 只返回候选通知消息，真正的 durability barrier 在观察到对应 `user/message` 已 append 后执行；segment 轮转补齐双父目录 fsync、快照水位和 active-only 尾部修复；attempt、faulted/resume、权限及仓库 wiring 规则一并收口（§3/§4/§7/§9/§10）。

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

**非目标（v1）：** 分布式多机队列；网页面板；任务依赖 DAG；自动额度均衡路由；周期 cron；执行器容器化；exec 前发布进程身份的 spawn wrapper；跨重启 reattach；跨重启的已验证进程身份终止 seam。v1 对 crash 后遗留进程采用 fail-safe：告警并按恢复矩阵结算，**不凭裸 PID 杀进程**（§4.3/§10.5）。

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

## 3. 任务模型与状态机（v4：两阶段副作用 + fail-safe crash recovery）

### 3.1 状态机（含副作用中间态）

```
pending ──领取(attempt+1)──► starting ──spawn──► running ──成功──► succeeded
   ▲                                    │
   │                                    ├──失败(可重试)──► pending（attempt 不变，退避延迟后）
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
| pending → `starting` | **attempt 在此唯一递增**、runId、logPath、commandFingerprint、plannedStartedAt（**无 pid**） | 无 | 重启见 starting 且无 running 记录 → 该 attempt 按失败处理（回 pending 时 attempt 不变），同时记录 `orphan-unknown`：spawn 可能已发生但 pid 未及持久化 |
| `starting` → `running` | spawn 返回后，经 FIFO 持久化 **pid**、actualStartedAt | `ctx.subprocess.spawn(spec)`（唯一副作用点） | pid 仅作诊断，**不是跨重启终止授权**；若宿主在 spawn 与 running 提交之间崩溃，按 starting 恢复 |
| starting/running → `stopping` | 取消意图；abort attempt signal | 无 | prepare 尚未完成时，返回后必须在 FIFO 内重检状态，见 stopping 则禁止 spawn；已有 live handle 时继续下行终止 |
| stopping → `canceled` | 终态 | 有 live handle 才 terminate + waitForExit；无 handle 则无终止副作用 | live handle 路径先写 stopping、再终止、最后结算；prepare 前取消直接结算；若 crash 导致 handle 丢失，boot 不凭 pid 杀进程，发 `orphan-unknown` 后结算并标 `terminationUnverified: true` |

**规则（v4）**：
1. **领取唯一性**：只有 `pending`、`attempt < maxAttempts` 且 `delayUntil <= now` 可领取；调度循环单线程。
2. **意图先行**：任何不可逆副作用（spawn/terminate）之前，先持久化其意图状态（starting/stopping）。terminate 仅能经当前进程持有的原始 handle 执行；重启后丢失 handle 时不得把诊断 pid 当成授权令牌。
3. **结算单写**：succeeded/failed/canceled 只能由 mutation FIFO（§4.2）在 live 副作用已完成，或 crash recovery 已显式记录 `terminationUnverified` 后写入；失败留痕（lastError、result、run record）。

### 3.2 任务字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | `tq-<UUIDv4>`；创建前检查 tasksById，不允许覆盖既有 id |
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
| `source` | enum | `'tool'|'inbox'`；只由可信入口赋值，调用方 spec 不含此字段 |
| `receiptId` | string | 每次 admission 都有值；唯一键为 `(source, receiptId)`。inbox = 文件 UUID；工具提供 `idempotencyKey` 时使用 `tool:key:<key>`，未提供时生成 `tool:auto:<uuid>`（后者不承诺跨调用去重） |
| `terminalSeq` | int? | 最近一次终态 change 的 seq；只用于审计，不承担 notification ack 身份 |

**durable run record（每次 attempt 一条，随 change 记录持久化）**：`runId`、`attempt`、`pid`（starting 时为 null；仅诊断）、`plannedStartedAt`、`actualStartedAt`、`logPath`、`commandFingerprint`、`terminationUnverified?`。

**durable notification record（独立于 Task，§7.4）**：`notificationId`、`taskId`、`runId`、`attempt`、`terminalSeq`、`ownerSessionId`、`messageId`、`status: 'pending'|'acknowledged'`、`acknowledgedAt?`。同一任务每次进入终态都创建不同 record；retry 不覆盖旧 record。

### 3.3 状态机规则（不可违背）

1. 领取唯一性（§3.1 规则 1）。
2. 意图先行（§3.1 规则 2）——副作用前必有持久化意图；崩溃窗口按 §4.3 恢复，不把裸 pid 或重复 spawn 当作通用重放手段。
3. 结算单写（§3.1 规则 3）——所有 mutation 走 §4.2 FIFO。

## 4. 持久化与崩溃恢复（v4：segment + FIFO + faulted 协议）

### 4.1 单写者 segment 日志（v4 闭合 crash durability）

```
$DSH_HOME/task-queue/            # 根目录 0o700（prompt/结果属用户私有数据）
  active.jsonl                   # 活跃写段（唯一可追加段，写者只有 scheduler）
  segments/000001-000100.jsonl   # 不可变已封段（文件名 = 首尾 seq）
  snapshot.json                  # {version,lastSeq,lastChangeDigest,stateDigest,tasks,notifications} 缓存
  inbox/                         # 外部投递入口（0o700，§7.3）
  quarantine/                    # 运营隔离区（运行时只读入，不写入坏段）
  runs/<taskId>/                 # 每次执行日志 run-<attempt>.log
  output/<taskId>/               # 默认产出目录
```

**change 记录格式**（借鉴 `schedule` 的 version-1 变更记录模式）：

```ts
// 占位声明使文档块自洽可编译（真实类型见 contract 包）
interface Task {}
interface NotificationRecord {}

type ChangeRecord =
  | { seq: number; version: 1
      op: 'created'|'starting'|'running'|'stopping'|'succeeded'|'failed'|'requeued'|'canceled'
      taskId: string; state: Task /* op 后完整快照，含 run records */
      notification?: NotificationRecord /* 仅有 owner 的终态 change 原子创建 */
      at: string }
  | { seq: number; version: 1; op: 'notification-acknowledged'
      notificationId: string; expectedStatus: 'pending'; expectedMessageId: string
      state: NotificationRecord /* acknowledged 后完整快照 */
      at: string }
```

折叠器维护两个 map：`tasksById` 与 `notificationsById`。notification ack 必须同时匹配 `notificationId`、`expectedStatus: 'pending'` 和原 record 的 `messageId`；重复 ack 返回既有结果，不能确认另一次 terminal transition。

- **全序依据 `seq`**（单调递增，`snapshot.json` 持久 `lastSeq`），`at` 仅诊断。
- **追加协议**：open('a') → write → **fsync(file)** → 更新内存 → 发事件；首次创建时 fsync 父目录。
- **轮转协议（v4 闭合 rename durability）**：active 行数 > 10000 或 > 8MB 时：
  1. fsync(active)，记录 `firstSeq/lastSeq`；
  2. rename 为 `segments/<firstSeq>-<lastSeq>.jsonl`，然后 **fsync `segments/` 与 `task-queue/` 两个父目录**（跨目录 rename 同时修改源、目标目录项）；
  3. 以独占创建方式建立新 active，fsync 新文件，再 fsync `task-queue/`；
  4. 最后更新 `snapshot.json`（`writeFileAtomic` + fsync 文件 + fsync `task-queue/`；`writeFileAtomic` 本身不承担 crash durability）。

  boot 若发现 active 缺失，先验证所有 sealed segment 的文件名范围与内容 seq 连续，再独占创建新 active；任一不连续、重叠或重复 seq 都直接 faulted。
- **快照是可丢弃缓存**：snapshot 必须通过 schema、`stateDigest = SHA-256(canonical({tasks,notifications}))`，且其 `lastChangeDigest` 匹配持久日志中 `lastSeq` 对应完整行；然后才以 snapshot 为基线重放 `seq > lastSeq`。任一校验失败就丢弃 snapshot，从最早 segment 全量折叠。先扫描所有 sealed segments + active 得到 durable `maxSeq`；snapshot.lastSeq 不得大于它。v1 **不删除旧 segment**，因此恢复不依赖未定义的 `baseSegment`/GC 协议。

  `canonical` 固定为 UTF-8、无额外空白、对象键递归字典序、tasks/notifications 按 id 升序；digest 规则进入 contract 包并由 golden vectors 固定，不能依赖运行时对象插入顺序。
- **损坏处理（fail-closed）**：完整非法行、sealed segment 的任何半行、文件名范围与内容不符、seq 缺口/重复 → 直接 faulted；运行时不得自行跳过坏行。只有 **active 的最后一条半行**可作为 interrupted append 修复：记录原长度 → truncate 到最后完整换行 → **fsync(active)** → 再按 §4.2 判定该 mutation 未提交。恢复其他损坏是运营动作：复制原件到 `quarantine/`、显式重写后重启。
- **v3 删除 v2 的"孤儿 `.lock`"场景**：`writeFileAtomic` 不产生 `.lock`（只有显式 `withFileLock` 才有）；本设计 snapshot/active 均为单写者，不使用 `withFileLock`，无孤儿锁问题。

### 4.2 mutation FIFO 与提交不确定协议（v4 增加 serviceState 边界）

**所有 mutation 串行**：enqueue、batch、inbox import、结算（succeeded/failed/canceled/requeued）、cancel 意图、retry、notification ack——全部进入**一个服务级 FIFO**（仿 `schedule` 的 `runScheduleTransaction`，按 service 实例键控）。多个 agent 并发 enqueue、子进程完成回调、scheduler tick 产生的 append 由此串行化。

服务运行态独立于任务状态：`serviceState: 'running'|'paused'|'faulted'`。`pause()` 仅允许 running→paused，`resume()` 仅允许 paused→running；对 faulted 调用 `resume()` 必须拒绝。faulted 只能由本节的自动判定成功退出，或在停机状态下完成运营修复后重启，不能用普通控制接口绕过。

**append/fsync 失败 ≠ 转移未发生**（v2 该断言在文件系统语义上不成立——write 可能已把完整行交给内核而 fsync 报错，或调用方看到错误但重启后记录实际存在）。协议：

1. FIFO 内 mutation 的 append/fsync 抛错 → 队列进入 **`faulted`**；
2. 拒绝新 mutation（enqueue/cancel/retry 返回 faulted 错误），调度器停转；
3. **判定**：关闭并重读 active 日志，折叠到 lastSeq，按 seq 检查该 change 是否已提交：
   - 已提交（seq 与规范化后的完整 change payload 均匹配）→ 重放该 change，内存与其一致，退出 faulted；原 mutation promise 按成功完成；
   - 未提交且前一行尾完整 → 该转移确实未发生，退出 faulted；原 mutation promise 保留原 I/O 失败，调用方可按接口语义重试；
   - **无法判定**（日志不可读/行损坏）→ 保持 fail-closed，要求重启或运营恢复，**不自动 `resume()`**。
4. 仅 active 尾部半行可按 §4.1 截断并 fsync；该情形复用第 3 步判定（截断 = 未提交）。
5. **spawn 后的 running publication 是唯一特例**：如果 handle 已创建而 running change 判定为未提交，scheduler 保留同一 handle，使用同一规范 payload 与 next seq 重试该 running append，**不得再次 spawn**。重试成功才退出 faulted；再次失败或无法判定则保持 faulted，由当前 handle 的 host disposal 路径负责终止。测试必须证明这一窗口最多 spawn 一次。

### 4.3 崩溃场景矩阵与语义取舍（v4）

| 场景 | 恢复行为 |
|---|---|
| pending，进程被杀 | 重放后仍 pending |
| starting，进程被杀 | 无 handle → 不信号任何 pid；该 attempt 按失败处理（回 pending 时 attempt 不变），发 `orphan-unknown` 告警 |
| running，宿主进程被杀 | handle 已丢失，持久 pid 仅诊断；**不终止裸 pid**，发 `orphan-unknown`，该 attempt 按失败处理 |
| stopping，宿主进程被杀 | handle 已丢失；不终止裸 pid，发 `orphan-unknown`，结算 canceled 且 run record 标 `terminationUnverified: true` |
| spawned 子进程自然失败 | 正常失败路径 |
| active 尾部半行 | 截断到最后完整换行并 fsync；faulted 判定协议收尾（§4.2） |
| 非法完整行 | fail-closed，运营 quarantine 恢复（§4.1） |

**at-least-once**：崩溃窗口内任务可能执行两次；即使 running 已持久，宿主 crash 后也不能把裸 pid 当作原进程身份证明。理由：内容生产类任务重跑代价 < exactly-once 与跨重启进程身份 seam 的复杂度。缓解：attempt 仅在领取时递增、独立 `run-<attempt>.log`、持久 pid/commandFingerprint 仅供诊断、`orphan-unknown` 告警可追溯。正常 shutdown 仍由存活的 `ctx.subprocess` handle 完成树终止；这里的取舍只针对非正常 crash。

## 5. 调度策略

调度循环是 `task-queue-local` 内的 `ctx.setInterval`（1s 可配），每 tick：

1. **扫 inbox**（§7.3）：校验 → 以 receiptId 幂等检查 → FIFO 写 `created` → 成功后删文件。
2. **回收**：scheduler 在领取时创建 attempt 级 AbortController；该 signal 同时传给 `prepare()` 与 `SubprocessSpawnSpec.signal`。prepare 超时/取消直接走 starting 失败或取消路径；handle 已创建后的超时由 subprocess 树终止，再走失败路径。
3. **领取**：pending 筛 `attempt < maxAttempts && delayUntil <= now`，按 priority 升序、同优先级 FIFO。占用并发槽的状态为 starting、running，以及仍持有 live handle 的 stopping；只有全局占用数 < `maxConcurrent`（默认 2）且该执行器占用数 < 执行器上限（默认 1）时才继续领取。
4. **执行**：FIFO 写 `starting` 并把 attempt **加一**（run record 无 pid）→ FIFO 外 `prepare(task, run, signal)` → prepare 返回后重新进入 FIFO，原子执行“确认状态仍为 starting → 同步 `ctx.subprocess.spawn(spec)` → append running”。若 cancel/timeout 已把状态推进为 stopping，禁止 spawn并按原因结算；spawn 与状态重检之间不得让另一个 mutation 插入。
5. **结算**：`SubprocessOutcome.exitCode === 0` → `succeeded`；非 0/超时/信号 → 失败路径（回 pending 时 attempt 保持当前值；下一次领取才加一，或在已达到 maxAttempts 时进 failed）。

**与 `dsh-schedule` 的职责边界**：schedule 是会话级持久提醒（触发后注入上下文，不执行任务）；`delayUntil` 是任务级"何时可领取"资格门槛。两者不合并。

**不抢占**：priority 只影响领取顺序。

## 6. 执行器（v4：prepare-only + attempt signal，spawn 唯一归 scheduler）

### 6.1 注册表接口（v3 修正——适配器不再持有生命周期）

```ts
// contract 包导出的注册接口（host 面）
interface ExecutorAdapter {
  // 只产 spawn spec，不碰 child_process
  prepare(task: unknown, run: unknown, signal: AbortSignal): Promise<unknown>
}
declare function registerExecutor(name: string, adapter: ExecutorAdapter): () => void
```

- **scheduler 唯一调用** `ctx.subprocess.spawn()`，唯一持有 `SubprocessHandle`，唯一负责：创建 `AbortSignal.any([attemptController.signal, AbortSignal.timeout(timeoutMs)])` 并同时约束 prepare/spawn、terminate、waitForExit、结算。
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

### 7.1 Service（host 面，`ctx.taskQueue`，v4 可信入口与运行态）

```
// 可信入口（source 由入口代码赋值，不接受调用方传 source）
enqueueFromTool(spec) → {id}            # 拒绝 executor:'shell'；可选 spec.idempotencyKey
enqueueBatchFromTool(specs) → {ids}     # 上限 200/次
// inbox 由 scheduler 内部扫描调用，不对外
list(filter?) → TaskSummary[]           # status/executor/tags/limit
get(id) → Task
cancel(id) → ok                         # pending→canceled；starting/running→stopping 意图
retry(id) → ok                          # failed → pending（attempt 清零）
stats() → serviceState + fault 摘要 + 各任务状态计数 + 每执行器计数
registerExecutor(name, adapter)
pause()/resume()                         # resume 仅接受 paused；faulted 必须拒绝
// backend 内部：ackNotification(notificationId, expectedStatus, messageId)
```

### 7.2 事件（host 面）

`task-queue/created`、`task-queue/starting`、`task-queue/running`、`task-queue/succeeded`、`task-queue/failed`、`task-queue/requeued`、`task-queue/canceled`、`task-queue/drained`、`task-queue/orphan-unknown`、`task-queue/faulted`。事件名与持久状态一一对应，不再用含糊的 `started`；事件只在对应 change fsync 并更新内存后发布，payload 只含叶子字段。

### 7.3 inbox 幂等 admission（v3 修正重复入队窗口）

**producer 协议（防半文件 + power-loss durable）**：
1. 写 `inbox/<uuid>.tmp`（独占 `wx`）→ **fsync(tmp)** → rename 为 `<uuid>.json` → **fsync(inbox 目录)**。仅 rename 原子可见 ≠ power-loss durable，两个 fsync 是协议的组成部分。
2. 文件内容 = 一条任务 spec（同 `enqueueFromTool` schema，严格校验）。

**scheduler 幂等 admission（v3 修正"落 log 后、删除前崩溃 → 重复创建"）**：
1. 每 tick 扫描 inbox；
2. **receiptId = 文件 UUID**；FIFO 写 `created` change 时同时持久化 `source:'inbox'` 与 receiptId；
3. 重扫时若 `(source:'inbox', receiptId)` 已提交 → **只补删 inbox 文件，不再创建任务**；
4. `created` 提交成功后删除 inbox 文件。

工具入口提供 `idempotencyKey` 时映射为 `(source:'tool', receiptId:'tool:key:<key>')`，已提交则返回既有 task id；key 必须是 1–128 UTF-8 bytes、不得含 NUL。未提供时生成 `tool:auto:<uuid>`，只作为持久 admission 身份，不承诺两个独立工具调用自动去重。inbox 文件 basename 必须严格匹配 UUID，不能把任意文件名直接当 receipt。

### 7.4 durable notification outbox（v4：独立 record + append 后 flush + CAS ack）

**事实源 = change 日志中的独立 NotificationRecord；note 文件只是物化投影**：

1. 任务进入终态（succeeded/failed/canceled）时，若有 `ownerSessionId`，在**同一终态 change** 中原子创建一条 `status:'pending'` 的 NotificationRecord。`notificationId` 与 `messageId` 在 append 前确定，`terminalSeq` 等于该 change 的 seq。Task 不持有可被 retry 覆盖的 notification 状态。
2. retry 只改变 Task；旧 notification record 保留。一次新的 terminal transition 创建新的 `notificationId`，因此迟到 ack 不可能确认后一次结果。
3. 可重建投影：backend 从日志折叠 `notificationsById` 得到待通知集合；`notes/`（若实现）只是缓存，丢失可重建。
4. **pre-step 只准备消息，不做虚假的 flush barrier**：
   - 读取该会话 pending records，按 `terminalSeq` 排序；
   - 对不在进程内 `inFlight` 集合、且 session 事件中尚无对应 `messageId` 的 record，把带稳定 `messageId` 的通知加入返回的 `PreStepDecision.messages`，同时标记 inFlight；
   - pre-step 返回时消息仍未 append；实现不得在这里声称它已持久化。现有 agent loop 会在 waterfall 返回后才 append `user/message`（`agent-loop/src/agent.ts`）。
   - **inFlight 对账（防标记残留）**：若 pre-step 决策被 abort/reject 导致消息从未 append，inFlight 标记会永久卡住该通知。因此每个 turn 结束时（`turn/end` 事件）对账：inFlight 中但 session 事件里没有对应 `user/message` 的 messageId 一律清除，允许下轮重注入。
   - **messageId 识别机制**：通知消息文本内嵌稳定 marker 行 `[task-queue-notification <notificationId> <messageId>]`；监听器对 `user/message` 事件文本做该前缀扫描匹配。messageId 为 UUID，天然无冲突；匹配只依赖文本，不依赖消息结构字段。
5. **append 后 durability barrier**：tool 插件监听 `session/event`。观察到匹配 `messageId` 的 `user/message` 后，只启动一个受控异步 finalizer（监听器本身立即返回，避免 session append 重入）：
   1. `await ctx.sessions.flush(session)`；若没有 persistence listener、flush 失败或 session 已失效，不 ack，清除 inFlight，保留 pending；
   2. flush 成功后，经 task-queue FIFO 写 `notification-acknowledged`，参数包含 `notificationId`、`expectedStatus:'pending'` 与 `messageId`；
   3. CAS 失败若因该 notification 已 acknowledged，视为幂等成功；任何 ID/状态不匹配都不得改写其他 record。
6. pre-step 若发现 session 事件中已经存在该稳定 `messageId`（典型场景：消息已 append、ack 前 crash），不重复注入；它直接启动同一 flush→CAS finalizer。由持久化恢复出来的事件已 durable，额外 flush 是统一 barrier，不改变语义。
7. **崩溃窗口语义**：
   - 终态已提交、消息未 append → pending 重建，稍后注入；
   - 消息已 append、flush 未完成 → pending 保留；恢复后按稳定 messageId 去重，再 flush/ack；
   - flush 已完成、ack 未提交 → pending 保留；恢复后看到 messageId 已存在，只补 ack；
   - ack 已提交但消息未持久 → 不可能，因为 ack 仅由成功 flush 后的 finalizer 发起。
8. 无 owner 任务不创建 notification，结果保留在任务记录 + outputDir，经 `task_queue_list` 审计。

### 7.5 工具（agent 面，`@deepseek-ai/dsh-tool-task-queue`，v3 改名）

`task_queue_enqueue` / `task_queue_enqueue_batch` / `task_queue_list` / `task_queue_status` / `task_queue_cancel` / `task_queue_retry` / `task_queue_stats`。

- 全部经 `enqueueFromTool*` 可信入口；**拒绝 executor: 'shell'**；`maxAttempts` 语义写入 description。
- 工具插件通过 **`ctx.systemPrompt.section()`** 注册使用规范段落（同 `tool-jobs` 先例，name `tool:task-queue`，order 参考 jobs 之后）——**不修改不存在的 persona/instructions 文本文件**（v2 该落点错误）。

## 8. 采用机制（v4：提高概率，不承诺保证）

1. **工具可见性**：description 编码使用时机（批量 ≥3 个独立任务、长耗时、需重试、跨会话 → 入队；单条快速交互 → 内联）。
2. **system-prompt section**（§7.5）：批量先入队再汇报；会话开始 `task_queue_stats` 看积压；发现 failed 主动报告并建议 `task_queue_retry`；不重复入队（先 list 查重）；agent 职责 = 投递、监控、处置失败、汇报。
3. **pre-step 摘要注入**：薄 context 插件挂 `agent/pre-step`（同 time-context 挂点），队列非空且距上次注入超阈值时返回一行状态摘要 + 本会话 pending 通知候选；notification 的真正 ack 由 §7.4 的 `session/event` append 后 finalizer 完成，pre-step 自身不做 durability 声明。
4. **调度器自治（唯一硬机制）**：无会话活跃时 host 面调度循环照常消化队列。前三条是采用概率放大器，本条是机制兜底。

## 9. 在 fork 中的落点（v4 完整 wiring 与门禁清单）

### 9.1 新增包（全新目录）

`packages/task-queue/{task-queue, task-queue-local, tool-task-queue}`（§2 表格）。

### 9.2 修改的既有文件（v4 完整清单，含构建与文档门禁）

**挂载模式（v3 修正）**：照 `tool-jobs` 既有模式——base bundle 挂 model-facing 工具，web overlay 禁用，standard preset 为 Web agent 重挂。

| 文件 | 改动 | 已验证 |
|---|---|---|
| `packages/bundle/base/cordis.patch.yml` | ① host 面服务行 `task-queue-local`（含执行器启用配置）② 工具行 `tool-task-queue`（供 TUI 等非 web 面） | 存在（当前有本地 WIP 改动，注意共存） |
| `packages/bundle/base/package.json` | 声明 `task-queue`、`task-queue-local`、`tool-task-queue` workspace 依赖 | 存在 |
| `packages/bundle/web-app/cordis.patch.yml` | `tool-task-queue` 行 `disabled: true`（web 由 preset 重挂，同 tool-jobs 模式） | 存在 |
| `apps/cli/config/agent-presets/standard/agent.cordis.yml` | 重挂一行 `tool-task-queue`；该 package 的同一次 apply 统一注册 7 工具、system-prompt、pre-step 与 session/event finalizer，禁止拆成两个会重复监听的 mount | 存在 |
| `apps/cli/package.json` | **声明 `tool-task-queue` 依赖**（preset 文件属于 apps/cli，其引用的包须可从 CLI 依赖解析——同 `tool-jobs` 在 73 行的先例） | 存在，v2 漏此项 |
| `tsconfig.host.json` | 增加三个新包的 project references（同 jobs 三包在 265–267 行的先例） | 存在，v3 漏此项 |
| `scripts/gen-tool-catalog.ts` | 注册 `tool-task-queue` 的 7 个 schema、真实 mount 依赖和 writes；生成 `docs/tool-catalog.md` | 显式清单，不能只靠 workspace 扫描 |
| `scripts/gen-doc-graphs.ts` | 把 `ctx.taskQueue` service 与 `task-queue/*` 事件加入 capability/event 模型；生成受影响的 graph docs | 显式模型，不能只靠包存在推断 |
| `pnpm-lock.yaml` | 由 `pnpm install` 自动更新（不手改） | — |

**新包内必需文件**：每包至少含 `package.json`、`tsconfig.json`、`src/index.ts`、测试与 `README.md`。三个 README 必须满足 `verify-package-readme-model-experience.ts`：contract/local 可写完整结构或经审计加入短格式 allowlist；tool 包的 schema 章节必须链接生成后的 `docs/tool-catalog.md` anchor。

**生成文件规则**：运行 `pnpm run gen-tool-catalog`、`pnpm run gen-doc-graphs` 及最终 `pnpm run doc-sync`，提交命令实际产生的受影响文档；不得手工猜测生成文件内容。

**覆盖机制**：host 层叠 = `base bundle patch` + profile/home 的 `cordis.patch.yml` + `--patch <path>` overlay（`dsh --profile web --patch ./extra.yml`）。**`--config` 入口不存在**。

### 9.3 merge 上游策略

- 同步：`git fetch upstream && git merge upstream/master`。冲突面 = §9.2 表内文件的新增行；bundle patch 若上游重排，按新行序重放。
- 措辞：不承诺"永远无冲突"，承诺"冲突面小且可机械重放"。
- 兜底：迁移到 profile/home `cordis.patch.yml` 或 `--patch` overlay，零仓库内改动。

### 9.4 路径与权限（v4 修正目录 mode）

- **路径安全**：`ownerSessionId`、taskId、receiptId 进入路径前一律 `encodeSegment`（`session-persistence-jsonl/src/format.ts`，防 `../`/绝对路径/NUL/分隔符；SessionId 是未验证 branded string）。
- **目录权限**：在 POSIX/Linux 上，`task-queue/` 根、`segments/`、`inbox/`、`notes/`（若实现）、`runs/`、`output/` 均 0o700（目录必须有 owner execute 位）；`active.jsonl`、sealed segment 文件、`snapshot.json`、run logs 与 note cache 文件均 0o600。创建后用 `chmod`/mode-aware open 收敛已有路径，Linux 测试以实际 `stat.mode & 0o777` 为准；Windows 不伪造 POSIX mode 断言，依赖当前用户目录 ACL，并在文档中声明该平台差异。
- **`source` 赋值**：只能由入口代码（enqueueFromTool / inbox 扫描）赋值，**任何调用方不得从 spec 传入**；Service 拆可信入口（§7.1）后，普通调用方拿不到 inbox 权限。

## 10. 错误处理与边界（v4）

1. **执行器缺失/未启用**：入队即拒（未启用）；spawn ENOENT → 该 attempt 立即进入 failed，不进重试风暴（配置错误类不重试）。
2. **超时**：`AbortSignal.timeout(timeoutMs)` 注入 spawn spec → subprocess 树终止 → 失败路径。
3. **append/fsync 错误**：§4.2 faulted 协议——进入 faulted、拒绝新 mutation、重读日志判定提交结果；**无法判定则 fail-closed，绝不自动 resume**。
4. **坏行**：完整非法行或 sealed segment 半行 → faulted + 运营 quarantine 恢复；仅 active 尾部半行可 truncate + fsync，再走 §4.2 判定。
5. **孤儿进程（fail-safe）**：正常 shutdown 用当前 `SubprocessHandle.terminate()/waitForExit()`；非正常 crash 后 handle 已丢失，boot 对 starting/running/stopping **一律不得凭裸 pid 或进程组号发信号**。发 `orphan-unknown`，记录 pid/fingerprint 供运营诊断，并按 §4.3 结算。未来只有在 subprocess seam 提供可持久、可验证的 OS process identity 后，才允许跨重启终止。
6. **重复入队**：唯一键为 `(source, receiptId)`；显式 idempotencyKey 幂等，自动 receipt 只保证单次 admission 身份（§7.3）；at-least-once 执行语义已明示（§4.3）。
7. **危险任务**：授权模型 §6.3。
8. **fsync 成本**：每次状态转移一次 fsync 是刻意开销；30min 级任务下占比可忽略；高频短任务再评估组提交（记录为已知取舍，YAGNI 不提前实现）。
9. **服务控制**：`resume()` 不能清除 faulted；日志判定不成功时只有停机运营恢复 + 重启。`stats()` 必须返回 serviceState 和 fault 原因摘要。

## 11. 测试策略（v4）

| 层 | 内容 |
|---|---|
| 单元 | 状态机全转移（attempt 仅在领取时递增、starting→running 两阶段、stopping 取消路径、超时→失败）、退避序列、Task/Notification change union、notification CAS、seq 折叠 |
| 集成（假执行器） | 入队→starting→running→结算全链路；inbox 投递→receipt 幂等→删除 |
| 崩溃模拟 | 杀宿主进程于 pending/starting/running/stopping/active 半行各点；断言 crash 恢复从不向复用 PID/PGID 发信号，且 orphan-unknown/terminationUnverified 与 §4.3 一致 |
| faulted 协议 | 注入 append 失败 → 断言 faulted、拒绝新 mutation、判定路径正确（已提交/未提交/不可判定）；spawn 已成功但 running 未提交时重试同一 change，spawn 计数始终为 1 |
| 幂等 | 同 receiptId 重复扫描不重复创建；idempotencyKey 返回既有 id |
| outbox | 两次 terminal transition 产生不同 notificationId；pre-step 返回前不得 ack；观察匹配 user/message append→flush→CAS ack；retry/迟到 ack、flush 失败、append 后 crash 各窗口不串代、不静默丢失 |
| 授权 | shell 仅 inbox、未启用执行器拒绝、工具无法入队 shell、source 不可伪造 |
| 安全 | 子进程 env 不含 `DSH_*` 与凭据形变量；路径 encodeSegment；目录实际 mode=0o700、文件=0o600；伪造/复用 pid 不触发跨重启 kill |
| segment durability | 注入 crash 于跨目录 rename、双目录 fsync、新 active 创建、snapshot 发布之间；验证 seq 无重复/缺口，sealed 半行 fail-closed，active 半行 truncate 后已 fsync |
| 仓库门禁 | 三包 project references、工具 catalog、capability/event graph、README Model Experience；`pnpm run doc-sync` 与相关 focused tests 通过 |
| 冒烟（手动） | 真实 claude/codex/arkcli 各一条最简 prompt；**仅证明该环境可运行，不替代上述测试** |

## 12. 里程碑（v4 验收 = 可执行证据）

| 里程碑 | 内容 | 验收证据 |
|---|---|---|
| M1 contract+backend | 状态机（两阶段）、独立 notification records、segment 日志+轮转、快照重放、inbox receipt、FIFO+faulted | `pnpm exec vitest run packages/task-queue/...` 全绿；crash/rename/PID-reuse 矩阵测试通过 |
| M2 调度器 | tick、并发、优先级、退避、`delayUntil`、超时 abort | 集成测试全绿 |
| M3 执行器 | 5 个 prepare-only 适配器 + 运行日志 + 授权模型 | 冒烟：claude 一条跑通；env scrub 断言通过 |
| M4 集成 wiring | 工具 + system-prompt section + pre-step/session-event outbox 钩子 + bundle/preset/build/doc wiring | fixture 显式启用安全假执行器；会话内"帮我做这 5 件事"→ 批量入队并被消化；`pnpm run doc-sync` 通过 |
| M5 Linux 部署 | systemd 常驻 + 跨会话断点续传实测 + 文档 | 重启服务器：pending 续跑、starting/running/stopping 按 fail-safe 矩阵恢复且不 kill 裸 pid、通知 outbox 不丢 |

## 13. 未来方向（非 v1）

- Client 面板（Slot UI）
- 周期任务（评估复用 `schedule` 持久记录模型）、任务依赖 DAG、自动额度均衡路由
- exec 前发布进程身份的 spawn wrapper、subprocess 可持久 ProcessIdentity 与 verified recovered termination、幂等执行键（exactly-once）、执行器容器化、segment GC、组提交优化

## 附 A：v3 → v4 修订清单（回应 codex 第三轮审查）

| 审查意见 | v4 采纳方式 |
|---|---|
| P0-1 跨重启裸 PID kill 可能误杀 | §3.1/§4.3/§10.5 改为 fail-safe：handle 丢失后不信号 pid/pgid，告警并结算；verified ProcessIdentity seam 列未来方向 |
| P0-2 pre-step 内 flush 早于 decision message append | §7.4 拆成 pre-step 候选消息与 `session/event` append 后 finalizer；只有观察到 `user/message` 后才 flush→ack |
| P0-3 Task 单字段 notification 会被 retry/迟到 ack 串代 | §3.2/§4.1/§7.4 改为独立 NotificationRecord，按 notificationId + expectedStatus CAS ack，retry 不覆盖旧通知 |
| P1 segment crash durability 未闭合 | §4.1 补跨目录 rename 的双父目录 fsync、missing-active boot、durable maxSeq、active-only 半行 truncate+fsync、v1 不做 segment GC |
| P1 attempt 与 faulted/resume 不一致 | §3/§5 规定 attempt 仅 pending→starting 递增；§4.2 增加 serviceState，resume 不得清 faulted |
| P1 wiring 清单不全 | §9.2 增加 tsconfig.host、tool catalog、doc graphs、README Model Experience 与生成文件门禁 |
| P1 目录 0o600 不可遍历 | §9.4 改为目录 0o700、文件 0o600，并要求实际 stat 测试 |
| P2 receipt/时间/事件命名含糊 | §3.2/§7.3 定义 `(source, receiptId)`、自动 receipt、planned/actual 时间；§7.2 明确 started 事件语义 |

## 附 A.2：主 agent 对 v4 的复审（2026-08-14）

主 agent 逐条到仓库验证了 v4 新增的每个事实断言（session/event 事件、agent loop append 顺序、`ctx.sessions.flush`、tsconfig 引用位置、tool catalog 显式清单、doc-graphs 显式分类、README allowlist），全部成立。补两个 P2 缺口：

| 缺口 | 修补 |
|---|---|
| inFlight 标记在 pre-step 被 abort/reject 后永久残留，通知卡死 | §7.4 第 4 步增加 `turn/end` 对账：inFlight 中但 session 无对应 `user/message` 的 messageId 一律清除 |
| messageId 如何在 `user/message` 事件中被识别未定义 | §7.4 第 4 步定义文本内嵌 marker 行 `[task-queue-notification <notificationId> <messageId>]` + 前缀扫描匹配 |

## 附 B：v2 → v3 修订清单（历史，回应 codex 第二轮审查）

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
