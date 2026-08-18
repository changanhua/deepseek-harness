# AGENTS.md 维护指南

[English](AGENTS-maintenance.md) | 中文

本仓库有多个不同作用域的 AGENTS.md 文件。每个都是对应作用域内 agent 的**操作宪法**，不是百科全书。本指南说明每个文件在哪、用哪条规则判定一条事实归谁管、字数纪律，以及编辑纪律。它存在的意义，是让未来的 agent 和人类保持这次重构所达到的清晰分层。

## 三个作用域

| 文件 | 作用域 | 放什么 |
|---|---|---|
| 全局（`~/.dsh/AGENTS.md`） | 本机所有 DSH 会话、所有项目 | 跨项目的 agent 工作习惯。绝不放 DSH 特定内容。 |
| 根 [`AGENTS.md`](../AGENTS.md) | 进入本仓库的任何 agent | agent 每个会话都需要在上下文中拿到的规则：身份、pre-release 立场、核心 invariants、最小验证纪律、secrets、Agent Note 规则。目标 60–80 行。 |
| 子树 `AGENTS.md`（`packages/`、`examples/`、`docs/`、`.agents/notes/`） | 在该子树内工作的 agent | 只属于该子树的指令。绝不放 root 已承载的仓库级规则。仓库级规则是 root 的职责，不是子树的。 |

root 与子树的界线是**一事实一归属**（[docs/AGENTS.md](AGENTS.md#the-tier-taxonomy-one-home-per-fact)）：每条规则只有一个家，其余地方只链接它。当 rule 需要 agent 在每个会话、无论任务都照做时，它是 root 规则。当 rule 只在某类工作时才被需要，它属于该类工作的文档（TypeScript 约定 → `docs/development.md`，测试策略 → `docs/testing.md`，Cordis 语义 → `docs/cordis-primer.md`，以此类推），而不是 root。

## 一条事实归谁

新增或移动规则前，按此顺序自问：

1. **它是 DSH 特定的吗？** 若是，绝不可以进全局文件。全局只放每个仓库都成立的习惯（先验证再声称；优先读项目自己的 AGENTS；如实报告实际跑过的命令；区分事实与推断）。DSH 词汇（`everything is a plugin`、`Cordis`、`SessionEventMap`、`ctx.effect()`、`dsh-brand`）永远不进全局。
2. **agent 在这里的每个会话都需要它吗？** 若需要，进 root `AGENTS.md`，用一至三行规则并链接它的家。
3. **agent 只在做某类工作时才需要它吗？** 若如此，进该类工作的二级文档或子树文件，而非 root。root 只在二级文档索引里保留一个链接。
4. **它是布局、命令表、或生成目录吗？** 若是，进承载该层级归属的文档（布局 → `development.md`，命令 → `development.md` + `testing.md`，类型清单 → 子系统页）。root 不做复述。

## 字数纪律

`pnpm run verify-doc-budgets`（`doc-sync` 的一环）强制执行 [`scripts/doc-budgets.manifest.json`](../scripts/doc-budgets.manifest.json) 里的上限。**manifest 是权威**——ceiling 错了改 manifest，而不是改建议性目标文案。

- root `AGENTS.md` 上限在 manifest 里是 **1900 词**。不要把 [docs/AGENTS.md](AGENTS.md#wordcount-budgets) 里的 1,600 词目标当成门禁值；manifest 才是门禁。
- 门禁红了先**搬迁**（把规则移到它的家，留一行链接），再**压缩**，最后才考虑**抬高** ceiling，且要在 PR 里说明 manifest diff 的理由。
- 达到或低于目标时，保留至少 5% 余量。高于目标时，ceiling 冻结，直到搬迁或压缩让它回到目标以下为止。

这次重构达到 60 行，是因为大多数约定被移走，而不是逐字地削掉散文。不搬迁内容光削字是错误的第一步。

## 编辑纪律

- **在 root 用一到三行陈述规则，链接它的家。** 展开性内容在「家」里存着，绝不内联在 root。
- **移动规则意味着在它的新家落地完整内容。** 本指南要防的失败：从 root 删掉一条规则，却没在目标文档加任何东西，导致该事实从文档体系中凭空消失。每条被移走的约定必须在同一变更里完整写进它的归属文档（[hardcoded-tunables 漏失](../AGENTS.md#conventions) 就是已记录的实例）。
- **`CLAUDE.md` 是 `AGENTS.md` 的符号链接**（root、`packages/`、`examples/`）；编辑真实文件，绝不碰符号链接。
- **绝不重复规则。** 用一句话 grep 它的独特措辞；保留一个家，其余链接它。复述的规则会各自腐化。
- **不要把具体事故硬编码进常驻规则。** 具名事件进 `Lesson` 条目（见 [docs/lesson.md](lesson.md)）；常驻规则只保留通用行为，不保留个案。
- **在链接高层文档的同时保持每条规则自包含。** 清晰尚存时才压缩。

## 改动后的验证

改动任何 AGENTS.md 或移动一条 convention 后，运行文档门禁：

```sh
pnpm run verify-doc-budgets   # 字数上限
pnpm run verify-md-links      # 相对链接与锚点可解
pnpm run verify-agent-note-format  # Agent Note 结构（若动过 note）
```

只报告实际运行的命令。一条因移动而断链或超预算的规则是失败的变更，不是外观问题。
