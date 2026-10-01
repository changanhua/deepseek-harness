# Side-effect safety

[English](side-effect-safety.md) | 中文

本 Host-only 子系统以持久人类批准范围、确定性预算和运行时租约接纳动作。[包参考](../../packages/guard/side-effect-safety/README.zh.md) 拥有配置与部署限制。[Host 合同](../../packages/guard/side-effect-safety/src/types.ts) 和[持久 schema](../../packages/guard/side-effect-safety/src/state.ts) 是类型权威。

## Authority and ownership

绑定生命周期的 Host adapter 拥有领域解释、经认证的人类确认、私有发送器和证据验证。内核拥有动作身份、摘要绑定、原子准入、风险消耗、业务租约与持久结果。它不注册模型工具或 Remote 方法。`allowed-once` 只用于激活请求；独立验证的完整人类审批 artifact 才提供持久授权。Planning adoption 不提供副作用授权。

## Durable state

Storage Domain `side_effect_safety` version 1 用一个 global 文档保存 `approvals` 和 `executions`。每个 execution 带 revision、不可变审批绑定、target、控制状态、租约、硬阻断和动作账本。动作只保留意图摘要、风险成本、时间戳和不透明证据引用；不持久化领域 payload 或证据字节。一份审批只资助一个 execution，不能通过新建 execution 重置预算。CAS 和目标独占使用同一个串行 writer 和持久提交。

## Transitions and commit order

`PREPARED → SENT → CONFIRMED | NOT_APPLIED | UNKNOWN`；`UNKNOWN → RECONCILING → CONFIRMED | NOT_APPLIED | UNKNOWN`。只有未发送 PREPARED 可变成 CANCELLED。终态或未决动作身份永不返回 PREPARED。幂等 prepare 返回当前记录，不授予再次执行权限。

Prepare 提交意图。Admission 验证范围、payload、审批、当前租约、预算、breaker 和 revision，并生成短时进程内 handle。Send 消费 handle、重新验证，将 SENT 与风险消耗一起持久提交后才调用 adapter。Readback 随后持久结算账本。SENT 提交失败不会调用 sender。结算失败保留未决记录。重启将遗留 SENT 和 RECONCILING 标记为 UNKNOWN，使旧租约失效，不调用 sender。

## Breaker and recovery

任何未决 SENT、UNKNOWN 或 RECONCILING 都会阻断相同 domain target 的后续发送，包括其它 execution。只读对账必须有证据才允许终态；缺失数据、异常和不合规结果保持 UNKNOWN。审批过期、预算耗尽、租约失效、幂等冲突和存储不一致均失败关闭。Pause 阻止准入；abort 仅取消未发送动作。完成要求非空且验证过的终态动作，并且没有硬阻断。预算保守保留所有已发送风险，包括 NOT_APPLIED 尝试。

账本为每个已发送动作保留唯一 `sentRevision`。连续失败预算按持久发送顺序计算，不依赖准备顺序或可能相同的时钟时间戳。

## Existing owners

[BrowserTask](../../packages/browser/browser-task/README.zh.md) 与扩展 journal 拥有传输级意图和只读恢复；本内核不添加浏览器传输或竞争 journal。[Delivery](delivery.zh.md) publication 的 prepared/publishing/unknown 对应 PREPARED/SENT/UNKNOWN，但其显式 confirm-not-created 重试策略仍由原 owner 拥有：本内核永久将原 action 终结为 NOT_APPLIED。[Session persistence](persistence.zh.md) writer 锁保护日志写入者；本 execution lease 保护业务准入。证据 owner 保留字节，本子系统只保存不透明引用。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsideeffectsafety--sideeffectsafety"></a>

### `ctx.sideEffectSafety` — `SideEffectSafety`

One Storage Domain writer owns all business leases and durable action records.

```ts cordis-catalog
/**
 * Return detached committed state and a current-clock breaker projection.
 * @param id - Execution identity.
 * @returns bounded snapshot with no action payload or evidence bytes.
 */
snapshot(id: SafetyExecutionId): SafetySnapshot
```

Source: [`packages/guard/side-effect-safety/src/index.ts`](../../packages/guard/side-effect-safety/src/index.ts)
<!-- END GENERATED cordis-surface -->
