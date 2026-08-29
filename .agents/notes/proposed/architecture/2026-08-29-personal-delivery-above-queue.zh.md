# Agent Note: Personal Delivery 组合在持久 Queue 之上

Status: proposed

[English](2026-08-29-personal-delivery-above-queue.md) | 中文

## 问题

DSH 可以运行功能丰富的 Agent Session，Queue v2 可以跨进程重启保存 typed Work、Attempt、结果、重试、资源 claim 和崩溃不确定性。这两种能力都不拥有经过批准的 GitHub 需求版本、有界代码 Packet、隔离的 Git worktree、独立验证证据或用户的验收决定。若把 Session 或 Agent 最终消息当成交付记录，执行叙述就会成为权威事实，跨 Session 连续性也会丢失。

把 easyGo 作为第二个控制面运行，会在 Queue v2 旁边增加另一套 Work/Attempt 调度器、worker lease、重试模型和 operator 状态。把全部交付语义移入 Queue core 则会产生相反的耦合：generic scheduler 将导入 GitHub、Git、Codex、验证和产品验收策略。单体 Delivery 插件虽能让这些关注点留在 Queue 外部，却仍会阻碍实现的独立替换和生命周期所有权。

Personal Delivery 需要两项必须保持窄于产品领域的能力。可信 Queue operator admission 必须创建 ownerless work，且不向浏览器暴露 generic enqueue authority。Codex execution 必须接受显式的 Attempt-owned cwd，且不虚构 supervisor Session，也不发布 generic executor registry。

## 提议

Personal Delivery 是一个 profile bundle，它在[持久 Queue](../../../../docs/subsystems/task-queue.zh.md)之上组合独立 DSH 插件。Delivery 拥有不可变需求采纳和人工决定；Queue 保留对 Work 与 Attempt 的既有权威。Git 拥有 commit identity，Session 拥有 transcript，evidence storage 拥有字节，Runtime Facts 拥有建议性的容量观测。

第一版实现位于 fork 的 `packages/delivery/` group，因为它依赖 fork 自有的 Queue v2 约定。Bundle 只包含 composition。Queue core 不导入 Delivery、GitHub、Git workspace、verifier、executor、Remote 或 UI package。Intake 调用 Delivery 而非 Queue；只有 `delivery-task-queue` 同时消费 Delivery 与 Queue、声明 Delivery WorkKind 并注册其 handler。

[MVP 约定](../../../../docs/specs/2026-08-29-personal-delivery-mvp.md)把第一条纵切限定为手工导入 GitHub Issue、一个本地仓库、Codex 执行、固定命令验证、本地证据和显式人工验收。[Protocol V1](../../../../docs/specs/2026-08-29-delivery-protocol-v1.md)拥有持久对象语义，[多 PR 计划](../../../../docs/specs/2026-08-29-personal-delivery-multi-pr-plan.md)拥有实施顺序和路径排他规则。

### 包拓扑

本提议在并行实施前固定十五个包角色。[`packages/delivery` map](../../../../packages/delivery/README.zh.md)拥有逐包导航；本 Note 拥有这些角色保持分离的理由。

| 层 | 包 | 职责 |
| --- | --- | --- |
| 共享基础 | `delivery-protocol`、`delivery`、`repo-workspace`、`delivery-evidence`、`delivery-testkit` | 冻结 Queue 无关的数据、三个 Service Definition、运行时 schema、fixture 和约定 fake。 |
| 可替换 provider 与集成 | `delivery-local`、`repo-workspace-git-local`、`delivery-evidence-local`、`delivery-runner-codex`、`delivery-verifier`、`delivery-github-intake`、`delivery-remote`、`delivery-task-queue` | 各自实现一个自有机制，不编辑另一个 Wave 包或冻结的 protocol。 |
| 产品 composition | `client/ui-delivery`、`bundle/personal-delivery` | 渲染派生 state 并选择插件；两个包都不成为持久 authority。 |

