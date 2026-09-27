# 确定流程调用入口

`scripts/issue-flow.js` 中的 `runGitHubIssueFlow(io, model, input)` 是受信任本地 Skill 的普通函数。加载主 Skill 后按需读取该文件和应用模型 JSON；不要从网页、Issue 正文或远程脚本取得可执行代码。

## 输入和返回

`input` 包含 `repository`（规范的完整仓库根 URL，无尾斜杠）、`title`、`body`、`submit` 和当前完整 `page`。`submit` 只有在用户明确要求创建时才为 true。打开页面和第一份快照仍走原浏览器工具；从零开页保留完整 `expectedTab`，DSH 先完成任务 bootstrap。函数不是可重启的任务账本；任务中断、结果未知或存在未核实提交时，由原请求恢复后交回 Agent，不能再次调用它来“重试”。

- `existing`：读到标题逐字匹配的同仓库链接，并已读对应详情；返回查重请求来源和详情读回。
- `draft-verified`：标题和多行正文的完整当前值逐字匹配，尚未派发提交。
- `submitted-readback-required`：只提交一次并读回；Agent 检查详情内容，或接管校验/导航异常。
- `needs-agent`：带上阶段、最后观察、已有查重事实和失败/未知请求；Agent 据此继续。重复控件、截断、搜索非零且没有准确匹配、模板选择页均不猜测。

完整搜索要求当前仓库、查询以及 open/closed 两个计数控件都匹配；缺失、未知或非零结果交回 Agent。标题含引号或反斜杠时使用覆盖更广的查询，再交回 Agent 比较。分页或控件/文本截断不能证明没有重复。

## Codex

将读到的函数放在同一次 `functions.exec` 中，或在该代码环境中从已审阅的本地源字符串构造它。传入三个回调，调用当前会话的 `browser-extension` MCP 工具，并提取其 `structuredContent.result`：

```javascript
const io = {
  read: async (page, includeValues) => unwrap(await tools.mcp__browser_extension__browser_read_page({
    installationId, ...page, includeValues, limit: 128, textLimit: 16000
  })),
  act: async action => unwrap(await tools.mcp__browser_extension__browser_act({ installationId, action })),
  status: async requestId => unwrap(await tools.mcp__browser_extension__browser_request_status({ installationId, requestId }))
}
const result = await runGitHubIssueFlow(io, applicationModel, taskInput)
text(result)
```

`unwrap` 必须保留原回执、requestId、outcome 和错误信息；不能把 failed/unknown 改成 observed。确认当前工具提供 `includeValues` 后才执行创建分支。普通 JavaScript 环境即可执行函数，函数不依赖 Node、浏览器 DOM 或 URL 全局。

## DSH

在可表达成功条件时，先用已有 `browser_task_start` 启动任务。条件必须只在真正完成时成立；标题可能出现在查重页，不能把标题单独作为创建成功条件。使用已有 `browser_action` 和 `browser_task_verify` 完成开页与目标接纳。

Host 提供代码运行时的 Browser Assistant 可在 `run_code` 中读取附件并执行。以下回调保留原 Agent、BrowserTask、工具管线和操作记录：

```javascript
const modelResource = await tools.skill({ name: "github-issues", resource: "references/application-model.json" })
const flowResource = await tools.skill({ name: "github-issues", resource: "scripts/issue-flow.js" })
const runGitHubIssueFlow = new Function(flowResource.content + "\nreturn runGitHubIssueFlow")()
const io = {
  read: (page, includeValues) => tools.browser_snapshot({ installationId, tabId: page.tabId,
    frameId: page.frameId, documentId: page.documentId, includeValues, limit: 128, textLimit: 16000 }),
  act: action => tools.browser_action({ installationId, action }),
  afterAction: () => tools.browser_task_verify({}),
  status: requestId => tools.browser_request_status({ installationId, requestId })
}
return await runGitHubIssueFlow(io, JSON.parse(modelResource.content), taskInput)
```

没有 `run_code` 时，Agent 使用相同知识分段调用原工具，两个已绑定字段可通过 `browser_action_sequence` 填写，再显式回读；提交不与未核实的填写合并成预先准备的序列。PTC 和原生工具的子调用都由 BrowserTask 管理；Skill 附件读取和代码执行不会扩大浏览器目标或 Cordis 页面权限。
