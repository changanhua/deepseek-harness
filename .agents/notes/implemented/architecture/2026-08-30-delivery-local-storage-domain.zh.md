# Agent Note: Delivery local 记录使用一个 Storage Domain

Status: implemented

[English](2026-08-30-delivery-local-storage-domain.md) | 中文

## 问题

Personal Delivery 需要让不可变 Contract revision、Work Packet、Queue dispatch binding 与人工 decision 在宿主重启后继续存在。只保留内存 projection 会丢失对未完成 Queue admission 进行 reconcile 所需的 authority；把 Queue Work、Attempt 或 evidence bytes 存入 Delivery 记录旁边，则会为这些事实建立第二个 owner。

Service Definition 还承诺 operation-wide idempotency。持久 provider 必须为精确 replay 返回原结果，拒绝用同一个 key 提交另一 operation 或 request，并在任何并发调用分配不同持久 identity 前完成串行化。

## 决策

`delivery-local` 打开一个名为 `personal_delivery`、格式版本为 1 的私有 Storage Domain。其 4 张表存储经过 Schema 校验的 `ContractRevision`、`WorkPacket`、`DispatchBinding` 与 `AcceptanceDecision` object。同步读取与 snapshot 直接从已打开的 domain 投影；每次写入只有在 Storage Domain 提交后才会变得可见。

此 provider 不在该 domain 中保存 Queue Work 与 Attempt 状态、Git checkout、verification execution 或 evidence bytes。它实现更广泛的 [Personal Delivery architecture](../../proposed/architecture/2026-08-29-personal-delivery-above-queue.zh.md) 中的本地持久化部分，同时不修改已冻结 Protocol 或其 3 个 Service Definition。

### 持久幂等

每个幂等 record key 都包含 caller key 的 SHA-256 identity、operation name 与完整 request digest。写入前，provider 会在全部自有表中扫描 caller-key prefix。operation 与 digest 完全一致时返回已存 object；任何其他用法都会在调用 repository、Queue 或 evidence resolver 前以 `idempotency-conflict` 拒绝。

进程内 tail 会串行化共享同一个 idempotency key 的调用，Storage Domain 则串行化持久写入本身。被拒绝的写入既不改变内存 projection，也不改变 backing medium，因此 retry 可以用相同 key 再次运行该 operation。

### Acceptance 提交边界

记录 decision 时，provider 会解析精确绑定的 change 与 verification Queue Work identity，校验其 Attempt facts、completion claim、verification intent、verdict、Packet plan、base 与 target，然后完整性读取每个被引用的 evidence object。只有这些检查全部成功后，provider 才会持久化人工编写的 decision。rejection 或 waiver 仍然需要精确 Queue candidate，但不会宣称失败 evidence 已通过。

## 考虑过的替代方案

**持久化第二套 Delivery lifecycle 状态机。** 拒绝，因为 Queue 已拥有 Work 与 Attempt lifecycle。Delivery 只存储其不可变记录，以及 submitting/bound 跨存储握手。

**使用随机 record id，但不保存持久 idempotency metadata。** 拒绝，因为在 response outcome 不明确后重启，可能会为同一个 request 创建另一个 Contract、Packet、binding 或 decision。

**在第 5 张 custom-schema 表中存储 idempotency row。** 拒绝，因为每张持久表的 value 都应使用已冻结 Protocol Schema。把 key、operation 与 request digest 编码到每个 result record 的 storage key 中，可以保留 replay detection，又不会扩展 Protocol 或新增 record type。

**不重新读取 evidence 就信任 passed verdict。** 拒绝，因为 verdict 是对 evidence integrity 的 claim，而不是不可变 bytes 或 metadata 本身。普通 acceptance 会通过 host-owned integrity-reading capability 解析每个被引用的 evidence id。

## 测试

定向测试会在持久内存 medium 上挂载真实 Storage hub 与 Domain Facility。测试覆盖 restart recovery、并发和跨 operation idempotency、source lineage、Contract readiness、Contract-field 和有界 Git-blob plan resolution、submitting-to-bound Queue handshake、acceptance authority mismatch、evidence provenance 与 integrity failure，以及包自有 durable-projection invariant。每文件 statement、branch、function 和 line coverage 均为 100%。

## 后果

Delivery 记录保持 restart-stable，同时不借用 Queue 或 evidence authority。即使 caller 只观察 Protocol id，storage-key format 也会成为私有 version-1 medium 的一部分。未来 format change 必须显式决定 Storage Domain version，不能静默接受旧 medium。

此 provider 由单个进程持有。Storage Domain notification 不会同步另一个 host process；不可变记录也没有自动 retention，因此 backend selection 必须考虑独占 ownership 与持续的历史增长。
