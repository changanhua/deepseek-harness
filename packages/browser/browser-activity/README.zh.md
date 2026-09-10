---
description: "浏览活动的宿主私有存储、保留策略与有界检索。"
kind: "package-reference"
---

# @changanhua/dsh-browser-activity

[English](README.md) | 中文

## 概述

本服务拥有上传后的原始浏览活动。每个安装实例默认没有采集策略。显式配置固定会话、站点、事件种类、频率、正文大小、保留期限和容量。整理后的知识由目标知识系统持有；本域保存观察到的事实。

## 目录

- [使用本包](#use-this-package)
- [存储与恢复](#storage-and-recovery)
- [模型体验](#model-experience)
- [已知限制](#known-limitations)
- [开发说明](#dev-note)

<a id="use-this-package"></a>
## 使用本包

将服务与 `browser` 及私有 `storageDomain` 后端组合。扩展 Gateway 暴露绑定安装身份的策略、上传和检索操作。采集要求当前 `browser:read` 与 `browser:observe`；Gateway 还要求 `session:interact`。配置其他站点的来源不会授予访问权限。

配置使用稳定请求 id 和用户看到的版本。暂停持久保存 `enabled: false` 并使旧缓冲批次失效；显式恢复产生另一版本。重复配置请求返回原版本。过期控件不能覆盖新设置。

Chrome 离线时仍可检索历史，但继续受当前会话、授权版本、权限和站点范围约束。撤权立即阻止访问，不等待持久化完成。采集和配置仍要求安装实例在线。`tool-browser` 中可选的 `browser_activity_search` 工具将检索绑定到调用 Agent 的会话。

<a id="storage-and-recovery"></a>
## 存储与恢复

`browser_activity` 域为每个安装实例保存一条记录。连续批次只保留最近一次回执；重启后的相同重试不会新增事件。提交结果不确定时停用当前激活，直到重新打开存储。已存事件保留会话与授权版本；重新授权不会通过检索暴露旧版本内容。

每份策略最多保留 2,000 条事件、每条 4,000 字符正文和 30 天历史。完整记录另受 4 MiB UTF-8 大小限制。暂停和启动时仍执行到期清理；默认定时周期为 60 秒。检索最多返回 100 条事件和 256 KiB。宿主最多接纳 64 个安装实例和 128 个待处理操作。

<a id="model-experience"></a>
## 模型体验

无。本包不注册模型工具或提示贡献，也不发起模型请求。消费者必须将采集正文视为来源资料，而非指令。

<a id="known-limitations"></a>
## 已知限制

本包不采集 Chrome 事件、不上传图片，也不写入思源。Loader 测试通过外部 Browser 测试替身验证 SQLite 恢复；它不证明 Chrome 采集或完整知识工作流。

<a id="dev-note"></a>
### 开发说明

[记录算法](src/records.ts) 执行批次和保留边界；[引擎](src/engine.ts) 拥有串行持久化与当前授权检查。[Loader 测试](tests/loader.spec.ts) 通过真实存储链检查冷恢复、重试身份、检索与持久暂停。
