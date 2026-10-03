---
description: "为普通模型请求和预备请求应用资源准入。被拒绝的请求不会到达选定适配器。获准请求先结算实际用量，再发布结束输出。"
kind: "package-reference"
---

# @changanhua/dsh-budget-llm

[English](README.md) | 中文

## 摘要

为普通模型请求和预备请求应用资源准入。被拒绝的请求不会到达选定适配器。获准请求先结算实际用量，再发布结束输出。

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

将本桥接与 LLM 运行时及[本地预算 owner](../budget-local/README.zh.md)一起挂载。[Profile 示例](../budget-local/tests/fixtures/profile/budget.patch.yml)安装最终派发检查；请求必须具有正数输出 Token 上限和 Host 绑定的作用域。

Host 执行消费者可以用 `withBudgetDispatchEvidence(ctx, maxAttempts, operation)` 包裹完整等待的工作。桥接缺失时，它拒绝进入操作；返回最终派发身份、实际 Provider/model、输入摘要、是否发生派发，以及 Budget owner 的准入和预留记录。达到尝试数量上限后，后续调用在进入适配器前被拒绝。调用方提供既有 Budget 作用域，并在返回前消费或关闭全部迭代器。证据限定在当前异步操作内，不含提示词或凭据；桥接代际变化时拒绝返回成功。

可选的第四个 `validate` 回调在资源预留和 HTTP 前检查复制出的最终派发事实。拒绝仍记录实际尝试身份和 `dispatched: false`；它不能修改派发参数，也不会创建另一个预算账本。

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

通过呈现资源拒绝和获准结果的 Agent、LLM 与 Workflow 调用方间接影响模型。

#### KV Cache effect

本包不直接改写提示前缀，提示构造和缓存复用由相应调用方负责。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- 文本输入使用明确标记的字节估算。无法取得可信 Token 上界的图片会被拒绝；缺失的缓存用量字段不会被当成零。此包不做货币计费。 Agent 层重试会创建新的 stream 请求身份；attempt 序号标识同一个 stream 内的 waterfall 重入。跨重试链的关联及行为验收仍需单独完成。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者工作记录</summary>

无。

</details>
