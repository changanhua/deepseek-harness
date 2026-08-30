# Agent Note: Delivery Queue Bridge 拥有受治理的执行与恢复

Status: implemented

[English](2026-08-30-delivery-queue-bridge.md) | 中文

## 问题

Personal Delivery 持久化不可变 Packet 与 cross-store dispatch binding，Queue 则拥有 Work、Attempt、retry、cancellation、Result 和 Attention。两个存储无法共享 transaction。因此，Bridge 必须通过 Queue 执行 Delivery work，且不能重复任何一侧的状态机、削弱 browser authority，或在 crash 或 cleanup failure 后虚构成功。

冻结的 admission helper 已在 ownerless operator enqueue 前持久化 `submitting`，并有条件地绑定返回的 Work id。缺失的 runtime boundary 是两个 WorkHandler、其 Attempt-local runner 与 verifier capability、诚实的 settlement mapping、可逆 registration 和 restart reconciliation。

## 决策

`@deepseek-ai/dsh-delivery-task-queue` 继续作为 `code.change@1` 与 `code.verify@1` 的唯一 declaration 和 registration owner。它是 function plugin，不发布 service、executor registry、browser Queue facade、durable cache 或 acceptance operation。更宽的 [Personal Delivery 提议](../../proposed/architecture/2026-08-29-personal-delivery-above-queue.zh.md)继续拥有产品拓扑和仍待完成的 Bundle/Profile integration。

Admission 解析严格的 Protocol record，并且只持久化不可变 execution fact。Code-change policy digest 覆盖 executor identity、可选 model、native permission mode、显式 environment、disposal grace 与 model-output limit。Queue 单独持久化 resource claim 与 retry ceiling。Verification 从 Packet 派生 target 和 plan，并独立证明精确的 base-to-target ancestry。

Preparation 把当前 Attempt 解析为一个精确 operator Work view，重新验证其持久化 resolved fact，并物化 provider proof 与 operation-local closure。它可以检查 revision 并绑定 evidence provenance，但不会打开 checkout、spawn process 或发布 evidence。`start()` 调用 runner 或 verifier，并同步返回其 live cancellation 与 settlement owner。

Runner 和 verifier success 会在 Bridge 再次解析，并验证精确 Packet、Work、Attempt、target、plan 和 verifier identity。Cancellation 结算为 `canceled`。已证明的 validation 和 startup failure 结算为不可重试的 `failed/not-started`；已完全停稳的 product、completion、workspace-boundary 或 execution failure 结算为不可重试的 `failed/started`；ownership、cleanup、unexpected rejection 或 malformed successful output 结算为 `unknown/unknown`。

Activation 仅在可信 Host composition 内取得 operator authority。它把两个 handler 注册为一个可逆 effect，扫描 Delivery snapshot 与 Queue operator view，拒绝缺失或 malformed 的 bound Work view，并用已存 canonical input 和 idempotency key 恢复每个 `submitting` binding。Recovery 不存储 projection，也绝不创建 acceptance decision。

## 考虑过的替代方案

**发布 generic executor 或 Bridge service。** 否决，因为一个 Codex runner 与一个 Delivery consumer 不足以证明 selection、registry、wire 或 lifecycle policy 的必要性。Package-local factory 与 operation-local closure 已覆盖当前用途。

**让 Remote 或 Config 携带 operator authority。** 否决，因为 Queue enqueue、result lookup 与 recovery 都是可信 Host operation。插件在内部创建 verified operator facade，只暴露既有的 narrow admission function。

**自动重试每个 failure。** 否决，因为已开始或不确定的 execution 可能产生 external effect 或拥有 worktree。Bridge 保留 Queue 的 side-effect classification，并在默认单 Attempt 下让每个 mapped failure 都不可重试。

**从 transient Queue event 或另一个 Bridge cache 恢复。** 否决，因为 missed event 与 cache state 无法证明 cross-store truth。Activation 只从 durable Delivery record 与当前 Queue view 重建。

## 后果

Delivery work 只有一个 Queue lifecycle 和一个 Delivery binding lifecycle。Handler disposal 会移除两个 registration，restart 会通过 Queue idempotency 收敛 incomplete handshake，且任何 runtime path 都不会自动验收 delivery。

Package test 以逐文件 100% source coverage 固定 strict resolved fact、policy identity、resource、retry policy、Attempt lookup、无副作用 preparation、同步 live ownership、provenance、typed output、cancellation、settlement truth、registration disposal、crash-window convergence、malformed view 和不自动 acceptance。

Bundle/Profile composition 与八个 product-level acceptance scenario 仍由 integration 拥有。本决策证明 package behavior 与 Host activation boundary，而非 assembled product runtime behavior。
