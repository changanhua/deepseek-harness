# 上游同步 SOP

[English](upstream-sync.md) | 中文

## 概述

个人 fork 只能从固定官版 commit 同步，并且必须使用隔离 branch 与 worktree。dry run 会记录 Git 快照、预测冲突、映射受影响的私人 patch、证明干净临时树能够物化，并删除所有临时 ref 与 worktree。它绝不准入 base、解决冲突、commit、push、发布或触碰用户的脏 checkout。

## 目录

- [前置条件](#preconditions)
- [运行 dry run](#run-the-dry-run)
- [分类结果](#classify-the-result)
- [执行已准入同步](#perform-an-admitted-synchronization)
- [验证与证据](#verification-and-evidence)
- [回滚](#rollback)
- [进一步探索](#further-exploration)
- [Dev Note](#dev-note)

<a id="preconditions"></a>

## 前置条件

从干净的同步 worktree 开始，不要使用用户日常 checkout。不能存在正在进行的 merge、cherry-pick、revert 或 rebase。`upstream` remote 必须解析到 `upstream-base.json.officialRepository` 记录的仓库；URL 不同会在 fetch 前失败。把当前 branch 名、HEAD、`upstream-base.json`、`core-patches.json`、`FORK-DIVERGENCE.md` 和最新 canary 报告保留为同步快照。

latest-upstream canary 是观察，不是准入。干净的临时合并只表示 Git 没有发现文本冲突，不能证明个人行为、持久数据、安全策略或验收。

<a id="run-the-dry-run"></a>

## 运行 dry run

在干净同步 worktree 中运行仓库命令：

```powershell
pnpm run dry-run:upstream-sync -- --format markdown
```

只有针对经过审查的官版分支时才使用 `--upstream-branch <branch>`。证据自动化使用 `--format json`。脚本会验证参数与分支语法，在 fetch 前解析官版 SHA，通过已验证 URL 把该准确分支 fetch 到唯一的 `refs/dsh/upstream-sync-dry-run/*` ref，并在分支于解析和 fetch 之间继续前进时拒绝执行。

脚本会比较受支持官版 base 与已固定目标，对个人 HEAD 运行 `git merge-tree`，归组变化 package 路径，把路径映射到 `core-patches.json` 有效条目，并推荐 patch 专属与平台检查。干净合并树会被包装成不受 ref 引用的双 parent commit，在系统临时目录中以 detached worktree checkout 一次，验证为干净后删除。临时 ref 会在报告返回前删除。Git object 可以保留到正常垃圾回收，但 branch、remote-tracking ref、`FETCH_HEAD`、源文件、index 和用户数据都不会改变。

<a id="classify-the-result"></a>

## 分类结果

编辑前先分类每项冲突。脚本提供机械分类，维护者负责产品决定。

| 分类 | 必须作出的决定 |
|---|---|
| `registered-core-patch` | 对照命名 patch 的原因、安全／数据影响、测试和退出条件检查官版变化。官版行为等价时删除私人 patch；否则只保留仍然必要的差量。 |
| `personal-product` | 保持个人 package 的领域和事实所有权，只适配它对变化后官版接口的依赖。 |
| `generated-artifact` | 先解决所有者源码，再重新生成并记录衍生物；绝不能把手工合并输出当作权威。 |
| `documentation` | 合并当前行为与独有理由，保持双语结构，然后重新记录配对。 |
| `test` | 判断失败暴露的是 fork 回归，还是断言了 fork 有意替换的行为。只有具名 divergence 才能支持修改断言。 |
| `other-upstream` | 保留任何个人修改前，先检查所有权和[功能放置政策](feature-placement.zh.md)。 |

任何涉及持久化格式、迁移、凭据、权限、仓库写入、验收或不确定外部副作用的冲突，都会停止自动推进并等待明确人工决定。

<a id="perform-an-admitted-synchronization"></a>

## 执行已准入同步

目标 SHA 与冲突决定获准后，从已快照个人 HEAD 在独立 worktree 创建具名同步 branch。合并报告中的准确 SHA，绝不能合并仍在移动的 `upstream/master`。对于 divergence 清单中的文件，不得使用 `-Xours`、`-Xtheirs`、`reset --hard` 或自动冲突解决器。

reconciliation 不简单时保留两个审查单元：merge commit 包含官版树和冲突解决；后续 reconcile commit 包含生成 artifact、测试调整、package metadata、registry 更新和文档。除非用户在验证后单独要求，否则不得 push、合并个人 `master` 或发布。

只有合并行为获准后才更新每个所有者。`upstream-base.json` 接收受支持 base、已观察 head、merge base、divergence、重新验证时间和有界证据。`core-patches.json` 删除已被替换的 patch、收窄保留路径并更新重新验证字段，不得隐藏新增风险。`FORK-DIVERGENCE.md` 汇总有意差异，不能替代任一机器所有者。

<a id="verification-and-evidence"></a>

## 验证与证据

先运行 dry-run 报告的 patch 专属命令，再使用完整官版历史验证 core patch registry。在已准入合并树上，GitHub 托管 Windows 是干净的阻断式兼容性载体；本地 Windows 10 仍是个人 runtime 行为的主要环境。Windows 最小源码门禁包括 package identity、完整构建、个人源码分发验证和约定类型检查。除非改动结论拥有可移植或 Linux 专属约定，否则托管 Linux 仍只提供建议。

记录目标 SHA、源 HEAD、merge commit、reconcile commit、冲突决定、命令、平台、输出或 artifact 引用、已知继承失败和人工验收。Agent 报告、merge-tree 结果或单独的绿色构建都不能准入 base。

<a id="rollback"></a>

## 回滚

在 merge commit 前，只能在专用同步 worktree 内 abort，并且应先验证它的 branch 与路径。默认 dry run 不需要回滚，因为它会在返回前删除准确临时 ref 和 worktree。如果清理失败，应保留报告路径并停止；不得递归删除未解析目标。

本地 merge commit 尚未共享时，应保留旧个人 branch；只有在明确清理范围内才能删除准确隔离同步 branch 或 worktree。commit 已共享后，应 revert merge 或 reconcile commit，不得改写共享历史。如果同步包含持久格式迁移，必须先遵循单独的备份、向前迁移和恢复约定，再更改生产数据。

<a id="further-exploration"></a>

## 进一步探索

- [上游兼容性 canary](upstream-compatibility.zh.md)
- [功能放置政策](feature-placement.zh.md)
- [下游 core patch registry](core-patch-registry.zh.md)
- [Fork divergence 记录](../../FORK-DIVERGENCE.md)

## Dev Note

dry run 会有意清理自己的 worktree，而不是把它变成实际 merge workspace。这使观察可重复，并让后续具名同步 worktree 成为显式准入动作。
