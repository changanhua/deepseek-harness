# 实操手册：收敛大型 upstream 合并

[English](merging-upstream.md) | 中文

当 DSH 下游分叉需要吸收大型 `upstream/master` 更新，同时保留分叉自有包和本地工作时，使用本手册。目标是得到一个可审阅的候选分支：祖先关系明确、生成物最新、有定向运行时证据，并明确列出尚未解决的基线债务；本手册不授权推送或发布。

## 1. 在触碰 Git 前冻结范围

先证明本次操作涉及哪个 checkout、分支和 upstream 引用。脏的根目录或个人工作树是受保护的输入，不是合并目标。

```powershell
git status --short --branch
git worktree list
git remote -v
```

记录受保护的目录、运行中的服务、数据根目录和用户点名的脏文件。不要为了让合并变容易而重置、清理、强制切换、删除或停止它们。

获取指定的 upstream 引用，并在创建候选分支前记录其对象 id、合并基点以及 ahead/behind 计数。

```powershell
git fetch upstream --prune
git rev-parse --verify upstream/master
git merge-base HEAD upstream/master
git rev-list --left-right --count HEAD...upstream/master
```

## 2. 创建隔离候选并留下检查点

从已经核验的源分支创建新的工作树，然后在那里合并 upstream。先核对实际的源引用和分支名再替换占位符；不要从过时的任务标题推断它们。

```powershell
git worktree add .worktrees/upstream-merge -b codex/upstream-merge <source-ref>
git -C .worktrees/upstream-merge merge --no-ff upstream/master
```

在候选工作树自身安装依赖。绝不要把一个工作树的 `node_modules` 用 junction 或 symlink 连接到另一个工作树：pnpm 可能重建目标，从而改写错误的 checkout。Windows 非交互安装需要重建 modules 时，设置 `CI=true`，并确保安装范围只落在候选工作树。

每次会话结束时保存简短检查点，包含候选路径、分支、HEAD、合并基点、已完成波次、下一条确切命令或文件集合、已知失败，以及失败属于基线还是本次改动。恢复时从检查点和已有终端句柄继续，不要重复发现过程或重启长命令。

## 3. 按所有权分层冲突

编辑前先列出未解决路径并为它们分配 owner。顺序很重要，因为后续层依赖共享契约。

```powershell
git diff --name-only --diff-filter=U
git status --short
```

- 先处理共享契约：Session 与日志格式、Connection、LLM、Host/Client 组合，以及生成的 Remote 声明。
- 再处理分叉自有能力族：upstream 可能没有的 Browser、Content、Queue、Runtime/Capability、UI 和 vision-relay 包。
- 最后处理配置、manifest、别名、lockfile、生成 catalog、文档和快照；这些始终由主代理负责集成。
- 如果双语 sidecar 让合并停住，先让配对驱动处理安全记录；合并已经停住时，运行 `pnpm run resolve-translation-pairing-conflicts`，再手动处理剩余的 owner 冲突。

不要用整批 `ours` 或 `theirs` 解决功能冲突。读取源代码、测试、包 manifest、Loader 行、Profile 或 Bundle wiring，以及所属 Agent Note；逐项恢复每个能力。记住，Bundle 的整行替换必须重新写出所有必需字段。

## 4. 用有边界的波次收敛

使用小提交，让后续会话能识别最后可信状态，也让审阅者能把契约修复与生成物噪声分开。

1. 让共享类型和生命周期契约编译通过，包括 Host 与 Client 两个 aggregate program。
2. 修复 Profile、Bundle、Loader、别名和包引用，确保目标组合确实可以加载。
3. 按当前共享契约恢复或适配分叉自有包和 test double。
4. 从 owner 源代码重新生成 catalog 和其他派生文件；绝不手改生成区域。
5. 只刷新运行时契约确实变化的快照，并在 Bash 与 PowerShell 有差异时使用平台感知断言。

