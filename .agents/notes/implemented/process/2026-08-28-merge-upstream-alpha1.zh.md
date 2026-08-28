# Agent Note: 将上游 dsh 0.1.2-alpha.1 合并进 fork

Status: implemented

[English](2026-08-28-merge-upstream-alpha1.md) | 中文

## 问题

fork 落后官版 `dsh-v0.1.2-alpha.1`（`cd5ef81481`）1,079 个提交。官版用 API Gateway、生成 Remote 与拆分后的 Client 服务替代浏览器 ApiProxy 和 client-runtime，同时调整了 headless 入口、应用组合、生成目录与包清单。fork 的任务队列、能力视图、运行时事实、模块环、精简仓库规则和文档策略占用了相同表面，因此产生 81 个冲突路径。

## 决策

合并官版标签，采用其 Gateway/Remote 浏览器架构、包删除、headless 任务约定、应用启动器、UI 服务拆分与生成文档。通过在新装配中挂载 task-queue 和 capability Remote、经 `capabilityRegistry.management` 投影 Skills 管理、保留 `shell.view` 与 `sidebar.modules`、保留 runtime facts 与受限 DSH 队列执行器、允许带警告的显式可信网络 Web 绑定，并继续让 translation pairing 不进入 `doc-sync`，保留 fork 的有意功能。

生成目录与双语记录从合并后的源码重建。退役的 ApiProxy、client-runtime、ACP demo、JSON-RPC demo 与 ACP snapshot 包随官版删除。

## 验证

`pnpm run typecheck` 通过。聚焦合并测试覆盖 30 个测试文件、257 项测试：首轮 252 项通过、1 项跳过；4 项预期接口断言更新后单独复跑通过。16 个受影响双语对通过具名一致性检查。

## 备选方案

**把退役的 ApiProxy 与 client-runtime 留作兼容层。** 否决：该预发布 fork 没有兼容承诺；并行浏览器架构会重复持有 Session、传输与 Remote。

**删除 fork 独有的 UI 与队列功能。** 否决：它们是有意的产品能力；把它们适配到官版 Remote 与 renderer 服务，可以在保留 fork 用途的同时维持单一架构。

## 后果

fork 现在跟随官版 `0.1.2-alpha.1` 架构，后续上游更新可从新的 merge base 继续。fork 独有功能明确记录在 `FORK-DIVERGENCE.md`。后续浏览器工作必须使用 API Gateway 生成 Remote 与官版 Client 服务包，不得重新引入 ApiProxy 或 client-runtime。
