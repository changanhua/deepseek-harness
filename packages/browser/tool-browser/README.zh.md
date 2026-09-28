---
description: "使用会话寻址浏览器服务、面向模型的浏览器检查与需要批准的页面操作。"
kind: "package-reference"
---

# @changanhua/dsh-tool-browser

[English](README.md) | 中文

## 摘要

本包让模型检查已授权的浏览器实例、标签页和快照，然后执行一项显式页面操作，或继续一个有界、由 Session 支持的浏览器任务。每项操作都使用发起 Agent 的 Session，而非模型提供的 session id。个人部署采用持续浏览器授权，无需逐次确认。不可变的提供方 ticket 绑定目标与参数；observed 结果只确认本地浏览器操作，不证明业务结果。

`browser_task_verify` 返回 `verification.scope = declared-conditions-only`、目标、条件和检查结果。URL 或原文条件通过不能证明请求的写入或挂载完成；Agent 必须分别报告条件之外的要求。同一 descendants 或 explicit-set 任务可以在重载后重新选择已接纳的标签，保留预算和历史；未决写入必须先追查。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

任务受阻、尚未选页或已终结时，`browser_tabs` 仍可发现已授权安装的标签。列举不会接纳页面、修改任务范围或消耗其动作预算；用户固定目标的过滤仍生效。首次选页返回 `tab_reference_stale` 时，若任务没有已接纳或待接纳页面、资源、委派工作或未决请求，则以失败结束。先列举新鲜标签，再依据更新的直接用户指令建立新任务；不得把新的浏览器会话身份直接替换进旧范围。已经持有页面或未决工作的任务仍须履行原有恢复责任。

请将此消费方与 `ctx.browser`、`ctx.tools` 和既有 `ctx.approval` 服务组合。

任务可以在页面尚不存在时开始。未固定用户目标时，调用 `browser_task_start` 可省略 `page`，再通过 `browser_action` 向声明 `targetFreeOpen` 的实例发送无页面引用的 `tab_open`。返回的 `tab` 包含 `tabId`、`windowId` 和 `browserSessionId`；`browser_task_verify` 读取这个精确标签页并将其接入同一个任务。若直接调用首次 `browser_snapshot`，必须将该引用作为 `expectedTab` 传入。开页和首次快照各占一次 action；接入和状态恢复不额外占用预算。unknown 开页会阻止该任务再次开页，必须用原 request id 核对结果。接入的目标属于任务，不改变用户的 Session 选页；用户之后选页或清空选择都会使这份权限失效。Cordis 页面函数交付要求精确的当前任务目标、未变的用户选页 revision、当前验收证据及完整自有资源，不要求手动固定页面。

组合 `ctx.browserActivity` 时，`browser_activity_search` 读取发起 Agent 会话的历史活动。模型不能指定其他会话 ID。检索按文本、时间、数量和编码字节数限定；Chrome 离线时仍以 Host 当前授权版本与站点为准。结果是来源资料，不是指令。知识写入使用部署另行配置的 MCP 工具与用户要求的工作流。

任务接纳页面后，`browser_snapshot` 和 `browser_extract` 只有在 installation、tab 和 frame 都匹配时，才会把省略的 `documentId` 固定为已接纳的文档。显式指定其他文档会被拒绝。任务结束后也遵循此规则；标签导航到别处不会静默扩大任务权限。

`browser_task_start.scope` 默认为 `single-tab`。跟随子页时选 `descendants`；处理若干已有页面时，选 `explicit-set` 并传入 `browser_tabs` 返回的最多 32 个完整标签引用。已有用户固定页的 descendants 任务需要完整 root；从零开页的任务在 bootstrap 时取得 root。显式集合可以从无当前页开始：`select-scope-tab` 要求对集合成员调用 `browser_task_select`，无需额外开页。候选不会自动成为目标。每次选择使用原任务的一次动作预算重新读取，只有 `status: selected` 才能使用返回的页面和控件。未知读取保留原请求身份；恢复确认停稳后可解除选择阻塞，但旧结果仍为 unknown。范围选择不改变用户绑定或 Cordis 页面函数权限。

