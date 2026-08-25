# @deepseek-ai/dsh-task-queue-local

[English](README.md) | 中文

[`@deepseek-ai/dsh-task-queue`](../task-queue/README.md) 约定的 host 平面持久实现：`LocalTaskQueue` 把每一条任务与通知记录写进组合层配置的 `queueRoot` 目录（随附的 base 行中为 `$DSH_HOME/task-queue/`）下的单写者 segment 日志，跨进程重启仍存活，并由一个调度器按可配置的并发上限领取、spawn 并结算任务。它会在读取持久日志前对 `queueRoot` 原子获取跨进程所有权锁，因此第二个宿主进程在恢复或回收第一个进程的存活任务之前就会被拒绝。作为插件加载后即注册为 `ctx.taskQueue`。

## Service

`LocalTaskQueue` 继承约定包里的 `TaskQueue` 服务，注册为 `ctx.taskQueue`。所有读操作都返回持久状态，所有写操作都经过一个服务级 mutation FIFO。

- `enqueueFromTool(spec) → TaskId`：可信工具入口。它拒绝 `executor: 'shell'`，要求执行器被显式启用，并生成幂等 receipt：调用方提供 `idempotencyKey` 时为 `tool:key:<idempotencyKey>`（重复调用返回既有任务 id），否则为 `tool:auto:<uuid>`（仅作为单次准入身份，不承诺跨调用去重）。
- `enqueueBatchFromTool(specs) → TaskId[]`：每次调用最多 200 条。
- `list(filter?)` / `get(id)`：读取摘要或完整任务；`list` 可按 status、executor、tags 过滤。
- `cancel(id)`：`pending` 直接取消；`starting`/`running` 落 `stopping` 意图并返回 `'stopping'`；终止态任务是空操作并返回 `'canceled'`。
- `retry(id)`：把 `failed` 或 `canceled` 任务清零 attempt 后回到 `pending`。
- `stats()`：返回 `serviceState`（faulted 时附原因）、各状态计数与各执行器计数。
- `registerExecutor(name, adapter)`：安装 prepare-only 适配器；返回一个移除它的 disposer。
- `pause()` / `resume()`：`pause` 仅允许自 `running`，`resume` 仅允许自 `paused`。对 faulted 队列调用 `resume()` 会被拒绝；faulted 只能经 fault 判定协议退出或由运营者重启。
- `ackNotification(notificationId, messageId)`：对终态变更产生的 `pending` 通知做 CAS 确认；status 或 message id 不匹配时失败，且不改动任何其他记录。
- `listNotifications({ ownerSessionId })`：按 terminalSeq 排序重建某一会话的待通知 outbox。

事件只有在对应 change 完成 fsync 并折叠进内存后才发布：`task-queue/created`、`task-queue/starting`、`task-queue/running`、`task-queue/succeeded`、`task-queue/failed`、`task-queue/requeued`、`task-queue/canceled`，以及用于恢复与故障信号的 `task-queue/orphan-unknown`、`task-queue/faulted`。

## 持久存储

队列根目录包含追加写的 `active.jsonl`、已封段的 `segments/<first>-<last>.jsonl`、可丢弃的 `snapshot.json` 缓存，以及 `inbox/`、`quarantine/`、`runs/<taskId>/` 和 `output/<taskId>/`。每条新变更写一行 JSON，遵循 `open('a')` → 写入 → `fsync(文件)`，首次创建时再 fsync 父目录。当 active 段超过 10000 行或 8 MB 时，先 fsync 该段，再改名为 `segments/` 下的封段，跨目录 rename 后 fsync 两个父目录，随后独占新建并 fsync 新的 active，最后重写快照。

启动时折叠所有封段与 active 尾部，校验文件名范围与 seq 连续；损坏的完整行、封段的半行、任何 seq 缺口或重复都会以 `FaultedError` 直接失败关闭。只有 active 段的尾部残行会被修复——截断到最后一个完整换行并 fsync。只有当快照的 sha256 state 摘要与逐行 lastChange 摘要都与持久日志一致时才信任它；任何不匹配都会丢弃快照并从最早段全量折叠。

## 跨进程单写者所有权锁

`LocalTaskQueue` 在读取持久日志或回收崩溃任务之前，先对 queue root 获取 `owner.lock`。锁通过原子 `link(2)` 从一个完整写入的临时文件创建，因此同一 `queueRoot` 上的第二个宿主进程在能 `recover()` 第一个进程的存活任务之前就会被拒绝。记录 pid 已死（前一宿主崩溃）的锁会被归档到 `quarantine/` 并接管；由存活 pid、其他机器或同一进程持有的锁会拒绝启动。不支持跨机器共享 queue root。

shutdown 时锁是真实的 fence，而非 best-effort 产物：async disposer 先关闭准入并停止调度器，然后依次 await boot 完成、调度器 drain（每个 tick 与 detached execution）与服务 mutation FIFO drain，最后才释放锁。因此第二个宿主无法在第一个宿主仍可能 append 时获取——包括在途的 enqueue/ack mutation 或运行中 subprocess 的终态 settle。shutdown 赢得竞态时已 claim 但尚未 spawn 的任务在磁盘上保持 `starting`，由下一个宿主的 crash recovery 接管；它绝不会在 stop 之后被 spawn。非优雅退出残留的锁文件会在下次 acquire 时由 stale-takeover 路径恢复。

## Mutation FIFO 与 faulted 协议

