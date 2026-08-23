# Agent Note: 通过 settings seam 表达 web 搜索／抓取提供方偏好

Status: implemented

[English](2026-08-23-web-settings-live-provider-preference.md) | 中文

## Problem

web seam 从 `WebRuntimeConfig.searchProvider`／`fetchProvider`（composition）选择搜索与抓取提供方，`$DSH_WEB_SEARCH_PROVIDER`／`$DSH_WEB_FETCH_PROVIDER` 以同一字段提供覆盖。该值只在构造时读取一次，因此用户既没有持久化的 `settings.yaml` 接口来表达默认提供方，也无法在不重启的情况下更改它。settings seam 已经存在并已消费多个能力（主题、语言、默认模型路由）；web 提供方偏好正是下一个尚无归属的用户可编辑选择。

## Decision

`WebRuntime` 注册一个 `web` settings namespace（`WEB_SETTINGS_NAMESPACE`，经 `settingsNamespace('web')`；`WEB_SETTINGS_SCHEMA` 持有 `searchProvider`／`fetchProvider`）。composition entry 与之前用同一套字段构造（`config.searchProvider ?? process.env.DSH_WEB_SEARCH_PROVIDER`，及抓取孪生字段），因此未挂载 settings provider 的部署行为与原来完全一致。接线采用 `agent-default-model` 已在用的规范 `installSettingsSection` 消费模式：服务维护一个 `source: () => WebSettingsSection` thunk，在有 settings scope 附加时指向解析后的 scope，settings provider 摘除时回落到 entry。

`search()`／`fetch()` 在调用开始时读一次 `source()`，并基于该快照解析提供方。用户层对 `web.searchProvider` 的编辑无需重启或重新注册提供方即可在下次调用生效（B5 live-resolve 语义）；正在进行的调用保持其开始时解析的偏好。缺省的 id 照旧保留自动选择。除 `WebSettingsSection` 类型外，公开面只新增 `WEB_SETTINGS_NAMESPACE`／`WEB_SETTINGS_SCHEMA` 两个导出。

## Verification

`packages/web/web/tests/web.settings.spec.ts` 用真实 `SettingsProvider` 钉住四种 live-resolve 行为：用户层覆盖 composition entry；热 `settings.replace` 改变下次调用但不改变正在进行的调用（per-operation 快照）；摘除 settings provider 时回落到 entry；无 settings provider 时按 composition entry 原样运行。既有 `web.spec.ts` 合约测试套件（注册、选择、`maxResults`、抓取、中止）原样通过。

## Alternatives considered

**保留构造时捕获的 id。** 拒绝：它把偏好冻结在启动时刻，编辑必须重启才生效，且不为 user-preference plane 提供任何 settings 接口。

**在 `search()` 中直接读 `settings.yaml`。** 拒绝：它绕过 `ctx.settings` 的分层与 watch 语义，并重复回答 settings seam 已经拥有的"真源"问题。

## Consequences

web 能力成为 user-preference plane 的又一消费方（B2：`ctx.web` 拥有默认提供方偏好）。偏好、选择与执行边界都留在 `WebRuntime`；`tool-web` 与各提供方不获得任何选择权。这个实时 `source()` thunk 也是后续 provider fact 贡献 `web.search-selected` 时读取的同一个值，因此那里无需再引入独立状态。