只有三个 public host service：`ctx.delivery` 上的 `Delivery`、`ctx.repoWorkspace` 上的 `RepositoryWorkspace` 和 `ctx.deliveryEvidence` 上的 `DeliveryEvidence`。Local provider 继承这些 definition；`delivery-testkit` 提供符合约定的 fake。Executor、verifier、intake、Remote、UI 和 bundle package 都不声明另一个 Delivery context key。

`delivery-protocol` 导出持久对象、严格运行时 schema、golden fixture，以及 `code.change@1` 与 `code.verify@1` 的 intent/resolved/output DTO。它不依赖 Queue、不扩展 `WorkKindMap`、不定义 live prepared value，也不注册 handler。这样 Delivery persistence、provider、test fake、Remote DTO 和 UI projection 无需导入 Queue lifecycle type 即可使用。

### 能力所有权

| 事实或行为 | Owner | 否定保证 |
| --- | --- | --- |
| 当前 Issue 文本和产品验收措辞 | GitHub | Delivery 不会静默覆盖它。 |
| 已采纳的不可变需求和有界 Packet | Delivery | Queue 不解释产品范围。 |
| Work、Attempt、重试、取消、Result、Receipt 和 Attention | Queue v2 | Delivery 不存储重复的 Attempt 或重试状态。 |
| Base、worktree、checkpoint、target commit 和 diff | Git workspace 插件 | Session cwd 不是执行权威。 |
| 完成声明 | Executor 输出的 `CompletionClaim` | 声明不能验证或验收自身。 |
| 验证检查和证据 | 独立 verifier 与 evidence storage | Executor 文本不是验证证据。 |
| 验收、拒绝或豁免 | 人工编写的 Delivery decision | 任何 Agent 或自动规则都不能验收交付。 |
| Ready、Running、Review、Blocked 和 Accepted lane | UI projection | Lane 不是可写持久状态。 |

`ContractRevision`、`WorkPacket`、`DispatchBinding`、`CompletionClaim`、`VerificationVerdict`、`AcceptanceDecision` 和 `EvidenceRef` 是 Delivery 协议对象。Queue 现有的 `WorkItem`、`WorkAttempt`、`WorkResult`、`Receipt` 和 `Attention` 语义保持不变。`ResumeCapsule` 是从这些权威事实编译出的派生 Evidence 对象，不是另一条生命周期记录。

Bridge 提出 provider-neutral 的 `code.change@1` 和 `code.verify@1` WorkKind。`delivery-task-queue` 是它们唯一的 declaration-merging 和运行时注册 owner；prepared value 保留在该包本地。Change work 的 Queue success 只记录 typed completion claim。验证作为独立 work 对精确 checkpoint commit 运行。只有匹配的 passed verdict 才允许普通验收；显式人工 waiver 记录例外。

Delivery 和 Queue 无法提交同一 transaction。因此，Delivery 在 enqueue 前持久化带确定性 Queue idempotency key 的 `submitting` binding，随后记录返回的 Work id。重启时使用相同 key 和 input 重复未完成的 enqueue；无论之前的调用是否已经提交，Queue 都会返回原始 id。Queue 无法解析的 bound id 会成为 corruption Attention，绝不使用另一个 key 重新准入。

### 技术门

Gate A 扩展可信 operator admission，但不向浏览器暴露 generic enqueue。Ownerless admission 使用 operator authority、operator-scoped idempotency、`ownerSessionId: null`，并且不创建 Session Notification。同一项 Queue 变更还会关闭直接的 post-start ownership gap：如果 `LiveAttempt` 已存在后 running append 失败，provider 会 abort controller、请求 `LiveAttempt.cancel()`、在 configured bound 内观察 cancellation 和 `live.done`，然后才记录 `unknown` 加 Attention。Cancellation rejection、deadline、conflicting late outcome 或另一次 persistence failure 继续作为 post-start evidence；Queue 绝不把它重新分类为 `not-started` 或自动重试。Deadline 保留的是 durable uncertainty，而不是 in-process handle 或 resource claim，因此 operator 授权重试前必须从外部证明之前的副作用已经 quiescent。

