# Agent Note: 下游 core patch 清单与预算

Status: implemented

[English](2026-09-05-downstream-core-patch-budget.md) | 中文

## Problem

fork divergence 文档解释了有意差异，却无法证明每一处新增加在上游所有 runtime 或 build 文件中的修改都属于经过审查的 patch series。Git 历史也无法自行判断某项修改是个人产品、compatibility adapter、可通用于上游的候选修复，还是意外的 core 修改。缺少机器所有者时，私人 patch 会扩散到共享文件、超过个人维护者的审查能力，并在上游提供等价能力后继续残留。

package identity registry 拥有 npm 来源事实。如果同时用它保存 Git 基线或 runtime patch，就会混合无关权限，并让 package 分类修改能够改写受支持上游决定。

## Decision

[`upstream-base.json`](../../../../upstream-base.json) 是受支持上游 commit、最近观察到的上游 commit、已记录个人 head、merge base、ahead/behind 数量、重新验证时间和有界 runtime evidence 的唯一机器所有者。已记录个人 head 是经过审计的输入 revision，不是指向承载该 JSON 文件之 commit 的自引用；它必须保持为待检查 head 的 ancestor。[`downstream/package-identities.json`](../../../../downstream/package-identities.json) 使用 schema version 3，不再包含上游 revision 字段。

[`core-patches.json`](../../../../core-patches.json) 统一拥有有效私人 core patch 清单及三项上限：有效 patch 数量、风险点总数和 critical patch 数量。每个条目表示一组命名 patch series，记录负责人、引入 commit、受影响的上游路径与 package、放置理由、事实／数据／安全影响、测试、canary 命令、迁移与回滚、替换条件、上游引用、复查期限、冲突位置、最近重新验证的上游 revision 和风险。

[`scripts/check-core-patch-budget.ts`](../../../../scripts/check-core-patch-budget.ts) 比较受支持基线与指定个人 head。被新增、修改、删除、重命名或改变类型的上游所有 runtime、build、workflow 和仓库控制路径必须由有效条目覆盖。检查排除 `vendor/`、文档、Agent Note、package README、双语 sidecar、已登记个人 package 和有界下游新增路径，因为它们已有自己的所有者和检查；上游所有 package 内的未登记新增文件仍在检查范围内。

检查器拒绝缺少必填字段、重复 id、跨 package 通配 pattern、仓库外证据路径、缺失证据文件、不存在或无法从 head 到达的引入 commit、过期复查、基线与 Git 历史不一致、未覆盖的上游路径和超出预算。compatibility adapter 必须声明 `factOwnershipEffect: "none"`；adapter 不能成为业务状态所有者。普通 fork checkout 会报告已观察上游对象是否可用；upstream-aware 调用方使用 `--require-observed-upstream` 让对象缺失成为错误。初始清单包含十组有效 series，风险为 66/70，并包含一组 critical series；当前覆盖路径数量由结构化报告统一拥有。

## Alternatives considered

**只保留 `FORK-DIVERGENCE.md`。** 不采用，因为人类 prose 无法可靠检测新修改的 core 路径、强制复查期限或计算风险预算。

**根据 Git commit 自动生成 patch 所有权。** 不采用，因为 commit topology 只能证明 ancestor，不能证明产品所有权、放置理由、安全影响或替换条件；这些决定必须由维护者显式作出。

**所有修改只与最新上游 tip 比较。** 不采用，因为个人发行版有意支持一个稳定基线。latest-upstream compatibility 在独立准入决定移动受支持基线前，只是 advisory canary。

**允许一个宽泛的 `packages/**` registry 条目。** 不采用，因为它会让检查变绿，却隐藏 registry 本应暴露的跨领域 core 修改。

## Consequences

每一处保留的上游 core 修改都有可搜索的 patch-series 所有者和显式移除路线。新增 core 工作必须属于已有有界 series，或者触发可见的 registry 与预算决定。剩余四点风险余量刻意保持很小：再增加 high-risk 或 critical patch 前，必须先移除、替换、向上游贡献，或者显式修改预算，不能静默累积。

registry 是治理证据，不能证明 patch 正确、对应测试命令已在当前环境通过，或者最新上游能够合并。Focused test、Windows 验收、latest-upstream canary、数据迁移检查和人类决定继续分别拥有这些责任。相关的[仓库拥有的 npm 身份](2026-09-04-repository-owned-npm-scope.zh.md)仍保持有效，因为 package 来源和发布权限是相互独立的决定。