切换页面保留旧操作与资源租约。只有精确所属的 clear/unmount 可以清理旧页；新渲染和输入仍要求当前目标。成功条件只使用当前页证据。任务完成后，在用户选页版本未变的条件下仍允许回读最终精确页面，即使用户的根页绑定与其不同；终态不再允许选页或写入。新任务重新声明自己的范围。

`browser_instances`、`browser_tabs` 和 `browser_snapshot` 检查当前提供方状态。快照还会返回有界的页面区域和列表条目，让 Agent 可以定位通用卡片和列表。表单值默认省略，因此空 `text` 不能证明值为空。只有任务需要当前非敏感表单值时才设置 `includeValues: true`；password、file、hidden 与敏感 autocomplete 字段仍会脱敏。fill 结果中的 `valueSet` 确认该动作已设置其请求值，但不证明后续业务效果。`browser_extract` 可以在新的观察上按条目文本筛选有界结构，不执行页面操作。必须先调用 `browser_page_map` 再 `browser_region_render`：前者返回短时不透明区域引用，而非 CSS selector。渲染接受一个引用和高层标题、摘要、条目、事实、链接与页脚字段；Provider 会编译私有页面 payload。`browser_region_clear` 按 mount id 恢复精确的扩展自有结果面板。`browser_request_status` 读取保留请求或扩展 journal 请求而不重放，`browser_action_sequence` 会准备并按序提交已经规划的动作，直至第一个非 observed 结果。unknown 结果会给出需要查询的精确 request id。`target_busy` 表示当前请求已被拒绝且未发送，因此 Agent 应查询更早的 in-flight 或 unknown 请求 id，而不是被拒绝的 id。`browser_action` 接受封闭的 action schema，准备页面操作，并且只提交返回的 ticket。其紧凑反馈保留控件与正文，但省略重复的页面区域和列表结构。`browser_entry_mount` 和 `browser_entry_unmount` 直接暴露持久页面条目引用；它们是提供方授权的挂载，不是一次性准备动作。取消、目标检查、ticket 过期以及禁止自动重试 unknown 结果的约束继续执行。

对于成功结果可由现有机器条件表达的自然语言浏览器任务，应先观察页面，再以任务目标和一项或多项具体条件调用 `browser_task_start`：可使用 `text`、精确 `url`、role/label/checked/expanded 等稳定控件事实，或 `region.mountId` 加预期渲染文本。若任务包含这些 clause 无法表达的禁止项、否定条件或其他结果，就不能用 `browser_task_verify` 声称已完成完整机器验证。消费方通过 `ctx.browserTasks` 写入派发前计划的 attempt、receipt、evidence、checker fact、capability 快照、规范委派身份和页面资源 lease；它不保留任务 `Map`。所有 Browser 入口共享该权威。确定性 not-sent 失败第一次出现后即暂停其未变化的语义目标；更换 mount id 不能绕过阻断。新区域引用或之后的页面地图事实只有在改变失败前置条件时，才可恢复执行。已发送的 unknown write 绝不重放，只能用 `browser_request_status` 查询。区域展示只有在渲染已观察且后续快照报告精确的 live mount／文本对后才成立；面板之外的页面同文不足为证，任务完成仍要求清理。缺失或重复 mount 观察会产生 `capability-drift`，但精确清理仍可执行。没有新动作或恢复事实时重复 verify 会返回 `stalled`，不会再产生快照或自动 continuation。`wait` 等 provider read 仍按 read 处理，因此中断不会制造 unknown write。unknown 效果需要用户决定时，Agent 必须请求用户在最新直接消息中发送 `[browser-task:cancel]` 或 `[browser-task:accept-unknown]`；`browser_task_cancel` 只会在每项页面资源已有终态后记录该决定，绝不会把 unknown 改成 observed。只有任务尚未验证、没有 blocker、已有进展，且仍在 12 次模型 continuation 与 40 次浏览器 action 的持久限制内，原生 Agent loop 才会继续。action 预算耗尽后仍允许精确清理，并在所有资源进入终态后以 `budget-exhausted` 收口。直接 `browser_action` 不会启动任务，因为它没有可机器核验的成功条件。