每一次持久 mutation——入队、批量、inbox 导入、结算、取消意图、重试、通知确认——都经同一条以服务实例为键的 promise 链串行执行，因此并发入队、inbox 扫描与结算回调不会交错。append/fsync 失败并不等于转移未发生，所以服务进入 `faulted`，拒绝新 mutation，并重读日志判定：已提交（seq 与 payload 均在）→ 对账并清除 fault；未提交且前一行尾完整 → 转移确实未发生，保留原始 I/O 错误；无法判定 → 保持 fail-closed，绝不自动 resume。spawn 之后的 `running` 发布是唯一重试特例：在下一个 seq 下重试同一规范 payload，而不是二次 spawn 进程。

## Inbox

外部生产者投递任务的方式是：写 `inbox/<uuid>.tmp`（独占）、fsync、改名为 `<uuid>.json`、再 fsync inbox 目录——两次 fsync 都是断电持久协议的一部分，因此调度器只会看到完整文件。basename 必须是严格 UUID，内容必须通过严格的入队 schema 校验。非 UUID basename 被忽略，非法内容被移入 `quarantine/` 而非入队。`receiptId` 即 UUID basename：重复扫描到已提交 receipt 时只删除文件、不创建第二个任务，且文件只在 `created` change 提交后才删除。

## 调度

启动恢复完成后才启动调度器，持久 mutation 方法也会等启动完成后返回，因此恢复状态不会覆盖启动期间入队的任务；服务声明 `subprocess` 为必需的插件依赖。tick 循环（默认 1 秒）先处理 inbox，再按优先级升序、同优先级 FIFO 顺序领取可用的 `pending` 任务，受全局 `maxConcurrent`（默认 2）与每执行器 `maxConcurrentPerExecutor`（默认 1）约束。领取分两阶段：先在 FIFO 内写 `starting`（`attempt` 唯一在此递增，run record 不含 pid），随后在 FIFO 外由适配器 `prepare(task, run, signal)` 产出 spawn spec，最后回到 FIFO 内原子地重检任务仍为 `starting`、经 `ctx.subprocess.spawn(spec)` spawn、并带真实 pid 写 `running`。在 prepare 期间被取消的任务绝不会被 spawn。`exitCode === 0` 结算为 `succeeded`；其余走失败路径——按 `backoffMs * 2^(attempt-1)` 退避重入队直到 `maxAttempts`，之后进 `failed`。attempt 级 `AbortSignal`（同时传入 spec 的 `signal`）兑现 `timeoutMs`，超时会升级为进程树终止。

崩溃回收恰在启动时执行一次：`starting`/`running`/`stopping` 任务是上一个宿主进程的遗留（不存在对应 live handle），按恢复矩阵结算（绝不向恢复出的 pid 发信号）并各自发出 `task-queue/orphan-unknown`。正常 tick 从不回收，否则一个已 spawn 的任务会每秒被回退一次。

## 执行器

适配器只做 prepare：返回完整指定的 `SubprocessSpawnSpec`，绝不直接触碰 `child_process`——spawn、terminate、wait 全部由调度器经 `ctx.subprocess` 完成。适配器还可提供可选的 `normalize(task, stdout, stderr)` 方法，将原始进程输出转换为 Agent 可消费的结果：至少包含人类可读的 `summary`，编码 agent 执行器（DSH/Claude/Codex）还可提供 `assistantText`。若适配器未提供 `normalize`，调度器会从 exit code、duration、tail 存在性与输出文件数量生成合理的默认摘要。内置 `claude`、`codex`、`opencode`、`arkcli`、`node` 与 `shell`。它们都以任务输出目录为 `cwd`、以有界 spill 收集 stdout/stderr，且不传 `env`，让 subprocess 服务的 scrub 后父环境生效。`node` 执行从任务 prompt 的 `{ "script": string, "args"?: string[] }` JSON 解析出的本地 Node 脚本，脚本必须存在于磁盘。`shell` 执行从任务 prompt 的 `{ "argv": string[] }` JSON 解析出的 argv 数组，且被一切工具入口拒绝——只有 inbox 准入能入队它，因此模型 prompt 永远无法变成任意命令。执行器必须在 host 配置中显式启用；未知或未启用的执行器在准入时即被拒绝，spawn 的 `ENOENT` 会让该 attempt 立即失败，而不是进入重试风暴。

## 权限

队列目录（`task-queue/`、`segments/`、`inbox/`、`quarantine/`、`runs/`、`output/`）以 `0o700` 创建；文件（`active.jsonl`、封段、`snapshot.json`、run 日志）以 `0o600` 创建。任何进入路径的不可信 id 都会先经 `encodeSegment` 编码。Windows 上不强制执行这些 mode，所有权依赖当前用户的目录 ACL。

## Model Experience

间接地，经由 [`dsh-tool-task-queue`](../tool-task-queue/README.md)，它渲染 7 个 `task_queue_*` 工具、`tool:task-queue` 提示词段落与通知投递消息；此后端自身不注册任何模型面。

#### KV Cache effect

无直接失效；命名的消费者拥有任何 request-prefix 变更。

## 已知限制与暂缓事项

- **至少一次执行语义**：`spawn` 与 `running` 提交之间崩溃可能导致同一 attempt 执行两次；`attempt` 只在领取时递增，恢复出的 pid 仅作诊断，绝不作为跨重启 kill 的授权。
- **未实现 segment GC**：封段永不删除，因此恢复不依赖未定义的 base-segment 协议，但队列目录会无限增长。
- **faulted 状态刻意保持粘滞**：无法判定的提交会一直 fail-closed，直到运营恢复与重启；设计上 `resume()` 无法清除它。
- **所有权锁仅限单机**：两台机器共享同一 queue root（例如通过网络文件系统）会被启动时拒绝；stale-takeover 路径仅处理同机 pid 死亡。
