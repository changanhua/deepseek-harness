---
description: "通过类型化 Queue 调度有限观察检查、由 Host 拥有的持久浏览器监控 plan。"
kind: "package-reference"
---

# @changanhua/dsh-browser-monitor

[English](README.md) | 中文

## 摘要

当需要为一次浏览器观察保留有界、持久的 plan，并在摘要变化时通知拥有表面时，请使用本包。plan 记录其 URL、周期、match 规则、固定 grant epoch，以及 digest 和 match 结果，而不是采集的页面正文。一次性 plan 只运行一次；周期 plan 将逾期 work 合并为 `latest` 或跳过它。本包拥有 Host plan 和 Queue 准入，不提供完整 Chrome 监控 UI。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当可信 Gateway 在安装的当前 observation authority 下创建 plan 时，请将监控器与 `ctx.browser`、`ctx.storageDomain` 和 `ctx.taskQueue` 组合。

`browser.monitor.check@1` 只接收 monitor id、revision 和到期 slot。pause 会使排队和运行中的 work 失效；resume 在调度另一个 slot 前绑定新的当前 authority。outbox 为一次检查可能产生的每个 notification slot 预留容量，只在显式 acknowledge 后移除 notice。默认允许 64 个 monitor，每 1,000 ms 轮询，并将一次有限读取限制为 30 秒。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制 — 点击展开</summary>

`BrowserMonitor` 通过其 storage domain 持久化记录，并使用经过验证的 Queue operator authority。sample 保留 SHA-256 digest、match 状态、时间和页面身份，绝不保留页面正文。Gateway facade 暴露 `monitor.list`、`monitor.create`、`monitor.pause`、`monitor.resume` 和 `monitor.acknowledge`；它与扩展 UI 保持分离。[引擎](src/engine.ts)拥有调度和恢复，[记录](src/records.ts)拥有 notification 容量和 acknowledgement。

每个已接受结果都会原子保存对应 Queue 工作、修订和检查时间的结算关联。Queue 确认终态前不准入下一次检查。若 Host 在两次提交之间停止，恢复时使用已保存的成功或失败结果完成结算，不再读取浏览器；暂停和一次性计划也适用。

</details>

-----

<a id="model-experience"></a>
## 模型体验

无。本包不注册模型工具、提示词区段或模型上下文，也不发起模型请求。

#### KV Cache 影响

无。监控 plan 和 notice 不会通过本包进入模型上下文。

## 已知限制与后续工作

- 浏览器检查要求原网址恰好对应一个已打开的顶层标签页；页面关闭或目标不唯一会产生失败结果。
- 通知容量不足会暂停准入，直到接收界面确认已有通知。本包不实现持续 DOM 观察器。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>供维护者使用的工作上下文 — 点击展开</summary>

无。

</details>
