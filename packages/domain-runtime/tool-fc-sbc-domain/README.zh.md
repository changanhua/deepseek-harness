---
description: "Let an agent inspect supplied FC observations, build candidate plans and inspect their current status through three typed tools."
kind: "package-reference"
---

# @changanhua/dsh-tool-fc-sbc-domain

[English](README.md) | 中文

## 摘要

让智能体通过三个类型化工具处理已有 FC 观察、生成候选方案并查看当前状态。返回不可变引用与有界摘要，不返回大载荷。工具不采集实时观察、不批准方案、不执行 FC 操作。仅在会话需要该离线 FC 工作流时挂载。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在显式启用的 Cordis 组合中挂载插件；它不是 profile bundle，也不加入默认组合。[Loader 组合 fixture](../fc-sbc-domain/tests/fixtures/cordis.yml) 拥有完整的 storage/service/tool 接线。

插件要求 `tools` 与 `fcSbcDomain`。`fc_sbc_inspect` 接受类型化已有观察，`fc_sbc_plan` 接受精确 Reality 引用，`fc_sbc_status` 读取紧凑摘要。即使模型 schema 未展示某项上限，执行时仍验证。

| Field | Default | Meaning |
|---|---|---|
| `maxOutputBytes` | `8192` | 完整渲染 JSON 结果上限；允许 1024–32768 |

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制</summary>

工具按 effect 生命周期注册类型化操作，并将领域决策交给 `fcSbcDomain`。达到配置的字节上限时，结果缩减为引用、状态与计数；紧凑封装仍超限则拒绝。源输入与载荷持久化仍归 FC 服务。见[工具实现](src/index.ts)。

不发布 `./invariant` companion：插件拥有可逆工具注册，没有独立耐久状态。

</details>

<a id="further-exploration"></a>
## 进一步阅读

- [组图](../README.zh.md) — 包职责。
- [子系统合同](../../../docs/subsystems/domain-runtime.zh.md) — 元数据与派生关系。
- [所有权决策](../../../.agents/notes/implemented/architecture/2026-09-30-domain-runtime-artifact-owners.zh.md) — 替代方案与取舍。

<a id="model-experience"></a>
## 模型体验

### 挂载包上下文

#### 模型看到什么

[生成的工具目录](../../../docs/tool-catalog.zh.md#changanhuadsh-tool-fc-sbc-domain) 拥有工具描述与 schema。数据相关结果包含引用及有界的覆盖、新鲜度、问题、候选与就绪度摘要；不注入完整载荷。

#### Token 影响

挂载工具会增加 schema；每次结果受 `maxOutputBytes` 限制，该限制是字节上限，不是 token 保证。

#### KV Cache 影响

稳定工具定义可保留已有可复用前缀；挂载、移除或 schema 变化可能改变该前缀。结果追加与 provider 缓存可用性是不同问题。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **无实时刷新** — inspect 编译已有证据，status 不重新采集。大工件通过所有者读取，不内联进工具结果。
- **无执行权限** — 工具不能购买、填阵、提交、修改 Planning 或调用 Safety；方案引用不是批准。

<a id="dev-note"></a>
### 开发备注

无。