Gate B 在可丢弃的显式 worktree 中验证真实 Codex 执行、取消传递、完整进程树 quiescence 和诚实 terminal 分类。受支持的 `@deepseek-ai/dsh-subagent-codex/app-server-run` 子路径公开 parent-free explicit-cwd 入口，同时在 package root 保留 Session-backed provider adapter。`delivery-runner-codex` 消费该窄子路径；任何 Delivery package 都不 deep-import source，也不虚构 Agent 或 Session。

本提议有意不定义 `ctx.codeExecutors` API。一个 Codex runner 和一个 Delivery consumer 只足以证明受支持的 lifecycle entry，而不是 provider registry 或 generic executor Service Definition。重新考虑该 public surface 前，必须由另一个独立 consumer 或可替换 provider 提供新证据。

### 并行实施边界

可执行 protocol、Service Definition、fake、package manifest 和 golden fixture 为每个 implementation Wave 形成一个冻结 base。Wave package 消费该 base，并且只编辑其分配到的 package-local source、test、README 和 Agent Note scope。需要 protocol change、另一个 Wave path、root dependency、更宽 authority surface 或另一种 durable state 时，它必须停止。

Protocol 和 fake service 只让 Wave 达到 type-ready，而不是 product-ready。Product readiness 还要求三个 service 的 concrete provider、Codex runner、verifier、GitHub intake、Queue bridge、Remote、client workbench、bundle composition 和纵向验收场景。并行工作开始后，由 integration 拥有 shared refresh。

### 执行与验证不变量

- Packet 在 Queue admission 前绑定一个 Contract revision 和完整 base commit。
- Issue 编辑会创建另一个 Contract revision，绝不修改已准入或运行中的 Packet。
- Delivery 在 Queue enqueue 前持久化确定性 pending dispatch，并在重启后通过重复同一幂等调用完成 reconciliation。
- `resolveAdmission()` 持久化不可变 executor、repository、policy 和 verification facts；`prepare()` 不启动 Git 或进程副作用。
- 一个 change Attempt 拥有一个隔离 worktree；executor 只在 Queue 发布 live ownership 后启动。
- 可能已经产生副作用却失去所有权时，状态转为 `unknown`，绝不自动重试。
- Governed runner 在 quiescence 后记录 clean 的完整 checkpoint commit、从 Git 派生 changed path，并证明该 commit 是 Packet base 的 descendant；Agent prose 不是 commit authority。
- Verification 使用 Packet 的 resolved fixed argv 和 Contract/base-blob provenance，绝不采用 Agent 修改的配置，并且针对 completed claim 的精确 checkpoint commit。
- Passed verdict 要求 ancestry 匹配、每个 required check 通过、没有 forbidden-path finding，并且 required evidence 完整。
- Evidence 携带不可变 URI、byte length、digest、type 和 provenance；Queue 持久化引用而非字节。
- 重启后，Delivery 从持久 Delivery record 和 Queue view 重建 projection；瞬态 Queue event 只改善新鲜度，不是恢复权威。
- Runtime quota fact 只能改变推荐。P0 绝不自动启动代码工作。

## 考虑过的替代方案

**保留 easyGo sidecar control plane。** 否决，因为它的 scheduler、worker、lease、retry state 和 operator API 与 Queue v2 重复。它的 worktree、validation、evidence 和 process-supervision 机制仍可作为实现参考和测试，而不是第二个运行时权威。

**实现一个 `dsh-delivery-desk` 插件。** 否决，因为 GitHub intake、domain persistence、Git worktree ownership、execution、verification、Remote 和 UI 具有不同依赖、权限和失败生命周期。一个可安装 Bundle 可以保持单一产品体验，而不让一个实现对象拥有全部关注点。

