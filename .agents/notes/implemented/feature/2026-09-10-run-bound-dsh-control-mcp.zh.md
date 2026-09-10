# Agent Note: 运行绑定的 DSH 控制 MCP

Status: implemented

[English](2026-09-10-run-bound-dsh-control-mcp.md) | 中文

## 问题

外部 Codex verifier 需要驱动隔离 DSH Session、检查 Dynamic Cordis 状态、读取浏览器页面事实并导出证据。Web UI 和终端日志向人暴露这些事实，但它们需要界面导航和临时日志解析。公共 ACP 表层控制 agent 工作流，而此验证路径还需要 ACP 不负责的 DSH 专有 Cordis 与浏览器观察。

现有的 [MCP 客户端决策](2026-07-07-mcp-client-plugin.zh.md) 拒绝通用的 Harness-as-MCP server，因为 ACP 已经服务外部 agent 自动化。该决策仍然有效：缺失的能力是一个狭窄的本地 verifier 适配器，而不是另一种公共 agent 协议或所有 DSH 工具的投影。

## 决策

`@changanhua/dsh-control-mcp` 提供两个显式组合的部分。仅启动时加载的 `control-mcp` profile 为外部客户端运行 stdio MCP server，并默认拥有一个子 Web Host 和临时隔离 home。`dsh_control_close` 与连接器释放时会停止子进程。一个默认关闭的 Web profile patch 挂载 Host 适配器，后者注册专用的已认证 Connection RPC channel。普通 Web profile 不加载该适配器；连接已经运行的 Host 仍是显式诊断模式。

连接器只接受 HTTP loopback origin。它在禁用重定向的情况下交换目标 Host 的进程启动 token，保留返回的签名 cookie 对，并在控制请求 URL 中不发送 token。一次 401 允许重新交换一次 cookie；Host 进程重启后仍然需要新启动 token，并重启连接器。连接器释放会等待子进程停止和临时 home 清理；并发关闭请求共享同一个完成 Promise。显式 CLI 入口将托管 Host 固定到目标 checkout。源码入口保留 Node 模块加载器，但排除可能与连接器进程冲突的调试器和测试运行参数。

每个 Host 请求都携带已配置的 `runId`。第一次成功打开 Session 会把该适配器实例绑定到一个 Session。浏览器访问只有在新的安装观察中出现后才绑定安装；快照只接受最新标签页观察中的标签页；条目检查则使用最近一次成功快照的页面身份。调用方不能为条目检查提供文档身份。

MCP server 暴露固定操作：运行身份及当前 Loader 或 Session 作用域能力检查、Session 打开/提示/取消/等待/事件/实时观察/问题回答、不含源码的 Cordis inventory、浏览器安装/标签页/快照/条目检查、写入核对以及证据导出。注册表检查读取既有投影所有者，并限制筛选结果数量。它不暴露任意 Remote endpoint、Context 对象、Node.js 执行、shell、文件系统、Dynamic Cordis 变更或验收决定。

Session 打开、提示、取消与问题回答要求调用方生成幂等 key。Host 保留固定数量的写入 receipt，容量耗尽后拒绝新写入，同时分别统计读取和等待。receipt 查询可核对不确定回复而不再次写入；相同写入会重放 receipt，同一身份换成其他内容则拒绝。取消会保留等待稍后执行的输入。receipt 和待答请求只属于当前进程。证据导出包括包代码指纹、适配器加载时的源码身份、当前观察及 Session 事件，由独立 verifier 解释这些事实。

默认关闭的 Host 仅为精确绑定的存活 Agent 接管现有 `user-questions/request` waterfall。每个待答请求获得独立身份，取消和释放立即撤回请求。运行观察读取这些真实待答请求，不从历史工具调用猜测问题是否仍未回答。等待在出现问题或 Agent 停止运行时返回；分页 cursor 只推进到实际返回的事件。现有问题工具记录提交的答案，并继续原 Agent 循环。必须由人决定的事项仍属于人，桥接不覆盖审批策略。

## 考虑过的替代方案

**只驱动 Web UI 并解析日志。** 拒绝，因为 UI 状态、滚动位置和格式化日志作为自动化输入，弱于所属的 Session、Cordis 和浏览器 service。最终页面可见验收仍适合保留独立浏览器检查。

**用 DSH 专有浏览器与 Cordis 方法扩展 ACP。** 拒绝，因为 ACP 是可互操作的外部 agent 协议。加入仅用于验证的 DSH 内部能力会让其约定依赖厂商，而且仍不能建立独立证据所有者。

**通过 MCP 暴露所有 Host Remote 方法或模型工具。** 拒绝，因为这会继承无关权限、复制 API 发现，并让 verifier 通过验证计划以外的路径改变被测对象。

**提供一个完成并判断浏览器任务的工具。** 拒绝，因为这会把页面理解、插件生成和验收隐藏在适配器内部。分离观察可以区分被测模型的工作与 verifier 的判断。

## 后果

Codex 可以创建和提示一个隔离 Session、等待其真实生命周期、检查 Cordis 与浏览器状态，并在不控制 DSH UI 的情况下获取证据。channel 保持本地、显式，并且不存在于普通 profile 中。固定工具 schema 和渐进绑定减少跨运行或过期页面控制的风险。MCP 初始化提供身份、等待、问题、重试和关闭前导出的工作流；项目内客户端配置避免把开发路由带入其他任务。

本包增加一个私有 personal bundle 和一个随附 profile template。只有目标 Host 组合提供由其他包负责的 `browser` service 时，浏览器操作才可用；在该集成落地前，这些工具返回结构化不可用结果。支持的部署形态是 stdio MCP、loopback HTTP、自动拥有子 Host 和每个连接器一个 Host。可用 `DSH_CONTROL_HOST_HOME` 提供凭证与持久设置；省略时使用临时 home，并在关闭时删除。

源码测试覆盖运行与 Session 绑定、有界幂等、等待、Cordis 过滤、浏览器观察 fence、认证、MCP 映射和生命周期释放。构建和源码 profile 测试运行 CLI 入口；源码关闭检查断言显式关闭与断开后子进程退出、临时 home 被删除。针对浏览器页面模型 worktree 的 Codex app-server 探测已驱动真实模型提问、提交 canary 答案、在 assistant 消息中观察其回传并导出证据。浏览器可见验收仍由浏览器页面模型集成负责。逐文件单元测试覆盖率仍低于仓库要求的 100% 门槛。
