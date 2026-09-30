---
description: "经认证的项目计划浏览器访问、交接准备与 Delivery 状态读取。"
kind: "package-reference"
---

# @changanhua/dsh-planning-remote

[English](README.md) | 中文

## 概述

使用此 Remote 可列出项目、读取计划 Board、提交受限计划命令、为精确修订准备 Delivery，并读取关联的 Delivery 状态和 packet 已声明的证据。Host 固定浏览器 actor 身份并拒绝未知或格式错误的 wire 字段。

context 操作返回所选 Plan 或 Focus 的投影，不展开资源内容。现有 execute 调用也承载对象修改和 Session 绑定，Provider 校验被绑定的 Session 属于该项目。`designCases` 只返回一个 Plan 已保存案例的摘要，包括作用对象、ResourceRef、冻结基础修订和当前漂移；探索未启用时报告 owner 不可用，不表示已确认的空列表。摘要操作不创建案例，也不修改正式状态。

## 使用此包

Remote 提供 `workspaces`、`snapshot`、`execute`、`handoff`、`execution` 和 `evidence`。组合 Delivery 时，`snapshot` 会增加只读的关联执行摘要。`handoff` 从选中的修订准备 shaping Case；它不批准需求、不派发工作、不验证修改，也不接纳结果。`execution` 将持久 handoff 引用关联到现有 Delivery 只读模型。`evidence` 仅接收所选 Plan 的关联 Case 中 packet 已声明的证据 id，然后使用 Delivery 既有的校验读取器；其他 Plan 不能读取该证据。

浏览器路径使用配置的本地人类身份，校验所选项目和精确修订。模型工具另行推导 Agent 权限，Planning 再校验当前直接用户消息。意图识别由 Agent 与 Skill 负责；Host 检查身份和版本事实，不解析自然语言授权。

## 不变量策略

不发布 invariant 伴随模块，因为 canonical 修订仍归 Provider 所有，漂移在每次读取时计算。探索记录只有一个 StorageDomain 所有者，不维护第二份实时 canonical 缓存。

## SBC 探索

显式启用 `enableSbcDesignCase` 配置后，可保存冻结的 Plan/Focus 投影、独立的选择与坐标，以及最近 30 步空间撤销记录。普通 Planning 操作不依赖探索存储。personal-planning Bundle 启用该选项，并选用已有的 web-host StorageDomain。打开案例只创建探索状态；打开和探索均不执行 Planning 命令。

JSON 后端将单条记录保存到配置的存储根目录下的 `sbc_design_cases/cases/<sha256>.json`，键由项目和作用对象身份哈希得到。每次移动保存逆向坐标；选择节点不消耗空间撤销历史。Consumer 在拖动结束时提交一次移动，不逐个提交指针事件。`maxSbcCases` 和 `maxSbcCaseBytes` 超限时在提交前拒绝新增或写入。存储初始化失败后可显式重试。

读取时将保存的 Plan 修订和可选 Focus 版本与最新 Planning 数据比较。漂移会保留冻结投影和全部探索状态。并发修改使用独立的案例版本，冲突后需要重新读取案例。最近一次请求可用原身份重试；若已有后续修改，更早的请求会冲突。

## 开发备注

无。

## 模型体验

### No direct model context

#### What the model sees

本包不注册提示词或工具；可选的 `tool-planning` consumer 负责模型指引和结果呈现。

#### Token effect

无。可选的 `tool-planning` Consumer 拥有任何模型可见的交接工具。

#### KV Cache effect

无。

## 已知限制与延后工作

- 未组合 Delivery 时会返回不可用 execution view，不改变计划数据。
- SBC 浏览器 UI 尚未接入。未提供自动协调或向 Planning 晋升的功能。
