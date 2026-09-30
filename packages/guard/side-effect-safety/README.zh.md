---
description: "持久审批、独占执行租约、有界副作用准入与只读 UNKNOWN 对账恢复。"
kind: "package-reference"
---

# @changanhua/dsh-side-effect-safety

[English](README.md) | 中文

## Summary

这个按需加载的 Host 防护包仅接纳已批准的副作用，跨重启保留结果，并在结果未知时阻断后续动作。领域 adapter 提供人类确认证据、范围验证、私有执行器和读回。本包不提供浏览器或业务领域执行器，也不暴露模型工具或 Remote 修改方法。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

将本服务与 Storage Domain、已配置的 backend 及 user-approval 一起挂载。所有上限均为部署必填项。[构建产物 Loader fixture](tests/fixtures/runtime.mjs) 提供仅使用合成回调的可执行配置例子；发布的 profile 不默认激活本防护包。

| Field | Default | Meaning |
|---|---|---|
| maxExecutions | required | 最多保留的 execution 数 |
| maxApprovals | required | 最多保留的审批 artifact 数 |
| maxActionsPerExecution | required | 每个 execution 最多保留的 action 数 |
| maxRecordBytes | required | 完整审批或 execution 的 UTF-8 字节上限 |
| maxTotalBytes | required | 完整持久状态的 UTF-8 字节上限 |
| maxEvidenceRefs | required | 每次审批或结算保留的引用数 |
| maxAdmissionMs | required | 准入 handle 的最长寿命 |

可信 Host 插件使用自身生命周期 context 调用 `bindSafetyAdapter`。激活会调用 `ctx.approval.request`，并独立验证人类身份及与完整审批草稿摘要绑定的证据。一份 artifact 仅资助一个 execution。`prepare` 只保存意图、不保存 payload；`admit` 返回不透明的一次性 handle，仅原始 binding 能执行它。复制 handle 或 raw action 均不能执行。

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals</summary>

[Storage Domain 定义](src/state.ts) 拥有一个有界原子文档。串行读改写在发布快照前提交。SENT 与风险消耗一起提交后才调用私有执行器。预算保守计算尝试风险：NOT_APPLIED 不退还已消耗风险。运行时策略在准入和发送时重复检查，包括异步验证后的过期检查。幂等身份冲突会持久阻断 execution。

重启使旧 runtime lease 失效，并将遗留 SENT 或 RECONCILING 动作转为 UNKNOWN。恢复仅向只读检查传递账本元数据。验证证据可以终结原动作，但不会使该身份再次可执行。暂停和中止保留所有可能已发送的效果。中止只取消 PREPARED 动作，且不能恢复执行。

[公开 Host 合同](src/types.ts) 区分 adapter 能力与脱离内部引用的快照。[子系统参考](../../../docs/subsystems/side-effect-safety.zh.md) 拥有状态机和持久化语义。不发布 invariant companion：本包没有可供交叉比较的独立事件投影或重复可变缓存；提交和打开时验证唯一权威记录。

</details>

<a id="model-experience"></a>
## Model Experience

### Host-only admission

#### What the model sees

本包不注册模型工具或 transcript 事件。Dynamic Cordis 可检查有界 `ctx.sideEffectSafety.snapshot` 结果；修改必须经私有 Host binding。

#### Token effect

不自动增加模型 token。显式快照检查会增加消费者请求的有界投影；账本只存摘要和证据引用，不存 transcript 或领域 payload。

#### KV Cache effect

不改变提示词或使 KV Cache 失效。

## Known Limitations and Deferred Work

- Storage Domain 只有一个 Host writer。JSON storage 不仲裁独立进程；共享根目录需要部署保证独占存储，例如 SQLite backend 的 exclusive 模式。本包不提供分布式租约，也不对可信 Host 代码实施沙箱。
- 人类身份、范围正确性和证据有效性由 adapter 拥有。没有注册生产 adapter。自动化审批结果缺少经验证的人类证据时不能激活 artifact。
- 执行器和检查器必须结算其 promise；dispose 等待活动操作完成。超时不会被解释为 NOT_APPLIED。结算持久化失败会保留未决 SENT 或 RECONCILING，等待重启和读回。
- 留存有界并失败关闭。不自动删除记录，不退还预算，也不提供 UNKNOWN 豁免。
- BrowserTask 传输映射、生产 UI、真实领域写入及 FC adapter 不在本包范围内。不迁移现有 BrowserTask 和 Delivery owner。

<a id="dev-note"></a>
### Dev Note

[持久准入决策](../../../.agents/notes/implemented/architecture/2026-09-30-side-effect-safety-kernel.zh.md) 说明所有权与保守风险计算的取舍。
