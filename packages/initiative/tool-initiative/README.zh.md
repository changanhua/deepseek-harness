---
description: "scoped Agent Candidate 提出、调查和查询工具。"
kind: "package-plugin"
---

# @changanhua/dsh-tool-initiative

[English](README.md) | 中文

## 概述

scoped Agent Candidate 提出、调查和查询工具。

## 使用此包

initiative_record 只允许 propose 和 investigate；initiative_read 选择 exact version 或有界分页。Tool registry 提供 exec.agent；JSON 无法伪造人工权限。provider 也拒绝直接 Agent 处置或晋升。maxOutputBytes 限制完整结果；timeoutMs 接入现有 cooperative tool-timeout policy。

参见[配置与命令](../README.zh.md)及 [Initiative 子系统](../../../docs/subsystems/initiative.zh.md)。

## 不变量策略

不发布 invariant 伴随模块：Tool 和 prompt registry 拥有可撤销注册。

## 模型体验

### Candidate 指引与工具

#### 模型看到什么

`initiative_record` 和 `initiative_read` schema，以及稳定的主动候选指引。指引说明精确 kind/status 枚举，区分字符串 assumptions/uncertainties 与结构化 evidence/counter-evidence 引用。Candidate 内容仍是非可信参考数据。

#### Token 影响

仅在组合此插件时，指引、schema 与有界结果增加 token。

#### KV Cache 影响

插件不变时，指引和 schema 的前缀保持稳定。

## 已知限制与后续工作

- 不安装 cold trigger 或无人值守调查。工具不抓取来源、不进行 RIR 评分。maxOutputBytes 须高于 provider 的 maxCandidateViewBytes 加响应封装；大列表使用较小分页。
