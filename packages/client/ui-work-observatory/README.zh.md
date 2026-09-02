---
description: "供用户查看本地日期或项目、对比人类活动和 Session 步骤时间并打开 Session 明细的工作观测浏览器包。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-work-observatory

[English](README.md) | 中文

## Summary

本包为 Web 应用提供独立的工作观测页面和自动的 document 级活动生产者。用户选择本地日历日期，查看人类活跃、页面可见、Agent 步骤、协作重叠和 Agent 单独时长，然后打开贡献记录的 Session。24 小时证据带会先展示来源区间，再呈现总量。页面明确说明这些数字是证据，不是生产力或节省时间的声明。

## Table of Contents

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步了解](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发注记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将浏览器包挂载到同时公开工作观测 Remote 和 Session Controller 的 Client 组合中。

### 何时选择

当标准 Web 产品的用户需要本机、可检查的人类和 Agent 墙钟证据时选择本包。没有 Host 服务或 Session 导航的 Client 组合可以省略它。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-client-ui-work-observatory'
```

本包没有浏览器配置。它的 `dsh.client.inject` 声明需要 Remotes、Session Controller、locale、layout、renderer、sidebar 和 Host 工作观测包。

从常驻侧边栏打开**工作观测**，选择日期，需要时刷新，然后选择 Session 记录返回对应对话。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

一个 app 级 effect 拥有 document listener、空闲 timer、可见页面 heartbeat 和串行 Remote 链。它发送可见性、近期人类活动、当前 Session id 和单调序号，不发送 client 时间戳。独立 controller 把选定本地日期转换为 epoch 边界，加载 Host 投影，拒绝过期响应，并向 Slot renderer 公开一个 observable。

准确的所有者分别是 [`src/client/activity-tracker.ts`](src/client/activity-tracker.ts)、[`src/client/controller.ts`](src/client/controller.ts) 和 [`src/client/WorkObservatoryWorkspace.tsx`](src/client/WorkObservatoryWorkspace.tsx)。

</details>

-----

<a id="further-exploration"></a>
## 进一步了解

- [工作观测子系统](../../../docs/subsystems/work-observatory.zh.md)——用户流程与证据含义。
- [Host 包](../../host/work-observatory/README.zh.md)——持久记录、边界和范围代数。
- [Web Client 子系统](../../../docs/subsystems/web-client.zh.md)——动态 Client 包加载。
- [Slots 子系统](../../../docs/subsystems/slots.zh.md)——工作区和侧边栏插入点。

-----

<a id="model-experience"></a>
## 模型体验

无，因为这个浏览器活动生产者和只读工作区不注册面向模型的 Tool、prompt section 或 Session event。

#### KV Cache 影响

无；浏览器观测和范围读取不会进入模型上下文或启动模型请求。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **当前项目过滤**——项目范围跟随所选 Session 的规范 `cwd`；首个版本不提供单独的项目选择器。
- **不做因果归因**——Skill、Queue 和 Delivery 记录不会被解释为时长或生产力的原因。
- **可见页面证据**——浏览器休眠、强制终止和传输丢失会在 Host 最后收到的 heartbeat 处结束证据。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
