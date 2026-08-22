# Agent Note：将上游 dsh 0.1.1-rc.2 合并进 fork

状态：已实现

English | [中文](2026-08-22-merge-upstream-rc2.zh.md)

## 问题

该 fork 跟踪 `upstream/master`（`deepseek-ai/deepseek-harness`）。上游发布了 `dsh-v0.1.1-rc.2`（`b150a551b8`），在 rc.8 merge base 之上有 207 个提交：图片/Files 请求管线统一重构（PR #2676）、#2608 权限修复的回退（PR #2903）、i18n 链接本地化、CI workflow 拆分与 session projection 重构。fork 落后 207 个提交、涉及 2668 个文件，所有生成 catalog 与双语配对记录都不同步。

## 决策

按 rc.7/rc.8 建立的方式，分两个提交完成合并与 reconcile：

1. **合并提交** `Merge remote-tracking branch 'upstream/master'`：解决 16 个冲突文件。`AGENTS.md` 保留 fork 的精简 constitution（divergence #1）。`slot-catalog.ts` 保留 fork 独有 `ui-settings-skills` occupant，而 `client-ui-subagent SubagentCatalogAction` occupant 随上游 ui-subagent 重构（SubagentHeaderLineage 替代）移除。生成 catalog（`skills`/`typert` 的 `.md`/`.zh.md`）跟随上游移除 Source 行号（PR #1373）。双语配对合并双方：`subsystems/README.zh.md` 采用上游 `.zh.md` 链接本地化并保留 fork 的 task-queue 索引行；`tool-catalog.zh.md` 在保留 fork task-queue 中文工具目录的同时加入上游 `experimental-tool-agent-team`，顺序与重生成的英文源对齐。八个 `.i18n.yaml` 配对记录暂取上游 blob 占位，Phase 2/3 重记录。
2. **Reconcile 提交** `fix: reconcile fork artifacts with merged upstream (rc.2)`：重新生成 `gen-cordis-catalog`（过时的 `task-queue.md`）、`gen-config-catalog`（过时的 `config-catalog.md`）与 `gen-client-catalog`（过时的 `slot-catalog.ts`）。修复一个合并回归：上游把 `translation-pairing` 叶子 gate 重新加进了 `docSyncLeafGates` 及其在 `run-gates.spec.ts` 的断言——fork 已移除两者（divergence #2），故再次删除。执行 `pnpm install` 落实 ui-subagent 新增的 `react-dom` devDependency 与上游 `credentials/authorization` workspace。更新 FORK-DIVERGENCE.md。

## 验证

`pnpm run typecheck`、`pnpm run build`、`pnpm run doc-sync` 与 `pnpm run verify-doc-budgets` 通过。全部 catalog 验证器通过（`verify-cordis-catalog`、`verify-tool-catalog`、`verify-config-catalog`、`verify-persistence-catalog`、`verify-client-catalog`）。完整 `pnpm run test` 显示两个合并引入的失败已修复（run-gates 断言、ui-subagent `react-dom` 解析），剩余仅为既有 Windows 环境失败（fs/lsp/skill/workspace/doc-site 套件的 symlink EPERM、源码/测试/依赖在本次合并均未变的 schedule runtime 边界用例、以及 pwsh-persistent 超时）；第二次运行出现的那个 `acp-snapshot` 失败属偶发，单独运行通过。

## 备选方案

**用 `-Xours`/`-Xtheirs` 自动解决冲突。** 否决：分叉文件或生成 catalog 里的每个冲突都是需要保留两边增量内容的判断。

**仅在 verify gate 失败时重新生成 catalog。** 否决：生成文件编码了合并后的源码真相，每次合并后都必须重新生成，与 gate 状态无关。

**跳过 FORK-DIVERGENCE 更新。** 否决：该记录是下次合并的 reconcile 参考；merge base 过期或缺失分叉会让下次冲突分诊更难。

## 后果

fork 现在领先 rc.2 merge base 48 个提交，上游没有缺失的提交（merge base 即上游 tip 本身）。后续合并可以端到端运行 `dsh-merge-upstream` 技能，并在冲突解决和测试断言调整处设人工关卡。既有 Windows symlink-EPERM 环境失败仍在 reconcile 范围之外；若 fork CI 开始 gate 它们，应另行处理。
