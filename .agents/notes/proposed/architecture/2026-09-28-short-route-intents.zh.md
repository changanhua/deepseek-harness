# Agent Note: 短路由意图选择既有能力

Status: proposed

[English](2026-09-28-short-route-intents.md) | 中文

## 问题

用户需要用短说法选择预期执行路线，而不是每个任务都重写一段长提示词。目前这种选择只能作为模型轮次里的普通自然语言表达。模型可以在一个对话里记住 `DSH!:` 这样的局部简写，但这不会让该路线成为 DSH 拥有的约定，也不能证明实际执行的是 DSH、GitHub、BrowserTask 或另一项能力。

同一个可见任务可能有不同原因。GitHub Issue 流程通常最适合专用 GitHub 路线，而同一流程也可以作为 DSH 浏览器验收用例，因为它会覆盖已认证页面读取、查重、提交和回读。如果这些原因共享一条模糊的“浏览器”指令，用户就无法判断结果是在优化业务完成，还是在证明 DSH 能力。

DSH 已经有主要工程部件：profile 与 preset composition、`ctx.tools` 可见性和策略、只读 capability registry、workflow tool、BrowserTask evidence 和 session event。绕过这些机制的新路由系统会重复策略，并让证据更难被信任。

## 提议

增加一层很窄的 Route Intent，把短用户前缀映射到 DSH 既有 composition 和 evidence 机制。Route Intent 不是新的执行平面。它分类任务原因，选择或推荐 preset/tool/workflow 集合，并声明所选路线必须返回的 evidence contract。

第一组有用意图刻意保持很小：

| 前缀 | 意图 | 默认含义 |
| --- | --- | --- |
| `DSH!:` | 严格 DSH 验收 | 只使用 DSH 暴露的能力；缺能力时报出缺口，而不是 fallback。 |
| `Browser:` | 浏览器任务 | 适配时优先使用组合后的 DSH 浏览器路线；返回页面观察和动作证据。 |
| `GH:` | GitHub 业务任务 | 使用当前最直接的 GitHub-capable 路线；除非特别要求，不需要 DSH 浏览器证据。 |
| `Repo:` | 仓库任务 | 使用仓库工具处理 worktree、diff、test、commit 和 push。 |
| `Capability:` | 能力检查 | 先读取 live capability registry 或等价 profile surface，再推荐路线。 |
| `Evidence:` | 仅验证任务 | 不继续产品工作；返回运行了哪项能力、产生什么 receipt、最后回读到什么。 |

`GH:` 和 `DSH!:` 必须保持分离。`GH:` 优化的是通过最强 GitHub 路线完成 GitHub 工作。`DSH!:` 只有在目标是验证 DSH 浏览器或 workflow 能力时，才把 GitHub 页面作为载体。一个结果只有在证据命名 DSH 能力，并包含证明 DSH 路线执行过该工作的持久证据或回读证据时，才同时满足两者。

Route Intent 应该落在既有 composition stack 上：

- Agent preset 或 routing skill 识别前缀并设置任务原因。
- `ctx.tools` 和 policy 为严格路线限制可见工具集。
- Capability registry 提供 live 的“这条路线在这里能不能跑”答案。
- Workflow tool 承载固定多步流程，例如“搜索 issue、只创建一次、再回读”。
- BrowserTask 和 session log 为浏览器任务提供 receipt、readback 和 acceptance evidence。

严格前缀必须 fail closed。如果一个 `DSH!:` 任务需要的 DSH 浏览器能力缺失、过期或未授权，该路线会报告缺失能力并停止。它不能静默使用 computer-use、通用浏览器 UI driver、直接 GitHub connector 或 shell script，然后把结果总结成 DSH 验收。

## 考虑过的替代方案

**把前缀保留为 Codex-only 对话约定。** 否决，因为它只解决输入长度，不解决 provenance。用户仍然必须相信当前模型记住了约定，而且没有使用 fallback route。

**创建新的 generic DSH router service。** 第一阶段否决，因为 DSH 已经有 profile composition、tool policy、capability inspection、workflow 和 evidence record。Router service 在证明既有部件不足之前，就需要拥有自己的 policy、discovery、failure 和 evidence model。

**强制所有 GitHub 任务走 DSH 浏览器 workflow。** 否决，因为日常 GitHub 工作应该使用最可靠的 GitHub 路线。GitHub 是好的浏览器验收样例，不是默认避开专用 GitHub 通道的理由。

**让每个 workflow 发明自己的前缀和证明文本。** 否决，因为价值在于一致的 route reason 和 evidence contract。Workflow-specific prompt 可以增加细节，但顶层意图词应保持小而稳定。

## 验收标准

- 严格 `DSH!:` 任务只暴露 DSH-approved 工具，或在不 fallback 的情况下报告缺失的 DSH 能力。
- `GH:` 任务可以使用直接 GitHub 路线，且不会被当成 DSH 浏览器验收。
- GitHub 浏览器验收任务可以展示使用的 DSH 能力、操作 receipt 和目标页的新鲜回读。
- 能力检查任务在推荐路线前读取 live profile 或 registry state。
- 实现先复用 preset、tool policy、workflow、capability registry、BrowserTask evidence 和 session event，再考虑新增 public routing service。
- 文档和 UI 文案把前缀描述为 route intent 与 evidence requirement，而不是保证完成的魔法词。

## 风险

短前缀如果变得太宽，可能隐藏重要约束。因此第一组前缀只覆盖常见路线选择，任务细节仍保留在提示词剩余部分。

当请求的 DSH 能力不可用时，严格路线可能阻碍业务完成。验收任务需要这种行为；日常工作若更重视完成，应使用 `GH:`、`Browser:` 或 `Repo:`。

Capability registry 可以显示工具存在，但不能证明当前页面、账号或授权可以完成请求动作。严格路线仍需要 action receipt 和 readback evidence。

过早增加 router service 会集中化当前各包已经拥有的策略。第一版实现应保持薄映射，直到重复路线证明真的需要运行时 service。
