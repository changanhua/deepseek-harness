---
description: "面向需要可编辑 Markdown、已验证产物、检查和显式发布的 Profile 的持久来源可追溯知识项目。"
kind: "package-reference"
---

# @changanhua/dsh-knowledge-base

[English](README.md) | 中文

## Summary

`dsh-knowledge-base` 在保留每个已提交条目为可编辑 Markdown 的同时，持久保存基于来源的知识项目。它在同一份 Domain 支持的项目中记录来源快照、已准备生成输入、已捕获响应、已接受候选、审查、检查和不可变发布物，因此后续 Queue 恢复可完成已验证收据或候选而无需再次调用模型。适用于需要受管内容和显式发布的 Profile；它本身不提供模型工具，也不调度工作。包报告完成前会完成文件写入，但不承诺断电耐久。

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
| `root` | required | 包含受管项目、工作条目、产物、报告和发布物的绝对根目录。 |

生成的[配置目录](../../../docs/config-catalog.zh.md)是可接受配置的完整来源。

### Content and publication

创建项目、通过 consumer 导入或抓取来源快照、确认其 plan hash，然后准备 `plan`、`generate` 或 `review` 阶段。已接受的生成会写入 Markdown 工作条目和不可变产物；对工作文件的编辑会保持可见，直到调用方采纳它。`check` 比较当前文件、来源、依赖和已记录审查结论。`publish` 只在当前检查通过后成功，并创建带版本的不可变发布物，不会在生成完成时自动发布。

同一受信 Profile 内，受管根目录下的项目由其会话共享。该包不会为项目、条目、产物或发布物附加 session 私有 ACL。

发布物中的 `sources.json` 记录来源元数据和快照身份，不包含完整来源文本。将工作 Markdown 复制到另一安装实例不会恢复 Domain 记录、已准备阶段或 Queue work item。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>实现细节 — 点击展开</summary>

一条 Domain 项目记录是业务权威。阶段在 prepared、publishing 和 completed 业务状态间迁移，而 Queue 独立保留 Work 和 Attempt 状态。`captureResponse` 会在 cleanup 前记录已完成原生响应，`recoverStage` 会在写入缺失条目或重放已完成阶段前校验该收据或候选。文件层提供可编辑 Markdown 与不可变内容寻址产物；发布物会把通过检查的产物复制到经 manifest 验证的版本目录。

| File | Role |
|---|---|
| [`src/repository.ts`](src/repository.ts) | 项目操作、阶段接受与恢复、检查和发布。 |
| [`src/files.ts`](src/files.ts) | 受管 Markdown、不可变产物和发布文件。 |
| [`src/state.ts`](src/state.ts) | 项目、阶段、候选和发布物的 Domain 记录。 |

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

<a id="dev-note"></a>
### Dev Note

无。
