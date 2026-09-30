---
description: "Compile supplied FC read observations into durable Reality artifacts and derive candidate Plans from an exact Reality reference."
kind: "package-reference"
---

# @changanhua/dsh-fc-sbc-domain

[English](README.md) | 中文

## 摘要

将已有 FC 读取观察编译为耐久 Reality 工件，并从精确 Reality 引用派生候选 Plan。工件在所有者重启后仍可读，读取结果与存储分离。部分观察、不完整搜索及缺少化学反应或报价证据都保留为明确阻塞。本包不登录 FC、不操作浏览器、不执行业务写入。

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

服务要求 `storageDomain` 与 `domainArtifacts`。它拥有版本 1 的 Storage Domain `fc_sbc_artifacts`。容量不足拒绝发布，不隐式淘汰工件或采集实时浏览器数据。

| Field | Default | Meaning |
|---|---|---|
| `maxArtifacts` | `256` | 最多保留的工件数 |
| `maxArtifactBytes` | `1048576` | 完整序列化工件字节上限 |
| `maxCards` | `2000` | 可接纳观察的卡片容量 |
| `maxChallenges` | `8` | 可接纳挑战容量 |
| `maxCrossChallengeCombinations` | `10000` | 跨挑战候选组合搜索上限 |

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制</summary>

编译器投影已有 read/probe 的白名单字段，复用扩展库存、页面、求解与报价 helper，通过 FC 所有的串行 Storage Domain 写入发布。canonical SHA-256 身份、请求回执与 canonical 输入回执保留不可变重放；同一请求 ID 对应不同输入时拒绝。包级打包包含已有纯算法，不复制为第二份所有者源码。见[编译器](src/compiler.ts)、[存储](src/store.ts)与[类型化桥接](src/algorithms.ts)。

不发布 `./invariant` companion：Storage Domain 值是唯一耐久权威，冷读取直接验证工件 digest 与回执关系。

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

- **证据接纳而非来源认证** — capture 验证已有 read/probe 的结构与覆盖一致性，不认证实时 Browser receipt，也不证明模型提供的事实真实发生。这些工件本身不能授权未来的 Safety 执行。

- **只处理观察** — 调用者提供已有观察与来源；本包不登录、不刷新页面。缺少过期时间表示新鲜度未知；status 计算过期状态，不改写历史工件。
- **部分组证据** — 已有 main-read 可筛选挑战但不证明全组遍历完成，因此即使库存完整，组覆盖仍为 partial 或 unknown。
- **仅候选规划** — 不提供实时 native chemistry、真实报价、批准或执行。有界搜索与缺失证据不能产生 ready-for-approval。
- **构建所有权** — 纯 FC 算法仍归扩展源码，必须打包进 Host 工件；公开声明与运行时不能依赖已部署的扩展源码目录。

<a id="dev-note"></a>
### 开发备注

无。
