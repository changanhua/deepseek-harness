---
description: "Discover domain providers and read immutable artifacts by reference."
kind: "package-reference"
---

# @changanhua/dsh-domain-runtime

[English](README.md) | 中文

## 摘要

发现领域 provider 并按引用读取不可变工件。provider 支持分离读取时，只读元数据不加载载荷。未知领域、不支持的 kind 和身份不匹配直接拒绝，不路由到回退实现。载荷持久化与业务语义归 provider。

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

没有包专属配置字段。通过 `ctx.domainArtifacts` 为每个领域注册一个 provider，由贡献方 fiber 拥有其生命周期。重复注册被拒绝；卸载移除路由，并使该次注册尚未完成的读取失效。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制</summary>

注册表验证完整元数据封装与请求的精确身份，然后复制 JSON 载荷，不解释其字段。它保留 provider 注册，不保留领域工件。schema 解析与分离读取防止调用者改变所有者状态。见[注册表](src/index.ts)与[元数据 schema](src/schema.ts)。

不发布 `./invariant` companion：注册属于进程本地状态，读取验证 provider 边界，不比较由不同所有者维护的耐久观察。

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

本包不注入模型提示词或工具 schema。是否把工件引用与摘要送入模型请求，由 `tool-fc-sbc-domain` 消费方决定。

#### Token 影响

直接模型 token 增量为零；消费方渲染不归本包。

#### KV Cache 影响

本包不替换请求前缀内容，也不发起独立模型请求；缓存复用取决于消费方提示词与工具路径。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **不存储或执行** — provider 拥有载荷保留、耐久性与领域操作；注册表没有回退 provider。
- **有界元数据** — 单个 header 或 descriptor 至多 32,768 UTF-8 字节；lineage 只暴露直接父引用，不递归遍历图。

<a id="dev-note"></a>
### 开发备注

无。
