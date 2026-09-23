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

`browser_instances`、`browser_tabs` 和 `browser_snapshot` 检查当前提供方状态。快照还会返回有界的页面区域和列表条目，让 Agent 可以定位通用卡片和列表。浏览器观察结果会在面向模型的文本之外持久化有界且不含 selector 的展示元数据，因此输出保留策略把文本 spill 后，UI 投影仍然可用。input、textarea 和 contenteditable 的值会被刻意脱敏，因此空 `text` 不能证明值为空。fill 结果中的 `valueSet` 确认该动作已设置其请求值，但不证明后续业务效果。`browser_extract` 可以在新的观察上按条目文本筛选有界结构，不执行页面操作。必须先调用 `browser_page_map` 再 `browser_region_render`：前者返回短时不透明区域引用，而非 CSS selector。渲染接受一个引用和高层标题、摘要、条目、事实、链接与页脚字段；Provider 会编译私有页面 payload。`browser_region_clear` 按 mount id 恢复精确的扩展自有结果面板。`browser_request_status` 读取保留请求或扩展 journal 请求而不重放，`browser_action_sequence` 会准备并按序提交已经规划的动作，直至第一个非 observed 结果。unknown 结果会给出需要查询的精确 request id。`target_busy` 表示当前请求已被拒绝且未发送，因此 Agent 应查询更早的 in-flight 或 unknown 请求 id，而不是被拒绝的 id。`browser_action` 接受封闭的 action schema，准备页面操作，并且只提交返回的 ticket。其紧凑反馈保留控件与正文，但省略重复的页面区域和列表结构。`browser_entry_mount` 和 `browser_entry_unmount` 直接暴露持久页面条目引用；它们是提供方授权的挂载，不是一次性准备动作。取消、目标检查、ticket 过期以及禁止自动重试 unknown 结果的约束继续执行。

对于成功结果可由现有机器条件表达的自然语言浏览器任务，应先观察页面，再以任务目标和一项或多项具体条件调用 `browser_task_start`：可使用 `text`、精确 `url`、role/label/checked/expanded 等稳定控件事实，或 `region.mountId` 加预期渲染文本。若任务包含这些 clause 无法表达的禁止项、否定条件或其他结果，就不能用 `browser_task_verify` 声称已完成完整机器验证。消费方通过 `ctx.browserTasks` 写入派发前计划的 attempt、receipt、evidence、checker fact、capability 快照、规范委派身份和页面资源 lease；它不保留任务 `Map`。所有 Browser 入口共享该权威。确定性 not-sent 失败第一次出现后即暂停其未变化的语义目标；更换 mount id 不能绕过阻断。新区域引用或之后的页面地图事实只有在改变失败前置条件时，才可恢复执行。已发送的 unknown write 绝不重放，只能用 `browser_request_status` 查询。区域展示只有在渲染已观察且后续快照报告精确的 live mount／文本对后才成立；面板之外的页面同文不足为证，任务完成仍要求清理。缺失或重复 mount 观察会产生 `capability-drift`，但精确清理仍可执行。没有新动作或恢复事实时重复 verify 会返回 `stalled`，不会再产生快照或自动 continuation。`wait` 等 provider read 仍按 read 处理，因此中断不会制造 unknown write。unknown 效果需要用户决定时，Agent 必须请求用户在最新直接消息中发送 `[browser-task:cancel]` 或 `[browser-task:accept-unknown]`；`browser_task_cancel` 只会在每项页面资源已有终态后记录该决定，绝不会把 unknown 改成 observed。只有任务尚未验证、没有 blocker、已有进展，且仍在 12 次模型 continuation 与 40 次浏览器 action 的持久限制内，原生 Agent loop 才会继续。action 预算耗尽后仍允许精确清理，并在所有资源进入终态后以 `budget-exhausted` 收口。直接 `browser_action` 不会启动任务，因为它没有可机器核验的成功条件。

启用 structure 的 `browser_snapshot` 还会采集有序来源块，注明提取器版本与缺口。新采集的 `browser-source-v2` 保留可见图标的可访问名称及不同的图片标题；此前保存的 `browser-source-v1` 证据仍可读取。两种版本都不保证覆盖整页。`browser_read_source` 分页读取已经送达的块，不重新读取网页。`browser_publish_semantic_map` 只接受引用已送达来源读取结果的 AI 分组与概括，并校验发起会话、精确快照、层级和整体上限。结果是派生地图，不是权威网页内容。未组织的块保持可访问，新候选保留为独立版本。

扩展会标记语义生成的用户回合。可重放的 Session 投影在 Host 恢复后继续识别该回合。Host 的单调工具守卫在该回合只允许快照、来源读取和地图发布工具，嵌套转发也受限，并将读取限定在固定标签和 frame；后续普通回合使用原有工具策略。标记只收紧权限，绝不授予权限。另一个仅在 Host 使用的投影为每个 Session 保留最近四份已认证来源快照及其已读回执；被淘汰的快照不能再用于新读取或发布。重新绑定或清除目标，以及后续尝试新的快照，都会使旧来源无法再发布。同一标签导航后，成功快照的安装、标签、frame 和目标修订号匹配时仍会接纳来源；快照返回的 documentId 和 URL 标识来源页面，不要求等于绑定时的页面。原文定位使用该 documentId，并在高亮前核对当前文字。

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

生成的[浏览器工具 schema](../../../docs/tool-catalog.zh.md#changanhuadsh-tool-browser)暴露十七个浏览器工具和可选活动检索，不注册提示词区段。`browser_snapshot` 返回有界的新引用；`browser_page_map`、`browser_region_render` 和 `browser_region_clear` 暴露证据绑定的页面工作区；`browser_request_status` 给出恢复边界；`browser_task_start`、`browser_task_verify` 和用户决定边界 `browser_task_cancel` 暴露持久任务控制流程。

#### Token 影响

工具定义在可见时有固定成本。结果只在模型调用工具时加入有界的快照、任务或状态事实；`browser_snapshot` 默认最多 64 个控件和 8,000 字符正文；结构化来源采集另有最多 64 块及 16,000 字符。来源读取每页最多八个完整块及 4,800 个来源字符。动作反馈最多包含 64 个控件和 4,000 字符，并省略页面结构。

#### KV Cache effect

可见工具集与作用域组合不变时，前缀保持稳定。工具结果追加在可复用请求前缀之后，不会改变先前缓存内容。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 本包不拥有浏览器提供方、Chrome worker 或站点登录执行器。
- 语义地图只覆盖已采集来源块。来源校验只证明引用了采集文本，不证明概括准确或整页已覆盖；两级导航不推断因果关系，也不会静默重定位已变化的原文。
- 可见且同 Session 的 Chrome peer 可以通过既有 Approval chain 回答；隐藏或断线 peer 委托 Web。代表性的 DeepSeek-v4.1-flash 现场验收已通过标准 Web 组合在获授权的知乎页面完成：精确 mount 范围的展示证据已被观察，临时资源已清理，任务最终以 completed 且无 blocker 的状态结束。其他站点登录和模型路由仍取决于部署配置。

此包不发布 invariant companion，因为任务循环状态由 Agent 生命周期持有，并由 Agent 销毁监听器清理。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>供维护者使用的工作上下文 — 点击展开</summary>

无。

</details>
