# Agent Note: 架构浏览器的证据分层

Status: implemented

[English](2026-08-29-architecture-explorer.md) | 中文

## Problem

仓库包含数百个正式工作区包，而一个运行中的 Web Profile 只组合其中一部分包条目。静态包列表无法显示当前激活状态，Loader 快照也无法解释没有进入该进程的包。如果在没有来源信息的情况下合并两个来源，源码存在、构建组合和运行时观察会显得彼此等价。

## Decision

Web 组合包把 `@deepseek-ai/dsh-client-ui-architecture` 作为一级侧边栏模块和完整 `shell.view` 工作区。开发者浏览包字段、筛选、依赖方向、反向消费者和单包证据详情时，普通会话仍保持挂载。

构建目录和运行时叠加保持为不同证据层。`scripts/gen-architecture-catalog.ts` 从正式 `packages/*/*/package.json` manifest 确定性派生提交的 Client 目录。它记录 manifest 描述、目录领域、显式浏览器/组合包/Remote/工具声明面和仓库内 `peerDependencies`；`verify-architecture-catalog` 拒绝漂移。

运行时层复用 `pluginInventory/list`。它直接读取当前 Loader，并提供启用状态和 Fiber 阶段，不添加第二份生命周期缓存。只有当精确 module specifier 等于生成的包名时，Client 才会把运行时行连接到目录方块。UI 把未连接的包标为未观察到，而不是推断当前 Profile 排除或无法加载它们。

获取状态属于 apply 私有 snapshot controller。组件把目录作为不可变注入数据接收，通过 Slot renderer 的 `hooks` compartment 接收运行时状态，并把搜索、领域和所选包状态保留在本地。

## Alternatives considered

**由 Host 在运行时扫描源码 checkout。** 打包安装可能不包含源码 checkout，而且文件系统发现会给只读 Client 功能增加路径权限和平台行为。构建过程已经拥有确定性目录所需的精确 manifest。

**把 `pluginInventory/list` 扩展为仓库目录。** 插件清单包拥有当前 Loader 条目，并且有意不携带缓存或来源模型。构建元数据属于不同权威来源，保留在生成的 Client 产物中。

**只发布生成的模块图文档。** 该文档仍是完整依赖参考，但不能保留交互选择或连接当前 Loader 状态。架构工作区链接该所有者，而不是替代它。

**从 Loader 顺序推断 Profile 和组合包来源。** Loader 顺序证明当前配置顺序，不证明哪个 layer 最后引入或替换某一行。首版保持来源缺失，直到 Profile composer 显式公开它。

## Consequences

架构入口始终可用于随附的 Web 工作区，并且不需要新的 Host service。生成的 Client 产物会随正式包目录增长，每次 manifest 变化都必须通过新鲜度检查。依赖链接有意覆盖 `peerDependencies`，不覆盖任意 import 或 Cordis injection。

运行时状态是时间点信息，并且因为插件清单不提供 stream 而手动刷新。外部 Loader module 在独立的已安装包目录拥有权威来源之前，只通过运行时汇总计数显示。Profile 对比、组合包来源、行为验证和流程播放保持在这个证据层之外，不会显示为猜测事实。
