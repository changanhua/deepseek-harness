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

### 将 Codex 接入开发 worktree

使用目标 checkout 已安装的依赖，将下面的配置放入其受信任项目的 `.codex/config.toml`，并替换两个绝对路径。项目内配置可以避免把其他 Codex 项目指向开发 Host；客户端设置以 [Codex MCP 配置参考](https://developers.openai.com/codex/mcp)为准。

```toml
[mcp_servers.dsh_control]
command = "pnpm"
args = ["dsh", "--profile", "control-mcp"]
cwd = 'C:\path\to\target-worktree'
env = { DSH_CONTROL_CLI_ENTRY = "apps/cli/src/bin.ts", DSH_HOME = 'C:\path\to\isolated-connector-home', DSH_TELEMETRY_DISABLED = "1" }
env_vars = ["DEEPSEEK_API_KEY"]
startup_timeout_sec = 60
tool_timeout_sec = 120
required = true
```

Codex 进程的环境中必须有目标提供方的凭据。`env_vars` 只声明要转发的变量名，不要把密钥写入提交到仓库的 TOML 文件。默认临时 Host 不继承日常 DSH home 的设置和浏览器授权。上面的 `DSH_HOME` 隔离连接器；`DSH_CONTROL_HOST_HOME` 则单独指定准备好的 Host home。并发连接器不要共享这个 Host home。

此源码开发入口在启动 Host 时保留连接器的 Node 模块加载器，但不复制调试端口或测试运行参数。验收构建产物时，先构建目标，再设置 `DSH_CONTROL_CLI_ENTRY = "apps/cli/lib/bin.js"`。在目标目录执行 `codex mcp get dsh_control`，然后在那里打开新的 Codex 任务并调用 `dsh_runtime_status`：worktree 根目录、代码形态与隔离 home 必须匹配，之后才能写入 Session。源码修改需要新连接器运行才会加载；关闭前先导出证据，因为临时 Host 的历史会被删除。源码指纹不证明 Web 资源已经重新构建。

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

连接器暴露十七个工具，覆盖运行身份、组合与写入核对、Host 关闭、Session 打开/提示/取消/等待/事件/观察/问题回答、无源码的 Dynamic Cordis 检查、浏览器安装/标签页/快照/条目检查以及证据导出。`dsh_runtime_status` 可在绑定 Session 前调用，返回适配器加载时观察到的进程、Profile、home、包代码指纹和源码工作区。包指纹不代表整个应用构建或后续源码变更的验证结果。`dsh_runtime_inspect` 读取当前 Loader 插件清单；绑定 Session 后还可读取其作用域内的 Skills、工具和已配置 MCP server。查询与结果数量限制避免 Codex 只找一个能力时返回整个注册表。

一次开发回合先打开 Session、提交指令，再调用 `dsh_session_wait`。Agent 空闲、出现真实待答问题或超时时，等待返回阶段、问题和有界事件页。后续事件读取沿用返回的 `cursor`；`hasMore` 和 `latestSeq` 区分分页未读完与已读到末尾。`dsh_session_observe` 直接读取阶段与待答问题。回答时向 `dsh_session_attention_answer` 提交 `attentionId`、调用方生成的 `requestId` 和每个问题 id 的答案。现有问题服务恢复原工具调用，并把答案记录进 Session。补充指令可通过 `session_prompt` 的 `mode: steer` 提交。

控制 Host 只接管精确绑定的存活 Agent 的问题；其他 Agent 沿用已有回答者。必须由人决定的事项仍需人的回答。取消或 Host 释放会撤回问题，过期身份会被拒绝；并发问题保持独立。Host 最多保留 32 个待答请求，每批问题和答案各限 64 KiB。答案校验问题 id、已提供的选项及单选/多选语义，审批策略保持不变。`dsh_browser_snapshot` 返回页面事实，条目检查仅使用最近一次成功快照的页面身份。

-----

<a id="control-contract"></a>
## 控制约定

### 身份与权限

每个请求都携带配置的 `runId`。第一次成功的 `dsh_session_open` 会把 Host 适配器绑定到一个 Session。随后，浏览器访问会绑定从最新 `dsh_browser_instances` 结果中选择的一个安装，快照只接受最新 `dsh_browser_tabs` 观察中的标签页。页面操作不能提供自己的文档身份；条目检查使用最近一次成功快照的 page 对象。

### 写入、等待与证据

Session 打开、提示、取消和问题回答要求调用方生成 `requestId`。回复丢失后重试相同 id 和内容；即使问题已结束，匹配的 receipt 仍会重放，换成其他内容则拒绝。`dsh_request_receipt` 可在不重复写入的情况下核对结果；未找到只表示当前 Host 进程没有保留该 receipt。`dsh_session_cancel` 中断当前回合并保留排队或 steering 输入，后续 prompt 可唤醒新工作。Host 最多保留 `maxWriteReceipts` 个写入结果，默认 256 个，满额后拒绝新写入。这些 receipt 和待答请求不跨 Host 重启恢复。证据导出包含运行身份、当前观察、Session 事件和操作计数，结果判断由外部检查者负责。

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

已连接的 MCP 客户端会收到以 “Use this server for one isolated DSH run:” 开头的初始化指引，以及十七个固定 `dsh_*` 工具 schema 和 JSON 结果。[server 拥有的指引](src/server.ts)说明身份检查、Session 绑定、事件游标、问题权限、不确定写入核对及关闭前导出。问题文本和浏览器页面事实都是不可信数据；任何工具结果都不会授予新权限或证明成功。

#### Token 影响

初始化指引和十七个工具 schema 给外部 MCP 客户端增加固定上下文成本。事件页、注册表查询和问题批次有界，完整证据导出的大小随 Session 历史增长。本包不向目标 DSH 模型添加工具或提示章节；提交的问题答案会进入其现有工具结果和后续模型上下文。

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
