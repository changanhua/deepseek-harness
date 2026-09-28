---
description: "通过已配置模型在有限候选项中选择一个可用项，或放弃选择；工具不会执行动作。"
kind: "package-reference"
---

# `@changanhua/dsh-tool-choice`

[English](README.md) | 中文

## 概述

当 Agent 已有有限候选项并需要受限选择时，使用 `choose_candidate`。它会过滤禁用候选，返回已列出的 id 或放弃选择，并且不会执行选中的动作。它通过关闭推理的已配置 LLM 路由工作，因此调用方保有动作授权。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在按需 `choice` preset 中挂载该插件，并显式设置 `provider`、`model`、`maxInputBytes`、`maxCandidates`、`maxOutputTokens` 和 `timeoutMs`。工具接受 `goal`、`facts`、可选的 `constraints` 以及带 `id`／描述的候选项。它会拒绝无效输入、非文本或畸形输出、多余响应字段、未知或禁用 id、截断和缺失终止帧。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

原生注册和 `./declaration` 共享一份 DSH Schema DSL、名称和说明。每次调用由真实 Agent 持有，并为成功、失败、超时或取消配对记录辅助请求与终态。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [能力 bundle](../../bundle/capabilities/README.zh.md) — 按需 MCP Profile。
- [工具子系统](../../../docs/subsystems/tools.zh.md) — 执行管线。

-----

<a id="model-experience"></a>
## 模型体验

### 有界候选选择

#### 模型看到的内容

模型会收到包含目标、事实、可用候选项和约束的一次有界 JSON 请求。禁用候选不会进入请求，系统指令要求一个 JSON 选择或放弃。

#### Token 影响

输入 Token 随受限的调用方数据增长；输出 Token 受 `maxOutputTokens` 限制。

#### KV Cache 影响

每次调用是独立辅助请求，不复用 Agent 回合的对话前缀。

<a id="known-limitations-and-deferred-work"></a>
## 限制与延期工作

- 工具不发现候选项、不验证观察结果、不执行动作，也不保证模型选择正确。

未发布运行时 invariant companion。每次调用在返回前验证候选 ID 和模型输出；本包没有需要核对的独立维护副本。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
