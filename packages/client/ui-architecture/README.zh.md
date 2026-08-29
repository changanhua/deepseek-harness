---
description: "在一个全页 Web 工作区中浏览完整的构建期 DSH 工作区包目录、依赖方向和当前 Loader 激活状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-architecture

[English](README.md) | 中文

## 概述

架构工作区让开发者浏览所有正式 DSH 工作区包，同时不会把源码存在误当成运行时激活。页面分开呈现生成的构建目录与当前 Loader 快照，再按精确包名连接两者，显示哪些目录包已进入组合。搜索、领域筛选、依赖链接、反向消费者和包描述让完整目录可以在一个页面中使用。

## 目录

- [使用这个包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [继续了解](#further-exploration)
- [模型体验](#model-experience)
- [已知限制和延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用这个包

随附的 Web 组合包把该包挂载为一级侧边栏模块列表中的“架构”入口。打开入口时，普通会话仍挂载在底层，中央列显示完整工作区。

提交的目录由 `packages/*/*/package.json` 生成；`pnpm run verify-architecture-catalog` 会拒绝过期结果。运行时刷新调用 `pluginInventory/list`，并且只显示 Host 确认的时间点 Loader 状态。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

生成器记录包描述、领域、显式浏览器/组合包/Remote/工具声明面，以及规范的仓库内 `peerDependencies`。Client 插件注册一个 `sidebar.modules` 条目和一个 `shell.view` 条目。apply 私有控制器把 Loader 响应保留在 React 之外；Slot renderer 通过注入的 `useRuntime` selector hook 绑定其 observable。

| 文件 | 作用 |
| --- | --- |
| [`src/client/ArchitectureWorkspace.tsx`](src/client/ArchitectureWorkspace.tsx) | 全页包字段、筛选、依赖导航和证据详情 |
| [`src/client/runtime-controller.ts`](src/client/runtime-controller.ts) | 时间点 `pluginInventory/list` 加载和过期响应拒绝 |
| [`src/client/catalog.generated.ts`](src/client/catalog.generated.ts) | 确定性构建目录；由生成器维护，禁止手工编辑 |
| [`../../../scripts/gen-architecture-catalog.ts`](../../../scripts/gen-architecture-catalog.ts) | 目录写入器和新鲜度检查 |

</details>

-----

<a id="further-exploration"></a>
## 继续了解

- [架构](../../../docs/architecture.zh.md) — 组合、运行时领域和扩展点。
- [模块依赖图](../../../docs/module-graph.zh.md) — 生成的完整 `peerDependencies` 图。
- [Web Client 架构](../../../docs/subsystems/web-client.zh.md) — 模块加载、Slots 和 Host 投影。
- [插件清单](../../host/plugin-inventory/README.zh.md) — 当前 Loader 快照的权威来源。
- [架构浏览器决策](../../../.agents/notes/implemented/feature/2026-08-29-architecture-explorer.zh.md) — 证据分层和替代方案。

-----

<a id="model-experience"></a>
## 模型体验

无，因为这个包是只读 Client 呈现，不注册面向模型的 Tool、prompt section 或 Session event。

#### KV Cache 影响

无；目录生成发生在开发期间，运行时刷新读取 Host 投影，不启动模型请求。

## 已知限制和延期工作

<a id="known-limitations-and-deferred-work"></a>

这个视图只陈述两个证据所有者能够证明的事实。

- **构建身份，而不是实时源码** — 目录代表用于构建 `lib/client.js` 的 checkout；只编辑 manifest 而不重新生成和构建，无法改变已经运行的页面。
- **运行时快照，而不是来源链** — Loader 条目显示启用状态和 Fiber 阶段，但不识别由哪个 Profile、组合包或 patch layer 引入。
- **Manifest 依赖图** — 依赖和消费者链接使用仓库内 `peerDependencies`；它们不声称枚举源码导入或 Cordis service injection。
- **手动运行时刷新** — Host 不提供插件清单订阅，因此打开的页面只在用户请求或插件重载时刷新。
- **仅限工作区包** — 外部插件可以贡献 Loader 条目，但只有构建 checkout 中的包才有生成的包方块。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
