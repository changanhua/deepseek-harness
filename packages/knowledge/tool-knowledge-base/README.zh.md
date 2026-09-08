---
description: "可安装的 DSH 知识库 bundle，为模型工具和 /knowledge 命令增加来源、构建、检查、发布和恢复操作。"
kind: "package-bundle"
---

# @changanhua/dsh-tool-knowledge-base

[English](README.md) | 中文

## Summary

`dsh-tool-knowledge-base` 为 `dsh --profile` 界面添加可编辑、基于来源的知识库工作流。其 bundle patch 挂载业务仓库、原生 Codex Queue 桥接和 `knowledge_base` 工具；带 commands 的 Profile 也会获得 `/knowledge`。在 `dsh-base` 后添加 bundle，然后使用显式的 create、source、confirm、build、check、publish、思源和恢复请求。build 不会自动发布，生成会保持停止，直到人工 `/knowledge` 命令或可信 Host 发送 `resume-generation`；模型工具会拒绝该 action。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

将 bundle 安装到自定义 Profile，其 bundle 顺序置于 `@deepseek-ai/dsh-base` 之后，然后通过 `dsh --profile <name>` 启动 Profile。

在已构建源码检出且已配置 Web Profile 时，可用 `pnpm dsh --profile web --patch packages/knowledge/tool-knowledge-base/cordis.patch.yml` 启动附加功能。补丁只用于本次启动，不修改保存的 Profile；选择构建产物前先运行仓库正常的 Host 构建。

### Minimal workflow

每次知识任务都会生成自己的地图。使用 `{"action":"map","projectId":"<id>"}` 查看当前规划与条目关系；发布总是包含地图，`siyuan-sync` 自动写入对应思源地图并返回 `mapDocumentId`。无需为特定主题手工补地图，也不增加额外模型调用。

将每个 JSON 对象作为 `knowledge_base` 的 `request` 字符串，或放在 `/knowledge` 命令之后。`plan` 返回工作后，先查看该工作直到成功，再读取 `status` 并确认当前 `planHash`，然后构建。

```json
{"action":"create","spec":{"id":"game-vibe","title":"Game ideas","readerTask":"plan a prototype","language":"en","seeds":[]}}
{"action":"source","projectId":"game-vibe","sourceId":"brief","title":"Brief","text":"Prototype the core loop."}
{"action":"plan","projectId":"game-vibe"}
{"action":"confirm","projectId":"game-vibe","planHash":"<status planHash>"}
{"action":"build","projectId":"game-vibe"}
{"action":"check","projectId":"game-vibe"}
{"action":"publish","projectId":"game-vibe","version":"v1"}
{"action":"siyuan-sync","projectId":"game-vibe","version":"v1"}
{"action":"siyuan-verify","projectId":"game-vibe"}
{"action":"status","projectId":"game-vibe"}
```

`build.maxRevisions` 为 0–3，默认 2；同一输入的格式修正也使用该配置上限。build 在 `unknown` 工作时停止，绝不自动重发。仅在已验证收据可结算未知工作后使用 `resume`；仅对已知 `not-started` 失败使用 `retry`，仅对已知 `knowledge-validation` 失败使用 `correct`。`export-draft` 显式写入部分草稿，不登记完整发布或修改 `currentRelease`；`diff` 先核验两个完整发布，再列出新增、删除和变化的条目 ID。`stop-generation` 持久保存停止状态并等待已知活动调用结束。只有人工 `/knowledge` 命令与可信 Host 请求路径可以发送 `resume-generation`；`knowledge_base` 工具调用会被拒绝。

### 思源编辑

同步前配置 `knowledge-base.siyuan` 和既有原生 `mcp-client` 服务。`siyuan-sync` 仅接收正式已发布版本，创建首次条目文档或单独命名的更新候选。`siyuan-status` 报告映射文档和候选 ID。人员在思源中编辑条目标题或知识正文段后，先用 `siyuan-inspect` 回读并取得 `snapshotHash`，再通过 `/knowledge` 或可信 Host 以该哈希调用 `siyuan-adopt`。面向模型的工具允许 `siyuan-status`、`siyuan-verify` 和 `siyuan-inspect`，但拒绝 `siyuan-sync` 和 `siyuan-adopt`。来源与适用条件段的修改不会被接纳。需要实时文档和搜索索引证据时运行 `siyuan-verify`；版本目录只为读者链接条目。

### Profile Queue override

bundle patch 会在既有 Queue 容量旁设置 `knowledge-base: 1` 和 `codex: 1`。Profile 本地替换 `task-queue` config 时必须重述这些容量，因为 row config 会整体替换。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>实现细节 — 点击展开</summary>

`cordis.patch.yml` 是位于 `dsh-base` 之上的 layer。它配置 Queue 容量，并按依赖顺序插入仓库、Queue bridge 和工具。request executor 会在调用包服务前校验封闭 action 集；面向模型的 executor 会拒绝 `resume-generation`、`siyuan-sync` 和 `siyuan-adopt`，人工命令和可信 Host 则通过同一业务 executor 执行这些 action。它不会向模型暴露 subprocess、credential 或 storage 配置。

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | Bundle layer 和默认知识 Queue 容量。 |
| [`src/index.ts`](src/index.ts) | 工具、可选命令、请求校验和操作分派。 |
| [`src/build.ts`](src/build.ts) | 有界且按依赖排序的 build 编排。 |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Knowledge package map](../README.zh.md) — 包族。
- [Knowledge business repository](../knowledge-base/README.zh.md) — 可编辑内容和发布。
- [Knowledge Queue bridge](../knowledge-base-task-queue/README.zh.md) — 原生执行和恢复。
- [Base bundle](../../bundle/base/README.zh.md) — Profile 分层和启动约定。

-----

<a id="model-experience"></a>
## Model Experience

### 知识工具

#### What the model sees

模型会看到一个带 JSON request 字段及受支持业务 action 描述的 `knowledge_base` 工具。它不会看到 filesystem root、Queue 配置、credential 或 subprocess control。

#### Token effect

工具 schema 和 action 指引会向请求增加一个工具定义。build 和 stage prompt 分别由仓库与 Queue 包拥有。

#### KV Cache effect

工具定义在已组合 Profile 内保持稳定。变更 bundle 组合或工具集可能改变请求前缀和缓存复用。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

这些限制让自动化有界且发布保持审慎。

- **不自动发布** — `build` 返回 completed 或 incomplete work；`publish` 始终是 `check` 通过后的独立请求，而 `export-draft` 明确是部分草稿。
- **修正次数有界** — `maxRevisions` 同时限制格式修正和审查驱动再生成，为 0–3 次额外修订，默认值为 2。
- **unknown work 需要显式恢复** — build 不会重发副作用不确定的模型 work。
- **fetch 依赖 Profile** — URL fetch 和 refresh 需要可选 web service；直接来源文本不需要。
- **思源写入需要可信调用方** — 模型工具不能同步或接纳；需要配置原生 MCP client，并通过人工命令或可信 Host 路径调用。

<a id="dev-note"></a>
### Dev Note

无。
