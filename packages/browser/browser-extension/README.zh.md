---
description: "具备所有者批准授权、有界 Host HTTP 和 WebSocket 请求及会话寻址执行的经认证 Chrome 扩展浏览器提供方。"
kind: "package-reference"
---

# @changanhua/dsh-browser-extension

[English](README.md) | 中文

## 摘要

当要通过 Host Web Server 将已批准 Chrome worker 连接到会话寻址的浏览器操作和选定 DSH Session 时，请选择此提供方。它以 verifier 和 challenge 配对扩展，让已登录所有者批准或撤销范围受限的授权，并通过 HTTP 和 WebSocket 转发有界请求。worker 使用 assistant runtime、connection、channel、journal、executor 和 page 层执行浏览器操作。每次发送前，提供方都会检查授权 scope、允许的 origin 和授权 epoch；模型工具由 tool-browser 消费方提供，本包不安排后台监控。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当 Host 拥有已批准扩展连接时，请将此提供方与 `webServer`、`connection`、`credentials` 和 `@changanhua/dsh-browser` 组合。

### 授权与请求处理

该提供方在 Host Web Server 上注册 `/api/browser-extension/v1` HTTP 和 WebSocket 路由，并在 `/browser-assistant` 提供已登录所有者的批准页面。扩展发起 verifier/challenge 配对请求。所有者只能选择请求的 scopes 和 origins 的子集，包括独立的 `session:interact` 权限，随后可以撤销由 Credential Provider 存储的授权。可见且同 Session、具备 `session:interact` 的 peer 会通过既有 Approval answer chain 获得浏览器操作批准，由 transport UUID 标识；隐藏或断线 peer 委托 Web。`/info` scope 列表描述协议词汇；它不证明每个 scope 都有执行器。

`prepare()` 创建绑定到当前授权 epoch、Session 和操作的私有 ticket。`executePrepared()` 会在派发前重新检查该绑定。worker 会在提交前同步复核表单状态：它直接展开本地 `<details>`，将其他无可见变化的点击视为 `unknown`，并把可见的本地页面变化报告为 `observed`，而不声称业务结果。填写回执不返回页面最终 value；批准 preview 来自 Host 输入。对于未知操作，journal 先检查完全停稳的 receipt，并要求用户按钮后才持久化 `acknowledgementPending`；`browser.acknowledge` 只向 Host 发送最小 identity、outcome 和完全停稳事实，成功后清除待处理 acknowledgement。重新连接可以再次同步它。旧 epoch 只能查询 status 或取消当前 write，绝不执行旧页面操作。请求、frame、结果、容量和截止时间均有边界。提供方每 20 秒发送一次 heartbeat，并断开陈旧 peer。取消会请求 worker 停止；缺失 receipt、断线、超时或传输失败会变为 `unknown`。重新连接仅恢复请求状态：不会重放查询或写入，任何未知的变更性操作在 worker 报告完全停稳前都不会解除。

具有 `session:interact` 时，经认证 peer 会获得严格的 `SessionController` facade，用于列出、创建、提示、取消、读取页面和附件，以及一个受控 follow stream。它校验每个 RPC 请求，串行替换 follow，将并发 Session 请求限制为 `maxSessionRequests`（默认 `4`，范围 `1`–`8`），并保留既有 16 MiB WebSocket frame 上限。提供方将 `sessionController` 作为注入的 peer dependency。

提供方仅接受其协议已实现的 actions。Puppeteer 是 `click`、`fill`、`submit`、`double_click`、`right_click`、`hover`、`press`、`select`、`check`、`drag`、`upload`、导航、标签、截图、滚动和等待动作的默认执行器。DOM 兼容执行器仅支持 `click`、`fill`、`submit`、`navigate`、`scroll` 和 `wait`，并拒绝新动作类型。它不安装或配置 Chrome 扩展，服务定义本身也不挂载这些路由。源配置由 [BrowserExtension.Config](src/index.ts) 定义；生成的[配置目录](../../../docs/config-catalog.zh.md)是穷尽参考。

交互快照包含可见元素的局部引用、DOM 角色、可读标签，以及禁用、只读、必填、选中和展开状态。树快照会将稳定的完整 Document、元素、文本和开放 Shadow Root 层次分页返回；节点跨 cursor 保留 index 和 parent index，iframe 元素只标记其 source 边界。原生标签和 `aria-labelledby` 会解析为文本，不读取编辑值。隐藏、可编辑、script 和 style 文本不会进入树输出；输入区、选择框和可编辑正文不会混入快照正文或元素标签；准备操作时，值仅在文档内的有界内存中保留，用于比较。隐藏或禁用控件不能执行，可见性或有效禁用、只读状态改变会使已准备动作失效。截图要求主 frame，base64 上限为 400,000 字符。上传只接受当前用户消息明确写出的绝对路径；该检查在模型工具执行前完成，不额外显示批准框。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制 — 点击展开</summary>

`BrowserExtension` 实现 `ctx.browser`，并负责 Host 路由注册、由凭据支持的授权和活动扩展传输。已连接 worker 负责其浏览器侧的 assistant runtime、channel、journal、executor 和 page 操作。`BrowserSessions` 是提供方对 `ctx.sessionController` 的严格 RPC facade，因此 worker 获得的是克隆结果而非直接服务访问。配对不会在公开视图中存储可复用 verifier。批准和撤销会断开受影响 peer，而每个请求在交付前封存授权 epoch 和目标。[授权处理](src/grants.ts)、[请求结算](src/requests.ts)、[Session RPC](src/sessions.ts)和[协议验证](src/wire.ts)包含准确的协议规则。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [浏览器定义](../browser/README.zh.md) — 定义此处实现的 `ctx.browser` 操作。
- [Web Client 子系统](../../../docs/subsystems/web-client.zh.md) — 说明 Host Web 路由和已登录请求。
- [存储子系统](../../../docs/subsystems/storage.zh.md) — 说明 Credential Provider 的持久化边界。
- [Host Web Server](../../host/webserver/README.zh.md) — 负责已注册 HTTP 和 WebSocket 路由。
- [Client Connection](../../client/connection/README.zh.md) — 负责请求 authority 和所有者 Cookie 检查。

-----

<a id="model-experience"></a>
## 模型体验

持有既有 `session:interact` 授权时，`reading.generate` 直接向 DSH 模型发送一次请求，仅包含本条解读提示词和材料。它不创建会话、不加载历史、不注册工具，也不运行 Agent 循环。模型路由与密钥来自 Host 适配器；解读选择覆盖 DSH 默认模型。每个连接只允许一条正在生成的解读，上限为 52,000 输入字符、64,000 输出字符和四分钟。停止或断连会取消请求；传输失败不自动重试。

#### KV Cache 影响

独立解读不发送之前的问题或输出，因此输入费用不会随解读历史增长。服务商可能缓存共同的提示词前缀；网关不保留会话缓存。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- 真实登录站点与真实模型的验收取决于部署配置。
- 标准 Agent preset 已组合浏览器工具；此提供方不选择模型，也不登录网站。
- 监控不消费浏览器 worker 或 Session stream 结果。
- 思源集成、观察和全局键处理不消费浏览器 worker 或 Session stream 结果。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>供维护者使用的工作上下文 — 点击展开</summary>

无。

</details>
