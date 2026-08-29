# Agent Note: 无 Parent 的 Codex app-server 运行

Status: implemented

[English](2026-08-29-parent-free-codex-app-server-run.md) | 中文

## Problem

Codex Subagent Provider 从父 Session 解析工作目录，而 host 拥有的交付 Attempt 需要在受信 Git worktree 内运行，并且不能虚构 Agent 或 Session identity。伪造 Parent 会让 lineage 与 authority 数据看似真实，但 Attempt 实际由 host 而非 Session 拥有。

app-server 生命周期已经把 prompt、取消 signal、工作目录、进程 spawn 操作、环境、permission mode 和 teardown bound 作为 resolved input。它对 Parent 的依赖属于 Provider adapter，而不属于 Codex process driver。

## Decision

`packages/subagent/subagent-codex/src/run.ts` 把 implementation-only 的 `startCodexAppServerRun()` 入口与共享 Subagent adapter 分开。底层请求只包含 `prompt` 与 `signal`；`CodexRunSpec.cwd` 提供显式绝对 workspace。现有 `startCodexRun()` adapter 移除 Parent 字段，并在 `CodexProvider` 按既有 policy 解析父 Session cwd 后委托给该入口。

implementation-only 入口不从 package root 导出，也不建立 `ctx.codeExecutors` 能力 seam。后续 Delivery Consumer 可以把此结果作为 feasibility evidence，但第二个生产 Consumer 必须证明最终 service contract、package ownership 与 provider registry 的必要性。

共享本地 Subprocess Provider 继续拥有进程树。AbortSignal 会结算本地取消并发送 best-effort Codex interrupt；caller 随后必须等待 `SubagentRun.dispose()`，由它终止 managed tree 并等待 quiescence。仅有 canceled result 不能证明进程已经退出。

## Verification

确定性 suite 证明了无 Parent 的 prompt、signal 与 cwd 精确接线。它也证明 cancellation 会结算 run，而 disposal 会保持 pending，直至 managed process 报告退出。

real-product suite 包含 linked-worktree 场景，要求固定版本的 `@openai/codex` 创建 relative-path proof file，并验证精确 prompt、cwd、Git root、common directory 与文件位置。其 cancellation 场景让真实 Responses 请求保持未完成，捕获 process tree（在 Linux 上包括不同的 Node-wrapper 与 native-Codex identity），触发 abort，等待 disposal，并验证所有已捕获 identity 均已死亡。

在 2026-08-29 Work Mode executor 中，未经修改的 approve-for-me real-product baseline 与新增场景都在 run publication 前停滞；此前 Codex 警告它拒绝在 `/tmp` 下创建 PATH helper alias。因此当前 checkout 没有已通过的 real-product Gate B evidence。具备可用 baseline 的 merge environment 必须先通过未经修改的 baseline，再通过两个无 Parent 场景；只有 baseline 通过后，新增场景失败才有归因价值。

## Alternatives considered

**把 `SubagentStartRequest.parent` 改成可选。** 否决，因为 Parent 是共享 Subagent seam 及其 in-process Provider 必需的 authority 与 lineage input。单个 host-owned execution path 不能证明应削弱所有 caller 的 contract。

**伪造最小 Parent Agent。** 否决，因为该对象会声称并不存在的 Session identity 与 workspace ownership。它还会让 durable delivery Attempt 耦合到未来 Subagent Provider 可能读取的其他 Parent 字段。

**在 Spike 阶段增加 public code-executor seam。** 否决，因为当前尚无生产 Delivery Consumer 或第二个 Provider。此时发布 registry 会让 Spike 在缺少 current-consumer evidence 时决定 service contract。

**回退到 `codex exec --json`。** 否决，因为现有固定版本 app-server driver 接受全部所需显式 input，并已与 process-tree owner 组合。第二种 Codex transport 会重复 permission、failure、cancellation 与 result normalization。

## Consequences

Delivery 实现可以在没有伪造 Parent Agent 的情况下继续，既有 Subagent Provider 保持外部行为。无 Parent function 在 Delivery Consumer 建立缺失 contract 前仍是 internal feasibility boundary，而不是稳定 cross-package API。

每个 host-owned caller 必须提供 validated cwd 与 trusted spawn closure，并且在 success、failure 或 cancellation 后等待 disposal。real-product proof 需要 Git 与固定版本 Codex platform package；确定性的 wire 与 lifecycle unit test 继续作为普通修改的低成本覆盖。
