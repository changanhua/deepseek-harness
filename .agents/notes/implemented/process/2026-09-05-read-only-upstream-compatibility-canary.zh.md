# Agent Note: 只读上游兼容性 canary

Status: implemented

[English](2026-09-05-read-only-upstream-compatibility-canary.md) | 中文

## Problem

个人 fork 会有意跟随一个稳定官版 base，而不是持续合并官版 `master`。静态基线和 patch registry 可以暴露当前 divergence，却不能检测新的官版 head、显示它触碰哪些已登记 patch series，或在维护者开始同步工作前区分普通官版变化与合并冲突。

每次定时触发都运行完整跨平台构建，会在官版 SHA 未变化时浪费托管容量。把方便获取的 Linux 当作唯一门禁，也会违背个人 Windows 10 运行目标；自动合并则会把建议性观察变成未经授权的准入决定。

## Decision

`.github/workflows/ci-upstream-watch.yml` 每周运行，也允许所有者在个人仓库手动触发；其权限是 `contents: read`，checkout 不持久化凭据，并且不使用 secret。轻量 detect job 读取 `upstream-base.json.observedUpstreamHeadSha`，并通过 `git ls-remote` 解析所选官版分支。SHA 相同时，运行会直接结束，不安装依赖，也不启动平台 job。

SHA 变化后，会针对已固定的 fetch head 启动一个 report job。[`scripts/generate-divergence-report.ts`](../../../../scripts/generate-divergence-report.ts) 比较已记录和目标官版历史，对个人 head 运行 `git merge-tree`，归组变化 package 路径，把官版路径映射到 `core-patches.json` 的有效条目，并写入一份 JSON artifact 和 Markdown 摘要。报告发现冲突时，会先上传证据再失败，不运行平台 job。工作流不会更新 `upstream-base.json`；移动受支持 base 仍是单独审查的决定。

Heatmap 分数是 `max(1, 私人路径数) × max(1, 不同官版 commit 数) × 架构中心性 × 数据迁移风险`。registry 拥有两个 1 至 4 的判断因子，Git 历史拥有两个测量因子。按此分数排序可以识别同时具有广泛私人修改、反复官版活动、架构影响和数据风险的 patch series，但不能把分数当作兼容性证明。

报告干净时，GitHub 托管 Windows 会运行临时合并、package identity 检查、完整仓库构建、个人源码分发验证和约定类型检查，并作为阻断式兼容性门禁。GitHub 托管 Linux 会检查 package identity，并运行 Host 构建和约定类型检查，在 job 层以 `continue-on-error` 提供建议。这扩展了 [Windows 优先的平台路由决定](2026-09-05-personal-windows-platform-routing.zh.md)：托管 Windows 不能替代准确的本地 Windows 10 证据，托管 Linux 也不会成为个人部署目标。

## Alternatives considered

**自动合并干净的官版 head。** 不采用，因为合并机制无法决定新 base 是否保留个人产品行为、数据、证据和已接受的私人 patch。canary 可以观察和报告，但不能准入或发布。

**每次定时触发都运行完整矩阵。** 不采用，因为官版 SHA 是这个 canary 最廉价且完整的失效键。该输入不变时，重任务不会增加证据。

**把 Linux 用作必需门禁。** 不采用，因为个人产品运行在 Windows 10。Linux 对可移植行为仍有价值，但它容易获得并不代表它能证明 Windows 路径、进程、Profile、凭据或交互式运行。

**把最新观察值保存在工作流状态或 Issue 评论中。** 不采用，因为 `upstream-base.json` 已经拥有经过审查的 Git 基线事实。工作流本地状态或 GitHub 讨论状态会创建第二个、更弱的所有者，并可能在未准入 base 时静默推进观察值。

## Consequences

官版 drift 会在一个每周间隔内或按需变得可见，而无变化的周只消耗一次浅 checkout 和一个只读远端查询。发生变化的周会在创建任何同步分支前留下机器可读的冲突、package、patch 和 heatmap 证据。

工作流会在一次性 runner 内写临时合并 object 和报告文件，并上传 JSON artifact，但它没有仓库写权限，也不包含 ref 更新、merge commit、push、发布或部署动作。仍需完成一次托管运行，才能证明 GitHub job 本身能够执行；本地测试只证明报告与声明式工作流约定。

[下游 core patch 决定](2026-09-05-downstream-core-patch-budget.zh.md)仍保持有效且未被取代：它拥有已准入基线和 patch 清单。本 Agent Note 拥有 latest-upstream 观察与 canary 专属平台路由。两份 Agent Note 都不会把 Agent 自报完成变成交付事实，也不会授权新的受支持 base。