**用 Contract、verification 和 acceptance 字段扩展 Queue record。** 否决，因为 Queue 是 image、host operation 和 restricted Agent 共用的 Work/Attempt scheduler。产品范围和人工验收不是 generic execution fact。

**使用 Session 或 Goal 作为持久交付 owner。** 否决，因为一次交付可以跨越 Session 和 executor，而 transcript 与 Round budget 是独立事实。失败的 Session 必须可被替换，同时保持 Packet identity 不变。

**围绕 Codex 入口创建 generic executor registry。** 否决，因为一个 provider 和一个 consumer 不足以证明 public capability 的必要性。受支持的 `app-server-run` 子路径公开 Delivery-specific runner 所需的最小 lifecycle，而不增加 `ctx.codeExecutors`。

**从 quota-driven planning 和自动启动开始。** 否决，因为 capacity observation 无法弥补不可变范围、隔离执行、恢复、验证和人工验收的缺失。纵向交付循环可靠之前，Runtime Facts 只作为推荐输入。

## 验收标准

- Gate A 能幂等准入 ownerless work，在 post-start durability failure 后执行有界双通道取消，并在无法证明 quiescence 时记录 uncertainty 且不自动重试。
- Gate B 只修改指定 worktree、取消完整 Codex 进程树，并为选定集成路径记录证据。
- 可执行 schema 和 golden fixture 可以 round-trip 每个 Protocol V1 对象，并拒绝非法 id、digest、commit、command plan 和 decision combination。
- Queue 无关 protocol 导出两组 WorkKind DTO，而只有 `delivery-task-queue` 扩展 Queue 并注册其 handler，同时不让 Queue core 依赖 Delivery。
- 十五个 package role 保留各自分配的路径，只有 `Delivery`、`RepositoryWorkspace` 和 `DeliveryEvidence` 发布 Delivery context key。
- Codex runner 只消费受支持的 `app-server-run` 子路径；Delivery group 不引入 generic executor service 或 source deep import。
- Queue admission 前 crash 和 Queue admission 后但 Delivery binding 前 crash 都能 reconcile 到同一个 Work id。
- 一个 Issue revision 可以到达 checkpoint、独立 passed verdict、人工 acceptance 和 restart-stable query result。
- Issue 编辑、重复 admission、取消、forbidden path、失败检查、缺失 evidence 和 host restart 都保留诚实的未验收结果。
- 后续替换或增加 executor 不改变 Contract、Packet、Claim、Verdict、Evidence 或 Acceptance 语义。

## 风险

Delivery group 开发期间，fork 的 Queue API 和 upstream alpha package 可能变化。冻结的 protocol fixture 和 package-local dependency 可以限制 merge surface，但 integration owner 仍须衡量 upstream synchronization cost。

Delivery 和 Queue persistence 可能在 admission 两侧分别失败。Pending-binding protocol 可以获得确定性 convergence，但会增加可见的 incomplete state；corruption 或缺失 bound Work 会 fail closed 并交给 operator review。

Local evidence storage 可能意外扩张成 generic artifact platform。P0 只接受当前代码交付证据类型；另一个 consumer 必须证明更广 service、retrieval authority 和 retention policy 的必要性。

固定 verification command 仍可能执行 repository code。因此 verifier 要求显式 argv、有界 cwd 和 timeout、trusted-plan provenance、隔离 checkout、secret-scrubbed environment 和 subprocess-tree quiescence。

`unknown` code Attempt 可能留下有用修改和不确定外部副作用。P0 保留 worktree 并要求 operator resolution；它放弃自动恢复，以避免重复 mutation 或虚构成功。

产品可能在交付闭环证明价值前扩张为项目管理器。MVP exclusion 和 acceptance scenario 继续作为范围边界；Planner、automatic launch、multi-host operation 和 generalized artifact 需要独立证据与决定。

窄 Codex 子路径有意不具备 registry 的灵活性。第二个 consumer 或 provider 以后可能证明 seam 的必要性，但在此证据出现前增加它，会创建没有当前 owner 的 selection、registration 和 lifecycle policy。
