# 下游 Core Patch Registry

[English](core-patch-registry.md) | 中文

## Summary

下游治理检查让每一处保留在上游所有代码中的修改都可见、有界且可移除。它把个人分支绑定到一个受支持的上游基线，要求每组 patch 都有负责人和退出条件，并在新的未登记修改合并前阻止它。它不判断上游实现是否等价，也不证明最新上游 revision 与个人版兼容。

## Table of Contents

- [事实来源](#sources-of-truth)
- [检查边界](#checked-boundary)
- [运行检查](#run-the-check)
- [失败与恢复](#failure-and-recovery)
- [进一步探索](#further-exploration)
- [Dev Note](#dev-note)

<a id="sources-of-truth"></a>

## 事实来源

[`upstream-base.json`](../../upstream-base.json) 统一拥有受支持上游 commit、最近观察到的上游 commit、已记录个人 head、它们的 merge base 与 divergence，以及重新验证时间。`recordedPersonalHeadSha` 是经过审计的输入 commit，可以保持为更新该记录之 commit 的 ancestor；检查器会拒绝不在待检查历史中的值。

[`core-patches.json`](../../core-patches.json) 统一拥有有效 patch 清单及其数量、风险和 critical patch 预算。每个条目记录上游文件、引入 commit、负责领域、原因、不可采用的更低层放置方式、事实／数据／安全影响、证据、回滚方式、替换条件、复查期限、已知冲突，以及该 patch 最近针对哪个上游 revision 重新验证。

[`downstream/package-identities.json`](../../downstream/package-identities.json) 只拥有 npm 来源事实，不再重复 Git 基线 revision。

<a id="checked-boundary"></a>

## 检查边界

检查器比较受支持上游基线与指定个人 head，并选择被新增、修改、删除、重命名或改变类型的上游所有 core 路径。它排除 `vendor/`、文档、Agent Note、package README 和双语 sidecar，因为这些内容已有各自的仓库与文档检查。只有 package identity registry 或有界的 `downstreamOwnedAdditions` 清单明确标识下游所有者时，新增文件才被排除；上游所有 package 内的新文件仍然需要 patch 条目。

每条选中路径都必须匹配一个有效 registry 条目。检查器还要求证据文件存在、引入 commit 有效且可从待检查 head 到达、复查日期未过期、迁移与回滚字段完整，而且有效清单未超过预算。`compatibility-adapter` 条目必须声明 `factOwnershipEffect: "none"`；拥有业务状态的 adapter 无法通过验证。

<a id="run-the-check"></a>

## 运行检查

在待审查 checkout 中运行仓库命令：

```sh
pnpm run check:core-patches
```

只有当受支持基线、registry、当前可用 Git 历史、路径覆盖、证据引用、期限和预算彼此一致时，命令才以零退出。只有已记录上游对象存在，并且其 merge base 与 divergence 一致时，结构化报告才设置 `observedUpstreamVerified`。普通 fork checkout 使用 `pnpm run check:core-patches -- --format json`；upstream-aware canary 还要增加 `--require-observed-upstream`，让上游对象缺失时关闭式失败。

<a id="failure-and-recovery"></a>

## 失败与恢复

未登记路径会阻止变更。增加私人 core patch 前，依次尝试上游能力、配置、Profile、Plugin、Provider、Slot、个人 package、Bundle 或 compatibility adapter。如果这些位置都不足，再增加包含真实风险与退出路线的 registry 条目；不得仅为隐藏新修改而扩大已有路径 pattern。

过期或超预算的 registry 会暂停新增私人 core 工作。维护者必须移除或替换 patch、向上游贡献通用修复，或者通过更新理由和测试显式调整预算。检查器不会解决 merge conflict、改变受支持基线、写入 Git 状态或修改用户数据。

<a id="further-exploration"></a>

## 进一步探索

- [Fork divergence 记录](../../FORK-DIVERGENCE.md)
- [仓库拥有的 npm 身份](../../.agents/notes/implemented/process/2026-09-04-repository-owned-npm-scope.zh.md)
- [Core patch 预算决定](../../.agents/notes/implemented/process/2026-09-05-downstream-core-patch-budget.zh.md)

## Dev Note

下一治理阶段由 latest-upstream canary 与 compatibility heatmap 消费本 registry；它们并不证明当前受支持基线已经变化。
