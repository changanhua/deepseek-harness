---
description: "使用会话寻址浏览器服务、面向模型的浏览器检查与需要批准的页面操作。"
kind: "package-reference"
---

# @changanhua/dsh-tool-browser

[English](README.md) | 中文

## 摘要

本包让模型检查已授权的浏览器实例、标签页和快照，然后执行一项显式页面操作。每项操作都使用发起 Agent 的 Session，而非模型提供的 session id。个人部署采用持续浏览器授权，无需逐次确认。不可变的提供方 ticket 绑定目标与参数；observed 结果只确认本地浏览器操作，不证明业务结果。

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

`browser_instances`、`browser_tabs` 和 `browser_snapshot` 检查当前提供方状态。快照还会返回有界的页面区域和列表条目，让 Agent 可以定位通用卡片和列表。`browser_extract` 可以在新的观察上按条目文本筛选有界结构，不执行页面操作。`browser_action` 接受封闭的 action schema，准备页面操作，并且只提交返回的 ticket。`browser_entry_mount` 和 `browser_entry_unmount` 直接暴露持久页面条目引用；它们是提供方授权的挂载，不是一次性准备动作。匹配的操作使用个人持续授权，包括导航、填写、提交和点击。准备结果的操作种类不匹配时仍需处理。取消、目标检查、ticket 过期以及禁止自动重试 unknown 结果的约束继续执行。

处理自然语言浏览器任务时，先观察页面，再以任务目标和具体成功条件（`text`、精确 `url`，或稳定控件事实如 role、label、checked、expanded）调用 `browser_task_start`。用 `browser_action` 执行一个计划动作，并用 `browser_task_verify` 重新观察和核对条件。只有任务尚未验证时，原生 Agent loop 才会继续。直接调用 `browser_action` 不会暗中启动任务，因为它没有可机器核验的成功条件。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制 — 点击展开</summary>

该工具为每项操作读取 `exec.agent.session.id`。提供方拥有准备和 ticket 过期。[策略](src/policy.ts)在准备的操作种类匹配时使用个人持续授权；[工具注册](src/index.ts)恰好一次提交不透明 ticket。其[不变式](src/invariant.ts)不注册独立运行时状态，因为 Browser 和 Approval 拥有派发及异常审批生命周期。

</details>

-----

<a id="model-experience"></a>
## 模型体验

本包注册九个浏览器工具和可选的活动检索，不注册提示词区段。`browser_snapshot` 通过 `query`、`offset` 和 `limit` 支持标签或卡片标题的子串搜索及匹配控件分页；还可返回有界的 `structure` 区域、列表条目及条目内部控件引用；`tree: true` 返回有界树条目以及 `snapshotId`、`treeCursor`、`treeComplete` 和页面身份。默认返回 64 个控件、8,000 字符正文并启用结构摘要；`textLimit: 0` 只返回控件。`browser_extract` 会重新观察页面，返回按条目文本筛选的有界列表，并保留条目顺序和内部控件引用。`scanTruncated` 表示 DOM 扫描不完整，没有匹配项不代表目标不存在。`browser_action` 在 `value.feedback` 附带一次新快照，最多包含 64 个控件和 4,000 字符正文；原操作值位于 `value.actionValue`。`browser_entry_mount` 与 `browser_entry_unmount` 让 Agent 可以在动态页面上添加或移除有界、绑定文档身份的条目引用。`browser_task_start` 和 `browser_task_verify` 提供有界的 12 次观察—动作—验证循环，连续三次相同失败即停止。unknown 动作终止任务，绝不自动重试。准备引用过期时，错误尽可能附带新引用，供模型重新选择符合用户意图的目标。工具本身不选择替代目标或重复写操作；反馈读取失败时保留原操作结果。

#### KV Cache 影响

工具 schema 添加较小的固定能力描述。动态浏览器数据仅在模型调用工具时进入请求。

## 已知限制与后续工作

- 本包不拥有浏览器提供方、Chrome worker 或站点登录执行器。
- 可见且同 Session 的 Chrome peer 可以通过既有 Approval chain 回答；隐藏或断线 peer 委托 Web。真实登录站点与真实模型的验收取决于部署配置。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>供维护者使用的工作上下文 — 点击展开</summary>

无。

</details>