-----

`browser_snapshot` 可选传入 `bindings`，以语义名称和完整页面 URL 描述可复用的应用控件。每项最多四个 role/label/tag/context/name/type/href 候选描述。只有完整的新鲜观察中恰好一个已启用、可写的匹配项才返回 `bound`；重复控件返回 `ambiguous`，分页、query 过滤或截断的观察返回 `incomplete`；其他状态为 `missing`、`page-mismatch` 和 `unavailable`。结果携带读取请求、安装、页面、snapshot 和原始控件引用。这些是读取的派生标注，动作仍经 `browser_action` 和既有任务记录执行，标注本身不授予权限或证明业务检查完成。描述最多 16 项、合计 16 KiB；每项结果最多提供四个候选以及完整的已观察匹配数。可选结果只在请求时增加上下文，不增加模型请求。[GitHub Issues Skill](../../../.agents/skills/github-issues/SKILL.md) 提供首个应用知识和流程模板；其控件描述经过隔离夹具验证，使用真实网站时仍需确认当前页面。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制 — 点击展开</summary>

该工具为每项操作读取 `exec.agent.session.id`。提供方拥有准备和 ticket 过期；`@changanhua/dsh-browser-task` 拥有可回放的任务 projection 与完成条件。[策略](src/policy.ts)在准备的操作种类匹配时使用个人持续授权；[工具注册](src/index.ts)恰好一次提交不透明 ticket。其[循环](src/loop.ts)是无状态 continuation 与 checker facade，因此 Host 重启恢复读取 Session fact，而不是独立任务 map。

</details>

-----

<a id="model-experience"></a>
## 模型体验

请求状态提示区分仍在执行的请求（`wait`）与保留的未知结果（`owner-decision`）。未知结果不会引导 Agent 执行被其 BrowserTask 阻止的页面读取；该提示和所有者取消操作都不会把动作改为已观察，也不会授权重放。

### 工具 schema

#### 模型可见内容

生成的[浏览器工具 schema](../../../docs/tool-catalog.zh.md#changanhuadsh-tool-browser)暴露浏览器工具和可选活动检索，不注册提示词区段。`browser_snapshot` 返回有界的新引用；`browser_page_map`、`browser_region_render` 和 `browser_region_clear` 暴露证据绑定的页面工作区；`browser_request_status` 给出恢复边界；`browser_task_start`、`browser_task_select`、`browser_task_verify` 和用户决定边界 `browser_task_cancel` 暴露持久任务控制流程。

#### Token 影响

工具定义在可见时有固定成本。结果只在模型调用工具时加入有界的快照、任务或状态事实；`browser_snapshot` 默认最多 64 个控件和 8,000 字符正文，动作反馈最多包含 64 个控件和 4,000 字符，并省略页面结构。

#### KV Cache effect

可见工具集与作用域组合不变时，前缀保持稳定。工具结果追加在可复用请求前缀之后，不会改变先前缓存内容。

## 已知限制与后续工作

- 本包不拥有浏览器提供方、Chrome worker 或站点登录执行器。
- 可见且同 Session 的 Chrome peer 可以通过既有 Approval chain 回答；隐藏或断线 peer 委托 Web。代表性的 DeepSeek-v4.1-flash 现场验收已通过标准 Web 组合在获授权的知乎页面完成：精确 mount 范围的展示证据已被观察，临时资源已清理，任务最终以 completed 且无 blocker 的状态结束。其他站点登录和模型路由仍取决于部署配置。
- click acknowledgement 最多只能报告旧 document 已不可观察；它不证明 click input 或业务结果。取消、截止时间、授权丢失、acknowledgement 丢失与未验证 fill 即使观察到导航也保持 `unknown`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>供维护者使用的工作上下文 — 点击展开</summary>

无。

</details>
