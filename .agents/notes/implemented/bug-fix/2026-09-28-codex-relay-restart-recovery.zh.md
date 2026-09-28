# Agent Note: Codex relay 重启恢复

Status: implemented

[English](2026-09-28-codex-relay-restart-recovery.md) | 中文

## Problem

独立 relay 重启会丢失内存 grant，而 Chrome 保留凭据。重试相同 WebSocket 无法重建缺失的 grant；把任何拒绝都当作重新配对许可，又会绕过明确拒绝。

## Decision

[连接器](../../../../packages/mcp/browser-extension-mcp/README.zh.md#connection-recovery)区分已认证的 grant 丢失、撤销、不可信来源和错误握手。只有 `4409 credentials_expired` 允许经原连接入口自动续授权。扩展保留安装身份，重试前持久化续授权意图；单一配对 Promise 与既有通道退避串行处理自动、手动和 worker 触发的恢复。主动断开及终止拒绝跨 worker 重启停止恢复。

relay 配置拥有安装撤销名单；配对与 WebSocket 认证都强制执行它，不依赖扩展持久化的终止保留状态。原有来源与 token 检查仍是必要条件。[浏览器执行授权决策](../architecture/2026-09-08-browser-execution-authority.zh.md)继续拥有操作身份、写入互斥与回执查询；续接连接不授权重放未知操作。

## Alternatives considered

通用 `1008` 上重新配对会混淆错误消息与可恢复状态丢失。直接从 token 重建 grant 会跳过现有配对入口。持久化所有 relay grant 会增加不必要的存储职责；既有信任与撤销配置足以决定新配对。

## Consequences

relay 重启可在不重载 Chrome 的情况下恢复。永久拒绝要求所有者解决拒绝原因并显式清除扩展保留状态。配置变更要求重启 relay。恢复次数仍有界，长期故障期间不保证最终连通。

聚焦协议与扩展测试覆盖拒绝分类、并发续授权、中断配对和 worker 持久状态。真实扩展隔离场景仅重启 relay，刷新页面证据，验证丢失响应的点击没有重放，并确认撤销跨 worker 唤醒有效。缺失回执仍为未知；能够证明操作结果的是恢复的日志回执，而非连接状态。
