---
description: "Personal Delivery 的仓库身份验证与 Attempt 独占隔离 Git checkout 生命周期。"
kind: "package-reference"
---

# @deepseek-ai/dsh-repo-workspace

[English](README.md) | 中文

## 摘要

`dsh-repo-workspace` 是 `ctx.repoWorkspace` 的 Service Definition。它将配置的 `RepositoryId` 与 Contract `BaseSelectionRule` 解析为经过验证的完整 commit，读取精确且有界的 Git blob，比较 Git ancestry 与 changed path，并打开由一个 Queue Attempt 独占的隔离 checkout。运行时 `cwd` 只是操作期位置，绝不能作为持久权限依据。

## 使用此包

Inspection 不产生副作用，可以在 admission 或 Packet 创建阶段执行。checkout 只能在 Queue handler 跨过 start 边界并取得 live ownership 后创建。

```ts
const base = await ctx.repoWorkspace.resolveBase({ repositoryId, selectionRule })
const planBlob = await ctx.repoWorkspace.readBlob({
  base,
  path: verificationSource.path,
  maxBytes: verificationPlanLimit,
})
const packetBase = await ctx.repoWorkspace.inspectRevision({
  repositoryId: packet.repositoryId,
  commit: packet.baseCommit,
})
const lease = await ctx.repoWorkspace.openChange({ ownerAttemptId, base: packetBase })
```

`resolveBase` 会验证显式 commit，或捕获 `ref-head` 在该次调用时指向的完整 commit。带 brand 的 proof 保留原始 selection rule，因此 proof 创建后的 ref movement 不会改写 Packet authority。`readBlob` 通过该精确 commit tree 解析规范化路径，返回 Git blob id 与一份全新的独立字节副本。预期失败分别使用 `reference-not-found`、`blob-not-found` 与 `blob-too-large`；无效字节上限属于 programmer misuse。取消会原样传播 signal 的 abort reason，不包装为 workspace failure。

Packet 持久化 exact `baseCommit` 后，change 与 verification execution 只需为该 commit 重新取得 `VerifiedRepositoryRevision`。打开 checkout 时刻意不再解析 Contract 原始的 `ref-head`：进程重启后，即使 ref 已移动，也不能把已准入工作重定向到另一 commit。

executor 进程树静止后，change lease 可以创建一个受治理的 checkpoint。verification lease 固定到一个精确 target commit。每个 lease 都必须关闭并等待：已稳定完成的工作使用 `remove`，副作用仍不确定时使用 `preserve`。cleanup rejection 属于 Attempt outcome，不能被隐藏。

## 理解实现

抽象 `RepositoryWorkspace` 服务拥有 verified-revision、verified-base、verified-blob token 与 lease 契约，本身不执行 Git 或文件系统工作。`dsh-repo-workspace-git-local` 是本地 Git Service Provider。Blob provider 必须从已证明 commit 对应的 Git object storage 读取命名对象，不能从环境中的 checkout path 读取。runner 与 verifier 接收窄的操作期 open closure 或 lease，因此无需依赖 Queue，也不能通过路径选择 DSH 控制中心 checkout。

包拓扑见 [Personal Delivery 子系统](../../../docs/subsystems/delivery.zh.md)，commit 与路径规则见 [Personal Delivery Protocol V1](../../../docs/specs/2026-08-29-delivery-protocol-v1.md)。

## 开发说明

没有待定的包内设计。provider 特定的 Git 命令与目录布局必须留在此 Service Definition 之外。

## 模型体验

### Host 仓库服务

#### 模型看到什么

模型不会看到来自 `ctx.repoWorkspace` 的内容；此服务只暴露 host Git 事实与 checkout ownership。

#### Token 影响

无。

#### KV Cache 影响

无。

## 已知限制

- 此契约只定义本地 Git worktree；没有另一个 provider 与生命周期决策时，不支持远程 workspace 和多主机 lease。
- 被保留的不确定 workspace 需要 operator 显式处理；此服务不会编造成功，也不会授权 Queue retry。
