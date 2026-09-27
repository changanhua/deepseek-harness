---
description: "Session 持久的 BrowserTask 证据、动作、资源、授权、委派和验收状态。"
kind: "package-reference"
---

# @changanhua/dsh-browser-task

[English](README.md) | 中文

## 摘要

`@changanhua/dsh-browser-task` 是单个浏览器任务的 Session 持久领域权威。每次闭合操作修改都写入完整的 `browser-task/change` 后置状态，因此 Host 重启后可回放，不能以进程内 Map 作为任务事实。前一个任务终态后才可创建下一任务；持久 source sequence 防止同一输入在重启后被当成新任务。

Browser 生命周期监听器会把该权威应用于普通工具、直接 Provider 调用、prepared commit 和 Dynamic Cordis Browser 调用。每个 write 都会记录 `dispatch-intent` 与无 action 恢复定位符，再 flush Session，之后 Provider 才能发送。回放不会产生 Browser 调用。已发送的 unknown write 只能 reconcile；Host 内存查无请求时可以用精确定位符查询扩展 journal，却不能执行 action。确定性失败会保留不含 request 或 mount id 的语义指纹。同一失败目标在第一次出现后即被阻断，只有实质不同的引用，或之后的有界页面地图 evidence 证明前置条件已改变，才恢复执行。内部 projection 错误会产生 `internal-invariant` blocker，而不会变成可重试 Browser 失败。

本领域会分离页面证据、精确目标绑定、动作回执、资源归宿、授权快照、委派和验收。证据绑定真实 Session 事实或 Browser 回执、页面目标和授权 epoch；页面地图恢复事实保留不透明区域引用，不保留 CSS selector。委派事实保留规范的 Subagent run、后台 Job 或 Cordis package/run 身份与有界输出摘要；委派成功本身绝不满足验收。`region-content` 条件要求匹配的渲染回执和渲染文本的新页面观察，而完成仍等待该区域的最终清理归宿。资源在派发前先预留；`delivery:not-sent` 可释放预留而不能伪装页面已经清理。普通 entry unmount 会释放可见 lease，但可以有意保留已收集值；之后的 `forgetCollected:true` 是受 owner 约束的另一项 finalizer，不能仅因可见 lease 已释放就被短路。完成必须为每项条件提供检查器支持的当前证据、没有未决写入/阻塞、预算从未超限，并且所有页面资源已释放或确认随文档消失。只有新的直接用户消息才能显式取消 Session 任务，且必须先让所有资源拥有回执支持的终态；unknown attempt 继续作为历史事实保留。

## 目录

- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## 模型体验

只读标签发现独立于任务页面接纳，仍受提供方授权约束。它不会修改任务目标、能力、证据、尝试或预算。选页回执保留失败原因，使消费者在重放后能够区分过期的浏览器会话引用与结果未定的操作；服务不会根据标签列表自行接纳替代身份。

### 任务 continuation

#### 模型可见内容

消费者只暴露紧凑任务状态和证据引用，不提供原始页面正文。模型通过消费方使用 `browser_task_start` 和 `browser_task_verify`，而不直接与此领域核交互。

#### Token 影响

任务状态受领域核的条件、证据、尝试、资源、委派、步骤和动作限制约束；原始页面正文不进入本包面向模型的 projection。

#### KV Cache effect

稳定任务 schema 与消费方组合会保留可复用前缀。变化的任务状态只作为后续消费方输出进入。

## 已知限制与后续工作

- 投影状态版本 11 保存 BrowserTask 变更版本 6 的快照；旧任务变更格式会被拒绝，不提供迁移。无目标任务会捕获用户空选择的修订号；`tab_open` 后保留待确认的精确标签页引用，只有匹配的主框架快照才能接入页面。接入只属于当前任务，绝不会修改用户的 Session 绑定。
- 标准 Web 组合和 `tool-browser` 已使用本服务，但通用 Session 投影还没有专门的任务状态 UI。
- owner cancel 只接受资源清理完成后最新直接用户消息中的明确标记 `[browser-task:cancel]` 或 `[browser-task:accept-unknown]`。Agent 遇到 unknown 浏览器效果需要用户决定时必须请求该标记，不能从普通自然语言推断同意，也不能断言效果发生或未发生。
- 扩展 journal 过期、存储丢失、执行器离线或定位符不匹配都会让请求保持 unknown。任务不会据此推断 `not-sent`，也不会重放 write。
- `advancePage` 只消费已结算且 observed attempt 的 canonical receipt。它保持 installation、tab、frame、预算、attempt 与选择修订号不变；只有 document-id 替换才处置旧页面资源。同一 document 的路由更新不会虚构清理。持久的 target receipt 是后续 provider read 的权威；rebind 不能借用无关 receipt。
- 页面回执保留最多八个 opener 候选，完整观察不超过 4 KiB，包含源标签、浏览器会话身份和截断标记。非法观察会被丢弃，动作结果保持原状；回放执行同一有界格式检查。候选可以伴随 unknown 动作存在，不能将其结算为成功，也不授予其他页面的操作权。
- 任务范围可以是 `single-tab`、`descendants` 或固定的 `explicit-set`，最多包含 32 个完整标签引用。`selectTarget` 原子地消费一次动作预算并记录固定快照请求；v3 回执只有通过完整标签的新鲜读取、当前权限及可回放的范围依据检查后，才能接纳目标。普通快照不隐式选页。未知选择读取在恢复确认停稳后仍保留未知结果；不同页面的证据不能满足当前页验收条件。
- 选择不移动资源租约。页面函数交付使用当前任务选定的页面和未变化的用户选页 revision；仍要求当前验收证据、精确活动资源和已认证的 Cordis owner，无需重复手动固定页面。精确且未转交的租约保留在原页面清理的权限，用户改选页面后仍可收尾，但浏览器当前授权仍须有效。终态任务在用户选页版本不变时保留最终精确页面的只读访问，不再允许选页或输入。
- 代表性的 DeepSeek-v4.1-flash 扩展验收已通过已配置的标准 Web 部署完成；包级测试与真实 Session 证据仍分别记录。

<a id="dev-note"></a>
### 开发备注

[源代码](src/index.ts)中的 Session event 类型和 projection fold 拥有持久词汇；tool-browser 只提供 continuation 与 checker 消费方。
