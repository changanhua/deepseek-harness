---
description: "通过受信任的 DSH Profile 运行已批准的 Eval CLI，包括安全证据读取与明确的 Queue 恢复控制。"
kind: "package-reference"
---

# @changanhua/dsh-eval-app

[English](README.md) | 中文

## 摘要

`dsh --profile <eval-profile>` 是已批准 Eval 运行的一次性操作员入口。Profile 提供 Workspace、操作员身份和允许的 policy id；命令行只提供稳定的运行、Plan、cell、Attempt、请求和操作标识。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在启动时固定的 Profile 中挂载此函数插件，并提供 `evalRuns`、`workspaceRegistry`、`cmdlineArgs`、`appReady` 和 `appExit`；Gate 命令另外需要 `evalGates`，续跑命令需要 `evalActivation`。启动运行：

```text
dsh --profile eval start --request nightly-17 --plan regression --version 1 --policy approved --wait
```

用 `show` 或 `list` 读取安全运行投影。`cancel`、`retry` 和 `resolve-unknown` 都要提供操作 id 和刚刚返回的精确 revision；重试和 unknown 处理必须由操作员明确发起。使用 `evidence <run> <cell> <attempt>` 读取一个保留 Attempt。

仅可为 Profile 列出的 Gate policy 使用 `gate evaluate <run> --policy <gate-policy>`，再用 `gate show <gate-id>` 读取结果。JSON 结果只包含安全的运行、证据或 Gate 事实。运行结果 `passed` 只是执行观察，不等于独立 Gate 决策。

只有 Profile 安装了精确 continuation policy 和 Host request factory，才能使用 `continue <gate-id> --grant <policy-id> --request <operation-id>`。factory 而非 CLI 输入会读取保留的通过 Gate 与终态 Queue Attempt，再创建一次性 activation。`activation show <id>` 会重新检查当前 Profile 授权并读取安全持久状态。activation owner 的 Profile 必须设置 `exclusiveGoalDriver: true`，且不能再组合其他自动 goal-round driver。

[操作指南](../../../docs/user/guide/eval.zh.md)解释结果状态。配套的[可选 overlay](../../../apps/cli/config/examples/eval.patch.yml)为已经配置好的 Eval Profile 添加 CLI，不提供执行授权。先注册 Workspace，再由 Profile 管理流程替换其中标记的可信值。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制</summary>

[源码](src/index.ts) 会在应用就绪前解析本应用的命令语法，在 Profile 插件树提交后调用一次共享的 `evalRuns` owner。它限制等待和输出，将 owner 错误转换成稳定 code，并要求 launcher 有界退出。它不创建第二套运行生命周期、Queue 接口、证据存储或 Gate。

</details>

<a id="further-exploration"></a>
## 进一步阅读

- [Eval 契约](../../../docs/subsystems/eval.zh.md)
- [运行生产者](../eval-runs-local/README.zh.md)
- [续跑生产者](../eval-activation-local/README.zh.md)

<a id="model-experience"></a>
## 模型体验

无；本消费者不构造模型上下文，执行和续跑生产者负责提示词。

#### KV Cache effect

无。本包不影响提示前缀或缓存复用。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

不发布 invariant companion，因为公开状态直接派生自已有 owner 或唯一账本，没有独立缓存的投影。

- Profile 管理员必须在本应用运行前注册 Workspace，并组合已批准的执行 policy。
- CLI 可以请求和读取已配置的 Gate 决策。Web UI 仍是独立消费者。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文</summary>

无。

</details>
