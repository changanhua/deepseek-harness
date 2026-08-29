---
description: "基于 browser-safe Delivery Remote projection、由本包拥有 locale 的 Personal Delivery workbench。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-delivery

[English](README.md) | 中文

## 概述

`dsh-client-ui-delivery` 根据 browser-safe Delivery Remote projection 渲染 Personal Delivery workbench。它注册本包拥有的中英文 copy、一个现有 shell view 和一个现有 sidebar module entry。

工作台展示五条 lane 的 Packet ledger、从 scope 到 decision 的 evidence spine 与六个明确操作。Controller 拥有 snapshot 和 mutation cancellation，在可恢复失败期间保留最后一次已接受 snapshot，并随 client plugin lifecycle 释放每个 active request。

## 目录

- [Composition](#composition)
- [工作台边界](#workbench-boundary)
- [开发说明](#dev-note)
- [Model Experience](#model-experience)
- [已知限制](#known-limitations-and-deferred-work)

## Composition

- Node entry 保持 inert，只提供 package invariant companion。
- Browser entry 消费 `slots`、`locale`、`remote` 与 `remote.delivery`。
- `shell.view/delivery` 渲染 workbench；`sidebar.modules/delivery-module` 打开它并显示派生的 blocked count。
- 一个共享 observable controller 同时供两个 entry 使用，因此 navigation 与 workbench 不会各自保存互相竞争的 Delivery facts browser copy。

Slot registration 与 locale dictionary 均由 effect 拥有，并在 plugin dispose 时消失。

## 工作台边界 {#workbench-boundary}

Issue import、Packet creation、change start、verification start、evidence read 与 human decision 是工作台范围内的 action。Browser 只提交所选 reference 与有界 form field。直接写 lane、raw Queue access、path 或 provider URI、credential、把 Agent prose 当作 evidence、提供未经验证的 success 与自动 acceptance 均不在范围内。

## 开发说明 {#dev-note}

保持 lane 与 blocked reason 由 Host snapshot 派生。新增操作时必须同时提供 narrow Remote method、本包拥有的 locale copy、cancellation 与产品可见测试。

## Model Experience

### 无直接模型上下文

#### 模型看到什么

模型不会直接看到任何内容。`./client` workbench 注册 browser UI 与 Remote call，但不注册 prompt、tool 或 resource。

#### Token effect

直接 token 为零；workbench state 是 browser control data，而不是 model input。

#### KV Cache effect

无；本包从不组装模型输入。

## 已知限制 {#known-limitations-and-deferred-work}

- **需要 Profile composition**——只有受支持的 bundle/profile 安装其 Client plugin、匹配的 Delivery Remote 与 provider 时，工作台才会出现。
- **单 operator MVP**——browser 永远不选择或声明 operator identity；multi-user authentication 与 authorization 不在本包范围内。
