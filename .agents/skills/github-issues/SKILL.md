---
name: github-issues
description: Reuse GitHub Issue page knowledge for browser-only duplicate search, issue creation, and readback, with fresh semantic control bindings. Use when operating repository Issues through browser-extension MCP or DSH browser tools.
---

# GitHub Issues

先读 [应用模型](references/application-model.json)，再按需要读 [查重与创建流程](references/create-issue.md)。DSH 通过 `skill({ name: "github-issues", resource: "references/application-model.json" })` 读取附件；Codex 使用当前会话的文件读取工具。模型保存页面和动作含义；当前仓库、表单值、页面身份、权限和执行结果来自本次浏览器读取。控件描述同时包含隔离页面和真实 GitHub 列表观察，仍必须逐页重新绑定。

## 绑定当前页面

1. 从用户目标确定仓库根 URL，读取当前页后确认 origin 与仓库路径。将模型中的 `{repository}` 替换为该根 URL。
2. DSH 的 `browser_snapshot` 可传 `bindings: [{ key, pageUrl, alternatives }]`。从模型选当前页的控件，`pageUrl` 使用已确认的完整 URL。需核对表单时显式 `includeValues: true`；未标记文本框仍可能包含敏感内容，页面范围大时用 `query` 限定值回读的目标表单。局部读取不能用于证明全页唯一绑定。
3. `bound` 表示完整本次观察中只有一个匹配控件，可直接使用唯一候选。`ambiguous` 的候选尚未选中，必须根据当前原始观察明确消歧，不能默认取第一项。`incomplete` 必须补充观察；`missing`、`page-mismatch` 和 `unavailable` 要补观察或升级判断。候选列表最多四项，`matchCount` 是观察到的匹配数；不把列表截断当作没有其他候选。
4. 仅对 `bound` 或已根据当前观察明确消歧的候选，用其原始 `page + snapshotId + elementId` 调用 `browser_action`。绑定结果的 `source.requestId` 指向生成它的读请求，既有 BrowserTask 负责预算、授权、执行记录与验收。
5. 独立 browser-extension MCP 使用 `browser_read_page` 和 `browser_act`；按同一知识匹配当前控件。它尚无 `bindings` 参数。不同通道不交换临时引用或 requestId。

缺少匹配时，可以用当前语义候选交给 Flash/Jev 选择或交给通用 Agent 探索。模型返回候选 ID，执行器使用原始引用。选择器无需生成 selector，也不能赋予权限。完整任务仍可由通用 Agent 执行；下面的模板用于重复发生的查重、创建任务。

## 可选确定流程

Agent 先确认用户目标、仓库、完整标题和正文，再选择 [调用入口](references/execution.md) 中的 `runGitHubIssueFlow`。它只使用调用方传入的原浏览器工具，既不另开 MCP 客户端，也不保存任务数据库。DSH 保留当前 BrowserTask；Codex 保留本会话的请求归属。未知请求未恢复时，禁止重新启动流程。

模板只在完整搜索明确没有结果、表单控件唯一绑定、字段逐字回读且用户明确要求创建时派发一次提交。模板选择、非零搜索结果的逐项比较、页面结构变化或校验失败会返回当前阶段与观察，由 Agent 接管。`submitted-readback-required` 只表示已派发提交并重新读页；Agent 仍需核对详情页的仓库、标题与正文。不要把这个状态改称“已创建”。
