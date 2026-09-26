# Agent Note: 惰性 MCP 能力端点

Status: implemented

[English](2026-09-26-lazy-mcp-capability-endpoint.md) | 中文

## Problem

DSH Profile 具有选择性。将当前已挂载的全部工具导出给 Codex，要么公开部分且偶然的 roster，要么迫使一个 Profile 加载所有可能的工具。一次直接外部工具调用还需要 DSH 策略、持久回执和新的 agent scope，但不能创建模型轮次。

## Decision

一个回环 MCP 端点发布部署所有的目录。每个行将声明绑定到 preset；读取目录不会挂载该 preset。首次调用会 single-flight standing mount，随后通过新的真实 Agent 和 `ToolRuntime` 运行已声明的原生工具。端点将目录发现与执行就绪状态分开。

目录声明与已加载工具必须有相同的名称、描述、输入 schema 和输出 schema。不一致会快速失败。每次调用追加开始和终态 session 事件，在返回前 flush，并记录 `observed`、`failed` 或 `unknown`；只有终态可以指导恢复。端点返回有界 MCP 文本和 JSON 结果，绝不持久化超限或不支持值的副本。

端点是经过认证、没有 Origin 的回环 Streamable HTTP surface。它接受无状态 `POST` exchange。Host teardown 会停止准入、中止自有工作、关闭未完成 exchange 并等待调用完全停稳。取消的 waiter 不会取消共享 preset mount。

## Boundaries

端点只接受被动原生工具 preset。挂载它不得开始模型轮次、等待用户输入、启动独立任务或要求展示 channel。PTC preset 会被拒绝。工具策略仍通过原生执行器运行，包括没有 approval channel 时对 `ask` 的拒绝。

此入口不会使 DSH Profile 可全局发现、启动另一个 Profile 或 Host、桥接 MCP Resources 或 Prompts、添加持久任务 API，也不会使 Codex 依赖 DSH 的独立浏览器连接器。更广泛的[浏览器能力平台设计基线](../../proposed/architecture/2026-09-26-browser-capability-platform.zh.md)仍是独立提案。

## Alternatives considered

**导出活跃 Profile 的注册表。** 这会让外部可见工具依赖偶然的 Host 组合，且无法公开未加载 preset。目录到 preset 的绑定改为显式。

**为每个工具创建一个 MCP 适配器。** 这会重复发现、生命周期、元数据和审计工作。一个协议端点可以发布任何已声明的原生工具。

**让每次调用经过 DSH 模型循环。** 直接工具调用需要策略和 agent scope，不需要规划。模型轮次会增加延迟和无关的 session 事件。

**在 Host 启动时挂载每个 preset。** 这会消除首次调用加载延迟，但破坏 Profile 选择性并激活无关依赖。

## Verification

- 元数据发现会使每个绑定 preset 保持 unloaded。
- 并发首次调用只挂载一次 preset；调用另一 preset 不会激活它。
- 失败挂载不保留部分组合，修复后的 preset 可以重试。
- 每个被接受的调用都有独立真实 Agent 和持久终态证据，没有模型轮次、步骤或 assistant 事件。
- 原生 ToolRuntime 策略、PTC 拒绝、元数据漂移拒绝、取消、响应边界、回环认证、Origin 拒绝和 Host teardown 都有聚焦测试。
- 已构建 Profile 的进程测试通过持久化服务重新读取 Session。Codex CLI 验收调用入口，通过真实 Flash 提供者选择候选，并通过 glob 找到验收文件。

## Consequences

首次使用需要承担 preset 加载延迟。`dsh_capabilities` 返回的状态可能在后续调用前过时；它是状态而非预留。协作式取消无法证明已开始的副作用未发生，因此 unknown 调用不得回放。在有组合级准入检查前，被动 preset 规则仍是架构约束。
