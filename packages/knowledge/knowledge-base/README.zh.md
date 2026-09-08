---
description: "面向需要可编辑 Markdown、已验证产物、检查和显式发布的 Profile 的持久来源可追溯知识项目。"
kind: "package-reference"
---

# @changanhua/dsh-knowledge-base

[English](README.md) | 中文

## Summary

`dsh-knowledge-base` 在配置的内容存储中保留每个已提交条目可编辑，同时持久保存基于来源的知识项目。它在 Domain 支持的记录中保存来源快照、已准备生成输入、已捕获响应、已接受候选、审查、检查、不可变发布物及可选思源映射，因此后续 Queue 恢复可完成已验证收据或候选而无需再次调用模型。适用于需要受管内容和显式发布的 Profile；它本身不提供模型工具，也不调度工作。包报告完成前会完成文件写入，但不承诺断电耐久。

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

使用 Storage Domain provider 挂载该服务，并提供绝对的受管内容根目录。

### Minimal configuration

```yaml
- name: '@changanhua/dsh-knowledge-base'
  config:
    root: /absolute/path/to/knowledge-base
```

| Field | Default | Meaning |
|---|---|---|
| `root` | required | 包含受管项目、来源快照、版本导出、产物、报告和发布物的绝对根目录。 |
| `siyuan` | `false` | 可选的可信思源目标。启用后按名称使用既有 `mcp-client` 服务，并配置笔记本、根路径及可选的固定项目根文档。 |

生成的[配置目录](../../../docs/config-catalog.zh.md)是可接受配置的完整来源。要让思源成为可编辑知识库，请配置已经组合的 MCP client；服务会调用该 client 的原生 `mcp__<serverName>__document`、`block` 和 `search` 工具，不会安装 client 或修改日常 Profile。

```yaml
- name: '@changanhua/dsh-knowledge-base'
  config:
    root: /absolute/path/to/knowledge-base
    siyuan:
      serverName: siyuan
      notebook: your-notebook-id
      rootPath: /AI 生成知识库
      projectRoots:
        game-vibe: existing-project-document-id
```

### Content and publication

创建项目、通过 consumer 导入或抓取来源快照、确认其 plan hash，然后准备 `plan`、`generate` 或 `review` 阶段。已接受的生成会保存不可变产物和可编辑工作条目。配置思源后，`siyuan-sync` 从正式发布版本创建首次可编辑条目文档；后续生成版本会成为单独命名的候选，不会原地覆盖该原始文档。`siyuan-inspect` 返回当前标题、正文和确认哈希。用户可在思源中修改原始标题或正文，再用带该哈希的 `siyuan-adopt` 接纳编辑并使原审查失效。来源与适用条件段的修改会被拒绝接纳。`siyuan-status` 报告持久映射，`siyuan-verify` 回读实时文档和搜索索引；版本目录只是阅读入口，不是实时完成凭证。

`check` 比较当前受管内容、来源、依赖、已记录审查结论和已配置的思源映射。`publish` 只在当前检查通过后成功，并创建带版本的不可变发布物，不会在生成完成时自动发布。来源快照和版本导出仍保留在 `root`；思源映射保存写入意图和稳定文档标识。若恢复时已派发的文档创建没有匹配文档，服务会保留继续点供操作者处理，而不重试创建。

同一受信 Profile 内，受管根目录下的项目由其会话共享。该包不会为项目、条目、产物或发布物附加 session 私有 ACL。

发布物中的 `sources.json` 记录来源元数据和快照身份，不包含完整来源文本。将可编辑文档或 Markdown 导出复制到另一安装实例不会恢复 Domain 记录、已准备阶段、Queue work item 或思源映射。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>实现细节 — 点击展开</summary>

一条 Domain 项目记录是业务权威。阶段在 prepared、publishing 和 completed 业务状态间迁移，而 Queue 独立保留 Work 和 Attempt 状态。`captureResponse` 会在 cleanup 前记录已完成原生响应，`recoverStage` 会在写入缺失条目或重放已完成阶段前校验该收据或候选。文件层保留来源快照、导出和不可变内容寻址产物；可选思源投影保存写入意图、稳定文档 ID、观测基线和候选，在接纳前回读，且不原地更新既有条目文档。

| File | Role |
|---|---|
| [`src/repository.ts`](src/repository.ts) | 项目操作、阶段接受与恢复、检查和发布。 |
| [`src/files.ts`](src/files.ts) | 受管 Markdown、不可变产物和发布文件。 |
| [`src/state.ts`](src/state.ts) | 项目、阶段、候选和发布物的 Domain 记录。 |
| [`src/siyuan.ts`](src/siyuan.ts) | 可选思源映射、回读、接纳和创建恢复意图。 |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Knowledge package map](../README.zh.md) — 相邻的 Queue 和工具 owner。
- [Knowledge Queue bridge](../knowledge-base-task-queue/README.zh.md) — 阶段准入、原生 Codex 执行和未知结果恢复。
- [Knowledge tool bundle](../tool-knowledge-base/README.zh.md) — 用户操作和受支持的 Profile 组合。
- [Storage subsystem](../../../docs/subsystems/storage.zh.md) — Domain 持久化 provider 语义。

-----

<a id="model-experience"></a>
## Model Experience

### 已保存的阶段输入

#### What the model sees

该服务不会直接向模型暴露内容。Queue consumer 会在稍后发送已准备 `prompt`，其中包含所选项目、来源快照、前置条目和审查上下文；来源文本会被视为引用资料，而非可执行指令。

#### Token effect

在 consumer 运行已准备阶段前没有实时请求 token。已准备 prompt 的大小会随所选来源和前置条目增长。

#### KV Cache effect

该服务不组装请求前缀。缓存复用取决于后续 consumer 的精确已准备 prompt 和模型路由。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

这些限制定义内容和恢复边界。

- **不承诺断电耐久** — 受管文件写入完成并不承诺在突然断电时目录或设备仍持久。
- **恢复需要 Domain 数据** — 仅有 Markdown 不能重建阶段归属、候选、审查或 Queue 状态。
- **发布物不含来源正文** — 发布物保留来源元数据和快照身份，但不会导出完整导入文本。
- **模型审查不是人工事实验证** — 通过的审查会针对可用来源和规则检查已记录响应；读者仍需在实践中验证重要主张。

- **库级语义检查只作提示** — 检查列出正文和适用条件在空白归一化后相同的重复候选。语义重复和矛盾检查报告 `not_run`，单条来源审查不证明全库不存在这些问题。
- **思源创建可能需要操作者处理** — 若已派发创建在恢复后没有可发现的文档，此版本保留继续点，且不提供操作者处理 action。

<a id="dev-note"></a>
### Dev Note

无。
