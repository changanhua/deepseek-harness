---
description: "供部署者和维护者配置持久浏览器活动与 Session 步骤证据、保留周期和有界范围读取的 Host 工作观测说明。"
kind: "package-reference"
---

# @changanhua/dsh-host-work-observatory

[English](README.md) | 中文

## Summary

本包让 Web 产品保留人类活动和打开的 Session 步骤墙钟时间本地证据，并读取指定日期或项目的有界范围。Host 使用自己的时钟标记浏览器观测、拒绝重复序号，并通过 `ctx.storageDomain` 保存全部非 Session 记录。计算总量前会合并并发标签页和 Session，所以同一墙钟时刻只计算一次。结果描述观测到的区间，不衡量生产力、CPU 使用量或节省的时间。

## Table of Contents

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步了解](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发注记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将此服务与 Session 存储和 storage-domain 数据形式一同挂载；随附的 Web bundle 已提供这套组合。

### 何时选择

当本地 Web 部署需要跨 Session 查看人类／Agent 墙钟证据时选择本包。没有工作观测浏览器页面的 headless 或 SDK 组合可以省略它。

### 最小配置

```yaml
- name: '@changanhua/dsh-host-work-observatory'
  config:
    retentionDays: 90
    maxClients: 128
    maxQueryRecords: 10000
```

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `retentionDays` | `90` | 浏览器转换记录和已关闭步骤的保留天数。 |
| `maxClients` | `128` | 同时保留的浏览器 document 身份上限。 |
| `maxQueryRecords` | `10000` | 一次范围读取可消费的已存转换与步骤记录上限。 |

`observeClient` 接收一个单调递增的浏览器状态且只记录 Host 时间；`readRange` 要求有限的 `from < to`，拒绝超过 31 天的范围，并可按规范项目路径过滤。[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-host-work-observatory)是全部可接受字段的生成来源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

浏览器心跳更新一份紧凑的 client 状态；只有状态或 Session 变化才新增转换记录。Session `step/start` 和 `step/end` event 生成持久步骤记录。范围读取会重建半开区间、按请求裁剪、合并并发记录，并从规范化区间集合推导重叠时间。存储 domain 使用路径安全的哈希记录键，因此 JSON 和 SQLite 后端共享同一格式。

准确的所有者分别是负责生命周期和 Remote 方法的 [`src/index.ts`](src/index.ts)、负责持久 schema 的 [`src/spec.ts`](src/spec.ts)，以及负责区间代数的 [`src/projection.ts`](src/projection.ts)。

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

- [工作观测子系统](../../../docs/subsystems/work-observatory.zh.md)——端到端语义与包所有权。
- [存储子系统](../../../docs/subsystems/storage.zh.md)——本包使用的唯一持久化路径。
- [Session 子系统](../../../docs/subsystems/session.zh.md)——这里投影的持久步骤 event。
- [Client 包](../../client/ui-work-observatory/README.zh.md)——浏览器生产者与用户页面。

-----

<a id="model-experience"></a>
## 模型体验

无，因为这个仅 Host 使用的时间证据服务不注册 prompt、tool、message 或 provider request。

#### KV Cache 影响

无；工作观测读写位于模型输入之外，也不会启动模型请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **Agent 时间是 Session 步骤墙钟时间**——它可能包含打开步骤中的 provider、tool、subagent 或人类等待区间，不是 CPU 时间。
- **仅限本机证据**——本包不合并多个 Host，也不声明因果生产力或节省时间。
- **可选 domain bridge 尚未提供**——Queue、Delivery 和 Skill 调用事实保持独立，直到专用 bridge 提供这些事实。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
