# 上游兼容性 canary

[English](upstream-compatibility.md) | 中文

## 概述

canary 会先检测官版上游是否出现新 head，再决定是否投入完整构建。head 变化后，它会生成临时合并报告、受影响 package 清单和私人 core-patch heatmap。合并干净时，流程进入阻断式 GitHub 托管 Windows 门禁和非阻断式 GitHub 托管 Linux 建议检查。工作流绝不准入新的受支持 base、推送 ref 或修改 `master`。

## 目录

- [调度与信任](#schedule-and-trust)
- [报告与 heatmap](#report-and-heatmap)
- [平台门禁](#platform-gates)
- [在本地运行报告](#run-the-report-locally)
- [失败与恢复](#failure-and-recovery)
- [进一步探索](#further-exploration)
- [Dev Note](#dev-note)

<a id="schedule-and-trust"></a>

## 调度与信任

`.github/workflows/ci-upstream-watch.yml` 在每周一 UTC 03:23 运行，也支持所有者手动触发。它只在 `changanhua/deepseek-harness` 中运行；手动运行还要求触发者是所有者。仓库权限固定为 `contents: read`，所有 checkout 都禁用凭据持久化，并且任何 job 都不会获得 secret。

detect job 只 checkout 一个 commit，通过 `git ls-remote` 解析所选官版分支，再与 `upstream-base.json.observedUpstreamHeadSha` 比较。SHA 相同时，它会跳过依赖安装、合并分析和两个平台 job。分支名无效或无法解析时，流程会在重任务开始前失败。

<a id="report-and-heatmap"></a>

## 报告与 heatmap

SHA 变化后会启动 report job。该 job 获取完整官版历史，验证获取到的 head 仍等于 detect job 的 SHA，安装不可变依赖，在已观察上游对象存在的条件下验证 core patch registry，并对个人 head 运行 `git merge-tree`。临时合并可能在一次性 runner 中写入临时 Git object，但不会更新 branch ref 或 checkout。

JSON artifact 与 GitHub step summary 包含个人 head、受支持和已观察上游 SHA、目标 SHA、合并状态、冲突路径、官版变更路径、受影响 package 和受影响的有效 patch series。`upstream-base.json` 仍是已准入基线事实的唯一所有者；报告绝不会改写它。

每行 heatmap 按 `max(1, 私人路径数) × max(1, 官版 commit 数) × 架构中心性 × 数据迁移风险` 排序。两个判断因子都由 `core-patches.json` 记录为 1 至 4 的整数。路径数衡量私人修改密度，触碰匹配路径的不同官版 commit 数衡量官版变更频率。

<a id="platform-gates"></a>

## 平台门禁

冲突报告会先上传证据再失败，因此两个平台 job 都不会运行。报告干净时，流程会在 `windows-latest` 检查 package identity、构建临时合并 checkout、验证个人源码分发并进行约定类型检查；任何失败都会阻断 canary。托管 runner 提供干净的 Windows 兼容性证据，但不能证明用户具体的 Windows 10 环境。

报告干净时，还会在 `ubuntu-latest` 检查 package identity、运行 Host 构建和约定类型检查，并在 job 层设置 `continue-on-error`。对于这个面向个人 Windows 的产品，Linux 只提供兼容性建议，不是部署目标或隐藏的验收前提。

<a id="run-the-report-locally"></a>

## 在本地运行报告

在已经具有目标 upstream ref 和完整历史的 checkout 中运行：

```powershell
pnpm run check:core-patches -- --require-observed-upstream
pnpm --silent run report:upstream-compatibility -- --upstream-ref upstream/master --format markdown --json-output "$env:TEMP\dsh-upstream-compatibility.json"
```

第一条命令证明已记录 registry 与可用 Git 历史一致。第二条命令打印人类摘要，并写入同一次运行的结构化 JSON。`not-run` 合并状态表示目标 SHA 等于已记录观察值，不表示已经测试合并。

<a id="failure-and-recovery"></a>

## 失败与恢复

如果官版分支在检测和获取之间继续前进，应重新运行工作流，让所有 job 使用同一个目标 SHA。如果缺少已观察上游对象，应先获取完整官版历史再重试。如果报告发现冲突，应检查已上传 JSON、分类受影响 patch series，并使用上游同步 dry run；不要通过本工作流移动受支持 base。

工作流的本地合并和报告文件只存在于一次性 runner 中。它没有仓库写权限，也不包含 commit、push、强制更新、发布或部署步骤。

<a id="further-exploration"></a>

## 进一步探索

- [下游 core patch registry](core-patch-registry.zh.md)
- [Fork divergence 记录](../../FORK-DIVERGENCE.md)
- [Windows 优先的平台路由决定](../../.agents/notes/implemented/process/2026-09-05-personal-windows-platform-routing.zh.md)
- [只读 canary 决定](../../.agents/notes/implemented/process/2026-09-05-read-only-upstream-compatibility-canary.zh.md)

## Dev Note

本次修改已验证源码和本地报告路径。只有完成一次托管运行后，完成报告才能声称定时或平台 job 已成功执行。
