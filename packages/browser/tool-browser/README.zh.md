---
description: "使用会话寻址浏览器服务、面向模型的浏览器检查与需要批准的页面操作。"
kind: "package-reference"
---

# @changanhua/dsh-tool-browser

[English](README.md) | 中文

## 摘要

本包让模型检查已授权的浏览器实例、标签页和快照，然后执行一项显式页面操作，或继续一个有界、由 Session 支持的浏览器任务。每项操作都使用发起 Agent 的 Session，而非模型提供的 session id。个人部署采用持续浏览器授权，无需逐次确认。不可变的提供方 ticket 绑定目标与参数；observed 结果只确认本地浏览器操作，不证明业务结果。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

请将此消费方与 `ctx.browser`、`ctx.tools` 和既有 `ctx.approval` 服务组合。

组合 `ctx.browserActivity` 时，`browser_activity_search` 读取发起 Agent 会话的历史活动。模型不能指定其他会话 ID。检索按文本、时间、数量和编码字节数限定；Chrome 离线时仍以 Host 当前授权版本与站点为准。结果是来源资料，不是指令。知识写入使用部署另行配置的 MCP 工具与用户要求的工作流。

`browser_instances`、`browser_tabs` 和 `browser_snapshot` 检查当前提供方状态。快照还会返回有界的页面区域和列表条目，让 Agent 可以定位通用卡片和列表。`browser_extract` 可以在新的观察上按条目文本筛选有界结构，不执行页面操作。`browser_page_map` 建立精确文档的放置证据，`browser_region_render` 与 `browser_region_clear` 则创建和恢复扩展自有结果面板。`browser_request_status` 读取保留请求而不重放，`browser_action_sequence` 会准备并按序提交已经规划的动作，直至第一个非 observed 结果。`browser_action` 接受封闭的 action schema，准备页面操作，并且只提交返回的 ticket。`browser_entry_mount` 和 `browser_entry_unmount` 直接暴露持久页面条目引用；它们是提供方授权的挂载，不是一次性准备动作。匹配的操作使用个人持续授权，包括导航、填写、提交和点击。准备结果的操作种类不匹配时仍需处理。取消、目标检查、ticket 过期以及禁止自动重试 unknown 结果的约束继续执行。

处理自然语言浏览器任务时，先观察页面，再以任务目标和具体成功条件（`text`、精确 `url`，或稳定控件事实如 role、label、checked、expanded）调用 `browser_task_start`。消费方会通过 `ctx.browserTasks` 写入派发前计划的 attempt、receipt、evidence、checker fact、capability 快照和页面资源 lease；它不保留任务 `Map`。用 `browser_action` 执行一个计划动作，并用 `browser_task_verify` 重新观察和核对条件。只有任务尚未验证、没有 blocker，且仍在 12 次模型 continuation 与 40 次浏览器 action 的持久限制内，原生 Agent loop 才会继续。直接调用 `browser_action` 不会暗中启动任务，因为它没有可机器核验的成功条件。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制 — 点击展开</summary>

该工具为每项操作读取 `exec.agent.session.id`。提供方拥有准备和 ticket 过期；`@changanhua/dsh-browser-task` 拥有可回放的任务 projection 与完成条件。[策略](src/policy.ts)在准备的操作种类匹配时使用个人持续授权；[工具注册](src/index.ts)恰好一次提交不透明 ticket。其[循环](src/loop.ts)是无状态 continuation 与 checker facade，因此 Host 重启恢复读取 Session fact，而不是独立任务 map。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型可见内容

生成的[浏览器工具 schema](../../../docs/tool-catalog.zh.md#changanhuadsh-tool-browser)暴露十四个浏览器工具和可选活动检索，不注册提示词区段。`browser_snapshot` 返回有界的新引用；`browser_page_map`、`browser_region_render` 和 `browser_region_clear` 暴露证据绑定的页面工作区；`browser_request_status` 给出恢复边界；`browser_task_start` 与 `browser_task_verify` 暴露持久任务控制流程。

#### Token 影响

工具定义在可见时有固定成本。结果只在模型调用工具时加入有界的快照、任务或状态事实；`browser_snapshot` 默认最多 64 个控件和 8,000 字符正文，动作反馈最多包含 64 个控件和 4,000 字符。

#### KV Cache effect

可见工具集与作用域组合不变时，前缀保持稳定。工具结果追加在可复用请求前缀之后，不会改变先前缓存内容。

## 已知限制与后续工作

- 本包不拥有浏览器提供方、Chrome worker 或站点登录执行器。
- 可见且同 Session 的 Chrome peer 可以通过既有 Approval chain 回答；隐藏或断线 peer 委托 Web。真实登录站点与真实模型的验收取决于部署配置；代表性的 DeepSeek-v4.1-flash 验收尚未形成完成证据。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>供维护者使用的工作上下文 — 点击展开</summary>

无。

</details>