每恢复一个包，都要从源代码和 `package.json` 追踪到 TypeScript 引用、Loader/Profile 组合、构建产物以及一个运行时或回放测试。包目录存在、HTTP 返回 200 或静态配置解析成功，都不能证明运行中的产品实际使用了它。

## 5. 重新生成并校验派生物

共享契约稳定后运行每个生成器，再运行对应的新鲜度检查。DSH 合并通常需要这些检查：

```powershell
pnpm run gen-cordis-catalog
pnpm run gen-tool-catalog
pnpm run gen-client-catalog
pnpm run gen-persistence-catalog
pnpm run verify-cordis-catalog --check
pnpm run verify-tool-catalog
pnpm run verify-client-catalog
pnpm run verify-persistence-catalog
pnpm run verify-cordis-config
pnpm run verify-client-packages
```

有些生成器会在 `.tmp` 下创建临时文件；提交前检查 `git status`，只删除生成器明确创建的准确路径，绝不要用宽泛的 clean 命令。

生成文档依赖源代码中的 JSDoc 和类型声明。如果新鲜度或文档门槛暴露的是既有缺失 prose、失效链接或类型等价漂移，记录精确输出并与合并前候选对照；不要削弱生成器，也不要手改输出隐藏失败。

## 6. 从定向证据到广泛证据进行验证

使用能让第一处失败可归因的验证阶梯。

1. 运行 `git diff --check` 和本波次最小的包级或契约测试。
2. 运行完整的 project-reference 类型检查，而不是只跑叶子项目。
3. 运行 `npm run build`，让 Host、Client、生成契约和 Web 产物一起重建。
4. 运行覆盖修复入口的定向 Web 或单元场景，然后检查持久化会话或快照证据。
5. 只有在构建运行时闭包完整后，才运行广泛的 Web 和文档套件。

广泛套件变红时，在合并前候选上运行同一个门槛，或把精确失败类别与基线比较。把每个结果标为与改动相关、基线债务或基础设施不确定。构建通过时，Web 启动、Profile 组合、持久化或真实 provider 仍可能失败；不能仅凭构建输出宣称合并达到 release-ready。

平台专属快照需要额外谨慎。尽可能保留一个 canonical fixture，让直接断言按平台处理，只正规化可选的传输噪声（例如 PTY 完成标记），绝不要把真实工具错误或能力变化正规化掉。

## 7. 在不丢失证据的情况下收口

在宣称本地集成完成前：

- 更新 [`FORK-DIVERGENCE.md`](../../FORK-DIVERGENCE.md)，记录受支持的 upstream 基线和刻意保留的分叉行为。
- 对非简单冲突解决新增或更新 implemented process/testing Agent Note，记录替代方案、影响、验证和明确的覆盖缺口。
- 对每个编辑过的双语 pair 运行 `pnpm run verify-translation-pairing --write <pair>`，再运行具名 pair 检查。
- 确认 `git status --short --branch`、最终 ahead/behind 计数、确切提交和 `git diff --check`。
- 明确报告未解决的基线门槛；除非另有发布授权，否则保持候选分支不推送。

## 多 session 合并的经验教训

- session 数量不是进度单位；带有确切下一步的已提交检查点才是。
- 工作树隔离能同时保护合并候选与用户的无关 WIP，但共享依赖目录会破坏这种隔离。
- 共享契约和运行时组合必须先稳定，再恢复个人包和刷新生成物。
- 定向运行时证据比漫长的广泛套件更快定位真实回归；广泛失败仍必须做基线对照。
- “本地合并可审阅”和“仓库达到 release-ready”是两种不同声明，需要不同证据。

## 延伸阅读

- [开发指南](../development.zh.md)负责 aggregate 构建和日常贡献者流程。
- [测试策略](../testing.zh.md)负责真实 provider、Profile、回放和凭证边界。
- [分叉差异记录](../../FORK-DIVERGENCE.md)负责刻意保留的下游差异。
- [upstream 合并收敛 Agent Note](../../.agents/notes/implemented/process/2026-09-14-upstream-merge-reconciliation.zh.md)记录促成本手册的具体检查点。
