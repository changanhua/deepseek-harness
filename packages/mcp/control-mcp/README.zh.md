---
description: "供 Codex 客户端观察和驱动隔离 DSH Host 的运行绑定本地 MCP 控制，同时不暴露通用进程权限。"
kind: "package-bundle"
---

# @changanhua/dsh-control-mcp

[English](README.md) | 中文

## 概述

`control-mcp` profile 为本地 Codex 客户端提供一个小型 stdio MCP 接口，用于单次隔离 DSH 验证运行。连接器默认自动启动并拥有子 Web Host，包括临时 Harness home；调用 `dsh_control_close` 或连接器退出时会停止并清理子进程。另一个默认关闭的 Host patch 通过现有 Connection 传输暴露已认证的 Session、Dynamic Cordis 和浏览器观察。连接器只接受 HTTP loopback origin，并在发送控制请求前用 Host 启动 token 换取签名 cookie。本包不暴露任意 shell、Node.js、文件系统、Cordis 源码或验收权限。

## 目录

- [使用本包](#use-this-package)
- [控制约定](#control-contract)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 启动隔离 Host

构建当前 checkout。连接器默认会自行用默认关闭的 patch 启动目标 Web Host，并创建临时隔离 Harness home。

```powershell
$env:DSH_CONTROL_HOST_HOME = 'C:\path\to\prepared-isolated-host-home'
pnpm dsh --profile control-mcp
```

省略 `DSH_CONTROL_HOST_HOME` 时，连接器会创建临时 home，并在运行结束时删除。不要把此 patch 指向普通生产 profile：运行绑定是验证边界，不是通用远程管理 API。

### 启动 stdio 连接器

如果要连接已经运行的 Host，可设置 `DSH_CONTROL_AUTOSTART=false`，再传入它的 origin、token 和 run id。这是诊断兼容模式；Codex 通常使用上面的自动生命周期。

```powershell
$env:DSH_CONTROL_AUTOSTART = 'false'
$env:DSH_CONTROL_ORIGIN = 'http://127.0.0.1:52044'
$env:DSH_CONTROL_TOKEN = '<token printed by the isolated Host>'
$env:DSH_CONTROL_RUN_ID = 'validation-run-1'
pnpm dsh --profile control-mcp
```

通常由 MCP 客户端拥有此进程及其 stdio。`dsh --profile control-mcp --help` 可以检查 profile 组合而不占用协议流。

### 获得的能力

连接器暴露十二个工具：关闭 Host；针对一个 Session 的打开、提示、等待、事件读取和运行观察；不含源码的 Dynamic Cordis 检查；浏览器安装、标签页、快照和条目选择器检查；以及结构化证据导出。`dsh_session_observe` 返回当前阶段、事件 cursor，以及尚未回答的 `ask_user_question`。`dsh_browser_snapshot` 返回页面事实，但不选择选择器。`dsh_browser_entry_inspect` 只在快照成功后接受候选选择器，并从保存的观察中提供页面身份。

-----

<a id="control-contract"></a>
## 控制约定

### 身份与权限

每个请求都携带配置的 `runId`。第一次成功的 `dsh_session_open` 会把 Host 适配器绑定到一个 Session。随后，浏览器访问会绑定从最新 `dsh_browser_instances` 结果中选择的一个安装，快照只接受最新 `dsh_browser_tabs` 观察中的标签页。页面操作不能提供自己的文档身份；条目检查使用最近一次成功快照的 page 对象。

### 写入、等待与证据

`dsh_session_open` 和 `dsh_session_prompt` 要求调用方生成 `requestId`。Host 最多保留 `maxWriteReceipts` 个幂等写入结果，默认值为 256；固定容量用尽后拒绝新的写入。读取、写入和等待操作分别计数。`dsh_evidence_export` 在 MCP 结果中返回有界的 Host 观察 JSON；它不会写入任意路径，也不会宣告验收通过。

### 认证与恢复

连接器在禁用重定向的情况下执行启动 token 交换，只保留返回的 cookie 对，并且不在控制请求 URL 中发送 token。一次 HTTP 401 会清除 cookie 并尝试重新交换一次。新的 Host 进程会生成新的启动 token，因此 Host 重启后要用新 token 重启连接器。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 是完整且仅启动时加载的 `control-mcp` 应用：一个命令行所有者和一个 stdio server。[`host.cordis.patch.yml`](host.cordis.patch.yml) 是显式的 Web profile overlay，用于挂载 Host 适配器。Host 适配器注册专用的已认证 Connection RPC channel，stdio 端则把固定 MCP schema 映射到该 channel。[`src/control-plane.ts`](src/control-plane.ts) 负责运行绑定、幂等性、浏览器观察 fence、操作计数与证据组装。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [MCP 包组](../README.zh.md)——MCP 的消费与服务两个方向。
- [应用组合](../../../docs/architecture.zh.md)——profile 与 bundle 的所有权。
- [Session 子系统](../../../docs/subsystems/session.zh.md)——Session 读取和证据导出返回的持久事件。
- [MCP 客户端决策](../../../.agents/notes/implemented/feature/2026-07-07-mcp-client-plugin.zh.md)——为什么消费任意 MCP server 仍由另一个包负责。

-----

<a id="model-experience"></a>
## 模型体验

### 外部 MCP 控制工具

#### 模型看到什么

已连接的 MCP 客户端会看到十个固定 `dsh_*` 工具 schema 及其 JSON 结果。浏览器工具返回的页面文本和 DOM 事实是不可信数据；任何工具结果都不会授予新权限或证明成功。

#### Token 影响

十个工具 schema 会给外部 MCP 客户端增加固定上下文成本。工具结果会增加依数据而变的 token，其上限受 Session 事件限制、浏览器 provider 限制及一次运行中保留的证据约束。本包不会给目标 Session 内运行的 DSH 模型增加 prompt 或工具 token。

#### KV Cache 影响

对于固定包版本，工具列表保持稳定，可以保留在外部客户端可复用的前缀中。工具调用和结果追加在该前缀之后；schema 或外部客户端 MCP 组合变化时，会按照该客户端和 provider 的规则使复用失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **浏览器能力是可选运行时依赖**——目标 Host 没有 `browser` service 时，浏览器工具返回结构化错误。完整浏览器运行时验收属于与独立开发的浏览器页面模型的集成工作。
- **channel 是本地且绑定运行的**——只支持 stdio MCP 加 HTTP loopback Host。不提供共享 HTTP MCP server、发现 registry 或多 Host 路由。
- **Cordis 控制是只读的**——本包报告不含源码的生命周期状态，但不定义、运行、更新或停止 Dynamic Cordis package。
- **证据是观察而非判断**——外部验收仍必须把导出事实与独立冻结的 verifier plan 对比。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
