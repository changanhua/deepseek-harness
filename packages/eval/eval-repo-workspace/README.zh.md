---
description: "让每个 Eval cell 在已验证完整 commit 的隔离检出中运行。确定完成后移除检出；执行不确定时保留确切 Attempt 租约。Queue 适配会记录 unknown Attention，而不是重试不确定工作。"
kind: "package-library"
---

# @changanhua/dsh-eval-repo-workspace

[English](README.md) | 中文

## 摘要

让每个 Eval cell 在已验证完整 commit 的隔离检出中运行。确定完成后移除检出；执行不确定时保留确切 Attempt 租约。Queue 适配会记录 unknown Attention，而不是重试不确定工作。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在类型化 Queue handler 中导入本库的 `resolveEvalWorkspace`。准入时解析，重启后的准备阶段重新取得证明，并在 Queue 副作用边界调用返回对象的 `start`；[真实 Queue 测试](tests/workspace.spec.ts)展示该契约。

执行回调的第三个参数包含实际租约的仓库、已验证 commit、Attempt owner、检出根目录和准备摘要。检出根目录仅供 Host 使用，与 empty/fixture case 的可写目录不同。消费者据此绑定真实执行证据，不自行编造租约身份，也不接管清理。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现说明</summary>

行为与生命周期契约以 [源码](src/index.ts) 为准。此包没有独立缓存的业务投影可与 owner 状态比较，因此不发布空的 invariant companion。

</details>

<a id="further-exploration"></a>
## Further Exploration

- [Package group](../README.zh.md)
- [Setup guide](../../../docs/cookbook/trusted-eval-and-budget.zh.md)
- [Architecture](../../../docs/architecture.zh.md)

<a id="model-experience"></a>
## Model Experience

无，本包不增加模型提示，结果呈现由调用方负责。

#### KV Cache effect

本包不直接改写提示前缀，提示构造和缓存复用由相应调用方负责。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 执行器必须在子任务静止后才能报告确定完成。本桥接不提供隔离 subject、grader 或 verifier，也不证明模型质量。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者工作记录</summary>

无。

</details>
