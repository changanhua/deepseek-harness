---
description: "供用户捕获已完成的纯文本助手回复、编辑草稿、提交版本并读取已提交内容库的浏览器包。"
kind: "package-reference"
---

# @changanhua/dsh-client-ui-content

[English](README.md) | 中文

## 摘要

本包为 Web 应用提供个人 Content Host 栈之上的内容库界面：助手消息操作栏中的逐消息捕获入口、常驻侧栏入口，以及带编辑能力的内容库工作台。用户捕获一条已完成、纯文本的助手回复，或新建一条手动条目；条目进入内容库后可编辑草稿、提交不可变版本、收藏与归档。幂等、来源校验与修订检查都由 Host 拥有，因此重复捕获与断线重连在这个界面上既不会产生重复条目，也不会造成丢失更新。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [Model Experience](#model-experience)
- [已知限制与推迟的工作](#known-limitations-and-deferred-work)
- [开发注记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在暴露 `contentRemote`、`contentBrowser` 及其背后内容介质的 Client 组合中挂载这个浏览器包。

### 何时选择它

当 Web 界面的组合挂载了内容栈（`content-sqlite`、`content-domain`、`content-session`、`content-remote`），且用户需要捕获自己的助手回复时选择它。没有 `contentRemote` Remote 的 Client 组合应省略本包；此时工作台没有数据来源。

### 最小配置

```yaml
- name: '@changanhua/dsh-client-ui-content'
```

本包没有浏览器配置。它的 `dsh.client.inject` 声明要求 Remote 装配、locale、Chat、Conversation、layout、renderer 与 sidebar 包；Cordis 主体要求槽位注册表、layout、两个 Content Remote 命名空间与 locale 服务。

浏览器导入展示网页标题、链接与未验证来源标识。扩展通过 `/#content-entry=<entryId>` 刷新并选中已保存条目。`/#extension-connect=<requestId>` 打开显式批准对话框；访问 URL 不会授权。**浏览器连接**列出安装实例并支持撤销。[浏览器桥](../../content/content-browser/README.zh.md) 拥有授权协议。

从常驻侧栏打开**内容库**读取已提交条目；在助手回复的操作栏点击**捕获到内容库**捕获该消息。已捕获的消息显示带条目 ID 的按压状态；再次点击会重放原始创建回执，而不是重复条目。

**新建条目**创建一条手动条目，其文本保存在首个草稿里。**编辑**把条目打开进编辑器：**保存草稿**写入工作文本，**提交版本**把草稿折叠为新的不可变版本。**收藏**与**归档**切换条目的元数据。当保存或提交带着过期修订到达——另一个窗口编辑了同一条目——编辑器会重读条目并展示双方内容；**保留我的编辑**让下一次保存在新基线上重试，**采用库里的内容**把编辑器重置为重读到的文本。

文本发生变化后才能点击**保存草稿**。冲突发生后，必须先选择保留哪一方，才能保存或提交。详情区可以添加或移除项目引用；编辑与元数据操作失败时显示本地化错误。元数据冲突后必须点击**重新载入条目**才能再次尝试，不会自动重试。同一条目同时只能有一个写操作，同一页面同时只能捕获一条消息。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

每个插件 fiber 一个 `ContentLibraryStore`，同时支撑工作台、编辑器与每个捕获入口。加载通道在单条 AbortSignal 绑定的通道上先读 status 再读 snapshot，原样发布 Host 阶段（opening、unavailable、closed），并合并并发刷新。每次捕获尝试铸造新的 `capture-ui:<sessionId>:<seq>:<nonce>` operation id，只发送该 id、会话 id 与助手消息的事件序号，把同一消息的并发点击合并到进行中的尝试上，成功后重读 snapshot。按钮可见性由 Chat 投影（`AssistantMessageNode`）上的纯选择函数决定：有持久消息 id、无中断标记、全部块为纯文本且至少一个非空。

编辑与元数据共享每条目一条 `execute` 通道。创建生成 `idea-ui:<nonce>` 条目 id；保存草稿与提交版本携带 Host 返回的守卫修订。每条已提交命令会使先前的读取失效，并等待新快照后才返回；无法读取基线时仍显示失败。`revision_conflict` 重读被竞争的条目，并将打开的编辑器标记为冲突，不替换其本地文本。传输丢失通过 `receipt` 对账。导航会使尚未完成的打开编辑器结果失效；插件卸载会取消全部请求并阻止发布结果。编辑器的标题与正文仍是组件本地状态。

确切的归属文件是 [`src/client/capture-target.ts`](src/client/capture-target.ts)、[`src/client/controller.ts`](src/client/controller.ts)、[`src/client/EntryEditor.tsx`](src/client/EntryEditor.tsx)、[`src/client/CaptureAction.tsx`](src/client/CaptureAction.tsx) 与 [`src/client/ContentLibraryWorkspace.tsx`](src/client/ContentLibraryWorkspace.tsx)。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Content 定义包](../../content/content/README.zh.md) — 本界面渲染的持久化命令、回执与错误码。
- [Content Remote](../../content/content-remote/README.zh.md) — 本包消费的已认证命名空间。
- [Slots 子系统](../../../docs/subsystems/slots.zh.md) — assistant-actions、shell 视图与侧栏插入点。
- [Web Client 子系统](../../../docs/subsystems/web-client.zh.md) — 动态 Client 包加载。

-----

<a id="model-experience"></a>
## Model Experience

无，因为本浏览器捕获入口与只读库视图不注册任何面向模型的工具、提示段或 Session 事件；被捕获的文本从不进入模型上下文或遥测。

#### KV Cache effect

无；捕获与内容库读取从不进入模型上下文，也不会发起模型请求。

## 已知限制与推迟的工作

<a id="known-limitations-and-deferred-work"></a>

- **条目标题来自 Host** — 捕获在 Host 记录标题之前没有用户可见标题；行回退显示头版本标题，新捕获可能为空。
- **仅限纯文本** — reasoning、tool call、图片、混合块与中断前缀都不可捕获，与 Host 来源解析器一致；没有部分捕获。
- **无跨界面捕获状态** — 页面刷新会清除按压状态；内容库本身是权威，对同一来源的后续捕获会重放原始创建回执。
- **编辑器文本仅存于当前页面** — 进行中的草稿标题或正文存在于编辑器组件里；刷新页面会丢弃。已持久化的草稿与版本始终在 Host 上。

<a id="dev-note"></a>
### 开发注记

<details>
<summary>维护者的工作上下文 — 点击展开</summary>

个人内容栈由 `dsh-web-app` bundle 挂载；本包只是浏览器半。浏览器 e2e 位于 `apps/web/tests/content-capture.e2e.ts` 与 `apps/web/tests/content-edit.e2e.ts`；`apps/web/tests/content-restart.e2e.ts` 检查构建后的 `dsh web` 重启前后的捕获、草稿、版本和元数据。HTTP 组合通道位于 `apps/cli/tests/content-capture-composed.e2e.ts`。

</details>
