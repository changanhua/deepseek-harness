---
description: "使用原生 Codex app-server provider 对已准备 knowledge-base 阶段进行持久 Queue 执行和恢复。"
kind: "package-reference"
---

# @changanhua/dsh-knowledge-base-task-queue

[English](README.md) | 中文

## Summary

`dsh-knowledge-base-task-queue` 通过本地 Queue 和原生 Codex provider 运行已准备的知识阶段。每个 work item 固定声明一个 `knowledge-base` 单位和一个 `codex` 单位，因此包含它的 Queue 配置必须为两者都提供至少一个容量。它在 cleanup 前持久保存收到的响应，并把已验证的业务完成交还给 Queue；中断或副作用不确定时会保持 `unknown`，直到显式恢复操作证明安全。它适用于持久阶段执行，不是通用 Codex 调度器。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

在知识仓库、本地 Queue 和 subprocess provider 之后挂载该服务；其配置选择原生 Codex 运行模型、权限模式和释放宽限时间。

### Failure recovery

`resumeStage` 仅接受具有已验证 completed stage 或可恢复响应收据的 `unknown` work item。`retryStage` 仅接受副作用为 `not-started` 的已知 `failed` item，并重试原 Queue work。`correctStage` 仅接受 `failed` 的 `knowledge-validation` item，保留其被拒响应，并创建有界的修正阶段。停止的生成控制会阻止新的、重试的和修正的模型调用，直到人工 `/knowledge` 命令或可信 Host 请求恢复 generation；模型工具会拒绝 `resume-generation`。

### Queue capacity

handler 的声明固定为 `knowledge-base: 1` 和 `codex: 1`，在 bundle 默认配置下会串行启动知识阶段。Profile 本地替换 `task-queue` 配置会替换整个 row，因此覆盖时必须保留这两个资源容量。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>实现细节 — 点击展开</summary>

准入会解析先前准备的业务阶段、绑定其 Queue work 身份，并在不启动 Codex 的情况下重放 completed stage。服务只使用 operator 视图管理自身 `knowledge.stage@1` 绑定，不管理其他 Queue kind。runner 等待配置的 cwd 后、启动 Codex 前会再次检查持久停止和取消状态。runner 会在 provider cleanup 前捕获 completed response，然后要求仓库接受它。start 后失败和 cleanup 不确定会产生 Queue `unknown`；恢复会验证已保存响应或候选，再授权 Queue 结算。

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Queue 服务、阶段准入、重试、修正和显式恢复。 |
| [`src/runner.ts`](src/runner.ts) | 原生 Codex 生命周期、响应捕获、cleanup 和结果分类。 |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Knowledge package map](../README.zh.md) — 内容和工具 owner。
- [Knowledge business repository](../knowledge-base/README.zh.md) — 响应收据、候选和持久项目状态。
- [Knowledge tool bundle](../tool-knowledge-base/README.zh.md) — 面向用户的操作。
- [Local Task Queue](../../task-queue/task-queue-local/README.zh.md) — Queue Work 和 Attempt 语义。

-----

<a id="model-experience"></a>
## Model Experience

### 原生知识阶段

#### What the model sees

原生 Codex run 会收到仓库的已准备 `prompt`。Queue work id、attempt id、容量声明、恢复状态和 provider cleanup 诊断均不会进入 prompt。

#### Token effect

prompt 会贡献所选来源、前置项和请求的生成或审查任务。Queue 记账不会增加模型 token。

#### KV Cache effect

一个阶段的已准备输入不可变。变更来源、前置项、修正或模型路由会改变请求，并可能阻止缓存复用。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

这些限制维持保守的副作用边界。

- **unknown 永不自动重试** — 被杀掉或其他不确定的原生 run 需要已验证恢复和显式授权。
- **恢复需要收据** — 没有响应收据、completed stage 或持久候选时，Queue 不能安全恢复该 work。
- **固定容量名称** — 每个已挂载 Queue 都需要 `knowledge-base` 和 `codex` 容量声明。
- **仅原生 provider** — 此桥接使用 Codex app-server run 路径及其现有本地认证。

<a id="dev-note"></a>
### Dev Note

无。
