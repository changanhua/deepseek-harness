# 事故复盘（postmortem） 0005：合并后的 Web 运行时使用旧产物并重复重试失败的预设恢复

[English](0005-web-merge-runtime-regressions.md) | 中文

Status: resolved

## 摘要

已验证分支合并到本地 `master` 后，Web 页面仍显示 288 个架构包，而合并后的目录实际有 308 个。已有会话还因复制出来的 `field-cordis` 预设继续使用废弃的 `persona.text`、没有使用必需的 `persona.prefix` 而无法恢复。回滚会发出命令目录变更，浏览器又对每条通知重试，最终产生 `ERR_INSUFFICIENT_RESOURCES` 和含义不清的 `Failed to fetch`。事故流入的原因是 Git 状态、客户端构建产物、Profile 配置和真实发送刷新流程被分开验证。新增防护包括重建产物并重启的证据、Profile schema 检查、失败目录拉取合并，以及完整浏览器对话验收。

## 概述

合并后的 `master` 源码生成 308 个架构目录项。运行中的 Web 客户端此前仍提供包含 288 项的旧动态 bundle，直到重建架构包并重启 Host 后才更新。

个人 `field-cordis` 预设从旧组合复制而来，仍保留 `config.text`。当前 `dsh-persona` schema 要求 `config.prefix`，因此使用该预设的会话在 Agent 初始化阶段恢复失败。Gateway 返回了具体的内部错误原因，浏览器却把传输失败压缩成 `Failed to fetch`。

回滚期间命令注册发生变化。客户端命令目录为每条 `commands/change` 都启动新的 `commands/list` 请求，包括已有拉取正在失败时。请求风暴耗尽浏览器资源，遮蔽了原始预设错误。

## 影响

用户可能看到仿佛未合并的架构目录，无法恢复使用现场预设的会话，也无法发送普通提示词。原始 v0 会话文件保持不变；修复迁移器后已发布当前 v3 后继文件。没有证据表明发生数据丢失或授权绕过。

## 时间线

- 已验证的浏览器和记忆整合分支进入本地 `master`。
- Web 从源码检出启动，但使用了旧架构客户端 bundle；侧边栏显示 288 而非 308。
- 历史加载暴露下游 `rpcDigest` 字段未被 v0 迁移校验器接纳；原始日志保持不变，补上字段后迁移成功。
- 会话恢复随后暴露过期的 `field-cordis` `persona.text` 配置。
- 回滚通知触发命令目录重复拉取，浏览器出现 `ERR_INSUFFICIENT_RESOURCES`。
- 修正预设字段、合并命令刷新、重建架构客户端并重启 Host。
- 新会话发送两条提示词，收到两次预期回复，刷新后仍保留对话。

## 根因

合并流程把 Git ref 当成了 Web 已经提供的字节，缺少源码到 bundle 的身份核对，也没有要求源码或 Profile 变化后重启。Profile schema 变化没有针对既有个人预设副本的迁移或预检。命令目录把不可否决的变更事件当成无条件重试请求，因此确定性的初始化失败被放大成无限客户端循环。Session 格式也出现了写入方加入字段、冻结的 v0 读取方没有同步词汇的问题。

## 已添加的防护措施

- v0 Session 校验器接纳实际生成的非空 `rpcDigest`，并增加 `agent/inbox/spliced` 用户消息回归用例。
- `CommandDirectory` 合并进行中的失效通知，成功后最多补拉一次；失败项保持失败，只有显式重试路径才会再次拉取。
- 修改 `field-cordis` 个人预设前先创建了备份，并把 `text` 改为 `prefix`。
- 重新构建架构客户端并重启 Host 后再读取目录数量；实际页面显示 308。
- 浏览器验收覆盖会话恢复、新建会话、提交提示词、模型回复、刷新和继续发送第二条提示词。
- 命令目录行为及失败循环的原因已记入[插件自有的人类命令注册 Agent Note](../../.agents/notes/implemented/feature/2026-07-19-plugin-command-registration.zh.md)。

## 教训

- 分支已合并不等于运行中的 build 已更新；检出、产物、Profile、进程和端口必须作为同一个 subject identity 记录。
- 配置 schema 变化需要在会话恢复前检查持久化和复制出来的组合。
- 失败通知不能自动变成无限重试。
- HTTP 200、历史加载或页面可见都不足以证明 Web 可用；必须发送、收到回复、刷新并继续同一段对话。
