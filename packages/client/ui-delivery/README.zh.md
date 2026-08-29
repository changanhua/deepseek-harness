---
description: "为 Personal Delivery 工作台预留的空 client package boundary。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-delivery

[English](README.md) | 中文

## 概述

`dsh-client-ui-delivery` 为 Personal Delivery workbench 预留可发布的 browser entry。其 client plugin 刻意为空：加载后不注册 slot、locale、Remote call、subscription 或可见 component。

这样既能稳定 package discovery 与 Loader composition，又不会在 Remote-backed projection、action、disposal behavior 与产品可见测试存在前宣称已有用户体验。

## 空 composition

- Node entry 保留空 plugin body。
- Browser entry 导出空 dependency list 与 no-op `apply()`。
- Manifest 保留 `./client` export 与 web platform declaration。
- Peer 与 development dependency 预留未来的动态 Remote、locale、renderer 与
  client-test boundary。静态 slot、primitives 与 React input 在源码真正导入前
  仅保留为 development dependency；当前尚未注入或调用其中任何一项。

运行时不预留 shell 或 sidebar identity。缺少标准 registry lifecycle 与 disposal proof 时，不支持 slot registration。

## 工作台边界

Issue import、Packet creation、change start、verification start 与 human decision 是工作台范围内的 action。直接写 lane、把 Agent prose 当作 evidence、提供未经验证的 success 与自动 acceptance 均不在范围内。

## 开发说明

除非 generated Remote、framework seat、locale、component 与 lifecycle disposal 一并加入并通过测试，否则保持此 scaffold 为空。

## Model Experience

### 无直接模型上下文

#### 模型看到什么

模型不会直接看到任何内容。空 `./client` entry 不注册 prompt、tool、resource、Remote call 或 UI。

#### Token effect

直接 token 为零；当前不渲染任何 workbench state。

#### KV Cache effect

无；本包从不组装模型输入。

## 已知限制

- **没有产品可见工作台** — Remote-backed card、human action、slot composition、accessibility behavior 与 disposal 均不受支持。
