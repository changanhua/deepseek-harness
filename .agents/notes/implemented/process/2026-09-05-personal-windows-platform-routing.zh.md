# Agent Note: Windows 优先的个人平台任务路由

Status: implemented

[English](2026-09-05-personal-windows-platform-routing.md) | 中文

## Problem

个人下游在 Windows 10 上运行，但继承了跨平台代码库和官方上游自动化。若把可用 Runner 当作产品目标，就可能用 Linux 结果替代原生 Windows 证据，要求用户运营并不使用的 Linux 基础设施，或者仅因不部署 Linux 而丢弃可移植行为。

本地 Windows 10、GitHub 托管 Windows、GitHub 托管 Linux 和官方上游基础设施证明的是不同事实。工作规划和完成报告需要保留这些证据角色，同时不得创建另一套任务 Registry，也不得改变产品支持的平台契约。

## Decision

[`dsh-personal-platform-routing` skill](../../../skills/dsh-personal-platform-routing/SKILL.md) 按产品目标、执行载体、证据角色、阻塞结论和原因对工作分类。路由以轻量元数据保存在当前计划、WorkItem 或 handoff 中，而不是成为新的持久控制面。

对于个人 CLI、Profile、Web UI、服务、凭据、文件系统、进程、watcher、持久化和真实 Provider 行为，本地 Windows 10 是主要验收环境。GitHub 托管 Windows 提供干净的兼容性结果，但不能替代用户的具体操作系统、Profile、已安装工具、凭据或交互工作流。

Linux 不是个人部署目标。只有当改动行为拥有跨平台或 Linux 专属契约、发布 Artifact 需要原生产出环境，或者工作面向官方上游时，才使用 GitHub 托管 Linux。WSL、容器、远程 Linux 主机、自托管 Runner、仓库设置变更和部署始终属于需要单独明确授权的工作。

不部署 Linux 不代表可以移除可移植的产品行为。跨平台源码继续保留主机原生 fixture 和受影响的 Linux 证据。只有当改动代码和完成结论都不拥有相应契约时，Linux 专属证据才不阻塞仅面向 Windows 的个人结果。

个人 fork 的自动 PR 结论继续由 [fork 自有的 Windows 差分 CI](2026-08-29-fork-windows-differential-ci.zh.md) 定义的 Windows 托管工作流负责。分支推送如果没有匹配的工作流运行，就没有提供远程 CI 证据。上游或发布结论使用其自身当前的平台矩阵，不能继承此 fork 的仅 Windows 结论。

在分类之前，先使用同一平台上的可信 base 对比失败。分支引入的回归会阻塞受影响结论；继承的失败仍然是可见债务，不能被重新标记为通过证据。

## Alternatives considered

**从代码库删除 Linux 检查。** 这会把部署偏好与受支持行为变更混为一谈，并隐藏可移植或 Linux 所属契约中的回归。

**把 Linux CI 用作通用完成信号。** 托管自动化中的 Linux 易于获取，但不能证明 NT 路径、权限、进程行为、本地 Profile、凭据或用户的 Windows 10 工作流。

**运营个人 Linux 或自托管 Runner 基础设施。** 这会增加管理成本，并且对于公共 fork 代码会引入重大的信任边界。托管载体可以提供条件式兼容性证据，而不会让 Linux 运维成为个人产品的一部分。

**要求每项任务都运行 Windows 和 Linux。** 文档、schema 和其他平台中立改动不会自动需要重复载体。从改动结论出发进行路由，可以在确有意义时保留跨平台证明，而不会把它变成形式化消耗。

## Consequences

个人产品完成报告会分别列出本地 Windows 10 证据、托管 Windows 结果和 Linux 结果。干净的托管结果提高可复现性，而对精确 checkout 的本地观察仍然是用户实际运行时行为的主要证明。

跨平台、Linux 专属、发布和上游改动仍可能要求托管 Linux，并且相应结果可以阻塞其自身结论。用户无须仅为保留这些证据而安装或管理 Linux。

未来采用 Linux 部署目标、自托管 Runner 或扩大的个人 CI 矩阵，需要显式变更范围。在此之前，这些系统不能成为普通个人 Windows 工作的隐藏前提。
