---
description: "Session 持久的 BrowserTask 证据、动作、资源、授权、委派和验收状态。"
kind: "package-reference"
---

# @changanhua/dsh-browser-task

[English](README.md) | 中文

## 摘要

`@changanhua/dsh-browser-task` 是单个浏览器任务的 Session 持久领域权威。每次闭合操作修改都写入完整的 `browser-task/change` 后置状态，因此 Host 重启后可回放，不能以进程内 Map 作为任务事实。前一个任务终态后才可创建下一任务；持久 source sequence 防止同一输入在重启后被当成新任务。

它分离页面证据、精确目标绑定、动作回执、资源归宿、授权快照、委派和验收。证据绑定真实 Session 事实或 Browser 回执、页面目标和授权 epoch。资源在派发前先预留；`delivery:not-sent` 可释放预留而不能伪装页面已经清理。观察到动作或委派任务完成，都不等于浏览器任务完成；完成必须为每项条件提供检查器支持的当前证据、没有未决写入/阻塞、预算从未超限，并且所有页面资源已释放或确认随文档消失。在存在专用 owner-decision 事实前，保留资源仍保持 fail-closed。

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
- V1 不接受用户保留的页面资源作为最终归宿；必须释放或确认原文档已消失。
- 真实 DeepSeek-v4.1-flash 扩展验收依赖已配置部署，与包级测试分开记录。

<a id="dev-note"></a>
### 开发备注

[源代码](src/index.ts)中的 Session event 类型和 projection fold 拥有持久词汇；tool-browser 只提供 continuation 与 checker 消费方。
