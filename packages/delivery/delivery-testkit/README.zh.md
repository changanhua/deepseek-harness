---
description: "用于隔离 Consumer 测试的确定性 Delivery fake provider 与 golden fixture builder。"
kind: "package-reference"
---

# @changanhua/dsh-delivery-testkit

[English](README.md) | 中文

## 摘要

`dsh-delivery-testkit` 支持 Delivery Consumer 在不导入本地 provider 的情况下进行隔离测试。它提供具体的 `FakeDelivery`、`FakeRepositoryWorkspace` 与 `FakeDeliveryEvidence` Service Provider，以及每次返回新对象的 Protocol V2 fixture builder。这些 fake 保留生产义务：精确幂等、Case-head compare-and-set、人工 approval 门控、带 failed 记录重置与人工 resolution 的 publication 状态机、provider 派生 verification plan、host-only acceptance candidate 与 evidence read、跨 binding 校验、binding compare-and-set、repository owner 冲突、等待 cleanup、真实 SHA-256 证据校验，以及未配置调用直接失败。

## 使用此包

Consumer 集成测试可以一次挂载三个 fake；当测试关注 service topology 时，也可以只挂载一个 class。

```text
const harness = await mountDeliveryTestkit(ctx)
const packet = readyWorkPacketFixture()
```

Fixture builder 覆盖每个持久记录族：`contractRevisionFixture` 携带其 `origin` 与 `title` provenance，`githubImportOriginFixture` 提供 `github-import` origin，`deliveryCaseFixture`、`requirementDecisionFixture` 与 `issuePublicationFixture`——其 phase 一致的默认值覆盖全部五个 publication phase——与 verification plan、Packet、binding、claim、verdict、acceptance decision、evidence 和 resume capsule 一起补齐 version-2 记录。每个 fixture builder 都通过生产 schema 解析 golden value 并返回新副本，因此一个测试无法修改另一个测试的输入。

Repository 行为必须显式配置：先允许测试所需的 revision、ref head、精确 blob 与 range，再排入 change 或 verification lease。Base resolution 会捕获调用时的 commit，blob read 会强制 exact commit/path/object-id provenance、完整字节上限、abort 传播与全新独立字节副本。`FakeDelivery` 原子地提交 Case 及其 root revision，只在 expected-head compare-and-set 下移动 Case head，把 `github-import` 子 revision 限制在其 repository 与 Issue lineage 内，并把 Packet 创建与 publication 准备门控在 ready 且已 approved 的 revision 之后。它让每个 revision 至多拥有一个 publication：重复 prepare 返回既有记录，failed 记录在既有 id 下回到 `prepared` 以开始新一轮尝试，unknown 记录要求人工 resolution，且每个状态转换在错误 phase 下关闭失败。它先验证两条已存 binding，才调用 acceptance candidate；随后根据精确 Queue claim 与 verdict 自行枚举每个 evidence id，并让第二个 host capability 逐个 resolve 与 integrity-read。Evidence corruption 控制可以删除或替换存储字节，而不改写持久 reference。

需要等待 resolver 的 Delivery 写入按 idempotency key 串行化。并发的精确重试只返回同一个持久对象；并发但发生变化的 DTO 会在获胜写入提交后冲突；resolver 失败会释放该 key，重试仍可进行。

Packet creation 测试使用 `resolveBase`；恢复执行测试通过 `inspectRevision` 验证 Packet 已持久化的完整 base commit。Fake 打开 checkout 时接受该 exact revision，不会重新解析可能已移动的 Contract ref。

## 理解实现

此包只依赖 Protocol 与三个 Service Definition，不导入 Queue、Git、Codex、GitHub 或任何本地 provider。因此 Consumer 测试能证明其声明的 service requirement，也不会意外依赖 provider 路径或虚构的 `ctx.codeExecutors` API。

这些 fake 所保持的 provider 与 Consumer 拓扑见 [Personal Delivery 子系统](../../../docs/subsystems/delivery.zh.md)。

## 开发说明

只有至少两个 Consumer 包需要相同有效 Protocol 对象或 provider 行为时才添加 helper。无效原始 JSON 留在 Protocol fixture 中，避免 typed builder 将无效输入正规化。

## 模型体验

### 仅测试 provider

#### 模型看到什么

模型不会看到来自 `mountDeliveryTestkit` 的内容；此测试支持不会挂载到生产 profile。

#### Token 影响

无。

#### KV Cache 影响

无。

## 已知限制

- Fake repository lease 模拟声明的生命周期结果；真实 Git 行为属于本地 provider 自己的 contract 与 vertical test。
- Testkit 不伪造 Queue scheduling 或 Codex transport；这些 owner 继续使用各自的测试基础设施。
