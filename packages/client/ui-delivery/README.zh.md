---
description: "基于 browser-safe Delivery Remote projection、由本包拥有 locale 的 Personal Delivery workbench。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-delivery

[English](README.md) | 中文

## 概述

`dsh-client-ui-delivery` 让一个 operator 可以从一段想法保存本地 Delivery Case，让它停留在 Shaping，并在以后决定是否补全交付条件。就绪的 revision 随后可以被批准、执行、验证、接受，并可选发布为 GitHub Issue。

主 Case list 展示 Shaping、Ready、Running、Review、Blocked 与 Accepted phase，而 publication 保持为独立可见 lifecycle。次级 Packet ledger 保留从 scope 到 decision 的 evidence chain，共享 controller 拥有 cancellation、可恢复 snapshot 与每个 active request。

## 目录

- [Composition](#composition)
- [工作台边界](#workbench-boundary)
- [开发说明](#dev-note)
- [Model Experience](#model-experience)
- [已知限制](#known-limitations-and-deferred-work)

## Composition

- Node entry 保持 inert，只提供 package invariant companion。
- Browser entry 消费 `slots`、`locale` 与 `remote`，挂载生成的 Delivery Remote contribution，然后在需要 `remote.delivery` 的嵌套 context 中注册 UI。
- `shell.view/delivery` 渲染 workbench；`sidebar.modules/delivery-module` 打开它并显示派生的 blocked count。
- 一个共享 observable controller 同时供两个 entry 使用，因此 navigation 与 workbench 不会各自保存互相竞争的 Delivery facts browser copy。

Remote contribution、slot registration 与 locale dictionary 会在 plugin dispose 时一同消失；UI registration 失败时也会卸载 Remote contribution。

<a id="workbench-boundary"></a>

## 工作台边界

默认入口把一段想法保存为本地 Shaping Case，其中 outcome、scope、acceptance、base 与 verification field 可以暂不完整。补全这些交付条件是显式 revision action；Existing-Issue import 与 GitHub publication 是次级 action。Browser 只提交有界 content 与 selection；repository binding、human actor identity、idempotency、credential、publication marker、raw Queue authority 与 acceptance proof 均由 Host 拥有。

<a id="dev-note"></a>

## 开发说明

保持 lane 与 blocked reason 由 Host snapshot 派生。新增操作时必须同时提供 narrow Remote method、本包拥有的 locale copy、cancellation 与产品可见测试。

## Model Experience

### 无直接模型上下文

#### 模型看到什么

模型不会直接看到任何内容。`./client` workbench 注册 browser UI 与 Remote call，但不注册 prompt、tool 或 resource。

#### Token effect

直接 token 为零；workbench state 是 browser control data，而不是 model input。

#### KV Cache effect

无；本包从不组装模型输入。

## 已知限制

<a id="known-limitations-and-deferred-work"></a>

- **需要 Profile composition**——只有受支持的 bundle/profile 安装其 Client plugin、匹配的 Delivery Remote 与 provider 时，工作台才会出现。
- **单 operator MVP**——browser 永远不选择或声明 operator identity；multi-user authentication 与 authorization 不在本包范围内。
- **真实发布需要 Host 配置**——repository 没有 `githubTargets` entry 时，Case 保持本地；真实 Issue 还需要另行批准的 credential 与 target。
