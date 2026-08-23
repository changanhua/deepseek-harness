# Agent Note: web.search-selected 派生 fact 与 capability-visible 投影

Status: implemented

[English](2026-08-23-web-search-selected-fact-and-capability-projection.md) | 中文

## Problem

`WebRuntime` 的选择路径（`resolveProvider`）在执行时从实时 settings source 选中一个搜索提供方，但模型无法在不发起 `search()` 调用并读取成功或 `WebError` code 的情况下获知当前选中了哪个提供方。runtime-facts 注册表（batch 1）已支持 sync baseline 投影与集中式 relevance 过滤，但 web 包未注册任何 fact，因此 runtime-context snapshot 不携带任何 web 选择状态。

## Decision

`WebRuntime` 通过 R3.1-B3 定义的 optional seam 注册一个 baseline 运行时 fact：`web.search-selected`（sync、dynamic、owner `web`），经 `ctx.inject(['runtimeFacts'], rctx => rctx.effect(() => …))` 接线。`@deepseek-ai/dsh-runtime-facts` 是 optional peer dependency；未挂载该服务时 web seam 照常工作，卸载该服务时 `effect` disposer 自动撤回 fact。

该 fact 的 `resolveSync` 调用 `selectedSearchProviderId()`——一个新的公开方法，走与 `search()` 相同的 `resolveProvider` 选择路径，但 catch `WebError` 并返回 `undefined`（观测为 `unavailable`）而非抛异常。runtime-facts 注册表的 `observeSync` 会把抛错 contain 为 `unavailable` 并记录 warn 日志，但内部 catch 避免了该噪音，并使投影层不预判可操作性（R3-5）：模型从 `search()` 抛出的 `WebError` code 获知失败原因，而非从投影。

该 fact 声明 `relevance: { tools: ['web_search'] }`，因此 runtime-facts 注册表通过 `ctx.tools.get('web_search', scope)` 集中求值可见性，仅当该工具对 assembly scope 可见时才投影该 fact。web 包不写可见性代码（R3-3）。该 fact 为 `dynamic`，因此每次 assembly 重新读取 `this.source()`，settings 层偏好变更在下次 snapshot 生效，无需重新注册。

## Verification

`packages/web/web/tests/web.search-selected.spec.ts`（10 个用例）断言：fact 声明（owner、evaluation、freshness、exposure、relevance）；`resolveSync` 返回已配置的提供方 id；settings 层偏好变更在下次 inspect 更新而无需重新注册；无明确选中提供方时为 `unavailable`；scope 未定义或工具不可见时 `render` 不投影；`web_search` 对 scope 可见时 `render` 投影 `- web.search-selected: <id>`；fact 经 `systemPrompt.assemble` 流转；无 runtime-facts 服务时 web seam 正常工作；卸载 runtime-facts 服务时 fact 消失而 web seam 继续。包测试与仓库 typecheck 通过。

## Alternatives considered

**在注册时缓存选中的 id。** 拒绝：该 fact 为 `dynamic`——settings 层偏好变更必须在下次 assembly 生效，缓存值会返回过时的选择。

**让 `resolveSync` 抛 `WebError` 并依赖注册表的 `observeSync` catch。** 拒绝：无选中提供方时每次 assembly 产生 warn 日志，且投影层不应通过错误语义传递可操作性。`selectedSearchProviderId()` 内部 catch 并返回 `undefined`。

**将 `runtimeFacts` 声明为硬注入。** 拒绝（R3.1-B3）：这会使 runtime awareness 成为 web seam 的硬依赖，破坏早于该插件的 composition。

**在 web 包内部求值工具可见性。** 拒绝（R3-3）：relevance 是声明式的，可见性由 runtime-facts 注册表通过 `ctx.tools` 集中求值，fact owner 不写可见性代码。

## Consequences

baseline runtime-context snapshot 在 `web_search` 对 scope 可见时增加一行 capability-scoped 内容（`- web.search-selected: <id>`）；无条件 baseline（host.os、host.arch、runtime.execution-world）不变。V1 不投影可操作性——选中的提供方能否运行只能通过执行 `search()` 并按抛出的 `WebError` code 路由来观测。统一 provider readiness protocol 与 `web.search-operable` 推迟至 V2（R3-5）。
