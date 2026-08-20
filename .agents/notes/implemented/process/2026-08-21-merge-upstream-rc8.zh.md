# Agent Note：将上游 dsh 0.1.0-rc.8 合并进 fork

状态：已实现

English | [中文](2026-08-21-merge-upstream-rc8.zh.md)

## 问题

该 fork 跟踪 `upstream/master`（`deepseek-ai/deepseek-harness`）。上游发布了 `dsh-v0.1.0-rc.8`（`141eb6fef8`），在 rc.7 基础上有 536 个提交——规模大到若合并后不做 reconcile，fork 会残留过期的生成 catalog、损坏的测试和漂移的文档。上次 rc.7 合并已显示规律：冲突出现在 FORK-DIVERGENCE 列出的文件加上每个生成 catalog，测试之后也必须同步到 fork 现实。

## 决策

按 rc.7 建立的方式，分两个提交完成合并与 reconcile：

1. **合并提交** `Merge remote-tracking branch 'upstream/master'`：解决 22 个冲突文件。fork 侧条目（task-queue 工具、capability-registry、sidebar.modules、ui-conversation 依赖、tsconfig task-queue 引用）与上游新增条目（experimental agent-team 工具、brand slots、file/session-reference remotes、ui-renderer 改名）并存。`AGENTS.md` 保留 fork 的精简形式。`ui-settings-skills` 对已退役 `web-react` 包的依赖被改指到 `ui-renderer`（其上游改名）。
2. **Reconcile 提交** `fix: reconcile fork artifacts with merged upstream (rc.8)`：重新生成 cordis/client/config/doc-graphs/tool catalog；把 fork 测试适配到上游 API 变更（`commands.execute` 增加了 `images` 参数；web-app 增加 `openBrowser` 默认值；sidebar 增加 brand slots 和模块状态）；为 fork 包导出补 JSDoc；同步 skills 子系统的 type-equiv 文档；让 fork 包 README 符合 model-experience/limitations gate；为合并后的上游内容提高 `docs/testing.md` 文档预算。

## Reconcile 清单（已编入 dsh-merge-upstream 技能）

- 重新生成每个生成 catalog（`gen-cordis-catalog`、`gen-client-catalog`、`gen-config-catalog`、`gen-doc-graphs`、`gen-tool-catalog`）。
- 上游重命名 fork 消费的包时（`web-react` → `ui-renderer`），更新 fork 独有 `ui-settings-skills` 的依赖和 tsconfig 引用。
- 分类测试失败：fork 现实导致的断言漂移（更新测试）vs 环境（Windows symlink EPERM）vs 并行干扰（单独重跑）。
- 运行 `verify-export-jsdoc`、`verify-type-equiv`、`verify-doc-budgets` 和包 README gate；fork 包不达标时补 JSDoc 和 README 章节。
- 更新 FORK-DIVERGENCE.md：刷新 merge base 与领先数，并记录新确认的分叉（web-app LAN publishing、task-queue 能力、docs/specs）。

## 验证

`pnpm run typecheck` 与 `pnpm run build` 通过。适配包的聚焦测试套件通过（command-task-queue 9、web-app startup 5、gen-tool-catalog 10、ui-sidebar 6）。`verify-cordis-catalog --check`、`verify-type-equiv`、`verify-export-jsdoc`、`verify-doc-budgets` 以及两个包 README gate 通过。完整 `pnpm run test` 仍显示早于本次合并就存在的 Windows-symlink EPERM 和并行干扰失败；doc-sync 的 markdown-wrap 与文档站检查失败也是 fork 既有文档/环境问题，不是合并回归。

## 备选方案

**用 `-Xours`/`-Xtheirs` 自动解决冲突。** 否决：分叉文件或生成 catalog 里的每个冲突都是需要保留两边增量内容的判断。

**仅在 verify gate 失败时重新生成 catalog。** 否决：生成文件编码了合并后的源码真相，每次合并后都必须重新生成，与 gate 状态无关。

**跳过 FORK-DIVERGENCE 更新。** 否决：该记录是下次合并的 reconcile 参考；merge base 过期或缺失分叉会让下次冲突分诊更难。

## 后果

fork 现在领先 rc.8 merge base 46 个提交，上游没有缺失的提交。后续合并可以端到端运行 `dsh-merge-upstream` 技能，并在冲突解决和测试断言调整处设人工关卡。两个既有文档/环境 gate 失败（fork 文档的 markdown-wrap、Windows 的 symlink EPERM）仍在 reconcile 范围之外；若 fork CI 开始 gate 它们，应另行处理。
