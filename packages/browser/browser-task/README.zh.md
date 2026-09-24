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

### 任务 continuation

#### 模型可见内容

消费者只暴露紧凑任务状态和证据引用，不提供原始页面正文。模型通过消费方使用 `browser_task_start` 和 `browser_task_verify`，而不直接与此领域核交互。

#### Token 影响

任务状态受领域核的条件、证据、尝试、资源、委派、步骤和动作限制约束；原始页面正文不进入本包面向模型的 projection。

#### KV Cache effect

稳定任务 schema 与消费方组合会保留可复用前缀。变化的任务状态只作为后续消费方输出进入。

## 已知限制与后续工作

- 标准 Web 组合和 `tool-browser` 已使用本服务，但通用 Session 投影还没有专门的任务状态 UI。
- owner cancel 只接受资源清理完成后最新直接用户消息中的明确标记 `[browser-task:cancel]` 或 `[browser-task:accept-unknown]`。Agent 遇到 unknown 浏览器效果需要用户决定时必须请求该标记，不能从普通自然语言推断同意，也不能断言效果发生或未发生。
- 扩展 journal 过期、存储丢失、执行器离线或定位符不匹配都会让请求保持 unknown。任务不会据此推断 `not-sent`，也不会重放 write。
- 代表性的 DeepSeek-v4.1-flash 扩展验收已通过已配置的标准 Web 部署完成；包级测试与真实 Session 证据仍分别记录。

此包不发布 invariant companion，因为会话事件与投影折叠拥有持久任务事实，工具和生命周期测试核对其变化。

<a id="dev-note"></a>
### 开发备注

[源代码](src/index.ts)中的 Session event 类型和 projection fold 拥有持久词汇；tool-browser 只提供 continuation 与 checker 消费方。
